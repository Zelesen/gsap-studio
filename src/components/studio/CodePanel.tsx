"use client";

import { useCallback, useState } from "react";
import { RotateCw } from "lucide-react";

/*
 * CodePanel — the editable source with text tabs and a monospace editor.
 *
 * The three files are tabs on a full-width rule (the active one carries a 2px
 * ink underline, not a coloured pill). A changed file takes a small ink dot on
 * its tab and the foot states it in words. Monospace is confined to the editor
 * itself; labels stay in the text face.
 */

type FileKey = "html" | "css" | "javascript";

interface CodePanelProps {
  files: { html: string; css: string; javascript: string };
  onChange: (files: { html: string; css: string; javascript: string }) => void;
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
  onChange,
  onApply,
  isApplying,
}: CodePanelProps) {
  const [activeFile, setActiveFile] = useState<FileKey>("html");
  const [dirtyFiles, setDirtyFiles] = useState<Set<FileKey>>(new Set());

  const isDirty = dirtyFiles.size > 0;

  const handleChange = useCallback(
    (key: FileKey, event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = { ...files, [key]: event.target.value };
      onChange(next);
      setDirtyFiles((prev) => {
        const nextSet = new Set(prev);
        if (event.target.value.trim() === files[key].trim()) {
          nextSet.delete(key);
        } else {
          nextSet.add(key);
        }
        return nextSet;
      });
    },
    [files, onChange],
  );

  const handleApply = useCallback(() => {
    onApply();
    setDirtyFiles(new Set());
  }, [onApply]);

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
            {dirtyFiles.has(key) && (
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
        <span className={isDirty ? "studio-hint text-blaze-text" : "studio-hint"}>
          {isDirty
            ? `Edited · ${dirtyFiles.size} file${dirtyFiles.size > 1 ? "s" : ""}`
            : "Preview up to date"}
        </span>
        <button
          type="button"
          className="studio-btn"
          onClick={handleApply}
          disabled={!isDirty || isApplying}
        >
          <RotateCw aria-hidden="true" />
          Apply to preview
        </button>
      </div>
    </>
  );
}
