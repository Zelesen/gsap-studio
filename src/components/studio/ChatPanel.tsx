"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, RotateCw } from "lucide-react";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  onSend: (prompt: string) => void;
  placeholder?: string;
}

/*
 * ChatPanel — the conversation and the prompt composer.
 *
 * The transcript is a plain list of role-labelled rows: the prompt sits in a
 * one-step-raised block, the assistant's reply is plain text. The composer is
 * a real control (not a hero): a flat textarea, a hint line, and one primary
 * button. Loading and error states are lines in the flow, not banners.
 *
 * Enter generates; Shift+Enter inserts a newline. The textarea is labelled for
 * assistive tech, and the send button is disabled (and told why) when empty.
 */
export default function ChatPanel({
  messages,
  isLoading,
  error,
  onSend,
  placeholder = "Describe the website you want to build…",
}: ChatPanelProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState("");

  const canSend = inputValue.trim().length > 0 && !isLoading;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isLoading]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
    },
    [],
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const value = inputValue.trim();
      if (!value || isLoading) return;
      onSend(value);
      setInputValue("");
      if (inputRef.current) inputRef.current.value = "";
    },
    [inputValue, isLoading, onSend],
  );

  return (
    <>
      <div className="studio-panel-head">
        <span className="studio-panel-head__label">Conversation</span>
        {messages.length > 0 && (
          <span className="studio-hint">
            {messages.length} message{messages.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="studio-thread" ref={scrollRef}>
        {messages.length === 0 && !isLoading && (
          <p className="studio-hint text-center mt-6">
            No conversation yet. Describe the website you want to build below.
          </p>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === "user"
                ? "studio-msg studio-msg--user"
                : "studio-msg"
            }
          >
            <p className="studio-msg__role">
              {message.role === "user" ? "You" : "Studio"}
            </p>
            <p className="studio-msg__body">{message.content}</p>
          </div>
        ))}

        {isLoading && (
          <div className="studio-msg">
            <p className="studio-msg__role">Studio</p>
            <div className="studio-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className="studio-hint studio-is-generating mt-2" role="status">
              Generating your website…
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="studio-error" style={{ margin: "0 16px 4px" }}>
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <form className="studio-composer" onSubmit={handleSubmit}>
        <label htmlFor="studio-prompt" className="sr-only">
          Describe the website you want to build
        </label>
        <textarea
          ref={inputRef}
          id="studio-prompt"
          className="studio-textarea"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          rows={2}
          maxLength={2000}
          placeholder={placeholder}
        />
        <div className="studio-composer__row">
          <span className="studio-hint">
            Enter to generate · Shift+Enter for a new line
          </span>
          <button
            type="submit"
            className="studio-btn studio-btn--primary"
            disabled={!canSend}
          >
            {isLoading ? (
              <>
                <RotateCw className="animate-spin" aria-hidden="true" />
                Generating…
              </>
            ) : (
              <>
                Generate
                <ArrowRight aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </form>
    </>
  );
}
