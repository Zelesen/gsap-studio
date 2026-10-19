"use client";

import { useCallback, useRef, useState } from "react";

const EXAMPLE_PROMPTS = [
  "A kinetic type piece that unfolds on scroll",
  "A ribbon that twists toward the pointer",
  "A generative score for a silent film",
];

/*
 * Centralized destination for prompt submissions. No functional Studio route
 * exists yet, so submission is an explicit, reversible placeholder: the entered
 * prompt is preserved in local state and a confirmation is shown. Nothing is
 * sent to an external service and no navigation occurs.
 */
const submitPrompt = (prompt: string): void => {
  // Placeholder hook for a future Studio destination.
  window.dispatchEvent(
    new CustomEvent("studio:prompt-submit", { detail: { prompt } }),
  );
};

interface PromptComposerProps {
  className?: string;
}

export default function PromptComposer({ className = "" }: PromptComposerProps) {
  const [value, setValue] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isEmpty = value.trim().length === 0;
  const disabled = isEmpty || submitted !== null;

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(event.target.value);
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    if (isEmpty) return;
    setSubmitted(value);
    submitPrompt(value);
  }, [value, isEmpty]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleExample = useCallback(
    (prompt: string) => {
      setValue(prompt);
      setSubmitted(null);
      textareaRef.current?.focus();
    },
    [],
  );

  const handleReset = useCallback(() => {
    setValue("");
    setSubmitted(null);
    textareaRef.current?.focus();
  }, []);

  return (
    <div
      className={`relative z-10 w-full max-w-2xl ${className}`}
      aria-label="Creative prompt composer"
    >
      <div className="flex flex-col gap-3">
        <label
          htmlFor="studio-prompt"
          className="text-xs font-mono tracking-[0.35em] uppercase text-studio-indigo"
        >
          Prompt the studio
        </label>
        <textarea
          id="studio-prompt"
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={3}
          className="block w-full min-h-[110px] rounded-xl border border-studio-border bg-studio-bg/60 px-4 py-3 text-base text-studio-text placeholder-studio-muted outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-studio-bg focus-visible:ring-studio-gold transition-colors resize-none"
          placeholder="Describe the movement you want to see…"
          aria-describedby="prompt-hint prompt-examples"
        />
        <p id="prompt-hint" className="text-[10px] font-mono tracking-widest uppercase text-studio-muted">
          Enter to submit &middot; Shift+Enter for a newline
        </p>

        <div
          id="prompt-examples"
          className="flex flex-wrap gap-2 mt-2"
          aria-label="Example prompts"
        >
          <span className="text-[10px] font-mono tracking-widest uppercase text-studio-muted">
            Try:
          </span>
          {EXAMPLE_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => handleExample(prompt)}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded border border-studio-border-soft bg-studio-bg/40 px-3 py-1.5 text-[10px] font-mono tracking-wider text-studio-muted hover:bg-studio-border hover:text-studio-paper transition-colors disabled:opacity-50 disabled:pointer-events-none outline-none focus-visible:ring-2 focus-visible:ring-studio-gold"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={handleSubmit}
          className={`flex items-center gap-2 rounded-xl bg-studio-gold text-studio-bg font-mono text-xs tracking-wider uppercase px-6 py-2.5 hover:bg-studio-magenta hover:text-studio-text transition-colors disabled:opacity-40 disabled:pointer-events-none outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-studio-bg focus-visible:ring-studio-indigo`}
        >
          Submit
          <span aria-hidden="true">→</span>
        </button>

        {submitted !== null ? (
          <div className="flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase text-studio-magenta">
            <span role="status" aria-live="polite">
              Received: “{submitted}” — studio integration coming soon.
            </span>
            <button
              type="button"
              onClick={handleReset}
              className="underline underline-offset-2 hover:text-studio-paper transition-colors outline-none focus-visible:ring-1 focus-visible:ring-studio-gold"
            >
              Try another
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
