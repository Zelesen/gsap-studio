"use client";

import { useCallback, useEffect, useState } from "react";

import ChatPanel from "@/components/studio/ChatPanel";
import CodePanel from "@/components/studio/CodePanel";
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
  const [conversation, setConversation] = useState<StoredProject["conversation"]>(
    [],
  );

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [panels, setPanels] = useState({
    chat: { collapsed: false },
    preview: { collapsed: false },
    code: { collapsed: false },
  });

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
   * does not silently advance to unsaved edits.
   */
  useEffect(() => {
    if (!hydrated) return;
    saveProject({
      ...project,
      files: toFileList(drafts),
      applied: toFileList(applied),
      conversation,
    });
  }, [hydrated, project, drafts, applied, conversation]);

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

        // Generated code replaces both copies: it is what the user asked for,
        // so it belongs in the preview straight away with nothing to apply.
        const generated: ProjectFiles = {
          html: data.html,
          css: data.css,
          javascript: data.javascript,
        };
        setDrafts(generated);
        setApplied(generated);
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

  /*
   * Apply copies the drafts into the preview. The preview's own document
   * changes with them, which is what re-renders it — there is no separate
   * refresh counter to bump.
   */
  const handleApply = useCallback(() => {
    setError(null);
    setApplied(drafts);
  }, [drafts]);

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
            <CodePanel
              files={drafts}
              applied={applied}
              onChange={handleFileChange}
              onApply={handleApply}
              isApplying={isLoading}
            />
          ),
          collapsed: panels.code.collapsed,
        },
      }}
    />
  );
}
