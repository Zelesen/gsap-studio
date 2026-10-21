"use client";

import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, Play, RefreshCw, Sparkles, X, FileCode, Copy, Download } from "lucide-react";

import SyntaxEditor from "./SyntaxEditor";
import FileIcon from "./FileIcon";
import { languageForPath } from "@/lib/syntax";

import type { ProjectFiles } from "@/lib/storage";
import type { ProjectFile } from "@/lib/project";

type FileKey = keyof ProjectFiles;

interface CodePanelProps {
  /** Working drafts of the legacy triple — what the editor shows. */
  files: ProjectFiles;
  /** The version currently rendered in the preview. */
  applied: ProjectFiles;
  onChange: (files: ProjectFiles) => void;
  onApply: () => void;
  isApplying: boolean;
  /** Overlay copy while busy; defaults to the generation wording. */
  busyLabel?: string;
  /** M3.2: draft source of a React project. Empty for legacy projects. */
  source?: ProjectFile[];
  /** The source the preview was last compiled from (dirty baseline). */
  appliedSource?: ProjectFile[];
  onSourceChange?: (next: ProjectFile[]) => void;
  /** Controlled active file path (set by a file explorer). */
  selectedPath?: string | null;
  /** Fired when the user selects a file (tab or explorer row). */
  onFileSelect?: (path: string) => void;
}

const FILE_KEYS: FileKey[] = ["html", "css", "javascript"];

const FILE_LABELS: Record<FileKey, string> = {
  html: "index.html",
  css: "style.css",
  javascript: "script.js",
};

const LANGUAGE_FOR_KEY: Record<FileKey, "html" | "css" | "js"> = {
  html: "html",
  css: "css",
  javascript: "js",
};

/** Dirty state for the source mode: changed, added, or removed files. */
function diffSource(
  draft: ProjectFile[],
  applied: ProjectFile[],
): { changed: Set<string>; dirty: boolean } {
  const appliedByPath = new Map(applied.map((f) => [f.path, f.content]));
  const draftPaths = new Set(draft.map((f) => f.path));
  const changed = new Set<string>();
  for (const file of draft) {
    if (appliedByPath.get(file.path) !== file.content) {
      changed.add(file.path);
    }
  }
  for (const file of applied) {
    if (!draftPaths.has(file.path)) changed.add(file.path);
  }
  return { changed, dirty: changed.size > 0 };
}

export default function CodePanel({
  files,
  applied,
  onChange,
  onApply,
  isApplying,
  busyLabel,
  source,
  appliedSource,
  onSourceChange,
  selectedPath,
  onFileSelect,
}: CodePanelProps) {
  const [activeFile, setActiveFile] = useState<FileKey>("html");
  const [activePath, setActivePath] = useState<string | null>(null);

  const sourceFiles = useMemo(() => source ?? [], [source]);
  const isSourceMode = sourceFiles.length > 0;

  const controlledPath = selectedPath ?? null;
  const activeSourcePath = controlledPath ?? activePath;

  const dirtyFiles = FILE_KEYS.filter((key) => files[key] !== applied[key]);
  const { changed: changedPaths, dirty: sourceDirty } = diffSource(
    sourceFiles,
    appliedSource ?? [],
  );
  const isDirty = isSourceMode ? sourceDirty : dirtyFiles.length > 0;
  const dirtyCount = isSourceMode ? changedPaths.size : dirtyFiles.length;

  const activeSource =
    sourceFiles.find((f) => f.path === activeSourcePath) ?? sourceFiles[0];

  const handleSourceEdit = useCallback(
    (value: string) => {
      if (!onSourceChange || !activeSource) return;
      onSourceChange(
        sourceFiles.map((f) =>
          f.path === activeSource.path
            ? { ...f, content: value }
            : f,
        ),
      );
    },
    [onSourceChange, activeSource, sourceFiles],
  );

  const handleLegacyEdit = useCallback(
    (key: FileKey) => (value: string) => {
      onChange({ ...files, [key]: value });
    },
    [files, onChange],
  );

  const selectPath = useCallback(
    (path: string) => {
      onFileSelect?.(path);
      if (!onFileSelect) setActivePath(path);
    },
    [onFileSelect],
  );

  const closeTab = useCallback(() => {}, []);

  const handleTabKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const offset = event.key === "ArrowLeft" ? -1 : 1;
      if (isSourceMode) {
        if (sourceFiles.length === 0) return;
        const index = sourceFiles.findIndex(
          (f) => f.path === activeSource?.path,
        );
        const next =
          sourceFiles[
            (index + offset + sourceFiles.length) % sourceFiles.length
          ];
        selectPath(next.path);
        return;
      }
      const index = FILE_KEYS.indexOf(activeFile);
      const next =
        FILE_KEYS[(index + offset + FILE_KEYS.length) % FILE_KEYS.length];
      setActiveFile(next);
    },
    [activeFile, isSourceMode, sourceFiles, activeSource, selectPath],
  );

  const busyText = busyLabel ?? "Rebuilding live preview…";

  const languageForSource = useCallback(
    (path: string | null) => {
      if (!path) return undefined;
      return languageForPath(path);
    },
    []
  );

  const currentPathString = isSourceMode 
    ? (activeSource?.path ?? "app/page.tsx") 
    : FILE_LABELS[activeFile];

  const tabs = isSourceMode ? (
    sourceFiles.map((file) => {
      const selected = activeSource?.path === file.path;
      const dirty = changedPaths.has(file.path);
      return (
        <button
          key={file.path}
          type="button"
          role="tab"
          aria-selected={selected}
          aria-controls="studio-editor"
          tabIndex={selected ? 0 : -1}
          title={file.path}
          onClick={(event) => {
            event.stopPropagation();
            selectPath(file.path);
          }}
          onMouseDown={(event) => event.preventDefault()}
          className={`group relative flex items-center gap-2 h-9 px-3 text-xs font-mono border-r border-[#1a1a1a] transition-all cursor-pointer select-none border-t ${
            selected
              ? "bg-[#050505] text-[#ffffff] border-t-[#ffffff] font-medium"
              : "bg-[#0e0e0e] text-[#777777] border-t-transparent hover:bg-[#141414] hover:text-[#cccccc]"
          }`}
        >
          <span className="shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
            <FileIcon name={file.path} size={13} />
          </span>
          <span className="truncate max-w-[150px]">{file.path}</span>

          {dirty ? (
            <span 
              className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 ml-1 shadow-xs" 
              title="Unsaved changes"
            />
          ) : (
            <span
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[#222222] text-[#666666] hover:text-[#ffffff] transition-all ml-1"
              onClick={(event) => {
                event.stopPropagation();
                closeTab();
              }}
            >
              <X size={12} />
            </span>
          )}
        </button>
      );
    })
  ) : (
    FILE_KEYS.map((key) => {
      const selected = activeFile === key;
      const dirty = files[key] !== applied[key];
      return (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={selected}
          aria-controls="studio-editor"
          tabIndex={selected ? 0 : -1}
          title={FILE_LABELS[key]}
          onClick={() => setActiveFile(key)}
          className={`group relative flex items-center gap-2 h-9 px-3.5 text-xs font-mono border-r border-[#1a1a1a] transition-all cursor-pointer select-none border-t ${
            selected
              ? "bg-[#050505] text-[#ffffff] border-t-[#ffffff] font-medium"
              : "bg-[#0e0e0e] text-[#777777] border-t-transparent hover:bg-[#141414] hover:text-[#cccccc]"
          }`}
        >
          <span className="shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
            <FileIcon name={FILE_LABELS[key]} size={13} />
          </span>
          <span>{FILE_LABELS[key]}</span>

          {dirty ? (
            <span 
              className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 ml-1 shadow-xs" 
              title="Unsaved changes"
            />
          ) : (
            <span
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[#222222] text-[#666666] hover:text-[#ffffff] transition-all ml-1"
              onClick={(event) => {
                event.stopPropagation();
                closeTab();
              }}
            >
              <X size={12} />
            </span>
          )}
        </button>
      );
    })
  );

  return (
    <div className="flex flex-col h-full w-full bg-[#050505] text-[#e1e1e1] overflow-hidden border-none font-sans antialiased">
      {/* Studio Editor Breadcrumb Strip */}
      <div className="px-3 py-1.5 border-b border-[#1a1a1a] bg-[#000000] flex items-center justify-between text-[11px] text-[#888888]">
        <div className="flex items-center gap-2 font-mono truncate">
          <FileCode className="w-3.5 h-3.5 text-[#555555]" />
          <span className="text-[#e1e1e1]">{currentPathString}</span>
        </div>
        <div className="flex items-center gap-1">
          <button 
            type="button" 
            className="p-1 rounded hover:bg-[#161616] text-[#666666] hover:text-[#cccccc] transition-colors"
            title="Copy Code"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button 
            type="button" 
            className="p-1 rounded hover:bg-[#161616] text-[#666666] hover:text-[#cccccc] transition-colors"
            title="Download File"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Editor Tab Strip */}
      <div 
        className="flex items-center bg-[#090909] border-b border-[#1a1a1a] overflow-x-auto scrollbar-none" 
        role="tablist" 
        aria-label="Source files" 
        onKeyDown={handleTabKeyDown}
      >
        {tabs}
      </div>

      {/* Main Code Workspace Surface */}
      <div
        className="relative flex-1 overflow-hidden bg-[#050505]"
        id="studio-editor"
        role="tabpanel"
        aria-labelledby={
          isSourceMode && activeSource
            ? `studio-tab-src-${activeSource.path}`
            : `studio-tab-${activeFile}`
        }
      >
        {isSourceMode ? (
          <SyntaxEditor
            value={activeSource?.content ?? ""}
            path={activeSource?.path ?? undefined}
            language={languageForSource(activeSource?.path)}
            onChange={handleSourceEdit}
            readOnly={isApplying}
            aria-label={`Edit ${activeSource?.path ?? "file"}`}
            placeholder="Select a file from the explorer to edit"
          />
        ) : (
          <SyntaxEditor
            value={files[activeFile]}
            path={FILE_LABELS[activeFile]}
            language={LANGUAGE_FOR_KEY[activeFile]}
            onChange={handleLegacyEdit(activeFile)}
            readOnly={isApplying}
            aria-label={`Edit ${FILE_LABELS[activeFile]}`}
            placeholder="Select a file to edit"
          />
        )}

        {/* Rebuilding Preview Overlay */}
        {isApplying && (
          <div 
            className="absolute inset-0 bg-[#000000]/80 backdrop-blur-xs flex flex-col items-center justify-center gap-3 z-20 transition-all duration-300"
            role="status"
          >
            <div className="relative flex items-center justify-center">
              <div className="w-9 h-9 rounded-full border-2 border-[#222222] border-t-[#ffffff] animate-spin" />
              <Sparkles className="w-3.5 h-3.5 text-[#ffffff] absolute animate-pulse" />
            </div>
            <span className="text-xs font-medium text-[#e1e1e1] tracking-wide">
              {busyText}
            </span>
          </div>
        )}
      </div>

      {/* Studio Action Footer */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-[#000000] border-t border-[#1a1a1a] text-xs">
        <div className="flex items-center gap-2">
          {isDirty ? (
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
              </span>
              <span className="text-amber-400 font-medium font-mono text-[11px]">
                {dirtyCount} {dirtyCount === 1 ? "file" : "files"} unsynced
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[#666666] font-mono text-[11px]">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>Preview up to date</span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onApply}
          disabled={!isDirty || isApplying}
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md font-medium text-xs transition-all ${
            isDirty && !isApplying
              ? "bg-[#ffffff] text-[#000000] hover:bg-[#e1e1e1] cursor-pointer"
              : "bg-[#141414] text-[#444444] cursor-not-allowed border border-[#222222]"
          }`}
        >
          {isApplying ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3 h-3 fill-current" />
          )}
          <span>Apply Changes</span>
        </button>
      </div>
    </div>
  );
}