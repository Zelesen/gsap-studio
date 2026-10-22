/*
 * M3.5 — typed design brief contract.
 *
 * The brief is the structured understanding of the website the user asked
 * for. It is produced once (on a new website request or an explicit replan),
 * reviewed and edited by the user, and then handed to every execution task.
 *
 * Conventions follow src/lib/project.ts: hand-rolled validators returning
 * `{ ok: true, value } | { ok: false, error }`, no new validation dependency,
 * and deterministic normalization so a malformed model response degrades
 * instead of throwing.
 */

/** A required section of the website, in page order. */
export interface BriefSection {
  /** Human-readable section name, e.g. "Hero". */
  name: string;
  /** What the section has to achieve. */
  intent: string;
}

/** An optional section worth adding, with the reason why. */
export interface RecommendedSection {
  /** Human-readable section name. */
  name: string;
  /** Why this section is worth adding. */
  reason: string;
}

/** Typography, colour and layout direction. */
export interface VisualDirection {
  typography: string;
  color: string;
  layout: string;
}

/** The structured understanding of the website the user asked for. */
export interface DesignBrief {
  /** What the website is for. */
  purpose: string;
  /** Who it is for. */
  audience: string;
  /** What a visitor must be able to do or understand. */
  contentGoals: string[];
  /** Visual direction: typography, colour, layout. */
  visualDirection: VisualDirection;
  /** Required sections, in page order. */
  sections: BriefSection[];
  /** Optional sections the model recommends, each with a reason. */
  recommendedSections: RecommendedSection[];
  /** Interaction and GSAP animation intent. */
  interactions: string[];
  /** Responsive behaviour requirements. */
  responsive: string[];
  /** Accessibility requirements. */
  accessibility: string[];
  /** Explicit constraints the user stated. */
  constraints: string[];
  /** Assumptions recorded because the user did not say. */
  assumptions: string[];
  /**
   * Questions that materially block a good result. Empty when the brief is
   * actionable as-is — the user is never asked for what can be inferred.
   */
  clarifyingQuestions: string[];
}


/** Result shape shared by every validator in this module. */
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Normalize a string list. Non-string entries are dropped; the result is
 * always an array so downstream code never has to null-check.
 */
export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = nonEmptyString(item);
    if (text) out.push(text);
  }
  return out;
}

/** Normalize the visual direction, filling blanks with an empty string. */
export function normalizeVisualDirection(value: unknown): VisualDirection {
  const dir = isRecord(value) ? value : {};
  return {
    typography: nonEmptyString(dir.typography) ?? "",
    color: nonEmptyString(dir.color) ?? "",
    layout: nonEmptyString(dir.layout) ?? "",
  };
}

/** Normalize required sections; entries without a name are dropped. */
export function normalizeSections(value: unknown): BriefSection[] {
  if (!Array.isArray(value)) return [];
  const out: BriefSection[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = nonEmptyString(item.name);
    if (!name) continue;
    out.push({ name, intent: nonEmptyString(item.intent) ?? "" });
  }
  return out;
}

/** Normalize recommended sections; entries without a name are dropped. */
export function normalizeRecommendedSections(
  value: unknown,
): RecommendedSection[] {
  if (!Array.isArray(value)) return [];
  const out: RecommendedSection[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = nonEmptyString(item.name);
    if (!name) continue;
    out.push({ name, reason: nonEmptyString(item.reason) ?? "" });
  }
  return out;
}


/**
 * Validate and normalize a design brief.
 *
 * `purpose` and `audience` are required — a brief without them cannot guide
 * a build. Everything else is normalized; missing lists become empty arrays
 * so the model can omit what it does not know.
 */
export function validateDesignBrief(
  input: unknown,
): ValidationResult<DesignBrief> {
  if (!isRecord(input)) {
    return { ok: false, error: "brief must be an object" };
  }

  const purpose = nonEmptyString(input.purpose);
  if (!purpose) {
    return { ok: false, error: "brief.purpose must be a non-empty string" };
  }

  const audience = nonEmptyString(input.audience);
  if (!audience) {
    return { ok: false, error: "brief.audience must be a non-empty string" };
  }

  return {
    ok: true,
    value: {
      purpose,
      audience,
      contentGoals: normalizeStringList(input.contentGoals),
      visualDirection: normalizeVisualDirection(input.visualDirection),
      sections: normalizeSections(input.sections),
      recommendedSections: normalizeRecommendedSections(
        input.recommendedSections,
      ),
      interactions: normalizeStringList(input.interactions),
      responsive: normalizeStringList(input.responsive),
      accessibility: normalizeStringList(input.accessibility),
      constraints: normalizeStringList(input.constraints),
      assumptions: normalizeStringList(input.assumptions),
      clarifyingQuestions: normalizeStringList(input.clarifyingQuestions),
    },
  };
}


/**
 * Render a brief as compact plain text for a system prompt.
 *
 * Used as *context*, never as an instruction: the trusted generation prompt
 * stays authoritative.
 */
export function formatDesignBrief(brief: DesignBrief): string {
  const lines: string[] = [];
  lines.push(`Purpose: ${brief.purpose}`);
  lines.push(`Audience: ${brief.audience}`);
  if (brief.contentGoals.length > 0) {
    lines.push(`Content goals: ${brief.contentGoals.join("; ")}`);
  }
  const vd = brief.visualDirection;
  if (vd.typography || vd.color || vd.layout) {
    lines.push(
      `Visual direction: typography=${vd.typography || "n/a"}; color=${
        vd.color || "n/a"
      }; layout=${vd.layout || "n/a"}`,
    );
  }
  if (brief.sections.length > 0) {
    lines.push(
      `Sections (in order): ${brief.sections
        .map((s) => `${s.name} (${s.intent || "no intent given"})`)
        .join(" | ")}`,
    );
  }
  if (brief.recommendedSections.length > 0) {
    lines.push(
      `Recommended sections: ${brief.recommendedSections
        .map((s) => `${s.name} — ${s.reason || "no reason given"}`)
        .join(" | ")}`,
    );
  }
  if (brief.interactions.length > 0) {
    lines.push(`Interactions and animation: ${brief.interactions.join("; ")}`);
  }
  if (brief.responsive.length > 0) {
    lines.push(`Responsive: ${brief.responsive.join("; ")}`);
  }
  if (brief.accessibility.length > 0) {
    lines.push(`Accessibility: ${brief.accessibility.join("; ")}`);
  }
  if (brief.constraints.length > 0) {
    lines.push(`User constraints: ${brief.constraints.join("; ")}`);
  }
  if (brief.assumptions.length > 0) {
    lines.push(`Recorded assumptions: ${brief.assumptions.join("; ")}`);
  }
  if (brief.clarifyingQuestions.length > 0) {
    lines.push(`Open questions: ${brief.clarifyingQuestions.join("; ")}`);
  }
  return lines.join("\n");
}
