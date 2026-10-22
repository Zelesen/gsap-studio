"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import ChatPanel from "@/components/studio/ChatPanel";
import CodeWorkspace from "@/components/studio/CodeWorkspace";
import PreviewPanel from "@/components/studio/PreviewPanel";
import StudioLayout from "@/components/studio/StudioLayout";
import TaskPlanPanel from "@/components/studio/TaskPlanPanel";
import {
  clearProject,
  createEmptyProject,
  fromFileList,
  loadProject,
  saveProject,
  toFileList,
} from "@/lib/storage";
import type { ProjectFiles, StoredProject } from "@/lib/storage";
import type { ProjectFile, ProjectManifest } from "@/lib/project";
import type { DesignBrief } from "@/lib/design-brief";
import {
  approvePlan,
  nextReadyTask,
  type TaskPlan,
} from "@/lib/task-plan";

/*
 * Studio page — AI website builder at /studio.
 *
 * Vertical slice: prompt → real AI response → generated website → live preview.
 * All state is local (localStorage) for v1. The AI call goes through
 * /api/generate which talks to OpenRouter server-side.
 *
 * Code exists in two copies: `drafts` (what the editor holds) and `applied`
 * (what the preview renders). Editing only touches drafts; Apply copies them
 * across; a generation replaces both so new code appears immediately. Both are
 * persisted, so a refresh restores the editor exactly as it was left — dirty
 * markers included — while the preview keeps showing the last applied version.
 */

const PROJECT_TITLE = "Website builder";

/*
 * Deterministic stand-in used while the route is prerendered on the server.
 * It carries the real starter template so the static HTML is a meaningful
 * first paint; the client swaps in the stored project right after hydration.
 * No browser API (or crypto) is touched during the build's prerender pass.
 */
const INITIAL_FILES: ProjectFiles = {
  html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Project</title>
</head>
<body>
  <h1>Hello, studio.</h1>
  <p>Describe a website and I'll build it.</p>
</body>
</html>`,
  css: `* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #030207;
  color: #f5f1ff;
}

body {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
}

h1 {
  font-size: clamp(2rem, 5vw, 3.5rem);
  font-weight: 400;
  letter-spacing: -0.05em;
  margin-bottom: 12px;
}

p {
  color: #aaa5bb;
  font-size: clamp(1rem, 1.5vw, 1.25rem);
  line-height: 1.6;
}`,
  javascript: `
console.log("Studio project loaded.");
`,
};

const SERVER_PROJECT: StoredProject = {
  id: "pending",
  updatedAt: 0,
  files: toFileList(INITIAL_FILES),
  applied: toFileList(INITIAL_FILES),
  conversation: [],
  designBrief: undefined,
  taskPlan: undefined,
  approvedTasks: [],
};

export default function StudioPage() {
  const [project, setProject] = useState<StoredProject>(SERVER_PROJECT);
  const [drafts, setDrafts] = useState<ProjectFiles>(INITIAL_FILES);
  const [applied, setApplied] = useState<ProjectFiles>(INITIAL_FILES);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  /*
   * M3.2: draft source (`projectFiles`) and the source the preview was last
   * compiled from are tracked separately, mirroring drafts/applied for the
   * legacy triple. Apply advances this only when the compile succeeds, so a
   * broken draft can never become the dirty baseline.
   */
  const [appliedSourceFiles, setAppliedSourceFiles] = useState<ProjectFile[]>(
    [],
  );
  const [projectManifest, setProjectManifest] = useState<ProjectManifest | null>(
    null,
  );
  const [conversation, setConversation] = useState<StoredProject["conversation"]>(
    [],
  );

  /*
   * M3.5: the planning state. The brief and the plan are part of the
   * project, so they are persisted with it (see the save effect below) and
   * restored on load. `approvedTasks` lists the task ids the user cleared
   * for execution — the runner refuses anything outside that list.
   */
  const [designBrief, setDesignBrief] = useState<DesignBrief | null>(null);
  const [taskPlan, setTaskPlan] = useState<TaskPlan | null>(null);
  const [approvedTasks, setApprovedTasks] = useState<string[]>([]);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  /* M3.2: a source Apply runs a compile; tracked apart from generation. */
  const [isCompiling, setIsCompiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [panels, setPanels] = useState({
    chat: { collapsed: false },
    preview: { collapsed: false },
    code: { collapsed: false },
  });
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  /*
   * Hydration is deferred rather than read during the first render: the server
   * and the client must agree on the initial markup, and localStorage only
   * exists on the client. The read is queued as a microtask so it lands before
   * the browser paints — the stored project takes over with no flash and no
   * hydration mismatch. Persisting waits for `hydrated`, so a stored project
   * is never overwritten by the empty server placeholder.
   */
  const [hydrated, setHydrated] = useState(false);

  /*
   * Guards against two failure modes the runner cannot see:
   *  - `runRef` counts runs: a response from a superseded run is dropped.
   *  - `revisionRef` counts source edits: a result computed from an older
   *    tree is dropped instead of overwriting newer edits.
   */
  const runRef = useRef(0);
  const revisionRef = useRef(0);

  useEffect(() => {
    queueMicrotask(() => {
      const stored = loadProject();
      if (stored) {
        setProject(stored);
        setDrafts(fromFileList(stored.files) ?? INITIAL_FILES);
        // Projects saved before drafts were split have one copy: treat it as
        // already applied, matching the live preview they were saved under.
        setApplied(fromFileList(stored.applied ?? stored.files) ?? INITIAL_FILES);
        // M3.1: restore the generated multi-file source when present. Legacy
        // projects have no source and simply keep their old behaviour.
        setProjectFiles(stored.source ?? []);
        // M3.2: the applied source defaults to the draft for pre-M3.2 blobs
        // (storage already applies that migration on load).
        setAppliedSourceFiles(stored.appliedSource ?? stored.source ?? []);
        setProjectManifest(stored.manifest ?? null);
        setConversation(stored.conversation);
        // M3.5: restore the planning state.
        setDesignBrief(stored.designBrief ?? null);
        setTaskPlan(stored.taskPlan ?? null);
        setApprovedTasks(stored.approvedTasks ?? []);
      } else {
        setProject(createEmptyProject());
        setDrafts(INITIAL_FILES);
        setApplied(INITIAL_FILES);
      }
      setHydrated(true);
    });
  }, []);

  /*
   * Persist the project on every change. Both copies of the code are written,
   * so a refresh restores the drafts *and* the applied version — the preview
   * does not silently advance to unsaved edits. The generated multi-file
   * source is stored alongside when present, draft and applied copies alike.
   * The M3.5 planning state (brief, plan, approved tasks) is part of the
   * project too, so plan progress survives a reload.
   */
  useEffect(() => {
    if (!hydrated) return;
    saveProject({
      ...project,
      files: toFileList(drafts),
      applied: toFileList(applied),
      ...(projectFiles.length > 0 ? { source: projectFiles } : {}),
      ...(appliedSourceFiles.length > 0
        ? { appliedSource: appliedSourceFiles }
        : {}),
      ...(projectManifest ? { manifest: projectManifest } : {}),
      designBrief: designBrief ?? undefined,
      taskPlan: taskPlan ?? undefined,
      approvedTasks,
      conversation,
    });
  }, [
    hydrated,
    project,
    drafts,
    applied,
    projectFiles,
    appliedSourceFiles,
    projectManifest,
    designBrief,
    taskPlan,
    approvedTasks,
    conversation,
  ]);

  const handleGenerate = useCallback(
    async (prompt: string) => {
      setError(null);
      setIsLoading(true);

      // Optimistically add the user message; the reply is appended on settle.
      const userMsg: { role: "user"; content: string } = {
        role: "user",
        content: prompt,
      };
      setConversation((prev) => [...prev, userMsg]);

      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Provider is server-resolved: explicit env `AI_PROVIDER` wins for
            // operators; the Studio stays provider-agnostic and never sends keys.
            provider: process.env.NEXT_PUBLIC_AI_PROVIDER || undefined,
            messages: [...conversation, userMsg],
            currentHtml: drafts.html,
            currentCss: drafts.css,
            currentJs: drafts.javascript,
          }),
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Generation failed.");
        }

        // Store compiled output in drafts/applied (backward compatible with
        // existing preview and code panel). The multi-file source is stored
        // separately for future file-tree editor support.
        const compiled = data.compiled;
        if (compiled) {
          setDrafts({
            html: compiled.html,
            css: compiled.css,
            javascript: compiled.javascript,
          });
          setApplied({
            html: compiled.html,
            css: compiled.css,
            javascript: compiled.javascript,
          });
        }
        setProjectFiles(data.files ?? []);
        // The generation compiled these files and the preview renders them,
        // so the applied source is the generated tree itself.
        setAppliedSourceFiles(data.files ?? []);
        setProjectManifest(data.manifest ?? null);
        // A new project invalidates any task result computed from the old one.
        revisionRef.current += 1;
        setConversation((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "Website generated. Check the preview, or edit the code and apply it.",
          },
        ]);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred.",
        );
        setConversation((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "Generation failed. Check your API key and try again, or describe your idea differently.",
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [conversation, drafts],
  );

  const handleFileChange = useCallback((next: ProjectFiles) => {
    setDrafts(next);
  }, []);

  /* Source drafts only — the preview stays on the last compiled tree. */
  const handleSourceChange = useCallback((next: ProjectFile[]) => {
    setProjectFiles(next);
    // A user edit invalidates any task result computed from the old tree.
    revisionRef.current += 1;
  }, []);

  /*
   * Apply for a legacy project is a pure client-side copy: the drafts are the
   * preview artifact, so there is nothing to build.
   *
   * Apply for a React project compiles the draft source through /api/compile
   * first. Only a successful build advances the preview (`applied`) and the
   * applied source baseline — a compile error leaves both on the last good
   * version and surfaces the diagnostics to the chat. The compiled output is
   * mirrored into `drafts` too, because follow-up generations use it as their
   * current-state context.
   */
  const handleApply = useCallback(async () => {
    setError(null);

    if (projectFiles.length === 0) {
      setApplied(drafts);
      return;
    }

    if (!projectManifest) {
      setError(
        "This project has no manifest, so its source cannot be compiled.",
      );
      return;
    }

    const filesRecord: Record<string, string> = {};
    for (const file of projectFiles) {
      filesRecord[file.path] = file.content;
    }

    setIsCompiling(true);
    try {
      const response = await fetch("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: filesRecord,
          entry: projectManifest.entry,
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Compilation failed.");
      }

      /*
       * The compiled document is self-contained: it carries the import map,
       * the inlined CSS and the module script. Handing the same CSS and JS to
       * the preview on top of it would inject the ESM bundle a second time —
       * as a classic script — and break the preview with "Cannot use import
       * statement outside a module". The code panel keeps the split CSS/JS.
       */
      const compiled: ProjectFiles = {
        html: data.html ?? "",
        css: data.css ?? "",
        javascript: data.js ?? "",
      };
      setDrafts(compiled);
      setApplied({ html: compiled.html, css: "", javascript: "" });
      setAppliedSourceFiles(projectFiles);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Compilation failed.",
      );
    } finally {
      setIsCompiling(false);
    }
  }, [drafts, projectFiles, projectManifest]);

  /* Re-render the same applied code from scratch. */
  const handleRerender = useCallback(() => {
    setError(null);
    setRefreshKey((key) => key + 1);
  }, []);

  /*
   * M3.5 — planning.
   *
   * The brief and the plan are produced server-side (the provider key never
   * leaves the server). The plan comes back as a draft: the user reads it
   * and approves it before anything runs.
   */
  const handleCreatePlan = useCallback(async () => {
    setPlanError(null);

    if (conversation.length === 0) {
      setPlanError(
        "Describe the website you want first — the plan is built from this conversation.",
      );
      return;
    }

    setIsPlanning(true);
    try {
      const briefResponse = await fetch("/api/design-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversation }),
      });
      const briefData = await briefResponse.json();
      if (!briefResponse.ok || !briefData.ok) {
        throw new Error(
          briefData.error || "The design brief could not be created.",
        );
      }
      const brief = briefData.brief as DesignBrief;

      const planResponse = await fetch("/api/task-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief, messages: conversation }),
      });
      const planData = await planResponse.json();
      if (!planResponse.ok || !planData.ok) {
        throw new Error(planData.error || "The task plan could not be created.");
      }

      const plan = planData.plan as TaskPlan;
      setDesignBrief(brief);
      setTaskPlan(plan);
      // A fresh plan has nothing approved yet.
      setApprovedTasks([]);
      setConversation((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Plan ready — ${plan.tasks.length} task(s). Review it, then approve it to run the tasks.`,
        },
      ]);
    } catch (err) {
      setPlanError(
        err instanceof Error ? err.message : "The plan could not be created.",
      );
    } finally {
      setIsPlanning(false);
    }
  }, [conversation]);

  /*
   * Approving the plan is the gate for execution: only an approved plan
   * runs, and only the tasks cleared here. The approval re-validates every
   * plan invariant before the plan becomes executable.
   */
  const handleApprovePlan = useCallback(() => {
    if (!taskPlan) return;
    const approved = approvePlan(taskPlan);
    if (!approved.ok) {
      setPlanError(approved.error);
      return;
    }
    setTaskPlan(approved.value);
    setApprovedTasks(approved.value.tasks.map((task) => task.id));
    setPlanError(null);
    setConversation((prev) => [
      ...prev,
      {
        role: "assistant",
        content: `Plan approved — ${approved.value.tasks.length} task(s) cleared for execution.`,
      },
    ]);
  }, [taskPlan]);

  /*
   * M3.5 — execution.
   *
   * One task at a time, and only when its dependencies are completed. The
   * runner works server-side; the client keeps ownership of the project:
   * on success the returned tree becomes both the draft and the applied
   * source (the compile succeeded, so it is the last valid preview), and on
   * failure neither the source nor the preview changes — only the task
   * status and its error summary, so the task can be retried.
   */
  const executeTasks = useCallback(
    async (
      startPlan: TaskPlan,
      startFiles: ProjectFile[],
      taskId: string | undefined,
      runAll: boolean,
    ) => {
      if (!projectManifest) {
        setPlanError(
          "This project has no manifest, so its source cannot be edited.",
        );
        return;
      }

      const runId = ++runRef.current;
      const startRevision = revisionRef.current;
      setIsRunning(true);
      setPlanError(null);

      let currentPlan = startPlan;
      let currentFiles = startFiles;

      try {
        for (;;) {
          let targetId = taskId;
          if (runAll) {
            const next = nextReadyTask(currentPlan);
            if (!next) break;
            targetId = next.id;
          }
          if (!targetId) break;
          setRunningTaskId(targetId);

          const response = await fetch("/api/task-run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              plan: currentPlan,
              approvedTasks,
              manifest: projectManifest,
              files: currentFiles,
              taskId: targetId,
            }),
          });
          const data = await response.json();

          // A newer run superseded this one: drop the response entirely.
          if (runId !== runRef.current) return;

          // The source changed while the task ran, so its result is stale:
          // applying it would overwrite newer edits.
          if (startRevision !== revisionRef.current) {
            setPlanError(
              "The project changed while the task was running, so its result was discarded. Run the task again.",
            );
            return;
          }

          if (!response.ok || !data.ok) {
            // The plan progress (the failed task and its error) is kept; the
            // source and the preview are left exactly as they were.
            if (data.plan) setTaskPlan(data.plan as TaskPlan);
            setPlanError(data.error || "The task could not be completed.");
            return;
          }

          currentPlan = data.plan as TaskPlan;
          currentFiles = (data.files as ProjectFile[]) ?? currentFiles;
          setTaskPlan(currentPlan);
          setProjectFiles(currentFiles);
          setAppliedSourceFiles(currentFiles);
          if (data.compiled) {
            /*
             * The compiled document is self-contained (import map, inlined CSS,
             * module script), so the preview gets it alone — injecting the ESM
             * bundle again as a classic script would break it.
             */
            const compiled: ProjectFiles = {
              html: data.compiled.html ?? "",
              css: data.compiled.css ?? "",
              javascript: data.compiled.javascript ?? "",
            };
            setDrafts(compiled);
            setApplied({ html: compiled.html, css: "", javascript: "" });
          }
          setConversation((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `Task "${data.task?.title ?? "Task"}" completed — ${
                data.verification?.summary ?? "the task was applied and verified."
              }`,
            },
          ]);

          if (!runAll) break;
        }
      } catch (err) {
        setPlanError(
          err instanceof Error
            ? err.message
            : "The task could not be completed.",
        );
      } finally {
        if (runId === runRef.current) {
          setIsRunning(false);
          setRunningTaskId(null);
        }
      }
    },
    [approvedTasks, projectManifest],
  );

  const handleRunNextTask = useCallback(() => {
    if (!taskPlan) return;
    const next = nextReadyTask(taskPlan);
    if (!next) {
      setPlanError(
        "No task can run yet — the remaining tasks are waiting on unfinished dependencies.",
      );
      return;
    }
    void executeTasks(taskPlan, projectFiles, next.id, false);
  }, [taskPlan, projectFiles, executeTasks]);

  const handleRunAllTasks = useCallback(() => {
    if (!taskPlan) return;
    void executeTasks(taskPlan, projectFiles, undefined, true);
  }, [taskPlan, projectFiles, executeTasks]);

  const handleRetryTask = useCallback(
    (taskId: string) => {
      if (!taskPlan) return;
      void executeTasks(taskPlan, projectFiles, taskId, false);
    },
    [taskPlan, projectFiles, executeTasks],
  );

  const handleNewProject = useCallback(() => {
    if (
      !window.confirm(
        "Start a new project? Unsaved changes will be lost unless you reset first.",
      )
    ) {
      return;
    }
    setDrafts(INITIAL_FILES);
    setApplied(INITIAL_FILES);
    setProjectFiles([]);
    setAppliedSourceFiles([]);
    setProjectManifest(null);
    setConversation([]);
    setDesignBrief(null);
    setTaskPlan(null);
    setApprovedTasks([]);
    setPlanError(null);
    setError(null);
    revisionRef.current += 1;
    clearProject();
    setProject(createEmptyProject());
  }, []);

  const handleTogglePanel = useCallback((name: "chat" | "preview" | "code") => {
    setPanels((prev) => ({
      ...prev,
      [name]: { collapsed: !prev[name].collapsed },
    }));
  }, []);

  return (
    <StudioLayout
      title={PROJECT_TITLE}
      mode={mode}
      onModeChange={setMode}
      onNewProject={handleNewProject}
      onTogglePanel={handleTogglePanel}
      panels={{
        chat: {
          element: (
            <div className="flex flex-col h-full min-h-0">
              <div className="flex-1 min-h-0">
                <ChatPanel
                  messages={conversation}
                  isLoading={isLoading}
                  error={error}
                  onSend={handleGenerate}
                />
              </div>
              <TaskPlanPanel
                brief={designBrief}
                plan={taskPlan}
                approvedTasks={approvedTasks}
                isPlanning={isPlanning}
                isRunning={isRunning}
                runningTaskId={runningTaskId}
                error={planError}
                canRun={projectFiles.length > 0 && projectManifest !== null}
                onCreatePlan={handleCreatePlan}
                onApprove={handleApprovePlan}
                onRunNext={handleRunNextTask}
                onRunAll={handleRunAllTasks}
                onRetry={handleRetryTask}
              />
            </div>
          ),
          collapsed: panels.chat.collapsed,
        },
        preview: {
          element: (
            <PreviewPanel
              html={applied.html}
              css={applied.css}
              javascript={applied.javascript}
              onRefresh={handleRerender}
              refreshKey={refreshKey}
            />
          ),
          collapsed: panels.preview.collapsed,
        },
        code: {
          element: (
            <CodeWorkspace
              projectName={projectManifest?.name ?? PROJECT_TITLE}
              source={projectFiles}
              appliedSource={appliedSourceFiles}
              onSourceChange={handleSourceChange}
              legacyFiles={drafts}
              applied={applied}
              onLegacyChange={handleFileChange}
              onApply={handleApply}
              isApplying={isLoading || isCompiling}
              busyLabel={isCompiling ? "Compiling source…" : undefined}
              selectedPath={selectedPath}
              onFileSelect={setSelectedPath}
            />
          ),
          collapsed: false,
        },
      }}
    />
  );
}
