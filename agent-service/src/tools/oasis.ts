import { Type } from "@sinclair/typebox";
import { exec, spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { textResult } from "./helpers.js";

const SCRIPTS_DIR = join(import.meta.dirname, "..", "..", "scripts");
const VENV_PYTHON = join(import.meta.dirname, "..", "..", ".venv", "bin", "python3");

// ---------------------------------------------------------------------------
// Run OASIS Simulation
// ---------------------------------------------------------------------------

export function createRunOasisTool(defaultWorkDir: string, opts?: { apiKey?: string; modelId?: string }): AgentTool {
  return {
    name: "run_oasis_simulation",
    label: "Run OASIS Simulation",
    description:
      "Run a multi-agent social media simulation using the OASIS framework. " +
      "Takes agent profiles (JSON array), a platform, number of rounds, the post text, and a work_dir. " +
      "This writes profiles to a file, runs the OASIS Python simulation, and streams real-time actions. " +
      "Each profile must have: agent_id, username, name, bio, persona, age, gender, mbti, profession, " +
      "interested_topics, sentiment_bias, influence_weight, activity_level, archetype.",
    parameters: Type.Object({
      profiles: Type.Any({
        description: "Array of agent profile objects (JSON array or JSON string)",
      }),
      platform: Type.String({
        description: "Platform: 'twitter' or 'reddit'",
      }),
      rounds: Type.Number({
        description: "Number of simulation rounds",
        default: 5,
      }),
      post_text: Type.String({
        description: "The social media post to simulate reactions to",
      }),
      work_dir: Type.Optional(
        Type.String({
          description: "Working directory for this simulation's files",
        })
      ),
    }),
    execute: async (_toolCallId, params: any, signal, onUpdate) => {
      // LLMs sometimes stringify the profiles array — coerce back
      let profiles = params.profiles || [];
      if (typeof profiles === "string") {
        try {
          profiles = JSON.parse(profiles);
        } catch {
          return textResult("Error: profiles parameter is a string but not valid JSON. Pass a JSON array of profile objects.");
        }
      }
      if (!Array.isArray(profiles)) {
        return textResult("Error: profiles must be an array of profile objects.");
      }
      const platform = params.platform || "twitter";
      const rounds = params.rounds || 5;
      const postText = params.post_text || "";
      const workDir = params.work_dir || defaultWorkDir;

      const { mkdirSync } = await import("node:fs");
      mkdirSync(workDir, { recursive: true });

      const profilesPath = join(workDir, `profiles_${platform}.json`);
      await writeFile(profilesPath, JSON.stringify(profiles, null, 2));

      const dbPath = join(workDir, `${platform}.db`);

      const args = [
        join(SCRIPTS_DIR, "run_oasis.py"),
        "--profiles",
        profilesPath,
        "--platform",
        platform,
        "--rounds",
        String(rounds),
        "--db-path",
        dbPath,
        "--post-text",
        postText,
      ];

      return new Promise<AgentToolResult<void>>((resolve) => {
        // BYOK key takes priority, then fall back to .env / process.env
        const effectiveKey = opts?.apiKey || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || "";
        console.log(`[oasis] Spawning OASIS: apiKey=${effectiveKey ? "set (" + effectiveKey.slice(0, 12) + "...)" : "MISSING"}`);
        const child = spawn(VENV_PYTHON, args, {
          cwd: workDir,
          env: {
            ...process.env,
            ...(effectiveKey ? {
              OPENAI_API_KEY: effectiveKey,
              OPENROUTER_API_KEY: effectiveKey,
              OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
            } : {}),
            ...(opts?.modelId ? { CS_LLM_MODEL: opts.modelId } : {}),
          },
        });
        const stderrChunks: string[] = [];
        const summaryLines: string[] = [];

        const rl = createInterface({ input: child.stdout });
        rl.on("line", (line) => {
          try {
            const event = JSON.parse(line);
            if (onUpdate) {
              onUpdate({
                content: [
                  {
                    type: "text",
                    text: `[${platform}] ${event.type}: ${event.message || event.action_type || ""}`,
                  },
                ],
                details: event,
              });
            }
            if (event.type === "action") {
              summaryLines.push(
                `R${event.round} ${event.agent_name} (${event.action_type}): ${(event.content || "").slice(0, 100)}`
              );
            } else if (event.type === "progress") {
              summaryLines.push(`[progress] ${event.message}`);
            }
          } catch {
            summaryLines.push(line);
          }
        });

        child.stderr.on("data", (chunk) => {
          stderrChunks.push(chunk.toString());
        });

        const timer = setTimeout(() => child.kill(), 600000);
        signal?.addEventListener("abort", () => child.kill());

        child.on("close", (code) => {
          clearTimeout(timer);
          const parts: string[] = [];
          if (summaryLines.length) parts.push(summaryLines.join("\n"));
          if (stderrChunks.length)
            parts.push(`[stderr] ${stderrChunks.join("")}`);
          if (code !== 0) parts.push(`[exit code ${code}]`);
          parts.push(`\nSimulation DB: ${dbPath}`);
          parts.push(`Profiles file: ${profilesPath}`);
          resolve(textResult(parts.join("\n") || "(no output)"));
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Read Simulation Results
// ---------------------------------------------------------------------------

export function createReadResultsTool(defaultWorkDir: string): AgentTool {
  return {
    name: "read_simulation_results",
    label: "Read Simulation Results",
    description:
      "Read the results of a completed OASIS simulation from its SQLite database(s). " +
      "Returns a markdown summary of posts, comments, engagement metrics, and action breakdown. " +
      "Call this after run_oasis_simulation completes to analyze the results.",
    parameters: Type.Object({
      db_paths: Type.String({
        description:
          "Comma-separated platform=path pairs, e.g. 'twitter=./twitter.db,reddit=./reddit.db'",
      }),
      profiles_file: Type.String({
        description:
          "Path to the profiles JSON file used for the simulation",
      }),
      work_dir: Type.Optional(
        Type.String({
          description: "Working directory for this simulation",
        })
      ),
    }),
    execute: async (_toolCallId, params: any, signal) => {
      const cwd = params.work_dir || defaultWorkDir;
      const cmd =
        `"${VENV_PYTHON}" "${join(SCRIPTS_DIR, "read_results.py")}" ` +
        `--db-paths "${params.db_paths}" ` +
        `--profiles "${params.profiles_file}"`;

      return new Promise<AgentToolResult<void>>((resolve) => {
        const child = exec(
          cmd,
          { timeout: 60000, maxBuffer: 5 * 1024 * 1024, cwd },
          (error, stdout, stderr) => {
            const parts: string[] = [];
            if (stdout) parts.push(stdout.trim());
            if (stderr) parts.push(`[stderr] ${stderr.trim()}`);
            if (error) parts.push(`[error] ${error.message}`);
            resolve(textResult(parts.join("\n") || "(no output)"));
          }
        );
        signal?.addEventListener("abort", () => child.kill());
      });
    },
  };
}
