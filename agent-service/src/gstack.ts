import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export interface GstackPersona {
  skill_name: string;
  folder_name: string;
  display_name: string;
  description: string;
  tier: number;
  archetype: string;
  sentiment_bias: number;
  influence_weight: number;
  activity_level: number;
  profession: string;
  interested_topics: string[];
}

// Map skill folder names to CrowdSim persona traits.
// The folder name in gstack (e.g. "cso/") is the key.
// description comes from SKILL.md frontmatter at runtime.
const PERSONA_MAP: Record<string, Omit<GstackPersona, "skill_name" | "folder_name" | "description" | "tier">> = {
  "plan-ceo-review": {
    display_name: "CEO / Founder",
    archetype: "strategist",
    sentiment_bias: 0.3,
    influence_weight: 4.5,
    activity_level: 0.7,
    profession: "CEO & Founder",
    interested_topics: ["product strategy", "growth", "fundraising", "market fit"],
  },
  "office-hours": {
    display_name: "YC Office Hours Mentor",
    archetype: "skeptic",
    sentiment_bias: -0.1,
    influence_weight: 4.0,
    activity_level: 0.6,
    profession: "Startup Mentor",
    interested_topics: ["startups", "product-market fit", "user research", "GTM"],
  },
  "plan-eng-review": {
    display_name: "Engineering Manager",
    archetype: "expert",
    sentiment_bias: 0.0,
    influence_weight: 3.5,
    activity_level: 0.7,
    profession: "Engineering Manager",
    interested_topics: ["architecture", "execution", "team velocity", "technical debt"],
  },
  "review": {
    display_name: "Staff Engineer",
    archetype: "critic",
    sentiment_bias: -0.2,
    influence_weight: 3.5,
    activity_level: 0.8,
    profession: "Staff Software Engineer",
    interested_topics: ["code quality", "production bugs", "system design", "testing"],
  },
  "plan-design-review": {
    display_name: "Senior Designer",
    archetype: "critic",
    sentiment_bias: 0.1,
    influence_weight: 3.0,
    activity_level: 0.5,
    profession: "Senior Product Designer",
    interested_topics: ["UX", "visual design", "accessibility", "design systems"],
  },
  "design-consultation": {
    display_name: "Design Partner",
    archetype: "expert",
    sentiment_bias: 0.2,
    influence_weight: 3.0,
    activity_level: 0.6,
    profession: "Design Director",
    interested_topics: ["design strategy", "brand", "creative direction", "user research"],
  },
  "qa": {
    display_name: "QA Lead",
    archetype: "adversary",
    sentiment_bias: -0.3,
    influence_weight: 2.5,
    activity_level: 0.9,
    profession: "QA Lead",
    interested_topics: ["testing", "edge cases", "regression", "automation"],
  },
  "cso": {
    display_name: "Chief Security Officer",
    archetype: "guardian",
    sentiment_bias: -0.4,
    influence_weight: 3.5,
    activity_level: 0.6,
    profession: "Chief Security Officer",
    interested_topics: ["security", "compliance", "threat modeling", "supply chain"],
  },
  "benchmark": {
    display_name: "Performance Engineer",
    archetype: "expert",
    sentiment_bias: -0.1,
    influence_weight: 2.5,
    activity_level: 0.5,
    profession: "Performance Engineer",
    interested_topics: ["performance", "Core Web Vitals", "benchmarking", "optimization"],
  },
  "canary": {
    display_name: "SRE / On-call",
    archetype: "guardian",
    sentiment_bias: -0.2,
    influence_weight: 2.5,
    activity_level: 0.7,
    profession: "Site Reliability Engineer",
    interested_topics: ["reliability", "monitoring", "incident response", "deployment"],
  },
  "ship": {
    display_name: "Release Engineer",
    archetype: "builder",
    sentiment_bias: 0.3,
    influence_weight: 2.0,
    activity_level: 0.8,
    profession: "Release Engineer",
    interested_topics: ["CI/CD", "shipping", "release process", "velocity"],
  },
  "investigate": {
    display_name: "Debugger",
    archetype: "expert",
    sentiment_bias: -0.1,
    influence_weight: 2.5,
    activity_level: 0.6,
    profession: "Senior Software Engineer",
    interested_topics: ["debugging", "root cause analysis", "system internals"],
  },
};

// Skills to skip — utility/meta skills, not personas
const SKIP_SKILLS = new Set([
  "careful", "freeze", "unfreeze", "guard",
  "gstack-upgrade", "autoplan", "learn",
  "setup-browser-cookies", "setup-deploy",
  "connect-chrome", "browse", "codex",
  "design-shotgun", "design-review",
  "document-release", "retro",
  "qa-only", "land-and-deploy",
]);

/**
 * Parse SKILL.md YAML frontmatter only (description, name, tier).
 * Ignores the body entirely — it's gstack boilerplate, not useful for personas.
 */
function parseFrontmatter(
  filePath: string
): { name: string; description: string; tier: number } | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return null;

  const fmBlock = fmMatch[1];

  const nameMatch = fmBlock.match(/^name:\s*(.+)$/m);
  const tierMatch = fmBlock.match(/^preamble-tier:\s*(\d+)$/m);

  if (!nameMatch || !tierMatch) return null;

  // Description uses YAML multiline | syntax
  const descMatch = fmBlock.match(
    /^description:\s*\|\s*\r?\n((?:[ \t]+.+(?:\r?\n|$))*)/m
  );

  const description = descMatch
    ? descMatch[1]
        .split(/\r?\n/)
        .map((line) => line.replace(/^[ \t]{2}/, ""))
        .join(" ")
        .trim()
    : "";

  return {
    name: nameMatch[1].trim(),
    description,
    tier: parseInt(tierMatch[1], 10),
  };
}

/**
 * Load gstack skills and return CrowdSimulator personas.
 * Uses only the SKILL.md frontmatter description + PERSONA_MAP traits.
 */
export function loadGstackPersonas(gstackDir: string): GstackPersona[] {
  if (!existsSync(gstackDir)) {
    console.warn(`[gstack] directory not found: ${gstackDir}`);
    return [];
  }

  const personas: GstackPersona[] = [];
  const entries = readdirSync(gstackDir);

  for (const entry of entries) {
    const dirPath = join(gstackDir, entry);

    try {
      if (!statSync(dirPath).isDirectory()) continue;
    } catch {
      continue;
    }

    if (SKIP_SKILLS.has(entry)) continue;

    const mapping = PERSONA_MAP[entry];
    if (!mapping) continue;

    // Case-insensitive filesystem — try both
    const skillFile =
      [join(dirPath, "SKILL.md"), join(dirPath, "skill.md")].find((p) =>
        existsSync(p)
      ) ?? null;
    if (!skillFile) continue;

    const fm = parseFrontmatter(skillFile);
    if (!fm) continue;

    personas.push({
      skill_name: fm.name,
      folder_name: entry,
      description: fm.description,
      tier: fm.tier,
      ...mapping,
    });
  }

  // Sort by influence_weight descending
  personas.sort((a, b) => b.influence_weight - a.influence_weight);

  console.log(`[gstack] Loaded ${personas.length} personas from ${gstackDir}`);
  return personas;
}
