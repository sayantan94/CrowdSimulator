import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { textResult } from "./helpers.js";

// ---------------------------------------------------------------------------
// In-memory cache (from openclaw pattern)
// ---------------------------------------------------------------------------

const SEARCH_CACHE = new Map<string, { value: string; expiresAt: number }>();
const SEARCH_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SEARCH_CACHE_MAX = 100;

function getCached(key: string): string | null {
  const entry = SEARCH_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    SEARCH_CACHE.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key: string, value: string) {
  if (SEARCH_CACHE.size >= SEARCH_CACHE_MAX) {
    const oldest = SEARCH_CACHE.keys().next();
    if (!oldest.done) SEARCH_CACHE.delete(oldest.value);
  }
  SEARCH_CACHE.set(key, {
    value,
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
  });
}

// ---------------------------------------------------------------------------
// Tool: Perplexity Sonar via OpenRouter (from openclaw pattern)
// ---------------------------------------------------------------------------

export function createWebSearchTool(opts?: { searchModel?: string; apiKey?: string }): AgentTool {
  return {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web using Perplexity Sonar (via OpenRouter). Returns AI-synthesized answers with citations from real-time web search. " +
      "Use this to find news, discourse, audience patterns, case studies, and real-world context. " +
      "Returns a synthesized answer plus a list of source URLs (citations). " +
      "For deeper content from a specific source, use the fetch tool on citation URLs.",
    parameters: Type.Object({
      query: Type.String({ description: "The search query" }),
    }),
    execute: async (_toolCallId, params: any, signal) => {
      const query = params.query || "";
      const cacheKey = `pplx:${query}`.toLowerCase();
      const cached = getCached(cacheKey);
      if (cached) return textResult(cached + "\n\n(cached)");

      const apiKey = opts?.apiKey || process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        return textResult(
          "web_search error: OPENROUTER_API_KEY not set. Cannot perform web search."
        );
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        if (signal)
          signal.addEventListener("abort", () => controller.abort(), {
            once: true,
          });

        const res = await globalThis.fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "HTTP-Referer": "https://crowdsimulator.app",
              "X-Title": "CrowdSimulator Web Search",
            },
            body: JSON.stringify({
              model: opts?.searchModel || "perplexity/sonar",
              messages: [{ role: "user", content: query }],
            }),
            signal: controller.signal,
          }
        );

        clearTimeout(timer);

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          return textResult(
            `Search API error (${res.status}): ${detail || res.statusText}`
          );
        }

        const data = (await res.json()) as {
          choices?: Array<{
            message?: {
              content?: string;
              annotations?: Array<{
                type?: string;
                url_citation?: { url?: string; title?: string };
              }>;
            };
          }>;
          citations?: string[];
        };

        const msg = data.choices?.[0]?.message;
        const content = msg?.content ?? "No results";

        // Extract citations from annotations (OpenRouter) or top-level citations (direct Perplexity)
        const annotations = msg?.annotations ?? [];
        const citationUrls = new Map<string, string>(); // url -> title (dedup)
        for (const a of annotations) {
          if (a.type === "url_citation" && a.url_citation?.url) {
            const url = a.url_citation.url;
            if (!citationUrls.has(url)) {
              citationUrls.set(url, a.url_citation.title || "");
            }
          }
        }
        // Fallback: top-level citations array (direct Perplexity API)
        if (citationUrls.size === 0 && data.citations) {
          for (const url of data.citations) {
            citationUrls.set(url, "");
          }
        }

        const parts: string[] = [];
        parts.push(`Search results for "${query}":\n`);
        parts.push(content);
        if (citationUrls.size > 0) {
          parts.push("\n\nSources:");
          let i = 1;
          for (const [url, title] of citationUrls) {
            parts.push(title ? `${i}. ${title} — ${url}` : `${i}. ${url}`);
            i++;
          }
        }

        const result = parts.join("\n");
        setCache(cacheKey, result);
        return textResult(result);
      } catch (e: any) {
        return textResult(`Search failed: ${e.message}`);
      }
    },
  };
}
