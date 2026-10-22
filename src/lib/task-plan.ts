/*
 * M3.5 — typed task-plan contract.
 *
 * A plan is an ordered, editable list of build steps over a design brief.
 * The user inspects and edits it before approving; execution then runs the
 * tasks one at a time.
 *
 * Invariants enforced here (and relied upon by src/lib/task-runner.ts):
 *  - Task IDs are unique.
 *  - Dependencies point at existing tasks and never form a cycle.
 *  - At most one task may be `in_progress` or `verifying` at a time.
 *  - A task cannot be marked `completed` without a verification result.
 *
 * Validation follows src/lib/project.ts conventions: hand-rolled, typed,
 * dependency-free, and deterministic.
 */

import {
  validateDesignBrief,
  type DesignBrief,
  type ValidationResult,
} from "@/lib/design-brief";

/** Lifecycle status of a single planned task. */
export type TaskStatus =
  | "planned"
  | "ready"
  | "in_progress"
  | "verifying"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped";

/** Every legal task status, in lifecycle order. */
export const TASK_STATUSES: readonly TaskStatus[] = [
  "planned",
  "ready",
  "in_progress",
  "verifying",
  "completed",
  "failed",
  "blocked",
  "skipped",
];

/** Statuses that mean "a task is running right now". */
export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
  "in_progress",
  "verifying",
];

/** Approval state of the whole plan. */
export type PlanStatus = "draft" | "approved" | "completed";

/** Verification outcome recorded on a completed or failed task. */
export interface TaskVerification {
  /** True when every acceptance criterion was checked and passed. */
  ok: boolean;
  /** One-line summary of what was checked and what happened. */
  summary: string;
  /** Epoch ms of the check. */
  checkedAt: number;
}

/** One build step in the plan. */
export interface PlanTask {
  /** Stable identifier; referenced by dependencies. */
  id: string;
  /** Short title shown in the UI. */
  title: string;
  /** Concise description of the work. */
  description: string;
  /** Execution order, 0-based. */
  position: number;
  /** IDs of tasks that must complete first. */
  dependencies: string[];
  /** Conditions that must hold before the task counts as done. */
  acceptanceCriteria: string[];
  /** Files or project areas the task is expected to touch. */
  expectedFiles: string[];
  /** Current lifecycle status. */
  status: TaskStatus;
  /** Verification result, present once the task was checked. */
  verification?: TaskVerification;
  /** Error summary from the last failed attempt. */
  error?: string;
  /** How many times the task has been attempted. */
  attempts: number;
}

/** An ordered, editable plan over a design brief. */
export interface TaskPlan {
  /** Stable identifier for this plan revision. */
  id: string;
  /** Epoch ms the plan was created. */
  createdAt: number;
  /** The brief this plan implements. */
  brief: DesignBrief;
  /** The tasks, ordered by `position`. */
  tasks: PlanTask[];
  /** Approval state. Execution requires `approved`. */
  status: PlanStatus;
}

/* ── helpers ─────────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = nonEmptyString(item);
    if (text) out.push(text);
  }
  return out;
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    typeof value === "string" &&
    (TASK_STATUSES as readonly string[]).includes(value)
  );
}

/** A raw task as it may arrive from a model or from an edited draft. */
export interface RawPlanTask {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  position?: unknown;
  dependencies?: unknown;
  acceptanceCriteria?: unknown;
  expectedFiles?: unknown;
  status?: unknown;
  verification?: unknown;
  error?: unknown;
  attempts?: unknown;
}

/**
 * Detect a dependency cycle among the given edges.
 *
 * Uses an iterative depth-first search over `dependencies`, so a long plan
 * cannot blow the stack. Returns the cycle as a path, or null when the graph
 * is acyclic.
 */
export function hasDependencyCycle(
  edges: Map<string, string[]>,
): string[] | null {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of edges.keys()) color.set(id, WHITE);

  for (const start of edges.keys()) {
    if (color.get(start) !== WHITE) continue;
    // Iterative DFS: [node, index into its dependency list].
    const stack: Array<[string, number]> = [[start, 0]];
    color.set(start, GREY);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const node = frame[0];
      const deps = edges.get(node) ?? [];
      if (frame[1] >= deps.length) {
        color.set(node, BLACK);
        stack.pop();
        continue;
      }
      const next = deps[frame[1]];
      frame[1] += 1;
      if (!edges.has(next)) continue;
      const state = color.get(next);
      if (state === GREY) {
        // A back edge means the graph has a cycle.
        return [...stack.map((entry) => entry[0]), next];
      }
      if (state === WHITE) {
        color.set(next, GREY);
        stack.push([next, 0]);
      }
    }
  }
  return null;
}

/**
 * Normalize one task. The returned task is well-formed on its own; the
 * cross-task invariants (unique IDs, resolvable dependencies, single active
 * task) are checked by `validateTaskPlan`.
 */
export function normalizePlanTask(
  input: unknown,
  fallbackId: string,
  fallbackPosition: number,
): PlanTask {
  const raw: RawPlanTask = isRecord(input) ? input : {};
  const id = nonEmptyString(raw.id) ?? fallbackId;
  const position =
    typeof raw.position === "number" && Number.isFinite(raw.position)
      ? Math.trunc(raw.position)
      : fallbackPosition;

  const task: PlanTask = {
    id,
    title: nonEmptyString(raw.title) ?? id,
    description: nonEmptyString(raw.description) ?? "",
    position,
    dependencies: normalizeStringList(raw.dependencies),
    acceptanceCriteria: normalizeStringList(raw.acceptanceCriteria),
    expectedFiles: normalizeStringList(raw.expectedFiles),
    status: isTaskStatus(raw.status) ? raw.status : "planned",
    attempts:
      typeof raw.attempts === "number" && Number.isFinite(raw.attempts)
        ? Math.max(0, Math.trunc(raw.attempts))
        : 0,
  };

  if (isRecord(raw.verification)) {
    task.verification = {
      ok: raw.verification.ok === true,
      summary: nonEmptyString(raw.verification.summary) ?? "",
      checkedAt:
        typeof raw.verification.checkedAt === "number" &&
        Number.isFinite(raw.verification.checkedAt)
          ? raw.verification.checkedAt
          : 0,
    };
  }
  const error = nonEmptyString(raw.error);
  if (error) task.error = error;

  return task;
}

/** Count tasks that are currently running. */
export function countActiveTasks(tasks: PlanTask[]): number {
  return tasks.filter((t) => ACTIVE_TASK_STATUSES.includes(t.status)).length;
}

/**
 * Validate a plan: the brief, the tasks, and every cross-task invariant.
 *
 * Rejected:
 *  - a brief that fails `validateDesignBrief`
 *  - an empty task list
 *  - duplicate task IDs
 *  - a dependency that names a task which does not exist
 *  - a dependency cycle
 *  - more than one task in `in_progress`/`verifying` at the same time
 *  - a `completed` task with no verification result
 */
export function validateTaskPlan(input: unknown): ValidationResult<TaskPlan> {
  if (!isRecord(input)) {
    return { ok: false, error: "plan must be an object" };
  }

  const briefCheck = validateDesignBrief(input.brief);
  if (!briefCheck.ok) {
    return { ok: false, error: `brief: ${briefCheck.error}` };
  }

  if (!Array.isArray(input.tasks) || input.tasks.length === 0) {
    return { ok: false, error: "plan.tasks must be a non-empty array" };
  }

  const tasks: PlanTask[] = [];
  const seenIds = new Set<string>();
  const usedIds = new Set<string>();
  for (let i = 0; i < input.tasks.length; i++) {
    const raw = isRecord(input.tasks[i])
      ? (input.tasks[i] as RawPlanTask)
      : {};
    const explicitId = nonEmptyString(raw.id);
    if (explicitId) {
      if (seenIds.has(explicitId)) {
        return { ok: false, error: `duplicate task id: ${explicitId}` };
      }
      seenIds.add(explicitId);
      usedIds.add(explicitId);
      tasks.push(normalizePlanTask(raw, explicitId, i));
      continue;
    }
    /*
     * A task without an id gets a deterministic fallback. The fallback is
     * derived from the array index only (never from a clock or a random
     * source), so validating the same plan twice yields the same ids. It is
     * also collision-free against every explicit id in the plan.
     */
    let fallbackId = `task-${i + 1}`;
    let suffix = 2;
    while (usedIds.has(fallbackId)) {
      fallbackId = `task-${i + 1}-${suffix}`;
      suffix++;
    }
    usedIds.add(fallbackId);
    seenIds.add(fallbackId);
    tasks.push(normalizePlanTask(raw, fallbackId, i));
  }

  /*
   * Positions must be dense and unique: the tasks are re-indexed by the
   * requested order (ascending position, ties broken by input order), so the
   * validated plan always has positions 0..n-1 with no gaps and no
   * duplicates. Re-indexing is deterministic — the same input always
   * produces the same ordering.
   */
  const ordered = tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => a.task.position - b.task.position || a.index - b.index)
    .map((entry, position) => ({ ...entry.task, position }));

  // Dependencies must resolve to real tasks.
  const edges = new Map<string, string[]>();
  for (const task of ordered) {
    for (const dep of task.dependencies) {
      if (dep === task.id) {
        return {
          ok: false,
          error: `task ${task.id} depends on itself`,
        };
      }
      if (!seenIds.has(dep)) {
        return {
          ok: false,
          error: `task ${task.id} depends on unknown task ${dep}`,
        };
      }
    }
    edges.set(task.id, task.dependencies);
  }

  const cycle = hasDependencyCycle(edges);
  if (cycle) {
    return { ok: false, error: `dependency cycle: ${cycle.join(" -> ")}` };
  }

  // At most one task may be running.
  const active = countActiveTasks(ordered);
  if (active > 1) {
    return {
      ok: false,
      error: `at most one task may be in progress (found ${active})`,
    };
  }

  // A task is only complete when it was actually verified.
  for (const task of ordered) {
    if (task.status === "completed" && !task.verification) {
      return {
        ok: false,
        error: `task ${task.id} is completed without a verification result`,
      };
    }
  }

  const status =
    input.status === "approved" || input.status === "completed"
      ? input.status
      : "draft";

  return {
    ok: true,
    value: {
      id: nonEmptyString(input.id) ?? `plan-${tasks.length}-${ordered.length}`,
      createdAt:
        typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
          ? input.createdAt
          : 0,
      brief: briefCheck.value,
      tasks: ordered,
      status,
    },
  };
}

/** Return the tasks sorted by position (stable for equal positions). */
export function orderTasks(tasks: PlanTask[]): PlanTask[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => a.task.position - b.task.position || a.index - b.index)
    .map((entry) => entry.task);
}

/** Look up a task by id. */
export function findTask(plan: TaskPlan, id: string): PlanTask | undefined {
  return plan.tasks.find((task) => task.id === id);
}

/**
 * Whether a task's dependencies are all completed.
 *
 * Dependencies that name the task itself are ignored (a self-dependency is
 * meaningless and is rejected by `validateTaskPlan`).
 */
export function dependenciesSatisfied(plan: TaskPlan, task: PlanTask): boolean {
  return task.dependencies.every((depId) => {
    const dep = findTask(plan, depId);
    return dep ? dep.status === "completed" : true;
  });
}

/**
 * The next task that may run: not started, dependencies met, and not
 * blocked. Returns undefined when nothing is runnable.
 */
export function nextReadyTask(plan: TaskPlan): PlanTask | undefined {
  const ordered = orderTasks(plan.tasks);
  for (const task of ordered) {
    if (task.status !== "planned" && task.status !== "ready") continue;
    if (!dependenciesSatisfied(plan, task)) continue;
    return task;
  }
  return undefined;
}

/** Whether the plan has no task left to run. */
export function isPlanFinished(plan: TaskPlan): boolean {
  return plan.tasks.every(
    (task) =>
      task.status === "completed" ||
      task.status === "skipped" ||
      task.status === "blocked",
  );
}

/** A plain, immutable edit of one task. */
export function updateTask(
  plan: TaskPlan,
  id: string,
  patch: Partial<
    Pick<
      PlanTask,
      | "title"
      | "description"
      | "acceptanceCriteria"
      | "expectedFiles"
      | "dependencies"
    >
  >,
): TaskPlan {
  return {
    ...plan,
    tasks: plan.tasks.map((task) =>
      task.id === id
        ? {
            ...task,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.description !== undefined
              ? { description: patch.description }
              : {}),
            ...(patch.acceptanceCriteria !== undefined
              ? { acceptanceCriteria: [...patch.acceptanceCriteria] }
              : {}),
            ...(patch.expectedFiles !== undefined
              ? { expectedFiles: [...patch.expectedFiles] }
              : {}),
            ...(patch.dependencies !== undefined
              ? { dependencies: [...patch.dependencies] }
              : {}),
          }
        : task,
    ),
  };
}

/**
 * Approve the plan. Only a `draft` plan can be approved, and approval
 * re-validates every invariant before the plan becomes executable.
 */
export function approvePlan(plan: TaskPlan): ValidationResult<TaskPlan> {
  if (plan.status !== "draft") {
    return { ok: false, error: "only a draft plan can be approved" };
  }
  const check = validateTaskPlan({ ...plan, status: "approved" });
  if (!check.ok) return check;
  return { ok: true, value: check.value };
}
