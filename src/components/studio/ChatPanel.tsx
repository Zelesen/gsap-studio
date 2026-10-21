"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { 
  AlertCircle, 
  ArrowUp, 
  Loader2, 
  Sparkles, 
  Paperclip, 
  Mic, 
  Plus, 
  ExternalLink,
  ChevronRight
} from "lucide-react";

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

export default function ChatPanel({
  messages,
  isLoading,
  error,
  onSend,
  placeholder = "Ask a follow-up...",
}: ChatPanelProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState("");

  const canSend = inputValue.trim().length > 0 && !isLoading;

  // Auto-scroll to bottom of thread on new messages or loading state
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, isLoading]);

  // Auto-resize textarea height dynamically
  const handleInputResize = (element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
  };

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
    []
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const value = inputValue.trim();
      if (!value || isLoading) return;

      onSend(value);
      setInputValue("");

      if (inputRef.current) {
        inputRef.current.style.height = "auto";
      }
    },
    [inputValue, isLoading, onSend]
  );

  return (
    <div className="flex flex-col h-full w-full bg-[#000000] text-[#e1e1e1] overflow-hidden border-r border-[#1e1e1e] font-sans antialiased">
      {/* Top Banner / Studio Breadcrumb Badge */}
      <div className="px-3.5 py-2.5 border-b border-[#1a1a1a] bg-[#050505] flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5 text-[#888888]">
          <ChevronRight className="w-3 h-3 text-[#555555]" />
          <span>Worked for 1s</span>
        </div>
        {messages.length > 0 && (
          <span className="text-[10px] text-[#666666] font-mono px-1.5 py-0.5 rounded bg-[#111111] border border-[#222222]">
            {messages.length} {messages.length === 1 ? "msg" : "msgs"}
          </span>
        )}
      </div>

      {/* Message Thread */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3.5 py-4 space-y-4 scrollbar-thin scrollbar-thumb-[#222] scrollbar-track-transparent"
      >
        {/* Template Notification Badge */}
        <div className="bg-[#080808] border border-[#1e1e1e] rounded-lg p-3 text-xs leading-relaxed text-[#a0a0a0]">
          New chat started from template{" "}
          <span className="text-[#3b82f6] font-medium inline-flex items-center gap-1 hover:underline cursor-pointer">
            COMPUTE - The Platform to Build & Ship AI Agents
            <ExternalLink className="w-3 h-3" />
          </span>
        </div>

        {/* Empty State */}
        {messages.length === 0 && !isLoading && (
          <div className="py-12 flex flex-col items-center justify-center text-center px-4 space-y-3">
            <div className="w-9 h-9 rounded-full bg-[#111111] border border-[#222222] flex items-center justify-center text-[#888888]">
              <Sparkles className="w-4 h-4 text-[#ffffff]" />
            </div>
            <div className="space-y-1">
              <h3 className="font-medium text-[#e1e1e1] text-xs">AI Studio Assistant</h3>
              <p className="text-[11px] text-[#666666] max-w-[220px] leading-relaxed">
                Describe component changes, ask questions, or request new page layouts.
              </p>
            </div>
          </div>
        )}

        {/* Render Chat Messages */}
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex flex-col space-y-1 ${
              message.role === "user" ? "items-end" : "items-start"
            }`}
          >
            <div
              className={`text-xs leading-normal max-w-[92%] rounded-xl px-3.5 py-2.5 ${
                message.role === "user"
                  ? "bg-[#1e1e1e] text-[#ffffff] border border-[#2a2a2a] rounded-br-xs"
                  : "bg-[#090909] text-[#cccccc] border border-[#1a1a1a] rounded-bl-xs"
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}

        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex flex-col space-y-1 items-start">
            <div className="bg-[#090909] border border-[#1a1a1a] rounded-xl rounded-bl-xs px-3.5 py-2.5 flex items-center gap-2 text-xs text-[#888888]">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#ffffff]" />
              <span>Generating response...</span>
            </div>
          </div>
        )}
      </div>

      {/* Error State Banner */}
      {error && (
        <div className="mx-3 mb-2 p-2.5 rounded-lg bg-[#1a0808] border border-[#3a1515] flex items-center gap-2 text-[#ff6b6b] text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1 font-medium">{error}</span>
        </div>
      )}

      {/* Studio Prompt Box Form */}
      <form onSubmit={handleSubmit} className="p-3 bg-[#000000]">
        <div className="relative rounded-xl border border-[#222222] bg-[#0a0a0a] focus-within:border-[#444444] transition-all shadow-lg">
          <textarea
            ref={inputRef}
            id="studio-prompt"
            className="w-full resize-none bg-transparent px-3 py-2.5 text-xs text-[#ffffff] placeholder:text-[#555555] focus:outline-none max-h-36 min-h-[42px] leading-relaxed"
            value={inputValue}
            onChange={(event) => {
              setInputValue(event.target.value);
              handleInputResize(event.target);
            }}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            rows={1}
            maxLength={2000}
            placeholder={placeholder}
          />

          {/* Bottom Action Strip */}
          <div className="flex items-center justify-between px-2 py-1.5 border-t border-[#141414] bg-[#050505] rounded-b-xl">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="p-1.5 rounded-md hover:bg-[#181818] text-[#666666] hover:text-[#cccccc] transition-colors"
                title="Add context / files"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className="p-1.5 rounded-md hover:bg-[#181818] text-[#666666] hover:text-[#cccccc] transition-colors"
                title="Attach file"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="p-1.5 rounded-md hover:bg-[#181818] text-[#666666] hover:text-[#cccccc] transition-colors"
                title="Voice input"
              >
                <Mic className="w-3.5 h-3.5" />
              </button>

              <button
                type="submit"
                className={`inline-flex items-center justify-center h-6 w-6 rounded-md transition-all ${
                  canSend
                    ? "bg-[#ffffff] text-[#000000] hover:bg-[#e1e1e1] cursor-pointer"
                    : "bg-[#181818] text-[#444444] cursor-not-allowed"
                }`}
                disabled={!canSend}
                title="Send message"
              >
                {isLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}