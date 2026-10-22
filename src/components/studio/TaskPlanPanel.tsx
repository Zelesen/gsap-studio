"use client";

import {
  AlertTriangle,
  Check,
  Circle,
  CircleDashed,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import type { DesignBrief } from "@/lib/design-brief";
import type { PlanTask, TaskPlan, TaskStatus } from "@/lib/task-plan";

/*
 * TaskPlanPanel — the plan surface of the studio.
 *
 * It owns no state: the studio page holds the brief, the plan and the
 * approved task ids, and calls back into it. Every action the panel offers
 * is one the runner actually supports — create a plan, approve it, run the
 * next task, run the whole plan, retry a failed task.
 */

interface TaskPlanPanelProps {
  brief: DesignBrief | null;
  plan: TaskPlan | null;
  approvedTasks: string[];
  isPlanning: boolean;
  isRunning: boolean;
  runningTaskId: string | null;
  error: string | null;
  /** A task can only run against a real project tree. */
  canRun: boolean;
  onCreatePlan: () => void;
  onApprove: () => void;
  onRunNext: () => void;
  onRunAll: () => void;
  onRetry: (taskId: string) => void;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  planned: "Planned",
  ready: "Ready",
  in_progress: "Running",
  verifying: "Verifying",
  completed: "Done",
  failed: "Failed",
  blocked: "Blocked",
  skipped: "Skipped",
};

function TaskStatusIcon({
  status,
  running,
}: {
  status: TaskStatus;
  running: boolean;
}) {
  if (status === "completed") {
    return <Check className="w-3 h-3 text-[#4ade80]" aria-hidden="true" />;
  }
  if (status === "failed") {
    return <AlertTriangle className="w-3 h-3 text-[#f87171]" aria-hidden="true" />;
  }
  if (status === "blocked") {
    return <CircleDashed className="w-3 h-3 text-[#fbbf24]" aria-hidden="true" />;
  }
  if (running) {
    return <Loader2 className="w-3 h-3 text-[#ffffff] animate-spin" aria-hidden="true" />;
  }
  if (status === "planned" || status === "ready") {
    return <Circle className="w-3 h-3 text-[#555555]" aria-hidden="true" />;
  }
  return <CircleDashed className="w-3 h-3 text-[#555555]" aria-hidden="true" />;
}

function TaskRow({
  task,
  running,
  canRetry,
  onRetry,
}: {
  task: PlanTask;
  running: boolean;
  canRetry: boolean;
  onRetry: (taskId: string) => void;
}) {
  return (
    <li className="px-3 py-2 border-b border-[#141414] last:border-b-0">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">
          <TaskStatusIcon status={task.status} running={running} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs truncate ${
                task.status === "completed"
                  ? "text-[#7d7d7d] line-through"
                  : "text-[#e1e1e1]"
              }`}
            >
              {task.title}
            </span>
            <span className="text-[10px] font-mono text-[#4d4d4d] shrink-0">
              {STATUS_LABEL[task.status]}
            </span>
          </div>
          {task.description && (
            <p className="text-[11px] text-[#6b6b6b] leading-snug mt-0.5 line-clamp-2">
              {task.description}
            </p>
          )}
          {task.error && (
            <p className="text-[11px] text-[#f87171] leading-snug mt-1 break-words">
              {task.error}
            </p>
          )}
          {task.verification?.ok && (
            <p className="text-[11px] text-[#5f7f6a] leading-snug mt-1 break-words">
              {task.verification.summary}
            </p>
          )}
          {canRetry && task.status === "failed" && (
            <button
              type="button"
              onClick={() => onRetry(task.id)}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[#9a9a9a] hover:text-[#ffffff] transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Retry this task
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export default function TaskPlanPanel({
  brief,
  plan,
  approvedTasks,
  isPlanning,
  isRunning,
  runningTaskId,
  error,
  canRun,
  onCreatePlan,
  onApprove,
  onRunNext,
  onRunAll,
  onRetry,
}: TaskPlanPanelProps) {
  const isApproved = plan?.status === "approved" || plan?.status === "completed";
  const remaining = plan
    ? plan.tasks.filter((task) => task.status !== "completed")
    : [];
  const canRunNext =
    isApproved &&
    canRun &&
    !isRunning &&
    remaining.some(
      (task) => task.status === "planned" || task.status === "ready",
    );

  return (
    <section
      aria-label="Task plan"
      className="shrink-0 border-t border-[#1e1e1e] bg-[#050505] max-h-[45%] flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#141414]">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-3 h-3 text-[#666666] shrink-0" aria-hidden="true" />
          <span className="text-[11px] font-medium text-[#a0a0a0] truncate">
            Task plan
          </span>
          {plan && (
            <span className="text-[10px] font-mono uppercase tracking-wide text-[#4d4d4d]">
              {plan.status}
            </span>
          )}
        </div>
        {plan && (
          <span className="text-[10px] font-mono text-[#4d4d4d] shrink-0">
            {plan.tasks.filter((task) => task.status === "completed").length}/
            {plan.tasks.length} done
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#222] scrollbar-track-transparent">
        {!plan && (
          <div className="px-3 py-3 space-y-2">
            <p className="text-[11px] text-[#6b6b6b] leading-relaxed">
              {brief
                ? "The design brief is ready. Create a task plan to break it into steps you can approve and run."
                : "Turn this conversation into a design brief and an ordered task plan, approve it, then run the tasks one at a time."}
            </p>
            <button
              type="button"
              onClick={onCreatePlan}
              disabled={isPlanning}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#1a1a1a] border border-[#262626] text-[11px] text-[#d0d0d0] hover:bg-[#232323] hover:text-[#ffffff] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPlanning ? (
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="w-3 h-3" aria-hidden="true" />
              )}
              {isPlanning ? "Planning…" : "Create plan"}
            </button>
          </div>
        )}

        {plan && (
          <ul>
            {plan.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                running={isRunning && runningTaskId === task.id}
                canRetry={isApproved && canRun && !isRunning}
                onRetry={onRetry}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="mx-3 mb-2 p-2 rounded-md bg-[#1a0808] border border-[#3a1515] flex items-start gap-2 text-[#ff6b6b] text-[11px]"
        >
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
          <span className="flex-1 break-words">{error}</span>
        </div>
      )}

      {/* Actions */}
      {plan && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-t border-[#141414]">
          {plan.status === "draft" && (
            <button
              type="button"
              onClick={onApprove}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#ffffff] text-[#000000] text-[11px] font-medium hover:bg-[#e1e1e1] transition-colors"
            >
              <Check className="w-3 h-3" aria-hidden="true" />
              Approve plan
            </button>
          )}

          {isApproved && (
            <>
              <button
                type="button"
                onClick={onRunNext}
                disabled={!canRunNext}
                title={
                  canRun
                    ? "Run the next ready task"
                    : "Generate a website first — a task edits an existing project"
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#1a1a1a] border border-[#262626] text-[11px] text-[#d0d0d0] hover:bg-[#232323] hover:text-[#ffffff] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isRunning ? (
                  <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                ) : (
                  <Play className="w-3 h-3" aria-hidden="true" />
                )}
                {isRunning ? "Running…" : "Run next task"}
              </button>
              <button
                type="button"
                onClick={onRunAll}
                disabled={!canRunNext}
                className="px-2.5 py-1.5 rounded-md text-[11px] text-[#777777] hover:text-[#ffffff] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Run all
              </button>
            </>
          )}

          {approvedTasks.length > 0 && (
            <span className="ml-auto text-[10px] font-mono text-[#4d4d4d]">
              {approvedTasks.length} approved
            </span>
          )}
        </div>
      )}
    </section>
  );
}
