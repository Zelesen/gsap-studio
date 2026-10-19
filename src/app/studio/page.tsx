"use client";

import { useCallback, useEffect, useState } from "react";

import ChatPanel from "@/components/studio/ChatPanel";
import CodePanel from "@/components/studio/CodePanel";
import PreviewPanel from "@/components/studio/PreviewPanel";
import StudioLayout from "@/components/studio/StudioLayout";
import {
  clearProject,
  createEmptyProject,
  loadProject,
  saveProject,
} from "@/lib/storage";
import type { StoredProject } from "@/lib/storage";

/*
 * Studio page — AI website builder at /studio.
 *
 * Vertical slice: prompt → real AI response → generated website → live preview.
 * All state is local (localStorage) for v1. The AI call goes through
 * /api/generate which talks to OpenRouter server-side.
 */

const PROJECT_TITLE = "Website builder";

/*
 * Deterministic stand-in used while the route is prerendered on the server.
 * The real project is read from localStorage on the client, so no browser API
 * (or crypto) is touched during the build's prerender pass.
 */
const SERVER_PROJECT: StoredProject = {
  id: "pending",
  updatedAt: 0,
  files: [
    { name: "index.html", content: "" },
    { name: "style.css", content: "" },
    { name: "script.js", content: "" },
  ],
  conversation: [],
};

const INITIAL_FILES = {
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

export default function StudioPage() {
  const [project, setProject] = useState<StoredProject>(() => {
    if (typeof window === "undefined") return SERVER_PROJECT;
    return loadProject() ?? createEmptyProject();
  });

  const [files, setFiles] = useState(() => {
    return {
      html:
        project.files.find((f) => f.name === "index.html")?.content ||
        INITIAL_FILES.html,
      css:
        project.files.find((f) => f.name === "style.css")?.content ||
        INITIAL_FILES.css,
      javascript:
        project.files.find((f) => f.name === "script.js")?.content ||
        INITIAL_FILES.javascript,
    };
  });

  const [conversation, setConversation] = useState(() => project.conversation);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [panels, setPanels] = useState({
    chat: { collapsed: false },
    preview: { collapsed: false },
    code: { collapsed: false },
  });

  /*
   * Persist the project on every change. The project is initialised from
   * localStorage or created fresh, so a brand-new session is saved from the
   * outset rather than only after an explicit reset.
   */
  useEffect(() => {
    saveProject({
      ...project,
      files: [
        { name: "index.html", content: files.html },
        { name: "style.css", content: files.css },
        { name: "script.js", content: files.javascript },
      ],
      conversation,
    });
  }, [project, files, conversation]);

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
            currentHtml: files.html,
            currentCss: files.css,
            currentJs: files.javascript,
          }),
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Generation failed.");
        }

        setFiles({
          html: data.html,
          css: data.css,
          javascript: data.javascript,
        });
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
    [conversation, files],
  );

  const handleFileChange = useCallback(
    (next: { html: string; css: string; javascript: string }) => {
      setFiles(next);
    },
    [],
  );

  const handleApply = useCallback(() => {
    // The preview re-renders from the current files; the refresh key forces a
    // fresh write so "Apply to preview" does something observable.
    setError(null);
    setRefreshKey((key) => key + 1);
  }, []);

  const handlePreviewError = useCallback((message: string) => {
    setError(message);
  }, []);

  const handleNewProject = useCallback(() => {
    if (
      !window.confirm(
        "Start a new project? Unsaved changes will be lost unless you reset first.",
      )
    ) {
      return;
    }
    setFiles(INITIAL_FILES);
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
              html={files.html}
              css={files.css}
              javascript={files.javascript}
              onRefresh={handleApply}
              onError={handlePreviewError}
              refreshKey={refreshKey}
            />
          ),
          collapsed: panels.preview.collapsed,
        },
        code: {
          element: (
            <CodePanel
              files={files}
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
