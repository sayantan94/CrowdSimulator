#!/usr/bin/env python3
"""
Standalone OASIS simulation runner.
Called by the TypeScript agent via shell tool.

Usage:
    python run_oasis.py --profiles profiles.json --platform twitter --rounds 5 --db-path ./sim.db --post-text "..."

Follows MiroFish patterns for OASIS integration.
Outputs JSONL progress events to stdout for real-time streaming.
"""

import argparse
import asyncio
import json
import os
import sys

# Add oasis to path
OASIS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "oasis")
sys.path.insert(0, OASIS_DIR)

import oasis
from oasis.social_platform.typing import ActionType, DefaultPlatformType


def get_model():
    """Create a CAMEL model backend for OASIS agents."""
    from camel.models import ModelFactory
    from camel.types import ModelPlatformType

    provider = os.environ.get("CS_LLM_PROVIDER", "openrouter")
    model_id = os.environ.get("CS_LLM_MODEL")
    if not model_id:
        raise RuntimeError("No model specified. Set CS_LLM_MODEL env var.")

    if provider == "openrouter":
        api_key = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("OPENAI_API_KEY") or os.environ.get("CS_OPENROUTER_API_KEY")
        if not api_key:
            raise RuntimeError("No API key found. Set OPENROUTER_API_KEY or OPENAI_API_KEY env var.")
        return ModelFactory.create(
            model_platform=ModelPlatformType.OPENAI_COMPATIBLE_MODEL,
            model_type=model_id,
            api_key=api_key,
            url=os.environ.get("CS_OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        )
    elif provider == "bedrock":
        return ModelFactory.create(
            model_platform=ModelPlatformType.AWS_BEDROCK,
            model_type=model_id,
        )
    else:
        return ModelFactory.create(
            model_platform=ModelPlatformType.DEFAULT,
            model_type=model_id,
        )


def emit(data: dict):
    """Write a JSON line to stdout for the agent to stream."""
    print(json.dumps(data), flush=True)


# Available actions for each platform (following MiroFish patterns)
TWITTER_ACTIONS = [
    ActionType.CREATE_POST,
    ActionType.LIKE_POST,
    ActionType.UNLIKE_POST,
    ActionType.REPOST,
    ActionType.CREATE_COMMENT,
    ActionType.LIKE_COMMENT,
    ActionType.FOLLOW,
    ActionType.SEARCH_POSTS,
    ActionType.SEARCH_USER,
    ActionType.TREND,
    ActionType.REFRESH,
    ActionType.DO_NOTHING,
]

REDDIT_ACTIONS = [
    ActionType.CREATE_POST,
    ActionType.LIKE_POST,
    ActionType.DISLIKE_POST,
    ActionType.CREATE_COMMENT,
    ActionType.LIKE_COMMENT,
    ActionType.DISLIKE_COMMENT,
    ActionType.SEARCH_POSTS,
    ActionType.SEARCH_USER,
    ActionType.TREND,
    ActionType.REFRESH,
    ActionType.FOLLOW,
    ActionType.DO_NOTHING,
]


async def run_simulation(profiles_path: str, platform: str, rounds: int, db_path: str, post_text: str):
    import sqlite3

    # Load profiles
    with open(profiles_path) as f:
        profiles = json.load(f)

    emit({"type": "progress", "message": f"Building {platform} agent graph with {len(profiles)} agents..."})

    model = get_model()
    available_actions = TWITTER_ACTIONS if platform == "twitter" else REDDIT_ACTIONS
    recsys_type = "twhin-bert" if platform == "twitter" else "reddit"

    # Build agent graph following OASIS generate_reddit_agent_graph pattern
    agent_graph = oasis.AgentGraph()

    for i, p in enumerate(profiles):
        profile_data = {
            "nodes": [],
            "edges": [],
            "other_info": {
                "user_profile": p.get("persona", ""),
                "mbti": p.get("mbti", "ENTJ"),
                "gender": p.get("gender", "nonbinary"),
                "age": p.get("age", 30),
                "country": p.get("country", "US"),
            },
        }

        user_info = oasis.UserInfo(
            name=p.get("username", f"user_{i}"),
            description=p.get("bio", ""),
            profile=profile_data,
            recsys_type=recsys_type,
        )

        agent = oasis.SocialAgent(
            agent_id=i,
            user_info=user_info,
            agent_graph=agent_graph,
            model=model,
            available_actions=available_actions,
        )
        agent_graph.add_agent(agent)

    emit({"type": "progress", "message": f"Initializing {platform} environment..."})

    # Create environment using oasis.make()
    platform_type = DefaultPlatformType.TWITTER if platform == "twitter" else DefaultPlatformType.REDDIT

    env = oasis.make(
        agent_graph=agent_graph,
        platform=platform_type,
        database_path=db_path,
        semaphore=30,  # Limit concurrent LLM requests (following MiroFish pattern)
    )

    await env.reset()

    last_rowid = 0
    id_to_name = {i: p.get("name", f"Agent {i}") for i, p in enumerate(profiles)}
    id_to_archetype = {i: p.get("archetype", "neutral") for i, p in enumerate(profiles)}
    # Map OASIS 0-indexed user_id back to the profile's agent_id (may be 1-indexed)
    id_to_agent_id = {i: p.get("agent_id", i) for i, p in enumerate(profiles)}

    def flush_trace(round_num):
        """Read new rows from trace table and emit them. Returns new last_rowid."""
        nonlocal last_rowid
        try:
            conn = sqlite3.connect(db_path, timeout=2)
            cursor = conn.execute(
                "SELECT rowid, user_id, created_at, action, info "
                "FROM trace WHERE rowid > ? ORDER BY rowid",
                (last_rowid,),
            )
            for row in cursor:
                rowid, user_id, created_at, action, info = row
                last_rowid = rowid
                try:
                    info_data = json.loads(info) if info else {}
                except json.JSONDecodeError:
                    info_data = {"raw": info}

                emit({
                    "type": "action",
                    "round": round_num,
                    "agent_id": id_to_agent_id.get(user_id, user_id),
                    "agent_name": id_to_name.get(user_id, f"Agent {user_id}"),
                    "archetype": id_to_archetype.get(user_id, "neutral"),
                    "platform": platform,
                    "action_type": (action or "").upper(),
                    "content": info_data.get("content", info_data.get("raw", "")),
                    "stats": {},
                })
            conn.close()
        except Exception:
            pass  # DB may be briefly locked by OASIS, retry next poll

    async def poll_trace(round_num, stop_event):
        """Poll trace table every 2s while env.step() is running."""
        while not stop_event.is_set():
            await asyncio.sleep(2)
            if stop_event.is_set():
                break
            flush_trace(round_num)

    try:
        for r in range(rounds):
            emit({"type": "progress", "message": f"{platform} round {r + 1}/{rounds}"})

            if r == 0:
                # Seed the original post (manual action, following MiroFish pattern)
                first_agent = agent_graph.get_agent(0)
                actions = {
                    first_agent: oasis.ManualAction(
                        action_type=ActionType.CREATE_POST,
                        action_args={"content": post_text},
                    )
                }
                await env.step(actions)

            # Start polling trace table in background while agents run
            stop_poll = asyncio.Event()
            poll_task = asyncio.create_task(poll_trace(r + 1, stop_poll))

            # All agents take LLM-driven actions (following MiroFish main loop)
            agent_actions = {}
            for _, agent in agent_graph.get_agents():
                agent_actions[agent] = oasis.LLMAction()
            await env.step(agent_actions)

            # Stop polling and do a final sweep to catch any remaining rows
            stop_poll.set()
            await poll_task
            flush_trace(r + 1)

    finally:
        await env.close()

    emit({"type": "complete", "db_path": db_path, "platform": platform})


def main():
    parser = argparse.ArgumentParser(description="Run OASIS simulation")
    parser.add_argument("--profiles", required=True, help="Path to profiles JSON file")
    parser.add_argument("--platform", required=True, choices=["twitter", "reddit"])
    parser.add_argument("--rounds", type=int, default=5)
    parser.add_argument("--db-path", required=True, help="SQLite DB output path")
    parser.add_argument("--post-text", required=True, help="The post to simulate reactions to")
    args = parser.parse_args()

    asyncio.run(run_simulation(args.profiles, args.platform, args.rounds, args.db_path, args.post_text))


if __name__ == "__main__":
    main()
