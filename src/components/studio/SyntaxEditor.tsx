"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { highlight, languageForPath } from "@/lib/syntax";

type SyntaxLanguage = Parameters<typeof highlight>[1];

interface SyntaxEditorProps {
  value: string;
  path?: string;
  language?: SyntaxLanguage;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
}

export default function SyntaxEditor({
  value,
  path,
  language: languageProp,
  onChange,
  readOnly = false,
  disabled = false,
  placeholder,
  "aria-label": ariaLabel,
}: SyntaxEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const language = languageProp ?? (path ? languageForPath(path) : "plain");

  const syncHighlight = useCallback(() => {
    const textarea = textareaRef.current;
    const pre = preRef.current;
    if (!textarea || !pre) return;
    pre.scrollLeft = textarea.scrollLeft;
    pre.scrollTop = textarea.scrollTop;
  }, []);

  const renderHighlight = useCallback(() => {
    const pre = preRef.current;
    if (!pre) return;
    pre.innerHTML = value.length > 0 ? highlight(value, language) : "";
    syncHighlight();
  }, [value, language, syncHighlight]);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(event.target.value);
    },
    [onChange]
  );

  const handleScroll = useCallback(() => {
    syncHighlight();
  }, [syncHighlight]);

  useEffect(() => {
    renderHighlight();
  }, [renderHighlight]);

  useEffect(() => {
    syncHighlight();
  }, [syncHighlight]);

  return (
    <div
      className="relative w-full h-full bg-[#000000] text-[#e1e1e1] font-mono text-xs overflow-hidden"
    >
      <pre
        ref={preRef}
        aria-hidden="true"
        className="absolute inset-0 p-4 m-0 overflow-hidden whitespace-pre-wrap break-words pointer-events-none text-[#e1e1e1] leading-relaxed select-none z-0"
        style={{ tabSize: 2 }}
      />
      <textarea
        ref={textareaRef}
        className="absolute inset-0 w-full h-full p-4 m-0 bg-transparent text-transparent caret-[#ffffff] resize-none outline-none overflow-auto whitespace-pre-wrap break-words z-10 font-mono text-xs leading-relaxed selection:bg-[#264f78]"
        style={{ tabSize: 2 }}
        value={value}
        onChange={handleChange}
        onScroll={handleScroll}
        readOnly={readOnly}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        aria-label={ariaLabel}
      />
    </div>
  );
}