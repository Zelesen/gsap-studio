"use client";

import { useCallback, useEffect, useState } from "react";

import ChatPanel from "@/components/studio/ChatPanel";
import CodeWorkspace from "@/components/studio/CodeWorkspace";
import PreviewPanel from "@/components/studio/PreviewPanel";
import StudioLayout from "@/components/studio/StudioLayout";
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

      const compiled: ProjectFiles = {
        html: data.html ?? "",
        css: data.css ?? "",
        javascript: data.js ?? "",
      };
      setDrafts(compiled);
      setApplied(compiled);
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
    setError(null);
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
            <ChatPanel
              messages={conversation}
              isLoading={isLoading}
              error={error}
              onSend={handleGenerate}
            />
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
