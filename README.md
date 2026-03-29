<div align="center">

# CrowdSimulator

**Draft, simulate, decide.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://python.org)
[![Vue 3](https://img.shields.io/badge/Vue-3-42b883.svg)](https://vuejs.org)
[![OpenRouter](https://img.shields.io/badge/LLM-OpenRouter-6366f1.svg)](https://openrouter.ai)

</div>

> **Zero config. Bring your own key.** No `.env` files, no secrets to manage. Log in with your OpenRouter API key, pick your models, and simulate. 

Predict how the internet will react to your post before you publish it. CrowdSimulator researches your topic in real-time, generates realistic audience personas grounded in actual web discourse, and simulates their reactions — arguments, support, pile-ons, and consensus.

![CrowdSimulator — AI research phase](img_5.png)
![CrowdSimulator — Simulation results](img_2.png)
![CrowdSimulator — Strategy report](img_3.png)

## Quick Start

```bash
# 1. Clone
git clone https://github.com/sayantan94/CrowdSimulator.git
cd CrowdSimulator

# 2. Install all dependencies (Node, Python venv, pip packages)
./crowdsim setup

# 3. Start backend + frontend
./crowdsim start

# 4. Open http://localhost:5173 and log in with your OpenRouter key
```

## Prerequisites

- **Node.js 20+** and npm
- **Python 3.10+** with `venv` support
- **OpenRouter API key** — [get one here](https://openrouter.ai/keys)

## How It Works

```
Login → Compose Post → AI Research → Persona Generation → Review → Simulation → Report
```

1. **Login** — Enter your OpenRouter API key. The key stays in your browser's localStorage and is sent with each request to the local backend.
2. **Compose** — Write your post, describe your audience, pick platforms (Twitter/Reddit), set agent count, rounds, and choose LLM/search models.
3. **Research** — AI agent runs 15-20+ web searches on topic sentiment, breaking news, audience demographics, controversy risks, cultural context.
4. **Persona Generation** — Generates diverse audience profiles (supporters, skeptics, trolls, journalists, influencers) grounded in research findings.
5. **Review & Confirm** — Review generated personas and research sources before committing to simulation.
6. **Simulation** — OASIS multi-agent framework runs the sim: agents react with likes, reposts, comments, follows, downvotes across rounds.
7. **Report** — Sentiment score, risk assessment, virality prediction, faction breakdown, themes, strategy recommendations, suggested rewrite.

## Authentication

CrowdSimulator uses a **Bring Your Own Key (BYOK)** model. Your OpenRouter API key:

- Is entered in the browser at login
- Is stored in your browser's localStorage
- Is sent to the local backend per-request via `Authorization: Bearer` header (HTTP) and query parameter (WebSocket)
- Is passed through to OpenRouter for LLM calls and to the OASIS Python subprocess for simulation
- Never leaves your machine (browser → local backend → OpenRouter API)

## Model Selection

You choose both models from the frontend when composing a scenario:

| Setting | What it does | Default |
|---|---|---|
| **LLM Model** | Research, persona generation, analysis | `x-ai/grok-4.1-fast` |
| **Search Model** | Real-time web search via Perplexity | `perplexity/sonar` |

Browse available models at [openrouter.ai/models](https://openrouter.ai/models). Any model ID from OpenRouter works.

## Setup

`./crowdsim setup` handles everything automatically:

1. Installs backend Node dependencies (`agent-service/`)
2. Creates a Python virtual environment (`agent-service/.venv/`)
3. Installs Python packages from `requirements.txt` (OASIS framework, camel-ai, etc.)
4. Installs frontend Node dependencies (`frontend/`)

Run `./crowdsim doctor` to verify everything is ready.

## CLI Commands

All management is done through the `./crowdsim` script in the project root:

```bash
./crowdsim setup     # Install all dependencies (npm + pip)
./crowdsim start     # Start backend + frontend (background processes)
./crowdsim stop      # Stop all services
./crowdsim restart   # Stop then start
./crowdsim status    # Check what's running
./crowdsim logs      # View recent logs (also: logs backend, logs frontend)
./crowdsim doctor    # Diagnose setup issues (Node, Python, deps, ports)
```

Services run in the background. Logs are written to `.pids/backend.log` and `.pids/frontend.log`.

## Tech Stack

**Frontend:** Vue 3, Vue Router, Vite, D3.js, Three.js, Axios

**Backend:** Node.js, TypeScript, pi-agent-core, WebSocket (ws), Playwright, Readability

**Simulation:** OASIS multi-agent framework (Python), camel-ai, SQLite

**LLM:** OpenRouter (Grok, Claude, Gemini, Perplexity, etc.)

## Project Structure

```
CrowdSimulator/
├── crowdsim                  # CLI management script
├── frontend/                 # Vue 3 SPA
│   └── src/
│       ├── api/              # Axios + WebSocket client
│       ├── composables/      # useAuth, useSimulation
│       ├── components/       # ScenarioEditor, TerminalLog, SentimentBar, ...
│       └── views/            # Login, Compose, Research, Simulate, Results
├── agent-service/            # Node.js backend
│   ├── src/
│   │   ├── server.ts         # HTTP + WebSocket server, simulation pipeline
│   │   └── tools/            # Agent tools (web search, fetch, oasis, shell)
│   ├── scripts/              # Python scripts (run_oasis.py, read_results.py)
│   └── requirements.txt      # Python dependencies (camel-ai, OASIS)
└── docs/                     # Design docs and plans
```

## Troubleshooting

**`./crowdsim: no such file or directory`** — Make sure you're in the `CrowdSimulator` root directory.

**`Agent is busy with another simulation`** — A previous simulation is still running. Run `./crowdsim restart` to clear it.

**`401 Missing Authentication header`** — Your API key didn't reach the LLM provider. Log out and log back in with a valid `sk-or-...` key from [openrouter.ai/keys](https://openrouter.ai/keys).

**`Profile extraction failed`** — The LLM model couldn't generate valid persona profiles. The system retries automatically. If it keeps failing, try a more capable model (e.g. `anthropic/claude-sonnet-4`).

**Port already in use** — Run `./crowdsim stop` then `./crowdsim start`, or check with `./crowdsim doctor`.

**Python dependency conflicts** — Delete `agent-service/.venv` and re-run `./crowdsim setup` to rebuild from scratch.

## License

MIT
