/*
 * Server-side task execution route.
 *
 * Runs ONE task of an approved plan against the current project source and
 * returns the new source tree plus the compiled preview document.
 *
 * The route is the smallest safe integration point between the plan
 * contract (src/lib/task-plan.ts), the runner (src/lib/task-runner.ts) and
 * the studio: it reuses the existing compiler pipeline and the existing
 * project file format, and it never touches the browser's storage — the
 * client owns the project and persists the returned plan progress.
 *
 * Credentials are never exposed to the browser: the provider call happens
 * here, server-side.
 */

import { generateRawCompletion, type AIProvider } from "@/lib/ai";
import { compileProject } from "@/lib/compiler";
import { validateProjectResult, type ProjectFile } from "@/lib/project";
import { validateTaskPlan, type PlanTask, type TaskPlan, type TaskVerification } from "@/lib/task-plan";
import { runTask, type TaskRunFailureType } from "@/lib/task-runner";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;

interface TaskRunRequest {
  provider?: AIProvider;
  model?: string;
  plan: unknown;
  approvedTasks?: unknown;
  manifest: unknown;
  files: unknown;
  taskId?: string;
}

interface TaskRunResponse {
  ok: boolean;
  plan?: TaskPlan;
  task?: PlanTask;
  files?: ProjectFile[];
  compiled?: { html: string; css: string; javascript: string };
  verification?: TaskVerification;
  error?: string;
  type?: TaskRunFailureType | string;
  status?: number;
}

/*
 * One execution per plan at a time. The client runs tasks sequentially;
 * this turns a double click (or two tabs) into a 409 instead of two
 * concurrent edits racing for the same source tree.
 */
const activePlans = new Set<string>();

function planKey(planId: unknown): string {
  return typeof planId === "string" && planId.length > 0 ? planId : "__unkeyed__";
}

function normalizeApprovedTasks(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input.filter((id): id is string => typeof id === "string");
}

/**
 * POST /api/task-run
 * Body: { model?, provider?, plan, approvedTasks?, manifest, files, taskId? }
 *
 * Executes the next runnable task of an approved plan (or the task named
 * by `taskId`, for a retry). On success the response carries the new source
 * tree and the compiled preview; on failure it carries the plan with the
 * failed task and a short error summary — and no source, so the client
 * keeps its last valid tree and preview.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: TaskRunRequest;
  try {
    body = (await req.json()) as TaskRunRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  // The plan must satisfy the task-plan contract before anything runs.
  const planCheck = validateTaskPlan(body.plan);
  if (!planCheck.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `Invalid plan: ${planCheck.error}`,
        type: "invalid_plan",
        status: 400,
      },
      { status: 400 },
    );
  }
  const plan = planCheck.value;

  // The base project the task edits must be a valid project.
  const projectCheck = validateProjectResult({
    manifest: body.manifest,
    files: body.files,
  });
  if (!projectCheck.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `The project source is not valid: ${projectCheck.error}`,
        type: "invalid_edit",
        status: 400,
      },
      { status: 400 },
    );
  }

  const key = planKey((body.plan as { id?: unknown } | null)?.id);
  if (activePlans.has(key)) {
    return NextResponse.json(
      {
        ok: false,
        error: "A task is already running for this plan.",
        type: "already_running",
        status: 409,
      },
      { status: 409 },
    );
  }
  activePlans.add(key);

  try {
    const provider = (body.provider || process.env.AI_PROVIDER || undefined) as
      | AIProvider
      | undefined;

    let model: string;
    if (body.model) {
      model = body.model;
    } else if (provider === "google") {
      model = process.env.GOOGLE_MODEL?.trim() || "gemini-3.6-flash";
    } else if (provider === "openai") {
      model = "gpt-4o-mini";
    } else {
      model = process.env.OPENROUTER_MODEL?.trim() || "openrouter/free";
    }

    const result = await runTask(
      {
        plan,
        manifest: projectCheck.result.manifest,
        files: projectCheck.result.files,
        ...(typeof body.taskId === "string" && body.taskId.length > 0
          ? { taskId: body.taskId }
          : {}),
        ...(normalizeApprovedTasks(body.approvedTasks)
          ? { approvedTasks: normalizeApprovedTasks(body.approvedTasks) }
          : {}),
        model,
      },
      {
        generate: (messages, usedModel) =>
          generateRawCompletion(messages, usedModel, { provider }),
        compile: compileProject,
      },
    );

    if (!result.ok) {
      const status = result.type === "provider_error" ? 502 : 400;
      return NextResponse.json<TaskRunResponse>(
        {
          ok: false,
          error: result.error,
          type: result.type,
          plan: result.plan,
          ...(result.task ? { task: result.task } : {}),
          status,
        },
        { status },
      );
    }

    return NextResponse.json<TaskRunResponse>({
      ok: true,
      plan: result.plan,
      task: result.task,
      files: result.files,
      compiled: {
        html: result.compiled.html,
        css: result.compiled.css,
        javascript: result.compiled.js,
      },
      verification: result.verification,
    });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "status" in err) {
      const e = err as { status?: number; message?: string; type?: string };
      return NextResponse.json(
        {
          ok: false,
          error: e.message || "Task execution failed.",
          type: e.type,
          status: e.status,
        },
        { status: e.status && e.status >= 500 ? 502 : 400 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred." },
      { status: 500 },
    );
  } finally {
    activePlans.delete(key);
  }
}
