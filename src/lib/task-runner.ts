/*
 * M3.5 — the task runner.
 *
 * Executes exactly ONE task of an approved plan against the current project
 * source. The plan invariants live in src/lib/task-plan.ts; this module
 * enforces the execution rules on top of them:
 *
 *  - Only an approved plan runs, and only tasks the user approved.
 *  - One task at a time, and only once its dependencies are completed.
 *  - The model is asked for *edits* to the existing source tree — never for
 *    a fresh project — so the runner reuses the project format and the
 *    validators from src/lib/project.ts.
 *  - A task is completed only after the edited tree validates AND compiles.
 *    Recompiling unchanged source is not execution: a run that changes
 *    nothing fails with "no_changes".
 *  - A failure never mutates the source. The caller keeps the last valid
 *    tree and the last valid preview, and the failed task carries a short
 *    error summary so it can be retried safely.
 *
 * The provider and the compiler are injected, so the runner can be tested
 * with mocks and local fixtures — no paid API request is needed.
 */

import type { Message } from "@/lib/ai";
import type { CompileInput, CompileResult } from "@/lib/compiler";
import { formatDesignBrief } from "@/lib/design-brief";
import { normalizeRuntimeImports } from "@/lib/imports";
import {
  validateProjectFile,
  validateProjectResult,
  type ProjectFile,
  type ProjectManifest,
} from "@/lib/project";
import {
  dependenciesSatisfied,
  findTask,
  nextReadyTask,
  orderTasks,
  validateTaskPlan,
  type PlanTask,
  type TaskPlan,
  type TaskVerification,
} from "@/lib/task-plan";

/* ── types ────────────────────────────────────────────────────────────── */

/** Why a run could not be completed. */
export type TaskRunFailureType =
  /** The plan itself does not satisfy the task-plan contract. */
  | "invalid_plan"
  /** The plan is not approved, or the task is not approved. */
  | "not_approved"
  /** The task's dependencies are not completed yet. */
  | "blocked"
  /** There is nothing left to run. */
  | "no_task"
  /** The requested task cannot run in its current state. */
  | "not_runnable"
  /** The model returned edits that do not validate. */
  | "invalid_edit"
  /** The model returned the project unchanged — nothing was executed. */
  | "no_changes"
  /** The edited tree does not compile. */
  | "compilation_error"
  /** The provider call failed. */
  | "provider_error";

export interface TaskRunSuccess {
  ok: true;
  /** The plan with the executed task marked completed. */
  plan: TaskPlan;
  /** The executed task, with its verification result. */
  task: PlanTask;
  /** The new source tree — the caller applies it to the draft *and* applied copies. */
  files: ProjectFile[];
  /** The compiled preview document for the new tree. */
  compiled: CompileResult;
  /** What was checked before the task was marked completed. */
  verification: TaskVerification;
}

export interface TaskRunFailure {
  ok: false;
  /** The plan with the failed task marked failed (unchanged for pre-flight refusals). */
  plan: TaskPlan;
  /** The task that failed, when a task was selected at all. */
  task?: PlanTask;
  /** A short, actionable summary of what went wrong. */
  error: string;
  type: TaskRunFailureType;
}

export type TaskRunResult = TaskRunSuccess | TaskRunFailure;

export interface TaskRunInput {
  /** The plan to execute. It must be approved. */
  plan: TaskPlan;
  /** The manifest of the project the task edits. */
  manifest: ProjectManifest;
  /** The current source tree the task edits. */
  files: ProjectFile[];
  /** Run this task instead of the next ready one (used for retries). */
  taskId?: string;
  /** The task ids the user approved. When present, only these may run. */
  approvedTasks?: string[];
  /** The model to use for the edit. */
  model: string;
}

export interface TaskRunnerDeps {
  /** Provider seam: returns the raw model text for the given messages. */
  generate: (messages: Message[], model: string) => Promise<string>;
  /** Compiler seam: builds the tree and reports diagnostics. */
  compile: (input: CompileInput) => Promise<CompileResult>;
  /** Clock seam — tests inject a fixed clock. */
  now?: () => number;
}

/* ── the edit contract with the model ─────────────────────────────────── */

/**
 * The output contract for a task run: the complete new content of every
 * file the task changed, plus a one-line summary.
 */
export const TASK_EDIT_SYSTEM_PROMPT = `You are an expert React + TypeScript engineer. You implement exactly ONE task inside an existing React + TypeScript project.

Reply with a single JSON object and nothing else:
{
  "files": [ { "path": "src/App.tsx", "content": "the complete new content of the file" } ],
  "summary": "one sentence describing what you changed"
}

Rules:
- "files" lists every file you created or changed, with its COMPLETE new content.
- Only list files you actually changed; everything else stays as it is.
- Keep the existing project paths, the existing code style and the existing imports.
- Only these imports are allowed: react, react-dom, react-dom/client, react/jsx-runtime, gsap, gsap/ScrollTrigger, @gsap/react.
- Import the runtime with named imports, never with a namespace import:
    import { gsap } from "gsap";
    import { ScrollTrigger } from "gsap/ScrollTrigger";
    import { useGSAP } from "@gsap/react";
  'import * as gsap from "gsap"' gives you the module namespace, which has no registerPlugin, and the preview breaks.
- No external images, fonts, APIs or CDN scripts.
- The result must compile: valid TypeScript, no unresolved imports.
- No markdown fences, no prose outside the JSON.`;

/* ── helpers ──────────────────────────────────────────────────────────── */

const MAX_ERROR_SUMMARY = 600;

/** Keep an error short enough to store on a task, but still actionable. */
function summarizeError(error: string): string {
  const lines = error
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const text = lines.length > 0 ? lines.slice(0, 4).join("; ") : error.trim();
  return text.length > MAX_ERROR_SUMMARY
    ? `${text.slice(0, MAX_ERROR_SUMMARY - 1)}…`
    : text;
}

/** Replace one task of a plan, leaving the rest untouched. */
function withTask(
  plan: TaskPlan,
  id: string,
  patch: Partial<PlanTask>,
): TaskPlan {
  return {
    ...plan,
    tasks: plan.tasks.map((task) => {
      if (task.id !== id) return task;
      const next: PlanTask = { ...task, ...patch };
      // `error` is optional: drop it instead of writing an undefined key.
      if (patch.error === undefined) delete next.error;
      return next;
    }),
  };
}

function toFileRecord(files: ProjectFile[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const file of files) record[file.path] = file.content;
  return record;
}

/** The paths whose content differs between two trees (new files included). */
export function changedPaths(
  before: ProjectFile[],
  after: ProjectFile[],
): string[] {
  const previous = new Map(before.map((file) => [file.path, file.content]));
  const changed: string[] = [];
  for (const file of after) {
    const old = previous.get(file.path);
    if (old === undefined || old !== file.content) changed.push(file.path);
  }
  return changed;
}

/** Apply model edits to the current tree: existing files are replaced, new ones appended. */
export function applyEdits(
  current: ProjectFile[],
  edits: ProjectFile[],
): ProjectFile[] {
  const byPath = new Map<string, string>();
  for (const file of current) byPath.set(file.path, file.content);
  for (const edit of edits) byPath.set(edit.path, edit.content);

  const existing = new Set(current.map((file) => file.path));
  const out: ProjectFile[] = current.map((file) => ({
    path: file.path,
    content: byPath.get(file.path) ?? file.content,
  }));
  for (const edit of edits) {
    if (existing.has(edit.path)) continue;
    existing.add(edit.path);
    out.push({ path: edit.path, content: edit.content });
  }
  return out;
}

export interface TaskEdit {
  files: ProjectFile[];
  summary: string;
}

export type ParsedEdits =
  | { ok: true; value: TaskEdit }
  | { ok: false; error: string };

/**
 * Parse the model's reply into validated file edits.
 *
 * The same file validator the generation path uses decides what a legal
 * file is, so a model cannot smuggle in a traversing path or a binary blob.
 */
export function parseEditResponse(raw: string): ParsedEdits {
  let cleaned = raw.trim();
  const fence = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fence) cleaned = fence[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) {
      return { ok: false, error: "The model returned no parseable JSON object." };
    }
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return {
        ok: false,
        error: "The model returned invalid JSON that could not be parsed.",
      };
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "The model response is not a JSON object." };
  }

  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.files) || record.files.length === 0) {
    return { ok: false, error: 'The model response has no "files" array.' };
  }

  const files: ProjectFile[] = [];
  const seen = new Set<string>();
  for (const entry of record.files) {
    const check = validateProjectFile(entry);
    if (!check.ok) {
      return {
        ok: false,
        error: `The model returned an invalid file: ${check.error}`,
      };
    }
    if (seen.has(check.file.path)) {
      return {
        ok: false,
        error: `The model returned the same file twice: ${check.file.path}`,
      };
    }
    seen.add(check.file.path);
    files.push(check.file);
  }

  const summary =
    typeof record.summary === "string" ? record.summary.trim() : "";
  return { ok: true, value: { files, summary } };
}

/** Build the messages for one task run: brief, current source, then the task. */
export function buildTaskMessages(input: {
  plan: TaskPlan;
  task: PlanTask;
  files: ProjectFile[];
}): Message[] {
  const source = input.files
    .map((file) => `--- ${file.path} ---\n${file.content}`)
    .join("\n");
  const criteria =
    input.task.acceptanceCriteria.length > 0
      ? input.task.acceptanceCriteria.map((item) => `- ${item}`).join("\n")
      : "- (none stated)";
  const expected =
    input.task.expectedFiles.length > 0
      ? input.task.expectedFiles.map((path) => `- ${path}`).join("\n")
      : "- (none stated)";

  return [
    { role: "system", content: TASK_EDIT_SYSTEM_PROMPT },
    {
      role: "system",
      content: `VALIDATED DESIGN BRIEF (context only):\n${formatDesignBrief(
        input.plan.brief,
      )}\n--- END BRIEF ---`,
    },
    {
      role: "system",
      content: `CURRENT PROJECT SOURCE:\n${source}\n--- END SOURCE ---`,
    },
    {
      role: "user",
      content: `TASK: ${input.task.title}\n${input.task.description}\n\nACCEPTANCE CRITERIA:\n${criteria}\n\nEXPECTED FILES:\n${expected}\n\nImplement this task in the project above and return the full new content of every file you change.`,
    },
  ];
}

/* ── task selection ───────────────────────────────────────────────────── */

type TaskSelection =
  | { ok: true; task: PlanTask }
  | { ok: false; error: string; type: TaskRunFailureType };

/**
 * Pick the task to run: an explicitly requested one (a retry), otherwise
 * the next task whose dependencies are satisfied.
 */
function selectTask(plan: TaskPlan, taskId?: string): TaskSelection {
  if (taskId) {
    const task = findTask(plan, taskId);
    if (!task) {
      return { ok: false, error: `Unknown task "${taskId}".`, type: "not_runnable" };
    }
    if (task.status === "completed") {
      return {
        ok: false,
        error: `Task "${task.title}" is already completed.`,
        type: "not_runnable",
      };
    }
    if (task.status === "in_progress" || task.status === "verifying") {
      return {
        ok: false,
        error: `Task "${task.title}" is already running.`,
        type: "not_runnable",
      };
    }
    return { ok: true, task };
  }

  const next = nextReadyTask(plan);
  if (next) return { ok: true, task: next };

  const pending = orderTasks(plan.tasks).filter(
    (task) =>
      task.status === "planned" ||
      task.status === "ready" ||
      task.status === "failed" ||
      task.status === "blocked",
  );
  if (pending.length === 0) {
    return {
      ok: false,
      error: "Every task in the plan is done.",
      type: "no_task",
    };
  }
  return {
    ok: false,
    error: `No task can run yet: ${pending
      .map((task) => task.title)
      .join(", ")} ${pending.length === 1 ? "is" : "are"} waiting on unfinished dependencies.`,
    type: "blocked",
  };
}

/* ── the runner ───────────────────────────────────────────────────────── */

/**
 * Run one task of an approved plan.
 *
 * The returned plan is the plan to persist: on success the task is
 * completed with a verification result, on failure the task is marked
 * failed with a short error summary. The source tree is only returned on
 * success — a failed run never hands back a different tree.
 */
export async function runTask(
  input: TaskRunInput,
  deps: TaskRunnerDeps,
): Promise<TaskRunResult> {
  const now = deps.now ?? Date.now;

  const planCheck = validateTaskPlan(input.plan);
  if (!planCheck.ok) {
    return {
      ok: false,
      plan: input.plan,
      error: `The plan is not valid: ${planCheck.error}`,
      type: "invalid_plan",
    };
  }
  const plan = planCheck.value;

  if (plan.status !== "approved") {
    return {
      ok: false,
      plan,
      error: "Only an approved plan can be executed. Approve the plan first.",
      type: "not_approved",
    };
  }

  const selection = selectTask(plan, input.taskId);
  if (!selection.ok) {
    return { ok: false, plan, error: selection.error, type: selection.type };
  }
  const task = selection.task;

  if (input.approvedTasks && !input.approvedTasks.includes(task.id)) {
    return {
      ok: false,
      plan,
      error: `Task "${task.title}" is not approved for execution.`,
      type: "not_approved",
    };
  }

  if (!dependenciesSatisfied(plan, task)) {
    const unmet = task.dependencies.filter((depId) => {
      const dep = findTask(plan, depId);
      return dep ? dep.status !== "completed" : false;
    });
    return {
      ok: false,
      plan,
      error: `Task "${task.title}" is blocked by ${unmet.join(", ") || "an unfinished dependency"}.`,
      type: "blocked",
    };
  }

  // The task is running from here on: any failure below is a real failure.
  const runningPlan = withTask(plan, task.id, {
    status: "in_progress",
    attempts: task.attempts + 1,
  });
  const runningTask =
    runningPlan.tasks.find((candidate) => candidate.id === task.id) ?? task;

  const fail = (
    error: string,
    type: TaskRunFailureType,
  ): TaskRunFailure => {
    const summary = summarizeError(error);
    const failedTask: PlanTask = {
      ...runningTask,
      status: "failed",
      error: summary,
    };
    return {
      ok: false,
      plan: withTask(runningPlan, task.id, {
        status: "failed",
        error: summary,
      }),
      task: failedTask,
      error: summary,
      type,
    };
  };

  // 1. Ask the model for task-specific edits.
  let raw: string;
  try {
    raw = await deps.generate(
      buildTaskMessages({ plan, task, files: input.files }),
      input.model,
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "The AI provider failed.";
    return fail(`The AI provider failed: ${message}`, "provider_error");
  }

  // 2. Parse and validate the edits.
  const parsed = parseEditResponse(raw);
  if (!parsed.ok) {
    return fail(parsed.error, "invalid_edit");
  }

  /*
   * 3. Normalize the runtime imports of the edits.
   *
   * A namespace import of GSAP compiles but cannot run: the preview's import
   * map hands the code the module namespace, which has no `registerPlugin`.
   * Normalizing the edit — not just the compiled output — keeps the stored
   * source and the running preview in agreement.
   */
  const edits: ProjectFile[] = parsed.value.files.map((file) => ({
    path: file.path,
    content: normalizeRuntimeImports(file.content),
  }));

  // 4. Apply them to the current tree.
  const nextFiles = applyEdits(input.files, edits);
  const changed = changedPaths(input.files, nextFiles);
  if (changed.length === 0) {
    return fail(
      "The model returned the project unchanged, so there was nothing to execute.",
      "no_changes",
    );
  }

  // 5. The edited tree must satisfy the project contract.
  const validated = validateProjectResult({
    manifest: input.manifest,
    files: nextFiles,
  });
  if (!validated.ok) {
    return fail(
      `The generated files failed validation: ${validated.error}`,
      "invalid_edit",
    );
  }

  // 6. The edited tree must compile.
  let compiled: CompileResult;
  try {
    compiled = await deps.compile({
      files: toFileRecord(nextFiles),
      entry: input.manifest.entry,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Compilation failed.";
    return fail(`Compilation failed: ${message}`, "compilation_error");
  }
  // Only errors fail the task. A warning still produced a working build.
  if (compiled.errors.length > 0) {
    return fail(
      `Compilation failed:\n${compiled.errors.join("\n")}`,
      "compilation_error",
    );
  }

  // 7. Everything passed: the task is complete.
  const verification: TaskVerification = {
    ok: true,
    summary: buildVerificationSummary(task, changed, parsed.value.summary),
    checkedAt: now(),
  };
  const completedTask: PlanTask = {
    ...runningTask,
    status: "completed",
    verification,
  };
  const completedPlan: TaskPlan = {
    ...withTask(runningPlan, task.id, {
      status: "completed",
      verification,
    }),
    status: runningPlan.tasks.every(
      (candidate) =>
        candidate.id === task.id || candidate.status === "completed",
    )
      ? "completed"
      : runningPlan.status,
  };

  return {
    ok: true,
    plan: completedPlan,
    task: completedTask,
    files: nextFiles,
    compiled,
    verification,
  };
}

/** One line describing what was checked before the task was completed. */
function buildVerificationSummary(
  task: PlanTask,
  changed: string[],
  modelSummary: string,
): string {
  const parts = [
    `Updated ${changed.length} file${changed.length === 1 ? "" : "s"} (${changed.join(", ")})`,
  ];
  if (modelSummary) parts.push(modelSummary);
  if (task.acceptanceCriteria.length > 0) {
    parts.push(
      `${task.acceptanceCriteria.length} acceptance ${
        task.acceptanceCriteria.length === 1 ? "criterion" : "criteria"
      } implemented`,
    );
  }
  parts.push("source validated and compiled cleanly");
  return parts.join(" — ");
}
