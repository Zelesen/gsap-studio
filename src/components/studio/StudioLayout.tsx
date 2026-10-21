"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { 
  ArrowUpRight, 
  Code2, 
  MessageSquare, 
  Monitor, 
  Plus, 
  Search, 
  Home, 
  FolderKanban, 
  Compass, 
  LayoutTemplate, 
  ChevronDown,
  Sparkles,
  Settings,
  HelpCircle
} from "lucide-react";

/*
 * StudioLayout — the workspace shell for the AI website builder.
 * Redesigned to match the dark-mode studio interface.
 */

export type PanelName = "chat" | "preview" | "code";
export type WorkspaceMode = "preview" | "code";

interface StudioLayoutProps {
  title: string;
  mode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
  onNewProject: () => void;
  panels: Record<PanelName, { element: React.ReactNode; collapsed: boolean }>;
  onTogglePanel: (name: PanelName) => void;
}

const NAV: Array<{ name: PanelName; label: string; icon: React.ElementType }> = [
  { name: "chat", label: "Chat", icon: MessageSquare },
  { name: "preview", label: "Preview", icon: Monitor },
  { name: "code", label: "Code", icon: Code2 },
];

const SIDE_MIN = 260;
const DEFAULT_CHAT = 320;
const KEY_STEP = 24;

export default function StudioLayout({
  title,
  mode,
  onModeChange,
  onNewProject,
  panels,
  onTogglePanel,
}: StudioLayoutProps) {
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 900px)").matches,
  );
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT);
  const [mobilePanel, setMobilePanel] = useState<PanelName>("chat");

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    active: false,
    startX: 0,
    start: 0,
    which: "chat" as const,
  });
  const moveRef = useRef<((e: PointerEvent) => void) | undefined>(undefined);
  const upRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    return () => {
      if (moveRef.current) window.removeEventListener("pointermove", moveRef.current);
      if (upRef.current) window.removeEventListener("pointerup", upRef.current);
      document.body.style.userSelect = "";
    };
  }, []);

  const dragStart = useCallback(
    (event: React.PointerEvent) => {
      if (!containerRef.current) return;
      event.preventDefault();
      const start = chatWidth;
      dragRef.current = { active: true, startX: event.clientX, start, which: "chat" };
      containerRef.current.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";

      const clamp = (value: number) => {
        const total = containerRef.current?.getBoundingClientRect().width ?? 0;
        const mainMin = SIDE_MIN;
        const max = Math.max(mainMin, total - mainMin - 2);
        return Math.min(Math.max(value, mainMin), max);
      };

      moveRef.current = (e: PointerEvent) => {
        if (!dragRef.current.active) return;
        const next = clamp(
          dragRef.current.start + (e.clientX - dragRef.current.startX),
        );
        setChatWidth(next);
      };

      upRef.current = () => {
        dragRef.current.active = false;
        if (containerRef.current) containerRef.current.style.cursor = "";
        document.body.style.userSelect = "";
        if (moveRef.current) window.removeEventListener("pointermove", moveRef.current);
        if (upRef.current) window.removeEventListener("pointerup", upRef.current);
      };

      window.addEventListener("pointermove", moveRef.current);
      window.addEventListener("pointerup", upRef.current);
    },
    [chatWidth],
  );

  const dividerKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -KEY_STEP : KEY_STEP;
      setChatWidth((w) => Math.max(SIDE_MIN, w + delta));
    },
    [],
  );

  if (isMobile) {
    return (
      <div className="flex flex-col h-[100dvh] w-full bg-[#000000] text-[#e1e1e1] font-sans antialiased overflow-hidden">
        <header className="flex items-center justify-between px-3.5 py-2.5 border-b border-[#1a1a1a] bg-[#000000]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-[#ffffff]" />
            <h1 className="truncate text-xs font-medium text-[#e1e1e1]">{title}</h1>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#ffffff] text-[#000000] text-xs font-medium"
            onClick={onNewProject}
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </button>
        </header>

        <div className="p-2 border-b border-[#1a1a1a] bg-[#050505]">
          <div className="flex bg-[#111111] p-0.5 rounded-lg border border-[#222222]" role="group">
            {NAV.map(({ name, label, icon: Icon }) => (
              <button
                key={name}
                type="button"
                aria-pressed={mobilePanel === name}
                onClick={() => setMobilePanel(name)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mobilePanel === name ? "bg-[#222222] text-[#ffffff]" : "text-[#777777]"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <div className="h-full w-full">
            {panels[mobilePanel].element}
          </div>
        </div>
      </div>
    );
  }

  const sideStyle = (width: number): React.CSSProperties =>
    ({ width, flex: "0 1 auto" } as React.CSSProperties);

  return (
    <div className="flex h-[100dvh] w-full bg-[#000000] text-[#e1e1e1] font-sans antialiased overflow-hidden">
      {/* Studio Left Sidebar */}
      <aside className="w-60 flex flex-col border-r border-[#1a1a1a] bg-[#000000] select-none shrink-0">
        {/* User Account / Workspace Selector Header */}
        <div className="p-3 border-b border-[#1a1a1a] flex items-center justify-between">
          <div className="flex items-center gap-2 truncate">
            <div className="w-6 h-6 rounded-full bg-[#e11d48] text-white flex items-center justify-center font-bold text-xs">
              A
            </div>
            <span className="text-xs font-medium truncate text-[#cccccc]">amanmaurya917-...</span>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-[#777777] shrink-0" />
        </div>

        {/* Quick Search */}
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#0a0a0a] border border-[#222222] text-[#777777] text-xs">
            <Search className="w-3.5 h-3.5" />
            <span>Search</span>
            <span className="ml-auto text-[10px] font-mono bg-[#181818] px-1 rounded border border-[#2a2a2a]">⌘K</span>
          </div>
        </div>

        {/* Primary Navigation Links */}
        <div className="px-2 py-1 space-y-0.5 border-b border-[#1a1a1a]">
          <Link href="#" className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs text-[#888888] hover:text-[#ffffff] hover:bg-[#111111] transition-colors">
            <Home className="w-3.5 h-3.5" />
            <span>Home</span>
          </Link>
          <Link href="#" className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs text-[#ffffff] bg-[#111111] font-medium">
            <FolderKanban className="w-3.5 h-3.5" />
            <span>Projects</span>
          </Link>
          <Link href="#" className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs text-[#888888] hover:text-[#ffffff] hover:bg-[#111111] transition-colors">
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Chats</span>
          </Link>
          <Link href="#" className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs text-[#888888] hover:text-[#ffffff] hover:bg-[#111111] transition-colors">
            <Compass className="w-3.5 h-3.5" />
            <span>Design Systems</span>
          </Link>
          <Link href="#" className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs text-[#888888] hover:text-[#ffffff] hover:bg-[#111111] transition-colors">
            <LayoutTemplate className="w-3.5 h-3.5" />
            <span>Templates</span>
          </Link>
        </div>

        {/* Drafts & Projects List Section */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1 scrollbar-none">
          <div className="px-2 pb-1 text-[10px] font-medium text-[#555555] uppercase tracking-wider">
            Drafts
          </div>
          <div className="px-2.5 py-1.5 rounded bg-[#111111] text-xs text-[#ffffff] truncate font-medium border border-[#222222]">
            {title}
          </div>

          <div className="pt-3 px-2 pb-1 text-[10px] font-medium text-[#555555] uppercase tracking-wider flex items-center justify-between">
            <span>Projects</span>
            <button type="button" onClick={onNewProject} className="hover:text-[#ffffff]">
              <Plus className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-0.5 text-xs text-[#777777]">
            <div className="px-2.5 py-1 rounded hover:bg-[#0a0a0a] hover:text-[#cccccc] truncate cursor-pointer">v0-login-screen</div>
            <div className="px-2.5 py-1 rounded hover:bg-[#0a0a0a] hover:text-[#cccccc] truncate cursor-pointer">v0-saa-s-landing-page-qh</div>
            <div className="px-2.5 py-1 rounded hover:bg-[#0a0a0a] hover:text-[#cccccc] truncate cursor-pointer">v0-agentic-build-orchestrate</div>
            <div className="px-2.5 py-1 rounded hover:bg-[#0a0a0a] hover:text-[#cccccc] truncate cursor-pointer">v0-boty-ecommerce-template</div>
          </div>
        </div>

        {/* Sidebar Footer Credit & Status */}
        <div className="p-3 border-t border-[#1a1a1a] flex items-center justify-between text-[11px] text-[#777777]">
          <span className="truncate">amanmaurya917-2010</span>
          <span className="px-1.5 py-0.5 rounded bg-[#111111] border border-[#222222] font-mono text-[10px]">$5</span>
        </div>
      </aside>

      {/* Main Studio Viewport */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#000000]">
        {/* Top Header Bar */}
        <header className="h-12 border-b border-[#1a1a1a] bg-[#000000] px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs text-[#777777] truncate font-mono">COMPUTE - The Platform to Build & Ship AI Agents</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Preview / Code Mode Segmented Toggle */}
            <div
              className="flex bg-[#111111] border border-[#222222] rounded-lg p-0.5"
              role="group"
              aria-label="Workspace mode"
            >
              <button
                type="button"
                aria-pressed={mode === "preview"}
                onClick={() => onModeChange("preview")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  mode === "preview" ? "bg-[#222222] text-[#ffffff]" : "text-[#777777] hover:text-[#cccccc]"
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                Preview
              </button>
              <button
                type="button"
                aria-pressed={mode === "code"}
                onClick={() => onModeChange("code")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  mode === "code" ? "bg-[#222222] text-[#ffffff]" : "text-[#777777] hover:text-[#cccccc]"
                }`}
              >
                <Code2 className="w-3.5 h-3.5" />
                Code
              </button>
            </div>

            <span className="w-px h-4 bg-[#222222] mx-1" aria-hidden="true" />

            <button
              type="button"
              className="px-3 py-1.5 rounded-lg bg-[#ffffff] text-[#000000] text-xs font-medium hover:bg-[#e1e1e1] transition-colors shadow-sm cursor-pointer"
              onClick={onNewProject}
            >
              Publish
            </button>
          </div>
        </header>

        {/* Workspace Panels Container */}
        <div className="flex-1 flex overflow-hidden relative" ref={containerRef}>
          {!panels.chat.collapsed && (
            <section className="flex flex-col h-full shrink-0" style={sideStyle(chatWidth)}>
              {panels.chat.element}
            </section>
          )}

          {!panels.chat.collapsed && (
            <div
              className="w-1 bg-[#1a1a1a] hover:bg-[#333333] cursor-ew-resize transition-colors shrink-0"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat panel"
              tabIndex={0}
              onPointerDown={dragStart}
              onKeyDown={dividerKeyDown}
            />
          )}

          <section className="flex-1 flex flex-col min-w-0 bg-[#000000] h-full overflow-hidden relative">
            <div
              className={`absolute inset-0 flex flex-col transition-opacity duration-200 ${
                mode === "preview" ? "opacity-100 z-10 pointer-events-auto" : "opacity-0 z-0 pointer-events-none"
              }`}
            >
              {panels.preview.element}
            </div>
            <div
              className={`absolute inset-0 flex flex-col transition-opacity duration-200 ${
                mode === "code" ? "opacity-100 z-10 pointer-events-auto" : "opacity-0 z-0 pointer-events-none"
              }`}
            >
              {panels.code.element}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}