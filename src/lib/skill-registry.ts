/*
 * Skill registry for GSAP Studio AI generation.
 *
 * Provides deterministic skill selection and secure loading of agent skill
 * instructions from .agents/skills/. Skills are supplemental guidance:
 * they cannot override the trusted system prompt, change the output schema,
 * relax compiler allowlists, or expose secrets. Server-side project
 * validation and compilation remain the enforcement layer.
 */

import { readFile, realpath } from "fs/promises";
import { join, sep } from "path";

/** Skill role categories. */
export type SkillRole =
  | "design-direction"
  | "gsap-engineering"
  | "react-engineering"
  | "accessibility";

/** A registered skill entry. */
export interface SkillEntry {
  id: string;
  path: string;             // relative to skills root, e.g. "gsap-core/SKILL.md"
  role: SkillRole;
  description: string;
  triggers: string[];       // lowercase keywords matched against request text
  conflicts?: string[];     // skill IDs that cannot co-select with this one
  maxChars?: number;        // per-skill char cap for this entry
  prioritySections?: string[]; // section headings to deliver first (substring match, case-insensitive)
}

/** A skill entry that has been loaded from disk. */
export interface ResolvedSkill extends SkillEntry {
  content: string;          // loaded SKILL.md content (may be truncated)
  truncated: boolean;
}

/** Result of skill selection. */
export interface SelectionResult {
  selected: ResolvedSkill[];
  skipped: Array<{ id: string; reason: string }>;
}

/** Selection options. */
export interface SelectionOptions {
  userRequest: string;
  designBrief?: string | null;
  wantsScrollAnimation?: boolean;
  usesReactAndGsap?: boolean;
}

/** Configuration constants (configurable through code, not env). */
const REGISTRY_CONFIG = {
  /** Maximum number of skills to include in a single generation. */
  MAX_SKILLS: 4,
  /** Maximum combined characters of all skill content in the prompt. */
  MAX_COMBINED_CHARS: 16000,
  /** Default per-skill character cap. */
  DEFAULT_MAX_SKILL_CHARS: 3000,
} as const;

/** Skills root directory, following the project-root convention (process.cwd()). */
export const SKILLS_ROOT = join(process.cwd(), ".agents", "skills");

// Design-direction skill IDs that conflict with each other (at most one selected).
const DESIGN_DIRECTION_IDS = [
  "design-taste-frontend",
  "design-taste-frontend-v1",
  "design-taste-frontend-v2-experimental",
  "gpt-taste",
  "high-end-visual-design",
  "minimalist-ui",
  "industrial-brutalist-ui",
];

/** Priority order used to break ties between matching design-direction skills. */
const DESIGN_DIRECTION_PRIORITY: string[] = [
  "design-taste-frontend",
  "high-end-visual-design",
  "minimalist-ui",
  "industrial-brutalist-ui",
  "gpt-taste",
  "design-taste-frontend-v1",
  "design-taste-frontend-v2-experimental",
];

/**
 * Explicit registry entries. Verified present in .agents/skills/ and
 * skills-lock.json. Intentionally excluded:
 * - brandkit, image-to-code, imagegen-frontend-mobile, imagegen-frontend-web:
 *   moved stubs (image generation moved out), no usable SKILL.md instructions.
 * - redesign-existing-projects: retired, superseded by design-taste-frontend.
 * - stitch-design-taste: Stitch/DESIGN.md target workflow, not code generation.
 */
const REGISTRY: SkillEntry[] = [
  // GSAP engineering
  {
    id: "gsap-core",
    path: "gsap-core/SKILL.md",
    role: "gsap-engineering",
    description: "Official GSAP core API: tweens, easing, staggers, matchMedia, reduced motion.",
    triggers: ["gsap", "animate", "animation", "tween", "ease", "stagger", "matchmedia", "reduced-motion"],
    maxChars: 7600,
    prioritySections: [
      "When to Use GSAP",
      "Core Tween Methods",
      "Common vars",
      "Accessibility and responsive",
      "Official GSAP best practices",
      "Do Not",
    ],
  },
  {
    id: "gsap-scrolltrigger",
    path: "gsap-scrolltrigger/SKILL.md",
    role: "gsap-engineering",
    description: "Official GSAP ScrollTrigger: scroll-linked animation, pinning, scrub.",
    triggers: ["scroll", "scrolltrigger", "pin", "parallax", "scrub", "toggleactions"],
    maxChars: 8800,
    prioritySections: [
      "Key config options",
      "Scrub",
      "Pinning",
      "Refresh and Cleanup",
      "Official GSAP best practices",
      "Do Not",
    ],
  },
  {
    id: "gsap-react",
    path: "gsap-react/SKILL.md",
    role: "gsap-engineering",
    description: "Official GSAP React: useGSAP hook, refs, gsap.context, cleanup, SSR safety.",
    triggers: ["react", "next.js", "usegsap", "ssr", "cleanup", "context"],
  },
  // React engineering
  {
    id: "vercel-react-best-practices",
    path: "vercel-react-best-practices/SKILL.md",
    role: "react-engineering",
    description: "Vercel React/Next.js performance optimization guidelines.",
    triggers: ["performance", "bundle", "waterfall", "next.js", "render", "rerender", "ssr"],
  },
  {
    id: "vercel-composition-patterns",
    path: "vercel-composition-patterns/SKILL.md",
    role: "react-engineering",
    description: "React composition patterns: compound components, state lifting, React 19 APIs.",
    triggers: ["component", "composition", "compound", "react-19", "props", "state"],
  },
  // Accessibility
  {
    id: "intopia-web-accessibility",
    path: "intopia-web-accessibility/SKILL.md",
    role: "accessibility",
    description: "WCAG 2.2 AA accessibility: semantic HTML, focus, contrast, ARIA.",
    triggers: ["accessible", "a11y", "wcag", "contrast", "focus", "aria", "keyboard", "semantic"],
    maxChars: 3000,
  },
  // Design direction (at most one)
  {
    id: "design-taste-frontend",
    path: "design-taste-frontend/SKILL.md",
    role: "design-direction",
    description: "tasteskill v2: researched design directions, no-slop house style.",
    triggers: ["design", "direction", "landing", "art-direction", "no-slop", "premium"],
    maxChars: 6000,
    conflicts: DESIGN_DIRECTION_IDS.filter((i) => i !== "design-taste-frontend"),
  },
  {
    id: "design-taste-frontend-v1",
    path: "design-taste-frontend-v1/SKILL.md",
    role: "design-direction",
    description: "Dial-driven taste: variance/motion/density, GSAP ScrollTrigger skeletons.",
    triggers: ["motion", "scroll", "variance", "density", "dial", "gsap"],
    conflicts: DESIGN_DIRECTION_IDS.filter((i) => i !== "design-taste-frontend-v1"),
  },
  {
    id: "design-taste-frontend-v2-experimental",
    path: "design-taste-frontend-v2-experimental/SKILL.md",
    role: "design-direction",
    description: "Brief inference, image-gen-first asset strategy, bans on AI slop.",
    triggers: ["brief", "imagery", "assets", "image-gen", "picsum"],
    conflicts: DESIGN_DIRECTION_IDS.filter((i) => i !== "design-taste-frontend-v2-experimental"),
  },
  {
    id: "gpt-taste",
    path: "gpt-taste/SKILL.md",
    role: "design-direction",
    description: "AIDA page structure, GSAP scroll motion, marketing layout.",
    triggers: ["aida", "marketing", "hero", "scroll-motion"],
    conflicts: DESIGN_DIRECTION_IDS.filter((i) => i !== "gpt-taste"),
  },
  {
    id: "high-end-visual-design",
    path: "high-end-visual-design/SKILL.md",
    role: "design-direction",
    description: "Calm polished agency design, spring motion, Double-Bezel architecture.",
    triggers: ["premium", "agency", "polished", "spring", "double-bezel", "awwwards"],
    conflicts: DESIGN_DIRECTION_IDS.filter((i) => i !== "high-end-visual-design"),
  },
  {
    id: "minimalist-ui",
    path: "minimalist-ui/SKILL.md",
    role: "design-direction",
    description: "Warm monochrome editorial UI, flat bento grids, typographic contrast.",
    triggers: ["minimal", "monochrome", "bento", "editorial", "warm"],
    conflicts: DESIGN_DIRECTION_IDS.filter((i) => i !== "minimalist-ui"),
  },
  {
    id: "industrial-brutalist-ui",
    path: "industrial-brutalist-ui/SKILL.md",
    role: "design-direction",
    description: "Swiss type, rigid grids, extreme scale contrast, utilitarian colour.",
    triggers: ["brutalist", "swiss", "industrial", "rigid-grid", "telemetry"],
    conflicts: DESIGN_DIRECTION_IDS.filter((i) => i !== "industrial-brutalist-ui"),
  },
];

function skillById(id: string): SkillEntry | undefined {
  return REGISTRY.find((s) => s.id === id);
}

let realSkillsRootCache: string | null = null;

/**
 * Resolve the realpath of the skills root, cached. Falls back to the joined
 * path if realpath is unavailable (e.g. directory missing).
 */
async function realSkillsRoot(): Promise<string> {
  if (realSkillsRootCache) return realSkillsRootCache;
  try {
    realSkillsRootCache = await realpath(SKILLS_ROOT);
  } catch {
    realSkillsRootCache = SKILLS_ROOT;
  }
  return realSkillsRootCache;
}

/**
 * Validate that a skill's relative path cannot escape the skills root.
 * Returns null when the path is unsafe (traversal, absolute, null byte).
 */
export function validateSkillPath(relative: string): boolean {
  if (
    relative.includes("..") ||
    relative.startsWith("/") ||
    relative.startsWith(sep) ||
    /^[A-Za-z]:[\\/]/.test(relative) ||
    relative.includes("\u0000")
  ) {
    return false;
  }
  return true;
}

/**
 * Resolve and read a skill SKILL.md securely.
 *
 * Path containment: the resolved realpath must be inside SKILLS_ROOT.
 * Returns null when the file is missing, unreadable, unsafe, or escapes the root.
 */
export async function loadSkillSecure(
  entry: SkillEntry,
  maxChars: number
): Promise<ResolvedSkill | null> {
  if (!validateSkillPath(entry.path)) {
    return null;
  }

  const target = join(SKILLS_ROOT, entry.path);
  const root = await realSkillsRoot();

  let realTarget: string;
  try {
    realTarget = await realpath(target);
  } catch {
    // Missing or unreadable file: skip gracefully.
    return null;
  }

  // Containment check: realpath must be within the skills root.
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (!realTarget.startsWith(rootWithSep) && realTarget !== root) {
    return null;
  }

  let content: string;
  try {
    content = await readFile(target, "utf8");
  } catch {
    return null;
  }

  const cap = entry.maxChars ?? maxChars;
  if (content.length <= cap) {
    return { ...entry, content, truncated: false };
  }

  const sections = content.split(/\n(?=## )/);
  const priority = entry.prioritySections ?? [];
  const priorityLower = priority.map((p) => p.toLowerCase());

  const isPrioritySection = (section: string): boolean => {
    const firstLine = section.split("\n")[0];
    if (!firstLine.startsWith("## ")) return false;
    const heading = firstLine.slice(3).toLowerCase();
    return priorityLower.some((p) => heading.includes(p.toLowerCase()));
  };

  let kept = "";
  const addSection = (section: string): boolean => {
    const separator = kept.length === 0 ? "" : "\n";
    const candidate = kept + separator + section;
    if (candidate.length > cap) return false;
    kept = candidate;
    return true;
  };

  // Always include section 0 (frontmatter + title) if it fits.
  if (sections.length > 0) {
    addSection(sections[0]);
  }

  // Add priority (actionable) sections in document order first.
  for (let i = 1; i < sections.length; i++) {
    if (isPrioritySection(sections[i])) {
      addSection(sections[i]);
    }
  }

  // Fill remaining budget with non-priority sections in document order.
  for (let i = 1; i < sections.length; i++) {
    if (isPrioritySection(sections[i])) continue;
    addSection(sections[i]);
  }

  if (kept.length === 0) {
    // Even the first section exceeds the cap. Truncate it to fit rather than
    // skipping the skill entirely; mark as truncated so it is not silent.
    const first = sections[0] ?? "";
    if (first.length === 0) return null;
    return { ...entry, content: first.slice(0, cap), truncated: true };
  }

  return { ...entry, content: kept, truncated: true };
}

/**
 * Count lowercase trigger-term substring matches in the given text.
 */
function scoreSkill(entry: SkillEntry, text: string): number {
  let score = 0;
  for (const trigger of entry.triggers) {
    if (text.includes(trigger)) score += 1;
  }
  return score;
}

function normalize(text: string): string {
  return text.toLowerCase();
}

/**
 * Select skills deterministically from the user's request and an optional
 * validated design brief.
 *
 * Rules:
 * - React + GSAP is the studio baseline: gsap-core + gsap-react are always
 *   eligible when GSAP animation is involved.
 * - gsap-scrolltrigger when scroll-driven animation is requested.
 * - intopia-web-accessibility when broader accessibility guidance is useful
 *   (not only when the user says "accessibility").
 * - At most one design-direction skill; explicit direction preferred over
 *   keyword scoring; ties broken by DESIGN_DIRECTION_PRIORITY.
 * - Retired/moved/Stitch skills are never selected.
 */
export async function selectSkills(
  options: SelectionOptions,
  config: {
    maxSkills?: number;
    maxCombinedChars?: number;
    defaultMaxSkillChars?: number;
  } = {}
): Promise<SelectionResult> {
  const {
    maxSkills = REGISTRY_CONFIG.MAX_SKILLS,
    maxCombinedChars = REGISTRY_CONFIG.MAX_COMBINED_CHARS,
    defaultMaxSkillChars = REGISTRY_CONFIG.DEFAULT_MAX_SKILL_CHARS,
  } = config;

  const text = normalize(`${options.userRequest} ${options.designBrief ?? ""}`);
  const skipped: Array<{ id: string; reason: string }> = [];

  const usesGsap = options.usesReactAndGsap !== false;

  // Score all non-design-direction skills.
  const scored: Array<{ entry: SkillEntry; score: number }> = [];
  for (const entry of REGISTRY) {
    if (entry.role === "design-direction") continue;
    const score = scoreSkill(entry, text);
    // gsap-core and gsap-react are handled by the alwaysInclude block below;
    // gsap-scrolltrigger is handled by the wantsScrollAnimation block.
    // Accessibility is eligible whenever broader guidance is useful.
    // When this is not a GSAP project, gsap-engineering skills are not
    // keyword-eligible (they are not added by the guarded blocks either).
    if (!usesGsap && entry.role === "gsap-engineering") continue;
    const eligible =
      score > 0 || entry.role === "accessibility";
    if (eligible) {
      scored.push({ entry, score: score > 0 ? score : 1 });
    }
  }

  // Always include gsap-core and gsap-react for React + GSAP projects.
  if (usesGsap) {
    const alwaysInclude = ["gsap-core", "gsap-react"];
    for (const id of alwaysInclude) {
      const entry = skillById(id);
      if (entry && !scored.some((s) => s.entry.id === id)) {
        scored.push({ entry, score: 100 });
      }
    }
  }

  // gsap-scrolltrigger when scroll animation requested.
  if (options.wantsScrollAnimation) {
    const entry = skillById("gsap-scrolltrigger");
    if (entry && !scored.some((s) => s.entry.id === "gsap-scrolltrigger")) {
      scored.push({ entry, score: 90 });
    }
  }

  // Design direction: at most one. Prefer explicit direction, then keyword
  // score, then priority order for ties.
  let designChoice: { entry: SkillEntry; score: number } | null = null;
  for (const entry of REGISTRY) {
    if (entry.role !== "design-direction") continue;
    const score = scoreSkill(entry, text);
    if (score === 0) continue;
    if (
      !designChoice ||
      score > designChoice.score ||
      (score === designChoice.score &&
        DESIGN_DIRECTION_PRIORITY.indexOf(entry.id) <
          DESIGN_DIRECTION_PRIORITY.indexOf(designChoice.entry.id))
    ) {
      designChoice = { entry, score };
    }
  }
  if (designChoice) {
    scored.push(designChoice);
  }

  // Sort by score desc, then by registry order for stability.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return REGISTRY.indexOf(a.entry) - REGISTRY.indexOf(b.entry);
  });

  // Apply max skills cap.
  const capped = scored.slice(0, maxSkills);
  for (const s of scored.slice(maxSkills)) {
    skipped.push({ id: s.entry.id, reason: "max-skills cap" });
  }

  // Load selected skills securely, enforcing combined char budget.
  const selected: ResolvedSkill[] = [];
  let usedChars = 0;
  for (const s of capped) {
    const loaded = await loadSkillSecure(s.entry, defaultMaxSkillChars);
    if (!loaded) {
      skipped.push({ id: s.entry.id, reason: "failed to load securely" });
      continue;
    }

    let content = loaded.content;
    if (usedChars + content.length > maxCombinedChars) {
      const remaining = maxCombinedChars - usedChars;
      if (remaining <= 0) {
        skipped.push({ id: loaded.id, reason: "combined budget exhausted" });
        continue;
      }
      // Try to fit within the remaining budget using complete sections.
      const sections = content.split(/\n(?=## )/);
      let fit = "";
      for (const section of sections) {
        const candidate = fit ? `${fit}\n${section}` : section;
        if (candidate.length > remaining) break;
        fit = candidate;
      }
      if (!fit || fit.length === 0) {
        skipped.push({ id: loaded.id, reason: "cannot fit within budget" });
        continue;
      }
      content = fit;
    }
    selected.push({ ...loaded, content });
    usedChars += content.length;
  }

  return { selected, skipped };
}

export { REGISTRY, REGISTRY_CONFIG };
