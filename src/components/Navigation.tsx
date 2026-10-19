"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";

const LINKS = [
  { label: "Work", href: "#work" },
  { label: "Motion", href: "#motion" },
  { label: "About", href: "#about" },
] as const;

export default function Navigation() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const nav = ref.current;
      if (!nav) return;
      gsap.set(nav, { y: -24, opacity: 0 });
      gsap.to(nav, {
        y: 0,
        opacity: 1,
        duration: 0.9,
        ease: "power3.out",
        delay: 0.2,
      });
    }, ref);

    return () => {
      ctx.revert();
    };
  }, []);

  return (
    <nav
      ref={ref}
      className="fixed inset-x-0 top-0 z-50 border-b border-blaze-border bg-blaze-bg/80 backdrop-blur-md"
    >
      <div className="mx-auto flex h-16 items-center justify-between px-6 md:px-12">
        <Link
          href="/"
          className="text-blaze-text font-mono text-xs tracking-[0.35em] uppercase outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-blaze-bg focus-visible:ring-blaze-gold"
        >
          GSAP<sup className="text-[0.6em] text-blaze-muted">®</sup> STUDIO
        </Link>

        <div className="hidden md:flex items-center gap-8 text-xs font-mono tracking-wider uppercase">
          {LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="text-blaze-muted hover:text-blaze-text transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-blaze-bg focus-visible:ring-blaze-gold"
              onClick={() => {
                const target = document.querySelector(link.href);
                target?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3 text-xs font-mono tracking-wider uppercase">
          <span className="flex h-2 w-2 rounded-full bg-blaze-gold shadow-[0_0_12px_rgba(255,211,106,0.6)]"></span>
          <span className="text-blaze-text">Available</span>
        </div>
      </div>
    </nav>
  );
}
