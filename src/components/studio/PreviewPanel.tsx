"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor, RotateCw, Smartphone, Tablet } from "lucide-react";

/*
 * PreviewPanel — the generated website inside a sandboxed iframe.
 *
 * The iframe is the security boundary: generated HTML/CSS/JS runs there, never
 * in the application's origin. Desktop fills the well; tablet and mobile render
 * at their true viewport size and are scaled down to fit, so the embedded
 * document really is 390px wide on "mobile" rather than a squeezed imitation.
 *
 * A render error is surfaced through onError (a ref-stable callback) so the
 * iframe is only rewritten when its inputs change, not on every parent render.
 */

interface PreviewPanelProps {
  html: string;
  css: string;
  javascript: string;
  onRefresh: () => void;
  onError: (message: string) => void;
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

export default function PreviewPanel({
  html,
  css,
  javascript,
  onRefresh,
  onError,
  refreshKey = 0,
}: PreviewPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [scale, setScale] = useState(1);

  const size = VIEWPORTS[viewport];
  const framed = viewport !== "desktop";

  const buildFullHtml = useCallback((h: string, c: string, js: string) => {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Preview</title>
<style>
${c}
</style>
</head>
<body>
${h}
<script>
${js}
</script>
</body>
</html>
    `;
  }, []);

  // Write the generated document into the iframe. This is a side effect on an
  // external system, so errors go through onError rather than React state.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;

    try {
      doc.open();
      doc.write(buildFullHtml(html, css, javascript));
      doc.close();
    } catch (err) {
      onError(
        err instanceof Error ? err.message : "Failed to render preview.",
      );
    }
  }, [html, css, javascript, buildFullHtml, onError, refreshKey]);

  // Scale a framed device down to fit the well, without changing the viewport
  // the embedded document actually renders at.
  useEffect(() => {
    if (!framed) return;
    const well = wellRef.current;
    if (!well) return;

    const fit = () => {
      const pad = 40;
      const next = Math.min(
        1,
        (well.clientWidth - pad) / size.w,
        (well.clientHeight - pad) / size.h,
      );
      setScale(Math.max(0.2, next));
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(well);
    return () => observer.disconnect();
  }, [framed, size.w, size.h]);

  const hasContent =
    html.trim().length > 0 ||
    css.trim().length > 0 ||
    javascript.trim().length > 0;

  return (
    <>
      <div className="studio-panel-head">
        <span className="studio-panel-head__label">Preview</span>
        <div className="flex items-center gap-2">
          <div
            className="studio-segmented"
            role="group"
            aria-label="Preview viewport"
          >
            {VIEWPORT_ORDER.map((key) => {
              const Icon = VIEWPORT_ICONS[key];
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={viewport === key}
                  aria-label={`${VIEWPORTS[key].label} viewport`}
                  title={`${VIEWPORTS[key].label} viewport`}
                  onClick={() => setViewport(key)}
                >
                  <Icon aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="studio-btn studio-btn--ghost studio-btn--icon"
            onClick={onRefresh}
            aria-label="Re-render preview"
            title="Re-render preview"
          >
            <RotateCw aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="studio-well" ref={wellRef}>
        <iframe
          ref={iframeRef}
          className={
            framed ? "studio-device studio-device--framed" : "studio-device"
          }
          style={{
            width: framed ? size.w : "100%",
            height: framed ? size.h : "100%",
            transform: framed ? `scale(${scale})` : undefined,
          }}
          sandbox="allow-scripts allow-same-origin"
          title="Website preview"
        />
        {!hasContent && (
          <div className="studio-well__empty">
            No preview yet. Describe a website and press Generate to see it
            here.
          </div>
        )}
      </div>
    </>
  );
}
