"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Monitor,
  RotateCw,
  Smartphone,
  Tablet,
  ExternalLink,
  Sparkles,
} from "lucide-react";

/*
 * PreviewPanel — the generated website inside a sandboxed iframe.
 */

interface PreviewPanelProps {
  /** The applied version of the code — the preview never renders drafts. */
  html: string;
  css: string;
  javascript: string;
  /** Force a fresh render of identical content. */
  onRefresh: () => void;
  refreshKey?: number;
}

type Viewport = "desktop" | "tablet" | "mobile";

const VIEWPORTS: Record<Viewport, { w: number; h: number; label: string }> = {
  desktop: { w: 1280, h: 800, label: "Desktop" },
  tablet: { w: 768, h: 1024, label: "Tablet" },
  mobile: { w: 390, h: 844, label: "Mobile" },
};

const VIEWPORT_ORDER: Viewport[] = ["desktop", "tablet", "mobile"];

const VIEWPORT_ICONS: Record<Viewport, React.ElementType> = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
};

const PREVIEW_CSP = "base-uri 'none'; form-action 'none'; object-src 'none'";

const PREVIEW_BRIDGE = `(function () {
  var send = function (kind, message) {
    try {
      window.parent.postMessage(
        { studioPreview: { kind: kind, message: String(message).slice(0, 300) } },
        "*"
      );
    } catch (err) {
      /* The parent may be gone; nothing useful to do. */
    }
  };
  window.addEventListener("error", function (event) {
    var target = event && event.target;
    if (target && target.nodeType === 1) {
      if (target.tagName === "SCRIPT" || target.tagName === "LINK") {
        var url = target.src || target.href || "";
        send("resource", "Failed to load " + String(target.tagName).toLowerCase() + " " + url);
      }
      return;
    }
    send("error", (event && event.message) || "Script error");
  }, true);
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    send("rejection", reason && reason.message ? reason.message : reason);
  });
})();
`;

const MAX_ERROR_LENGTH = 200;

function sanitizeMessage(value: unknown): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  const flat = text.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return flat.slice(0, MAX_ERROR_LENGTH);
}

function escapeBlockEnd(source: string, tag: "style" | "script"): string {
  return source.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
}

function insertIntoHead(source: string, blocks: string[]): string {
  const injection = blocks.join("\n");
  const open = /<head\b[^>]*>/i.exec(source);
  if (open) {
    const at = open.index + open[0].length;
    return `${source.slice(0, at)}\n${injection}\n${source.slice(at)}`;
  }
  const close = /<\/head\s*>/i.exec(source);
  if (close) {
    return `${source.slice(0, close.index)}\n${injection}\n${source.slice(close.index)}`;
  }
  const htmlOpen = /<html\b[^>]*>/i.exec(source);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return `${source.slice(0, at)}\n${injection}\n${source.slice(at)}`;
  }
  return `${injection}\n${source}`;
}

function insertBeforeBodyEnd(source: string, blocks: string[]): string {
  if (blocks.length === 0) return source;
  const injection = blocks.join("\n");
  const close = /<\/body\s*>/i.exec(source);
  if (close) {
    return `${source.slice(0, close.index)}\n${injection}\n${source.slice(close.index)}`;
  }
  const htmlClose = /<\/html\s*>/i.exec(source);
  if (htmlClose) {
    return `${source.slice(0, htmlClose.index)}\n${injection}\n${source.slice(htmlClose.index)}`;
  }
  return `${source}\n${injection}`;
}

interface AssembleInput {
  html: string;
  css: string;
  javascript: string;
  nonce: number;
}

function assembleDocument({ html, css, javascript, nonce }: AssembleInput): string {
  const head: string[] = [
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`,
    `<script>${PREVIEW_BRIDGE}</script>`,
    `<!-- studio-render:${nonce} -->`,
  ];
  if (css.trim().length > 0) {
    head.push(`<style>\n${escapeBlockEnd(css, "style")}\n</style>`);
  }

  const foot: string[] = [];
  if (javascript.trim().length > 0) {
    foot.push(`<script>\n${escapeBlockEnd(javascript, "script")}\n</script>`);
  }

  if (!/<html[\s>]/i.test(html)) {
    return [
      "<!DOCTYPE html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      "<title>Preview</title>",
      ...head,
      "</head>",
      "<body>",
      html,
      ...foot,
      "</body>",
      "</html>",
    ].join("\n");
  }

  return insertBeforeBodyEnd(insertIntoHead(html, head), foot);
}

export default function PreviewPanel({
  html,
  css,
  javascript,
  onRefresh,
  refreshKey = 0,
}: PreviewPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [scale, setScale] = useState(1);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [runtimeErrors, setRuntimeErrors] = useState<{
    source: string;
    messages: string[];
  } | null>(null);

  const size = VIEWPORTS[viewport];
  const framed = viewport !== "desktop";

  const hasContent =
    html.trim().length > 0 ||
    css.trim().length > 0 ||
    javascript.trim().length > 0;

  const documentSource = useMemo(
    () =>
      hasContent
        ? assembleDocument({ html, css, javascript, nonce: refreshKey })
        : "",
    [hasContent, html, css, javascript, refreshKey],
  );

  const handleLoad = useCallback(() => {
    setLoadedSource(documentSource);
  }, [documentSource]);

  const errors =
    runtimeErrors && runtimeErrors.source === documentSource
      ? runtimeErrors.messages
      : null;

  const status: "empty" | "rendering" | "ready" = !hasContent
    ? "empty"
    : loadedSource === documentSource
      ? "ready"
      : "rendering";

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data: unknown = event.data;
      if (!data || typeof data !== "object") return;
      const payload = (data as { studioPreview?: unknown }).studioPreview;
      if (!payload || typeof payload !== "object") return;
      const { message } = payload as { message?: unknown };
      if (typeof message !== "string") return;
      const text = sanitizeMessage(message) || "Script error in the preview.";
      setRuntimeErrors((prev) => {
        const base =
          prev && prev.source === documentSource ? prev.messages : [];
        if (base.includes(text)) return prev;
        return { source: documentSource, messages: [...base, text].slice(-3) };
      });
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [documentSource]);

  useEffect(() => {
    const well = wellRef.current;
    if (!well) return;

    const measure = () => {
      if (framed) {
        const pad = 40;
        const next = Math.min(
          1,
          (well.clientWidth - pad) / size.w,
          (well.clientHeight - pad) / size.h,
        );
        setScale(Math.max(0.2, next));
        setDims({ w: size.w, h: size.h });
        return;
      }
      const frame = iframeRef.current;
      if (frame && frame.clientWidth > 0 && frame.clientHeight > 0) {
        setDims({
          w: Math.round(frame.clientWidth),
          h: Math.round(frame.clientHeight),
        });
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(well);
    return () => observer.disconnect();
  }, [framed, size.w, size.h, hasContent]);

  return (
    <div className="flex flex-col h-full w-full bg-[#000000] text-[#e1e1e1] overflow-hidden font-sans antialiased">
      {/* Studio Preview Top Bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1a1a] bg-[#050505] text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[#cccccc]">Preview</span>
          <span className="text-[10px] font-mono text-[#777777] bg-[#111111] px-2 py-0.5 rounded border border-[#222222]" aria-live="polite">
            {status === "rendering"
              ? "Rendering…"
              : dims
                ? `${size.label} · ${dims.w} × ${dims.h}`
                : ""}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Viewport Segmented Control */}
          <div
            className="flex items-center bg-[#111111] border border-[#222222] rounded-md p-0.5 space-x-0.5"
            role="group"
            aria-label="Preview viewport"
          >
            {VIEWPORT_ORDER.map((key) => {
              const Icon = VIEWPORT_ICONS[key];
              const isSelected = viewport === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`${VIEWPORTS[key].label} viewport`}
                  title={`${VIEWPORTS[key].label} viewport`}
                  onClick={() => setViewport(key)}
                  className={`p-1 rounded transition-colors ${
                    isSelected
                      ? "bg-[#222222] text-[#ffffff]"
                      : "text-[#777777] hover:text-[#cccccc]"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              );
            })}
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            className="p-1.5 rounded-md hover:bg-[#181818] text-[#777777] hover:text-[#cccccc] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={onRefresh}
            disabled={!hasContent}
            aria-label="Re-render preview"
            title="Re-render preview"
          >
            <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Main Preview Container Well */}
      <div className="relative flex-1 bg-[#0a0a0a] overflow-hidden flex items-center justify-center p-4" ref={wellRef}>
        {hasContent && (
          <iframe
            ref={iframeRef}
            className={`border border-[#222222] bg-[#000000] shadow-2xl transition-all duration-200 ${
              framed ? "rounded-xl overflow-hidden origin-center absolute" : "w-full h-full rounded-none"
            }`}
            style={{
              width: framed ? size.w : "100%",
              height: framed ? size.h : "100%",
              transform: framed ? `scale(${scale})` : undefined,
            }}
            sandbox="allow-scripts"
            srcDoc={documentSource}
            onLoad={handleLoad}
            title="Website preview"
            key={documentSource}
          />
        )}
        {!hasContent && (
          <div className="flex flex-col items-center justify-center text-center px-4 space-y-2">
            <div className="w-9 h-9 rounded-full bg-[#141414] border border-[#222222] flex items-center justify-center text-[#777777]">
              <Sparkles className="w-4 h-4 text-[#ffffff]" />
            </div>
            <p className="text-xs text-[#cccccc]">No preview generated yet.</p>
            <p className="text-[11px] text-[#666666] max-w-[240px] leading-relaxed">
              Describe your website in chat to build and render it here.
            </p>
          </div>
        )}
      </div>

      {/* Runtime Errors Toast Banner */}
      {errors && errors.length > 0 && (
        <div className="m-3 p-3 rounded-lg bg-[#1a0808] border border-[#3a1515] flex items-start gap-2.5 text-[#ff6b6b] text-xs shadow-lg" role="status">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <span className="font-medium block">
              Preview reported {errors.length === 1 ? "an error" : `${errors.length} errors`}:
            </span>
            <ul className="list-disc list-inside space-y-0.5 font-mono text-[11px] opacity-90">
              {errors.map((message) => (
                <li key={message} className="truncate">{message}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}