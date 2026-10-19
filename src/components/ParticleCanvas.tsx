"use client";

import { useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
};

export default function ParticleCanvas({
  className = "",
  color = "rgba(194, 244, 74, 0.25)",
}: {
  className?: string;
  color?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const particlesRef = useRef<Particle[]>([]);
  const dimsRef = useRef({ width: 0, height: 0, dpr: 1 });
  const reducedRef = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return undefined;

    let width = 0;
    let height = 0;
    let dpr = 1;

    const getParticleCount = (): number => {
      const area = width * height;
      // Scale density with screen area, then clamp to a cheap, performant range.
      let count = Math.floor(area / 30000);
      count = Math.min(Math.max(count, 24), 140);
      if (
        typeof navigator !== "undefined" &&
        navigator.hardwareConcurrency !== undefined &&
        navigator.hardwareConcurrency <= 4
      ) {
        count = Math.floor(count * 0.6);
      }
      return count;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.ceil(rect.width * dpr));
      height = Math.max(1, Math.ceil(rect.height * dpr));
      canvas.width = width;
      canvas.height = height;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dimsRef.current = { width, height, dpr };
      createParticles();
    };

    const createParticles = () => {
      const count = getParticleCount();
      const { width: w, height: h } = dimsRef.current;
      particlesRef.current = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        radius: 0.5 + Math.random() * 1.5,
        alpha: 0.1 + Math.random() * 0.4,
      }));
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const draw = () => {
      const { width: w, height: h } = dimsRef.current;
      ctx.clearRect(0, 0, w, h);

      if (reducedRef.current) {
        // Reduced motion: paint a resting field, no drift or interaction.
        for (const p of particlesRef.current) {
          ctx.globalAlpha = p.alpha * 0.4;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fill();
        }
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const repelRadius = 160;

      for (const p of particlesRef.current) {
        // Slow, undirected drift.
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;

        // Gentle repulsion from the pointer.
        const dx = mx - p.x;
        const dy = my - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0 && dist < repelRadius) {
          const force = (repelRadius - dist) / repelRadius;
          p.x -= (dx / dist) * force * 2;
          p.y -= (dy / dist) * force * 2;
        }

        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = () => {
      reducedRef.current = media.matches;
    };

    resize();
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    media.addEventListener("change", onMotionChange);

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      media.removeEventListener("change", onMotionChange);
    };
  }, [color]);

  return (
    <canvas
      ref={canvasRef}
      className={`block w-full h-full pointer-events-none ${className}`}
      aria-hidden="true"
    />
  );
}
