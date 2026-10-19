"use client";

import { useCallback, useState } from "react";
import { RotateCw } from "lucide-react";

import type { ProjectFiles } from "@/lib/storage";

/*
 * CodePanel — the editable source with text tabs and a monospace editor.
 *
 * The editor holds drafts. The preview renders the applied version. A file is
 * marked modified when its draft differs from its applied copy, so the dot
 * means "not in the preview yet" rather than "you typed since last keystroke",
 * and it clears itself the moment Apply lands. Switching tabs never discards a
 * draft: all three files live in the parent's state, only one is visible.
 *
 * The three files are tabs on a full-width rule (the active one carries a 2px
 * ink underline, not a coloured pill). Monospace is confined to the editor
 * itself; labels stay in the text face.
 */

type FileKey = keyof ProjectFiles;

interface CodePanelProps {
  /** Working drafts — what the editor shows. */
  files: ProjectFiles;
  /** The version currently rendered in the preview. */
  applied: ProjectFiles;
  onChange: (files: ProjectFiles) => void;
  onApply: () => void;
  isApplying: boolean;
}

const FILE_KEYS: FileKey[] = ["html", "css", "javascript"];

const FILE_LABELS: Record<FileKey, string> = {
  html: "index.html",
  css: "style.css",
  javascript: "script.js",
};

export default function CodePanel({
  files,
  applied,
  onChange,
  onApply,
  isApplying,
}: CodePanelProps) {
  const [activeFile, setActiveFile] = useState<FileKey>("html");

  // Derived, not tracked: drafts and applied versions are the single source of
  // truth, so the indicator cannot drift out of sync with what is rendered.
  const dirtyFiles = FILE_KEYS.filter((key) => files[key] !== applied[key]);
  const isDirty = dirtyFiles.length > 0;

  const handleChange = useCallback(
    (key: FileKey, event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange({ ...files, [key]: event.target.value });
    },
    [files, onChange],
  );

  const handleTabKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const index = FILE_KEYS.indexOf(activeFile);
      const offset = event.key === "ArrowLeft" ? -1 : 1;
      const next =
        FILE_KEYS[(index + offset + FILE_KEYS.length) % FILE_KEYS.length];
      setActiveFile(next);
    },
    [activeFile],
  );

  return (
    <>
      <div className="studio-panel-head">
        <span className="studio-panel-head__label">Code</span>
        <span className="studio-hint">3 files</span>
      </div>

      <div
        className="studio-tabs"
        role="tablist"
        aria-label="Source files"
        onKeyDown={handleTabKeyDown}
      >
        {FILE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            className="studio-tab"
            id={`studio-tab-${key}`}
            aria-selected={activeFile === key}
            aria-controls="studio-editor"
            tabIndex={activeFile === key ? 0 : -1}
            onClick={() => setActiveFile(key)}
          >
            {FILE_LABELS[key]}
            {files[key] !== applied[key] && (
              <span className="studio-tab__dot" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      <div
        className="studio-editor"
        id="studio-editor"
        role="tabpanel"
        aria-labelledby={`studio-tab-${activeFile}`}
      >
        <textarea
          value={files[activeFile]}
          onChange={(event) => handleChange(activeFile, event)}
          readOnly={isApplying}
          aria-label={`Edit ${FILE_LABELS[activeFile]}`}
          spellCheck={false}
        />
        {isApplying && (
          <div className="studio-editor__overlay" role="status">
            <RotateCw className="animate-spin" aria-hidden="true" />
            Generating new code…
          </div>
        )}
      </div>

      <div className="studio-panel-foot">
        <span
          className={isDirty ? "studio-hint text-blaze-text" : "studio-hint"}
          aria-live="polite"
        >
          {isDirty
            ? `Edited · ${dirtyFiles.length} file${dirtyFiles.length > 1 ? "s" : ""} not in the preview`
            : "Preview up to date"}
        </span>
        <button
          type="button"
          className="studio-btn"
          onClick={onApply}
          disabled={!isDirty || isApplying}
        >
          <RotateCw aria-hidden="true" />
          Apply to preview
        </button>
      </div>
    </>
  );
}
