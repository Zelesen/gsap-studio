"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Code2, MessageSquare, Monitor, Plus } from "lucide-react";

/*
 * StudioLayout — the workspace shell for the AI website builder.
 *
 * Tasteskill v2 (style: true-black-flat, shell: Ruled T-frame). A 224px
 * sidebar and a 56px top bar share one ground, divided only by 1px rules; the
 * three panels (Chat | Preview | Code) sit on the same ground and are split by
 * 1px rules with draggable, keyboard-resizable dividers.
 *
 * Grid arithmetic: 224 (sidebar) + 1 (rule) + [320 (chat) + 1 + preview + 1 +
 * 420 (code)] = the window. The side panels are fixed at 320 / 420 and the
 * preview absorbs the remainder, so the row always fills its container.
 *
 * Navigation recedes: a panel is shown/hidden from the sidebar, where the
 * active state is the label brightening rather than a coloured fill. On the
 * phone the sidebar folds away and one region shows at a time behind a
 * segmented switch.
 */

export type PanelName = "chat" | "preview" | "code";

interface StudioLayoutProps {
  title: string;
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
const DEFAULT_CODE = 420;
const KEY_STEP = 24;

function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="9" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="15.5" cy="4.5" r="2" fill="currentColor" />
    </svg>
  );
}

export default function StudioLayout({
  title,
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
  const [codeWidth, setCodeWidth] = useState(DEFAULT_CODE);
  const [mobilePanel, setMobilePanel] = useState<PanelName>("chat");

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    active: false,
    startX: 0,
    start: 0,
    which: "chat" as "chat" | "code",
  });
  const moveRef = useRef<((e: PointerEvent) => void) | undefined>(undefined);
  const upRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Drop any in-flight drag listeners if the layout unmounts mid-drag.
  useEffect(() => {
    return () => {
      if (moveRef.current) window.removeEventListener("pointermove", moveRef.current);
      if (upRef.current) window.removeEventListener("pointerup", upRef.current);
      document.body.style.userSelect = "";
    };
  }, []);

  const previewVisible = !panels.preview.collapsed;

  const dragStart = useCallback(
    (which: "chat" | "code") => (event: React.PointerEvent) => {
      if (!containerRef.current) return;
      event.preventDefault();
      const start = which === "chat" ? chatWidth : codeWidth;
      dragRef.current = { active: true, startX: event.clientX, start, which };
      containerRef.current.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";

      const clamp = (value: number) => {
        const total = containerRef.current?.getBoundingClientRect().width ?? 0;
        const neighbours =
          (which === "chat"
            ? panels.code.collapsed
              ? 0
              : codeWidth
            : panels.chat.collapsed
              ? 0
              : chatWidth) + (panels.preview.collapsed ? 0 : SIDE_MIN);
        const max = Math.max(SIDE_MIN, total - neighbours - 2);
        return Math.min(Math.max(value, SIDE_MIN), max);
      };

      moveRef.current = (e: PointerEvent) => {
        if (!dragRef.current.active) return;
        const next = clamp(
          dragRef.current.start + (e.clientX - dragRef.current.startX),
        );
        if (which === "chat") setChatWidth(next);
        else setCodeWidth(next);
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
    [
      chatWidth,
      codeWidth,
      panels.chat.collapsed,
      panels.code.collapsed,
      panels.preview.collapsed,
    ],
  );

  const dividerKeyDown = useCallback(
    (which: "chat" | "code") => (event: React.KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -KEY_STEP : KEY_STEP;
      if (which === "chat") setChatWidth((w) => Math.max(SIDE_MIN, w + delta));
      else setCodeWidth((w) => Math.max(SIDE_MIN, w + delta));
    },
    [],
  );

  if (isMobile) {
    return (
      <div className="studio-shell">
        <div className="studio-main">
          <header className="studio-topbar">
            <div className="flex items-center gap-2.5 min-w-0">
              <BrandMark className="studio-brand__mark" />
              <h1 className="truncate">{title}</h1>
            </div>
            <div className="studio-topbar__actions">
              <span className="studio-topbar__divider" aria-hidden="true" />
              <button
                type="button"
                className="studio-btn"
                onClick={onNewProject}
              >
                <Plus aria-hidden="true" />
                New
              </button>
            </div>
          </header>

          <div className="studio-mobile-switch">
            <div
              className="studio-segmented studio-segmented--full"
              role="group"
              aria-label="Workspace areas"
            >
              {NAV.map(({ name, label, icon: Icon }) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={mobilePanel === name}
                  onClick={() => setMobilePanel(name)}
                >
                  <Icon aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="studio-workspace">
            <section className="studio-panel studio-panel--grow">
              {panels[mobilePanel].element}
            </section>
          </div>
        </div>
      </div>
    );
  }

  const sideStyle = (width: number): React.CSSProperties =>
    previewVisible ? { width, flex: "0 1 auto" } : { flex: "1 1 0" };

  return (
    <div className="studio-shell">
      <aside className="studio-sidebar">
        <div className="studio-brand">
          <BrandMark className="studio-brand__mark" />
          <span className="studio-brand__name">GSAP Studio</span>
        </div>

        <p className="studio-group-label">Workspace</p>
        {NAV.map(({ name, label, icon: Icon }) => (
          <button
            key={name}
            type="button"
            className="studio-nav-item"
            data-on={!panels[name].collapsed}
            aria-pressed={!panels[name].collapsed}
            onClick={() => onTogglePanel(name)}
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}

        <div className="studio-sidebar__foot">
          <Link href="/" className="studio-back-link">
            <ArrowUpRight aria-hidden="true" />
            Back to site
          </Link>
        </div>
      </aside>

      <div className="studio-main">
        <header className="studio-topbar">
          <h1>{title}</h1>
          <div className="studio-topbar__actions">
            <span className="studio-topbar__divider" aria-hidden="true" />
            <button type="button" className="studio-btn" onClick={onNewProject}>
              <Plus aria-hidden="true" />
              New project
            </button>
          </div>
        </header>

        <div className="studio-workspace" ref={containerRef}>
          {!panels.chat.collapsed && (
            <section className="studio-panel" style={sideStyle(chatWidth)}>
              {panels.chat.element}
            </section>
          )}

          {!panels.chat.collapsed && !panels.preview.collapsed && (
            <div
              className="studio-divider"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat panel"
              tabIndex={0}
              onPointerDown={dragStart("chat")}
              onKeyDown={dividerKeyDown("chat")}
            />
          )}

          {!panels.preview.collapsed && (
            <section className="studio-panel studio-panel--grow">
              {panels.preview.element}
            </section>
          )}

          {!panels.preview.collapsed && !panels.code.collapsed && (
            <div
              className="studio-divider"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize code panel"
              tabIndex={0}
              onPointerDown={dragStart("code")}
              onKeyDown={dividerKeyDown("code")}
            />
          )}

          {!panels.code.collapsed && (
            <section className="studio-panel" style={sideStyle(codeWidth)}>
              {panels.code.element}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
