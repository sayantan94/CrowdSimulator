import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel, type Message, type Model } from "@mariozechner/pi-ai";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import {
  createWebSearchTool,
  createFetchTool,
  createShellTool,
  createRunOasisTool,
  createReadResultsTool,
} from "./tools/index.js";


interface Variant {
  id: string;   // "A", "B", "C"
  text: string;
}

interface Scenario {
  id: string;
  post_text: string;          // backward compat — always variants[0].text
  variants: Variant[];        // A/B variants
  audience_desc: string;
  platforms: string[];
  agent_count: number;
  rounds: number;
  model?: string;
  search_model?: string;
  status: string;
  research_topics: string[];  // user-specified research angles
  apiKey?: string;            // per-user OpenRouter API key (never persisted)
}

interface SimulationResults {
  scenario_id: string;
  sentiment_score: number;
  risk_score: number;
  virality: string;
  verdict: string;
  factions: Array<{ name: string; proportion: number; color: string }>;
  themes: Array<{ label: string; percentage: number }>;
  strategy: string[];
  suggested_rewrite: string;
  agents: Array<Record<string, any>>;
  actions: Array<Record<string, any>>;
}

// Mutable state shared between the persistent agent subscription and the
// active WebSocket connection. Only one simulation runs at a time.
interface ActiveSession {
  ws: WebSocket | null;
  phase: string;
  pipelinePhase: number; // 0=idle, 1=research+profiles, 2=simulate+analyze
  finalContent: string;
  lastAgentError: string;
  toolStarts: Map<string, { name: string; startTime: number }>;
  confirmResolve: ((confirmed: boolean) => void) | null;
  profilesSent: boolean;
  collectedAgents: Array<Record<string, any>>;
  collectedActions: Array<Record<string, any>>;
  collectedSources: Array<{ query: string; url?: string; tool: string }>;
}

// ---------------------------------------------------------------------------
// In-memory stores (persisted to disk)
// ---------------------------------------------------------------------------

const DATA_DIR = join(process.cwd(), "data");
const CROWDSIM_HOME = join(homedir(), ".crowdsim");
const HISTORY_FILE = join(CROWDSIM_HOME, "history.json");

const scenarios = new Map<string, Scenario>();
const results = new Map<string, SimulationResults | Record<string, SimulationResults>>();

// Load persisted history on startup
function loadHistory() {
  try {
    if (existsSync(HISTORY_FILE)) {
      const data = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
      if (data.scenarios) {
        for (const s of data.scenarios) scenarios.set(s.id, s);
      }
      if (data.results) {
        for (const [id, r] of Object.entries(data.results)) results.set(id, r as any);
      }
      console.log(`[history] Loaded ${scenarios.size} scenarios, ${results.size} results`);
    }
  } catch (err) {
    console.warn("[history] Failed to load history:", err);
  }
}

async function saveHistory() {
  try {
    mkdirSync(CROWDSIM_HOME, { recursive: true });
    const data = {
      scenarios: [...scenarios.values()].map(({ apiKey: _, ...s }) => s),
      results: Object.fromEntries(results),
    };
    await writeFile(HISTORY_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn("[history] Failed to save history:", err);
  }
}

loadHistory();

// ---------------------------------------------------------------------------
// Per-simulation active session — each simulation creates its own
// ---------------------------------------------------------------------------

// Track active sessions by scenario ID so the WS handler can find them
const activeSessions = new Map<string, ActiveSession>();

function createActiveSession(): ActiveSession {
  return { ws: null, phase: "idle", pipelinePhase: 0, finalContent: "", lastAgentError: "", toolStarts: new Map(), confirmResolve: null, profilesSent: false, collectedAgents: [], collectedActions: [], collectedSources: [] };
}

const SYSTEM_PROMPT = `You are CrowdSimulator, an AI agent that predicts how audiences will react to social media posts before they are published.

You have MEMORY — your conversation history persists across simulation runs. You can reference research, audiences, and results from previous simulations. When a user runs a new simulation:
- Check if your prior research is relevant — skip redundant web searches if you already have recent context
- Compare new results against previous ones to spot trends
- Reuse audience profiles or adapt them if the audience description is similar

## Your Tools
- **web_search**: Search the web via Google. IMPORTANT: Keep queries simple and broad (3-6 words). NEVER use long quoted phrases — they return nothing. Good: "CEO scandal resignation 2024". Bad: "backlash history executives adultery scandal 'resign' 'apology tour'"
- **fetch**: Fetch web pages for deeper content analysis
- **shell**: Run shell commands for file operations and other tasks
- **run_oasis_simulation**: Run a multi-agent OASIS simulation on Twitter or Reddit
- **read_simulation_results**: Read and analyze results from a completed simulation

## Your Pipeline

When given a post and audience description, execute this pipeline:

### Phase 1: Deep Research (CRITICAL — be thorough)
You MUST conduct extensive research. This is the foundation of the entire simulation.
Perform AT LEAST 15-20 different web_search queries covering ALL of these angles:

1. **Topic sentiment & discourse** (3-4 searches): Current public opinion, recent debates, trending takes
2. **News & events** (3-4 searches): Breaking news, recent developments, upcoming events related to the topic
3. **Audience demographics** (2-3 searches): Who talks about this topic, their platforms, age groups, communities
4. **Controversy & risks** (2-3 searches): Past backlash, cancelled brands/people, sensitive angles
5. **Competitor/similar posts** (2-3 searches): How similar content performed, viral examples, failed examples
6. **Cultural context** (2-3 searches): Memes, slang, in-group language, community norms
7. **Platform-specific patterns** (1-2 searches): How this topic plays on Twitter vs Reddit specifically

For important sources, use fetch to get the full content. Aim to reference 20+ distinct sources.

After completing research, output a structured research summary:
\`\`\`research_summary
## Key Findings
- [Finding 1]: [Source URL]
- [Finding 2]: [Source URL]
...

## Audience Landscape
[Description of key audience segments and their likely stances]

## Risk Factors
[Specific risks identified from research]

## Opportunities
[Positive angles identified from research]
\`\`\`

### Phase 2: Generate Research-Grounded Agents
Based on your research, generate diverse agent profiles. CRITICAL: Each agent must be GROUNDED in your research findings. The persona must reference specific real-world context you discovered.

Each profile must be a JSON object with these exact fields:
- agent_id (int, starting at 0)
- username (lowercase handle)
- name (full name)
- bio (200 char social media bio)
- persona (2000+ char detailed backstory: personality, beliefs, online behavior, posting style, reaction patterns. MUST reference specific findings from your research — real events, real discourse, real community dynamics)
- age (int)
- gender ("male"|"female"|"nonbinary")
- mbti (e.g., "ENTJ")
- profession (job title)
- interested_topics (string array)
- sentiment_bias (-1.0 extreme critic to 1.0 extreme supporter)
- influence_weight (0.5 nobody to 5.0 major influencer)
- activity_level (0.1 lurker to 1.0 power poster)
- archetype ("supporter"|"skeptic"|"neutral"|"journalist"|"troll"|"influencer"|"expert"|"casual_observer")
- research_basis (string — 2-3 sentences explaining WHICH specific research findings shaped this agent's perspective and why they would react the way they do)

Ensure diversity: mix of archetypes, ages, genders, sentiments, influence levels.

### Phase 3: Simulate
Call run_oasis_simulation for each platform with the generated profiles.
Always pass the work_dir parameter so files are stored per-scenario.
This runs a multi-agent simulation where AI agents react to the post.

### Phase 4: Analyze
Call read_simulation_results to get engagement data from the simulation databases.
Pass the work_dir parameter so it finds the correct files.

### Phase 5: Strategize
Analyze the simulation results and provide:

Your FINAL response must be a JSON object:
{
  "scenario_id": "<provided>",
  "sentiment_score": 0.0-1.0,
  "risk_score": 1-10,
  "virality": "low|medium|high",
  "verdict": "One sentence summary",
  "factions": [{"name": "Faction Name", "proportion": 0.0-1.0, "color": "green|red|blue|purple|orange|gold|teal|gray"}],
  "themes": [{"label": "Theme name", "percentage": 0-100}],
  "strategy": ["Recommendation 1", "Recommendation 2", "Recommendation 3"],
  "suggested_rewrite": "Improved version of the original post"
}

IMPORTANT: Your very last message must be ONLY this JSON object.`;

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

function resolveModel(provider: string, modelId?: string): Model<any> {
  if (provider === "openrouter") {
    const id = modelId || "anthropic/claude-sonnet-4";
    return getModel("openrouter", id as any);
  } else {
    const id = modelId || "anthropic.claude-sonnet-4-20250514-v1:0";
    return getModel("amazon-bedrock", id as any);
  }
}

function convertToLlm(messages: any[]): Message[] {
  return messages.filter(
    (m: any) => m.role === "user" || m.role === "assistant" || m.role === "toolResult"
  );
}

// ---------------------------------------------------------------------------
// Context compaction — prune old messages to stay within the token budget.
//
// Rough heuristic: 1 token ≈ 4 chars. We target a safe ceiling below the
// model's 200K limit, leaving room for the system prompt + new response.
// ---------------------------------------------------------------------------

const MAX_CONTEXT_CHARS = 500_000; // ~125K tokens — leaves ~75K for system + response
const COMPACTED_MARKER = "[compacted]";

function estimateChars(messages: any[]): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === "string") {
      total += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b.text) total += b.text.length;
        else if (b.content) total += typeof b.content === "string" ? b.content.length : JSON.stringify(b.content).length;
      }
    }
  }
  return total;
}

/** Truncate a single text block, keeping a head+tail preview. */
function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const keep = Math.floor(maxLen / 2);
  return text.slice(0, keep) + `\n... [truncated ${text.length - maxLen} chars] ...\n` + text.slice(-keep);
}

/**
 * Compact a single message in place — shrinks large tool results and
 * assistant outputs while preserving structure.
 */
function compactMessage(msg: any): any {
  const clone = { ...msg };
  if (Array.isArray(clone.content)) {
    clone.content = clone.content.map((b: any) => {
      if (b.type === "text" && b.text && b.text.length > 2000) {
        return { ...b, text: truncateText(b.text, 2000) };
      }
      // Tool result content blocks
      if (b.type === "toolResult" && Array.isArray(b.content)) {
        return {
          ...b,
          content: b.content.map((c: any) =>
            c.type === "text" && c.text && c.text.length > 1500
              ? { ...c, text: truncateText(c.text, 1500) }
              : c
          ),
        };
      }
      return b;
    });
  } else if (typeof clone.content === "string" && clone.content.length > 2000) {
    clone.content = truncateText(clone.content, 2000);
  }

  // Compact toolResult messages (top-level role=toolResult)
  if (clone.role === "toolResult" && Array.isArray(clone.content)) {
    clone.content = clone.content.map((c: any) =>
      c.type === "text" && c.text && c.text.length > 1500
        ? { ...c, text: truncateText(c.text, 1500) }
        : c
    );
  }

  return clone;
}

/**
 * transformContext — called before each LLM call.
 *
 * Strategy:
 *  1. If total context is under the limit, pass through unchanged.
 *  2. Otherwise, compact messages oldest-first: truncate large text blocks
 *     in tool results and assistant outputs from earlier turns.
 *  3. If still over budget after compaction, drop the oldest messages
 *     (keeping the most recent N turns intact).
 */
async function transformContext(messages: any[]): Promise<any[]> {
  let totalChars = estimateChars(messages);
  if (totalChars <= MAX_CONTEXT_CHARS) return messages;

  console.log(`[compact] Context too large (${totalChars} chars / ~${Math.round(totalChars / 4)} tokens). Compacting...`);

  // Phase 1: Compact older messages (keep the last 6 messages untouched —
  // roughly the current Phase prompt + its tool calls + response)
  const protectedTail = 6;
  const compacted = messages.map((m, i) => {
    if (i >= messages.length - protectedTail) return m;
    return compactMessage(m);
  });

  totalChars = estimateChars(compacted);
  if (totalChars <= MAX_CONTEXT_CHARS) {
    console.log(`[compact] After compaction: ${totalChars} chars. OK.`);
    return compacted;
  }

  // Phase 2: Still too large — drop oldest messages, but keep
  // at least the protected tail + a summary breadcrumb
  console.log(`[compact] Still ${totalChars} chars after compaction. Dropping old messages...`);

  let trimmed = [...compacted];
  while (trimmed.length > protectedTail && estimateChars(trimmed) > MAX_CONTEXT_CHARS) {
    trimmed.shift();
  }

  // Prepend a breadcrumb so the agent knows context was pruned
  const breadcrumb: any = {
    role: "user",
    content: `${COMPACTED_MARKER} Earlier conversation messages were pruned to fit within the context window. Previous simulation research and results have been removed — conduct fresh research for any new topics.`,
  };
  trimmed.unshift(breadcrumb);

  console.log(`[compact] Final context: ${trimmed.length} messages, ${estimateChars(trimmed)} chars.`);
  return trimmed;
}

// ---------------------------------------------------------------------------
// Agent event handler — uses the passed-in `active` session state
// ---------------------------------------------------------------------------

function handleAgentEvent(event: AgentEvent, active: ActiveSession) {
  const ws = active.ws;
  const wsOpen = ws && ws.readyState === ws.OPEN;

  // Always process agent_end to capture final content, even if WS is closed
  if (event.type === "agent_end") {
    // Only send strategizing phase for pipeline phase 2
    if (active.pipelinePhase === 2) {
      active.phase = "strategizing";
      if (wsOpen) {
        wsSend(ws!, "phase", { phase: "strategizing", message: "Finalizing strategy..." });
      }
    }

    const allTexts: string[] = [];
    const errors: string[] = [];
    for (const msg of event.messages) {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content as any[]) {
          if (block.type === "text" && block.text) {
            allTexts.push(block.text);
          }
        }
        // Check for error stopReason on assistant messages
        const am = msg as any;
        if (am.stopReason === "error" && am.errorMessage) {
          errors.push(am.errorMessage);
        }
      }
    }
    active.finalContent = allTexts.join("\n\n");

    // If there were model errors, store them so the caller can detect them
    if (errors.length > 0) {
      active.lastAgentError = errors.join("; ");
      console.error(`[agent_end] Model errors: ${active.lastAgentError}`);
    } else {
      active.lastAgentError = "";
    }

    console.log(`[agent_end] Collected ${allTexts.length} text blocks, total ${active.finalContent.length} chars${errors.length ? `, ${errors.length} errors` : ""}`);
    return;
  }

  if (!wsOpen) return;

  switch (event.type) {
    case "agent_start":
      wsSend(ws, "phase", {
        phase: "researching",
        message: "Agent is researching context...",
      });
      break;

    case "tool_execution_start": {
      const tool = event.toolName;
      const args = event.args || {};
      const toolCallId = (event as any).toolCallId || `${tool}-${Date.now()}`;

      // Track start time for duration calculation
      active.toolStarts.set(toolCallId, { name: tool, startTime: Date.now() });

      // Send rich tool_start event for ALL tools
      const toolEvent: Record<string, any> = {
        event_type: "tool_start",
        tool_name: tool,
        tool_call_id: toolCallId,
      };

      if (tool === "web_search") {
        toolEvent.label = `Search → ${args.query || ""}`;
        toolEvent.query = args.query || "";
        active.collectedSources.push({ query: args.query || "", tool: "web_search" });
      } else if (tool === "fetch") {
        toolEvent.label = `${(args.method || "GET")} → ${args.url || ""}`;
        toolEvent.url = args.url || "";
        active.collectedSources.push({ query: args.url || "", url: args.url || "", tool: "fetch" });
      } else if (tool === "shell") {
        toolEvent.label = `$ ${(args.command || "").slice(0, 120)}`;
        toolEvent.command = (args.command || "").slice(0, 200);
      } else if (tool === "run_oasis_simulation") {
        // LLMs sometimes stringify the profiles array
        let toolProfiles = args.profiles || [];
        if (typeof toolProfiles === "string") {
          try { toolProfiles = JSON.parse(toolProfiles); } catch { toolProfiles = []; }
        }
        const profileCount = Array.isArray(toolProfiles) ? toolProfiles.length : 0;
        toolEvent.label = `OASIS ${args.platform || ""} → ${profileCount} agents, ${args.rounds || 5} rounds`;
        toolEvent.platform = args.platform || "";
        toolEvent.agent_count = profileCount;

        // Emit agent_generated for each profile (skip if already sent during Phase 1)
        const profiles = toolProfiles;
        if (!active.profilesSent) for (const p of profiles) {
          if (p && typeof p === "object") {
            const agentData = {
              agent_id: p.agent_id,
              name: p.name || "",
              username: p.username || "",
              archetype: p.archetype || "neutral",
              sentiment_bias: p.sentiment_bias ?? 0,
              influence_weight: p.influence_weight ?? 1,
              bio: p.bio || "",
              persona: p.persona || "",
              age: p.age,
              gender: p.gender || "",
              mbti: p.mbti || "",
              profession: p.profession || "",
              interested_topics: p.interested_topics || [],
              activity_level: p.activity_level || "medium",
            };
            active.collectedAgents.push(agentData);
            wsSend(ws, "agent_generated", agentData);
          }
        }

        active.phase = "simulating";
        wsSend(ws, "phase", {
          phase: "simulating",
          message: `Running ${args.platform || ""} simulation...`,
        });
      } else if (tool === "read_simulation_results") {
        toolEvent.label = "Reading simulation results...";
        active.phase = "analyzing";
        wsSend(ws, "phase", {
          phase: "analyzing",
          message: "Analyzing simulation data...",
        });
      } else {
        toolEvent.label = tool;
      }

      wsSend(ws, "research_event", toolEvent);
      console.log(`[tool_start] ${tool}: ${toolEvent.label}`);
      break;
    }

    case "tool_execution_end": {
      const tool = event.toolName;
      const toolCallId = (event as any).toolCallId || `${tool}-unknown`;
      const startInfo = active.toolStarts.get(toolCallId);
      const duration = startInfo ? ((Date.now() - startInfo.startTime) / 1000).toFixed(1) : null;
      active.toolStarts.delete(toolCallId);

      // Extract result from tool output
      let resultPreview = "";
      let resultFull = "";
      const result = (event as any).result;
      if (result) {
        const content = result.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) {
              resultFull = block.text;
              break;
            }
          }
        } else if (typeof content === "string") {
          resultFull = content;
        } else if (typeof result === "string") {
          resultFull = result;
        } else if (result.text) {
          resultFull = result.text;
        }
        // Last resort: stringify whatever we got
        if (!resultFull && typeof result === "object") {
          const stringified = JSON.stringify(result);
          if (stringified.length > 10) resultFull = stringified;
        }
        if (resultFull) {
          resultPreview = resultFull.slice(0, 200).replace(/\n/g, " ↵ ");
        }
      }

      const isError = (event as any).isError || resultPreview.startsWith("Error:") || resultPreview.startsWith("Fetch error");

      const toolEndEvent: Record<string, any> = {
        event_type: "tool_end",
        tool_name: tool,
        tool_call_id: toolCallId,
        duration: duration ? parseFloat(duration) : null,
        result_preview: resultPreview.slice(0, 160),
        is_error: isError,
      };

      // Send full result content for search and fetch tools so the UI can display it
      if ((tool === "web_search" || tool === "fetch") && resultFull && !isError) {
        toolEndEvent.result_content = resultFull;
      }

      wsSend(ws, "research_event", toolEndEvent);

      if (tool === "read_simulation_results") {
        active.phase = "strategizing";
        wsSend(ws, "phase", {
          phase: "strategizing",
          message: "Generating analysis and strategy...",
        });
      }
      console.log(`[tool_end] ${tool} (${toolCallId}) completed in ${duration || "?"}s${isError ? " [ERROR]" : ""}`);
      if (tool === "run_oasis_simulation") {
        console.log(`[tool_end] run_oasis result preview: ${resultPreview.slice(0, 300)}`);
      }
      break;
    }

    case "tool_execution_update": {
      const tool = event.toolName;
      const data = event.partialResult as any;
      if (tool === "run_oasis_simulation" && data) {
        const details = data.details || {};
        if (details.type === "action") {
          console.log(`[sim_action] platform=${details.platform} agent=${details.agent_name} action=${details.action_type}`);
          active.collectedActions.push(details);
          wsSend(ws, "simulation_action", details);
        } else if (details.type === "progress") {
          console.log(`[sim_progress] platform=${details.platform} ${details.message}`);
          wsSend(ws, "simulation_progress", {
            platform: details.platform || "",
            message: details.message || "",
          });
        } else if (details.type === "complete") {
          console.log(`[sim_complete] platform=${details.platform} db=${details.db_path}`);
        }
      }
      break;
    }

    case "message_update": {
      const evt = event.assistantMessageEvent as any;
      if (evt.type === "text" && evt.text?.trim()) {
        // Stream text deltas for all phases
        wsSend(ws, "research_event", {
          event_type: "text_delta",
          text: evt.text,
          phase: active.phase,
        });
      }
      break;
    }

    case "message_end": {
      if (event.message.role === "assistant" && Array.isArray(event.message.content)) {
        const text = (event.message.content as any[])
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("");
        if (text && active.phase === "researching") {
          if (text.includes("## ") || text.includes("**")) {
            wsSend(ws, "research_event", {
              event_type: "message_end",
              text: text.slice(0, 300),
            });
          }
        }
      }
      break;
    }

    // agent_end is handled above (before the wsOpen check)
  }
}

// ---------------------------------------------------------------------------
// Create a fresh agent per simulation (per-user API key)
// ---------------------------------------------------------------------------

function createAgentForSimulation(active: ActiveSession, apiKey?: string, userModel?: string, searchModel?: string): Agent {
  const provider = process.env.CS_LLM_PROVIDER || "openrouter";
  const modelId = userModel || process.env.CS_LLM_MODEL;
  const model = resolveModel(provider, modelId);

  mkdirSync(DATA_DIR, { recursive: true });

  const tools = [
    createWebSearchTool({ searchModel: searchModel || process.env.CS_SEARCH_MODEL, apiKey }),
    createFetchTool(),
    createShellTool(DATA_DIR),
    createRunOasisTool(DATA_DIR, { apiKey }),
    createReadResultsTool(DATA_DIR),
  ];

  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      thinkingLevel: "off",
      tools,
    },
    convertToLlm,
    transformContext,
    getApiKey: apiKey ? () => apiKey : undefined,
  });

  // Subscribe with the session-scoped `active` state
  agent.subscribe((event) => handleAgentEvent(event, active));

  console.log(`Agent created with provider=${provider} model=${modelId || "(default)"} apiKey=${apiKey ? "user-provided" : "env"}`);
  return agent;
}

// ---------------------------------------------------------------------------
// Simulation runner (uses persistent agent)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Profile extraction from Phase 1 agent output
// ---------------------------------------------------------------------------

function extractProfiles(content: string): { profiles: any[]; error?: string } {
  if (!content?.trim()) {
    return { profiles: [], error: "No output from agent." };
  }

  const isProfileArray = (v: any) =>
    Array.isArray(v) && v.length > 0 && typeof v[0] === "object" &&
    (v[0].agent_id || v[0].name || v[0].username);

  // 1. Try ```json fences
  for (const m of content.matchAll(/```json\s*\n?([\s\S]*?)```/g)) {
    try {
      const p = JSON.parse(m[1].trim());
      if (isProfileArray(p)) return { profiles: p };
    } catch {}
  }

  // 2. Try any ``` fence that starts with [ or {
  for (const m of content.matchAll(/```\w*\s*\n?([\s\S]*?)```/g)) {
    const b = m[1].trim();
    if (b[0] !== "[" && b[0] !== "{") continue;
    try {
      let p = JSON.parse(b);
      if (p?.profiles) p = p.profiles;
      if (isProfileArray(p)) return { profiles: p };
    } catch {}
  }

  // 3. Salvage: find array start, parse individual complete objects
  const arrayStart = content.search(/\[\s*\{/);
  if (arrayStart >= 0) {
    const chunk = content.slice(arrayStart);
    // Find each }, { boundary and try parsing objects individually
    const objMatches = [...chunk.matchAll(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g)];
    const salvaged = objMatches
      .map(m => { try { return JSON.parse(m[0]); } catch { return null; } })
      .filter(o => o && (o.agent_id || o.name || o.username));
    if (salvaged.length > 0) {
      console.log(`[profiles] Salvaged ${salvaged.length} profiles from malformed JSON`);
      return { profiles: salvaged };
    }
  }

  const hasProfileWords = /agent_id|archetype|persona/.test(content);
  return {
    profiles: [],
    error: hasProfileWords
      ? `Profile fields found but JSON is malformed (${content.length} chars)`
      : `No profiles in output (${content.length} chars)`,
  };
}

// ---------------------------------------------------------------------------
// Direct OASIS runner — bypasses LLM, runs Python subprocess deterministically
// ---------------------------------------------------------------------------

const SCRIPTS_DIR = join(import.meta.dirname, "..", "scripts");
const VENV_PYTHON = join(import.meta.dirname, "..", ".venv", "bin", "python3");

async function runOasisDirect(
  ws: WebSocket,
  platform: string,
  profiles: any[],
  rounds: number,
  postText: string,
  workDir: string,
  active: ActiveSession,
): Promise<void> {
  const profilesPath = join(workDir, `profiles_${platform}.json`);
  await writeFile(profilesPath, JSON.stringify(profiles, null, 2));
  const dbPath = join(workDir, `${platform}.db`);

  const args = [
    join(SCRIPTS_DIR, "run_oasis.py"),
    "--profiles", profilesPath,
    "--platform", platform,
    "--rounds", String(rounds),
    "--db-path", dbPath,
    "--post-text", postText,
  ];

  console.log(`[oasis-direct] Starting ${platform} simulation: ${profiles.length} agents, ${rounds} rounds`);

  wsSend(ws, "phase", {
    phase: "simulating",
    message: `Running ${platform} simulation...`,
  });
  wsSend(ws, "research_event", {
    event_type: "tool_start",
    tool_name: "run_oasis_simulation",
    tool_call_id: `oasis-${platform}`,
    label: `OASIS ${platform} → ${profiles.length} agents, ${rounds} rounds`,
    platform,
    agent_count: profiles.length,
  });

  return new Promise<void>((resolve, reject) => {
    const child = spawn(VENV_PYTHON, args, { cwd: workDir });
    const stderrChunks: string[] = [];

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      try {
        const event = JSON.parse(line);
        if (event.type === "action") {
          console.log(`[sim_action] platform=${event.platform} agent=${event.agent_name} action=${event.action_type}`);
          active.collectedActions.push(event);
          wsSend(ws, "simulation_action", event);
        } else if (event.type === "progress") {
          console.log(`[sim_progress] platform=${event.platform} ${event.message}`);
          wsSend(ws, "simulation_progress", {
            platform: event.platform || platform,
            message: event.message || "",
          });
        } else if (event.type === "complete") {
          console.log(`[sim_complete] platform=${event.platform} db=${event.db_path}`);
        }
      } catch {
        // Non-JSON line from Python, ignore
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk.toString());
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`OASIS ${platform} timed out after 10 minutes`));
    }, 600000);

    child.on("close", (code) => {
      clearTimeout(timer);
      wsSend(ws, "research_event", {
        event_type: "tool_end",
        tool_name: "run_oasis_simulation",
        tool_call_id: `oasis-${platform}`,
        duration: null,
        result_preview: code === 0 ? `${platform} simulation complete` : `${platform} failed (exit ${code})`,
        is_error: code !== 0,
      });
      if (code !== 0) {
        const stderr = stderrChunks.join("").slice(-500);
        console.error(`[oasis-direct] ${platform} failed (exit ${code}): ${stderr}`);
        reject(new Error(`OASIS ${platform} failed (exit ${code}): ${stderr}`));
      } else {
        console.log(`[oasis-direct] ${platform} simulation complete`);
        resolve();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Simulation runner (two-phase pipeline with confirmation gate)
// ---------------------------------------------------------------------------

async function runSimulation(ws: WebSocket, scenario: Scenario) {
  // Each simulation gets its own session state and agent
  const active = createActiveSession();
  activeSessions.set(scenario.id, active);
  active.ws = ws;
  active.phase = "researching";
  active.pipelinePhase = 1;
  active.finalContent = "";
  active.profilesSent = false;
  active.confirmResolve = null;

  const userApiKey = scenario.apiKey;
  if (!userApiKey) {
    throw new Error("No API key available. Please log in with your OpenRouter key.");
  }
  console.log(`[sim] API key: user-provided, prefix: ${userApiKey.slice(0, 12)}...`);

  try {
    const agent = createAgentForSimulation(active, userApiKey, scenario.model, scenario.search_model);

    const workDir = join(DATA_DIR, scenario.id);
    mkdirSync(workDir, { recursive: true });

    const platforms = scenario.platforms.join(" and ");
    const isAB = scenario.variants.length > 1;

    const modelId = scenario.model || process.env.CS_LLM_MODEL || "anthropic/claude-sonnet-4";
    const searchModel = scenario.search_model || process.env.CS_SEARCH_MODEL || "perplexity/sonar";

    console.log(`[sim] Starting simulation for scenario ${scenario.id}`);
    console.log(`[sim] Model: ${modelId}, Search: ${searchModel}`);
    console.log(`[sim] Variants: ${scenario.variants.map(v => `${v.id}: "${v.text.slice(0, 60)}..."`).join(", ")}`);
    console.log(`[sim] Platforms: ${platforms}, Agents: ${scenario.agent_count}, Rounds: ${scenario.rounds}`);

    // Send config info to frontend
    if (ws.readyState === ws.OPEN) {
      wsSend(ws, "config", { model: modelId, search_model: searchModel });
    }

    // Build post text section for Phase 1 — include ALL variants for research context
    const postTextSection = isAB
      ? scenario.variants.map(v => `VARIANT ${v.id}: "${v.text}"`).join("\n\n")
      : `POST TEXT: "${scenario.post_text}"`;

    // ── Phase 1: Research + Generate Profiles ──────────────────────────
    const phase1Prompt = `Run a crowd simulation for this scenario:

SCENARIO ID: ${scenario.id}

${postTextSection}

AUDIENCE DESCRIPTION: "${scenario.audience_desc || "general social media audience"}"

PLATFORMS: ${platforms}
NUMBER OF AGENTS: ${scenario.agent_count || 15}
SIMULATION ROUNDS: ${scenario.rounds || 5}
WORK DIRECTORY: ${workDir}
${isAB ? `\nA/B TEST MODE: You are testing ${scenario.variants.length} post variants. Research should cover ALL variants. The same agents will react to each variant separately.\n` : ""}
FOR THIS STEP: Execute ONLY Phase 1 (Deep Research) and Phase 2 (Generate Research-Grounded Agents).

STEP 1 — DEEP RESEARCH:
Conduct AT LEAST 15-20 different web_search queries across all these angles:
- Topic sentiment & current discourse (3-4 searches)
- Breaking news & recent events (3-4 searches)
- Audience demographics & communities (2-3 searches)
- Controversy, backlash history, risks (2-3 searches)
- Similar posts that went viral or failed (2-3 searches)
- Cultural context, memes, community norms (2-3 searches)
- Platform-specific patterns (1-2 searches)
${scenario.research_topics.length > 0 ? `\nUSER-SPECIFIED RESEARCH TOPICS (MUST research these specifically):\n${scenario.research_topics.map((t, i) => `- ${t}`).join("\n")}\n` : ""}
Use fetch on important sources for deeper content. Be thorough — this research is the foundation.

After research, output a structured research summary in a \`\`\`research_summary code fence.

STEP 2 — GENERATE ${scenario.agent_count || 15} AGENTS:
Each agent MUST be grounded in your research. Include a research_basis field explaining which findings shaped this agent.

Output the complete profiles as a JSON array in a \`\`\`json code fence.
Each profile must include ALL required fields: agent_id, username, name, bio, persona, age, gender, mbti, profession, interested_topics, sentiment_bias, influence_weight, activity_level, archetype, research_basis.

DO NOT call run_oasis_simulation yet — the user needs to review and confirm the profiles first.`;

    // Retry wrapper for transient provider errors (connection drops, 429s, etc.)
    const MAX_RETRIES = 3;
    async function promptWithRetry(agent: Agent, prompt: string, retries = MAX_RETRIES): Promise<void> {
      for (let attempt = 1; attempt <= retries; attempt++) {
        active.lastAgentError = "";
        await agent.prompt(prompt);
        await agent.waitForIdle();

        if (!active.lastAgentError) return; // success

        console.warn(`[retry] Attempt ${attempt}/${retries} failed: ${active.lastAgentError}`);
        if (attempt < retries) {
          const delay = attempt * 3000; // 3s, 6s backoff
          console.log(`[retry] Waiting ${delay}ms before retry...`);
          if (active.ws && active.ws.readyState === active.ws.OPEN) {
            wsSend(active.ws, "phase", {
              phase: active.phase,
              message: `Provider error — retrying (${attempt}/${retries})...`,
            });
          }
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      // All retries exhausted
      throw new Error(`Model error after ${retries} attempts: ${active.lastAgentError}`);
    }

    await promptWithRetry(agent, phase1Prompt);

    const agentState = agent.state;
    if (agentState.error) throw new Error(`Agent error: ${agentState.error}`);

    // Fallback: pull content from agent state if event handler missed it
    if (!active.finalContent) {
      for (const msg of agentState.messages) {
        const m = msg as any;
        if (m.role === "assistant" && Array.isArray(m.content)) {
          for (const b of m.content) {
            if (b.type === "text" && b.text) active.finalContent += b.text + "\n";
          }
        }
      }
    }

    console.log(`[sim] Phase 1 done. ${active.finalContent.length} chars`);

    let extraction = extractProfiles(active.finalContent);

    // Retry up to 2 times if extraction failed
    for (let retry = 1; retry <= 2 && extraction.profiles.length === 0; retry++) {
      const retryMsg = active.finalContent.length > 500
        ? `Your profile JSON was malformed. Output ONLY a \`\`\`json code fence with the complete array of ${scenario.agent_count || 15} agent profiles. No other text.`
        : `You did not output agent profiles. Generate ${scenario.agent_count || 15} agent profiles as a JSON array in a \`\`\`json code fence. Each profile must include: agent_id, username, name, bio, persona, age, gender, mbti, profession, interested_topics, sentiment_bias, influence_weight, activity_level, archetype, research_basis. Output ONLY the JSON array, no other text.`;

      console.log(`[sim] Profile extraction failed (attempt ${retry}/2, content=${active.finalContent.length} chars), retrying...`);
      if (ws.readyState === ws.OPEN) {
        wsSend(ws, "phase", { phase: "researching", message: `Retrying profile generation (${retry}/2)...` });
      }
      active.finalContent = "";
      await promptWithRetry(agent, retryMsg);
      extraction = extractProfiles(active.finalContent);
    }

    if (extraction.profiles.length === 0) {
      throw new Error(`Profile extraction failed after retries. ${extraction.error || ""} (content length: ${active.finalContent.length})`);
    }

    const profiles = extraction.profiles;

    // Send full profile data to frontend and collect for results
    const wsOpen = ws && ws.readyState === ws.OPEN;
    active.collectedAgents = [];
    for (const p of profiles) {
      const agentData = {
        agent_id: p.agent_id,
        name: p.name || "",
        username: p.username || "",
        archetype: p.archetype || "neutral",
        sentiment_bias: p.sentiment_bias ?? 0,
        influence_weight: p.influence_weight ?? 1,
        activity_level: p.activity_level ?? 0.5,
        bio: p.bio || "",
        persona: p.persona || "",
        age: p.age,
        gender: p.gender || "",
        mbti: p.mbti || "",
        profession: p.profession || "",
        interested_topics: p.interested_topics || [],
        research_basis: p.research_basis || "",
      };
      active.collectedAgents.push(agentData);
      if (wsOpen) wsSend(ws, "agent_generated", agentData);
    }

    // Extract research summary from Phase 1 output
    let researchSummary = "";
    const rsMat = active.finalContent.match(/```research_summary\s*\n([\s\S]*?)```/);
    if (rsMat) researchSummary = rsMat[1].trim();

    if (wsOpen) {
      active.profilesSent = true;

      wsSend(ws, "agents_ready", {
        count: profiles.length,
        platforms: scenario.platforms,
        rounds: scenario.rounds,
        sources_count: active.collectedSources.length,
        research_summary: researchSummary,
        sources: active.collectedSources,
      });
      wsSend(ws, "phase", {
        phase: "awaiting_confirmation",
        message: `${profiles.length} personas generated — review and confirm`,
      });
    }

    active.phase = "awaiting_confirmation";
    console.log(`[sim] Sent ${profiles.length} profiles. Waiting for confirmation...`);

    // ── Wait for user confirmation ─────────────────────────────────────
    const confirmed = await new Promise<boolean>((resolve) => {
      active.confirmResolve = resolve;
      // Timeout after 10 minutes
      setTimeout(() => {
        if (active.confirmResolve === resolve) {
          resolve(false);
        }
      }, 600000);
    });
    active.confirmResolve = null;

    if (!confirmed) {
      throw new Error("Simulation cancelled or confirmation timed out.");
    }

    console.log(`[sim] User confirmed. Starting Phase 2...`);

    // ── Phase 2: Simulate + Analyze + Strategize (per variant) ─────────
    active.pipelinePhase = 2;
    active.phase = "simulating";

    const variantResults: Record<string, SimulationResults> = {};

    for (let vi = 0; vi < scenario.variants.length; vi++) {
      const variant = scenario.variants[vi];
      const variantDir = isAB ? join(workDir, `variant_${variant.id}`) : workDir;
      mkdirSync(variantDir, { recursive: true });

      active.finalContent = "";
      active.collectedActions = [];

      if (ws.readyState === ws.OPEN) {
        wsSend(ws, "phase", {
          phase: "simulating",
          message: isAB
            ? `Running Variant ${variant.id} (${vi + 1}/${scenario.variants.length})...`
            : "Starting simulation...",
        });
        if (isAB) {
          wsSend(ws, "variant_start", { variant_id: variant.id, variant_index: vi, total_variants: scenario.variants.length, text: variant.text });
        }
      }

      // ── Run OASIS deterministically for each platform ──────────────────
      const postText = isAB ? variant.text : scenario.post_text;
      const simRounds = scenario.rounds || 5;

      for (const plat of scenario.platforms) {
        try {
          await runOasisDirect(ws, plat, profiles, simRounds, postText, variantDir, active);
        } catch (err: any) {
          console.error(`[sim] Platform ${plat} failed: ${err.message}`);
          wsSend(ws, "simulation_error", {
            platform: plat,
            message: err.message,
          });
          // Continue with other platforms even if one fails
        }
      }

      const twCount = active.collectedActions.filter(a => a.platform === "twitter").length;
      const rdCount = active.collectedActions.filter(a => a.platform === "reddit").length;
      console.log(`[sim] OASIS done for variant ${variant.id}. Actions: twitter=${twCount}, reddit=${rdCount}, total=${active.collectedActions.length}`);

      // ── Ask LLM to read results and analyze ────────────────────────────
      active.phase = "analyzing";
      wsSend(ws, "phase", {
        phase: "analyzing",
        message: "Analyzing simulation data...",
      });

      const dbPathsList = scenario.platforms.map(p => `${p}=${join(variantDir, `${p}.db`)}`).join(",");
      const profilesFile = join(variantDir, `profiles_${scenario.platforms[0]}.json`);

      const analysisPrompt = isAB
        ? `The OASIS simulation for VARIANT ${variant.id} has completed across ${scenario.platforms.length} platform(s): ${platforms}.

Actions collected: twitter=${twCount}, reddit=${rdCount}, total=${active.collectedActions.length}

1. Call read_simulation_results to analyze the data:
   - db_paths="${dbPathsList}"
   - profiles_file="${profilesFile}"
   - work_dir="${variantDir}"
2. Based on the results, provide your assessment.

Your FINAL response must be ONLY a JSON object:
{
  "scenario_id": "${scenario.id}",
  "variant_id": "${variant.id}",
  "sentiment_score": 0.0-1.0,
  "risk_score": 1-10,
  "virality": "low|medium|high",
  "verdict": "Detailed 2-3 sentence summary for this variant",
  "factions": [{"name": "Faction Name", "proportion": 0.0-1.0, "color": "green|red|blue|purple|orange|gold|teal|gray"}],
  "themes": [{"label": "Theme name", "percentage": 0-100}],
  "strategy": ["Recommendation 1", "Recommendation 2", "Recommendation 3"],
  "suggested_rewrite": "Improved version of this variant's post"
}`
        : `The OASIS simulation has completed across ${scenario.platforms.length} platform(s): ${platforms}.

Actions collected: twitter=${twCount}, reddit=${rdCount}, total=${active.collectedActions.length}

1. Call read_simulation_results to analyze the data:
   - db_paths="${dbPathsList}"
   - profiles_file="${profilesFile}"
   - work_dir="${workDir}"
2. Analyze results thoroughly and provide your final strategy.

Your FINAL response must be ONLY a JSON object with these fields:
{
  "scenario_id": "${scenario.id}",
  "sentiment_score": 0.0-1.0,
  "risk_score": 1-10,
  "virality": "low|medium|high",
  "verdict": "Detailed 2-3 sentence summary of the simulation findings",
  "factions": [{"name": "Faction Name", "proportion": 0.0-1.0, "color": "green|red|blue|purple|orange|gold|teal|gray"}],
  "themes": [{"label": "Theme name", "percentage": 0-100}],
  "strategy": ["Detailed recommendation 1", "Detailed recommendation 2", "Detailed recommendation 3"],
  "suggested_rewrite": "Improved version of the original post"
}`;

      await promptWithRetry(agent, analysisPrompt);

      console.log(`[sim] Variant ${variant.id} analysis complete.`);

      // Parse final JSON from agent output
      const rawContent = active.finalContent;
      console.log(`[parse] Attempting to extract JSON from ${rawContent.length} chars of agent output`);

      let result: any = null;

      // Strategy 1: Extract from ```json code fences
      const jsonFenceMatch = rawContent.match(/```json\s*([\s\S]*?)```/);
      if (jsonFenceMatch) {
        try {
          result = JSON.parse(jsonFenceMatch[1].trim());
          console.log("[parse] Extracted from ```json fence");
        } catch {}
      }

      // Strategy 2: Extract from generic ``` code fences
      if (!result) {
        const fenceMatch = rawContent.match(/```\s*([\s\S]*?)```/);
        if (fenceMatch) {
          try {
            result = JSON.parse(fenceMatch[1].trim());
            console.log("[parse] Extracted from ``` fence");
          } catch {}
        }
      }

      // Strategy 3: Find JSON objects and pick the one with expected fields
      if (!result) {
        const candidates: string[] = [];
        let depth = 0;
        let start = -1;
        for (let i = 0; i < rawContent.length; i++) {
          if (rawContent[i] === "{") {
            if (depth === 0) start = i;
            depth++;
          } else if (rawContent[i] === "}") {
            depth--;
            if (depth === 0 && start >= 0) {
              candidates.push(rawContent.slice(start, i + 1));
              start = -1;
            }
          }
        }
        for (let i = candidates.length - 1; i >= 0; i--) {
          try {
            const candidate = JSON.parse(candidates[i]);
            if (candidate.sentiment_score !== undefined || candidate.verdict || candidate.factions || candidate.risk_score !== undefined) {
              result = candidate;
              console.log(`[parse] Found result JSON in candidate ${i + 1}/${candidates.length}`);
              break;
            }
          } catch {}
        }
      }

      // Strategy 4: Greedy regex
      if (!result) {
        const greedyMatch = rawContent.match(/\{[\s\S]*\}/);
        if (greedyMatch) {
          try {
            result = JSON.parse(greedyMatch[0]);
            console.log("[parse] Extracted via greedy regex");
          } catch (e: any) {
            console.error("[parse] Greedy regex match found but failed to parse:", e.message);
          }
        }
      }

      // Retry once if no parseable JSON
      if (!result) {
        console.log(`[parse] Retrying variant ${variant.id}...`);
        active.finalContent = "";
        await promptWithRetry(agent, `Output ONLY the JSON analysis object. No other text. Include: scenario_id, sentiment_score, risk_score, virality, verdict, factions, themes, strategy, suggested_rewrite.`);

        // Try parsing retry content
        const rc = active.finalContent;
        const fm = rc.match(/```json\s*([\s\S]*?)```/) || rc.match(/```\s*([\s\S]*?)```/) || rc.match(/(\{[\s\S]*\})/);
        if (fm) { try { result = JSON.parse(fm[1].trim()); } catch {} }
      }

      if (!result) {
        throw new Error(`Results parsing failed for variant ${variant.id}. Could not extract JSON from ${rawContent.length} chars.`);
      }

      const simResults: SimulationResults = {
        scenario_id: scenario.id,
        sentiment_score: result.sentiment_score ?? 0.5,
        risk_score: result.risk_score ?? 5,
        virality: result.virality ?? "medium",
        verdict: result.verdict ?? "",
        factions: result.factions ?? [],
        themes: result.themes ?? [],
        strategy: result.strategy ?? [],
        suggested_rewrite: result.suggested_rewrite ?? "",
        agents: active.collectedAgents,
        actions: [...active.collectedActions],
      };

      variantResults[variant.id] = simResults;

      if (ws.readyState === ws.OPEN && isAB) {
        wsSend(ws, "variant_complete", { variant_id: variant.id, results: simResults });
      }
    }

    // Store results — single variant uses flat structure, multi-variant uses keyed object
    if (isAB) {
      results.set(scenario.id, variantResults);
    } else {
      results.set(scenario.id, variantResults[scenario.variants[0].id]);
    }
    scenario.status = "complete";
    saveHistory();

    wsSend(ws, "simulation_complete", {
      results: isAB ? variantResults : variantResults[scenario.variants[0].id],
      is_ab: isAB,
    });
  } finally {
    active.ws = null;
    active.phase = "idle";
    active.pipelinePhase = 0;
    active.finalContent = "";
    active.profilesSent = false;
    active.confirmResolve = null;
    active.collectedAgents = [];
    active.collectedActions = [];
    active.collectedSources = [];
    activeSessions.delete(scenario.id);
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = new Set([
  "https://crowdsim.agentdex.store",
  "http://localhost:5173",
  "http://localhost:3000",
]);

function getCorsOrigin(req: IncomingMessage): string {
  const origin = req.headers.origin || "";
  return ALLOWED_ORIGINS.has(origin) ? origin : "";
}

function jsonResponse(res: ServerResponse, status: number, data: any, req?: IncomingMessage) {
  const origin = req ? getCorsOrigin(req) : "";
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(data));
}

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function wsSend(ws: WebSocket, eventType: string, data: Record<string, any>) {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ event: eventType, ...data }));
    }
  } catch {
    // Client disconnected
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "8000");

const httpServer = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    const origin = getCorsOrigin(req);
    res.writeHead(204, {
      ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // GET /api/health
    if (req.method === "GET" && path === "/api/health") {
      return jsonResponse(res, 200, { status: "ok", version: "1.0.0" }, req);
    }

    // POST /api/scenarios
    if (req.method === "POST" && path === "/api/scenarios") {
      const body = await parseBody(req);
      const id = randomUUID().replace(/-/g, "").slice(0, 12);

      // Extract API key from Authorization header
      const authHeader = req.headers.authorization || "";
      const bearerKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

      // Build variants array
      let variants: Variant[] = [];
      if (body.variants && Array.isArray(body.variants) && body.variants.length > 0) {
        variants = body.variants.map((v: any, i: number) => ({
          id: v.id || String.fromCharCode(65 + i), // A, B, C...
          text: v.text || "",
        }));
      } else {
        // Single post — wrap as variant A for consistency
        variants = [{ id: "A", text: body.post_text || "" }];
      }

      const scenario: Scenario = {
        id,
        post_text: variants[0].text,  // backward compat
        variants,
        audience_desc: body.audience_desc || "",
        platforms: body.platforms || ["twitter", "reddit"],
        agent_count: body.agent_count ?? 15,
        rounds: body.rounds ?? 5,
        model: body.model,
        search_model: body.search_model,
        status: "created",
        research_topics: Array.isArray(body.research_topics) ? body.research_topics.filter((t: any) => typeof t === "string" && t.trim()) : [],
        ...(bearerKey ? { apiKey: bearerKey } : {}),
      };
      scenarios.set(id, scenario);
      saveHistory();

      // Return scenario without the apiKey
      const { apiKey: _omit, ...safeScenario } = scenario;
      return jsonResponse(res, 200, safeScenario, req);
    }

    // GET /api/scenarios
    if (req.method === "GET" && path === "/api/scenarios") {
      return jsonResponse(res, 200, [...scenarios.values()].map(({ apiKey: _, ...s }) => s), req);
    }

    // GET /api/scenarios/:id
    const scenarioMatch = path.match(/^\/api\/scenarios\/([^/]+)$/);
    if (req.method === "GET" && scenarioMatch) {
      const s = scenarios.get(scenarioMatch[1]);
      if (!s) return jsonResponse(res, 404, { detail: "Scenario not found" }, req);
      const { apiKey: _, ...safe } = s;
      return jsonResponse(res, 200, safe, req);
    }

    // GET /api/results/:id
    const resultsMatch = path.match(/^\/api\/results\/([^/]+)$/);
    if (req.method === "GET" && resultsMatch) {
      const r = results.get(resultsMatch[1]);
      if (!r) return jsonResponse(res, 404, { detail: "Results not found" }, req);
      return jsonResponse(res, 200, r, req);
    }

    jsonResponse(res, 404, { detail: "Not found" }, req);
  } catch (err: any) {
    console.error("HTTP error:", err);
    jsonResponse(res, 500, { detail: err.message || "Internal server error" }, req);
  }
});

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const match = url.pathname.match(/^\/api\/simulations\/ws\/([^/]+)$/);

  if (match) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const scenarioId = match[1];
      const scenario = scenarios.get(scenarioId);

      if (!scenario) {
        wsSend(ws, "error", { message: "Scenario not found" });
        ws.close();
        return;
      }

      // Read per-user API key from query parameter (overrides the one from POST)
      const wsKey = url.searchParams.get("apiKey") || url.searchParams.get("key");
      if (wsKey) {
        scenario.apiKey = wsKey;
      }

      console.log(`[ws] Scenario ${scenarioId}: apiKey from POST=${!!scenario.apiKey}, wsKey=${!!wsKey}`);

      if (!scenario.apiKey) {
        wsSend(ws, "simulation_error", { message: "No API key. Please log in again." });
        ws.close();
        return;
      }

      scenario.status = "running";

      // Listen for client messages (confirmation, etc.)
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          const session = activeSessions.get(scenarioId);
          if (msg.action === "confirm" && session?.confirmResolve) {
            console.log(`[ws] Received confirmation from client`);
            session.confirmResolve(true);
          }
        } catch {}
      });

      // Clean up if client disconnects mid-simulation
      ws.on("close", () => {
        console.log(`[ws] Client disconnected for scenario ${scenarioId}`);
        const session = activeSessions.get(scenarioId);
        if (session && session.ws === ws) {
          // Cancel pending confirmation
          if (session.confirmResolve) {
            session.confirmResolve(false);
          }
        }
      });

      runSimulation(ws, scenario)
        .catch((err) => {
          console.error("Simulation error:", err);
          scenario.status = "error";
          saveHistory();
          wsSend(ws, "simulation_error", { message: String(err.message || err) });
        })
        .finally(() => {
          // Small delay so the error event reaches the client before close
          setTimeout(() => {
            try { ws.close(); } catch {}
          }, 500);
        });
    });
  } else {
    socket.destroy();
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

httpServer.listen(PORT, () => {
  console.log(`CrowdSimulator server listening on http://localhost:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
