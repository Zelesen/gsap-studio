"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";

const TITLE_LINES = [
  "Motion is a design language,",
  "not a decoration.",
];

const BODY = [
  "We treat every transition, every reveal, and every scroll as part of the interface.",
  "Timing, easing, and choreography are editorial decisions — not afterthoughts.",
  "This studio exists to test what moves on the web, and why.",
];

export default function Manifesto() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const ctx = gsap.context(() => {
      const section = sectionRef.current;
      if (!section) return;

      const eyebrow = section.querySelector<HTMLElement>("[data-manifesto-eyebrow]");
      const titleLines = section.querySelectorAll<HTMLElement>("[data-manifesto-line]");
      const accent = section.querySelector<HTMLElement>("[data-manifesto-accent]");
      const body = section.querySelectorAll<HTMLElement>("[data-manifesto-body]");

      if (prefersReduced) {
        gsap.set([eyebrow, ...titleLines, accent, ...body].filter(
          (el): el is HTMLElement => el !== null,
        ), { clearProps: "all", y: 0, opacity: 1, scale: 1, filter: "none" });
        if (accent) gsap.set(accent, { scaleX: 1 });
        return;
      }

      // Content is visible by default; GSAP choreographs a creative entrance on scroll.
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: "top 70%",
          end: "bottom 20%",
          toggleActions: "play none none reverse",
          once: true,
        },
      });

      tl.fromTo(eyebrow, { y: 20, opacity: 0.6 }, { y: 0, opacity: 1, duration: 0.8, ease: "power3.out" })
        .fromTo(
          titleLines,
          { y: 30, opacity: 0.5 },
          { y: 0, opacity: 1, duration: 1, stagger: 0.2, ease: "power3.out" },
          "-=0.4",
        )
        .fromTo(
          accent,
          { scaleX: 0 },
          { scaleX: 1, duration: 1, ease: "power3.out" },
          "-=0.5",
        )
        .fromTo(
          body,
          { y: 20, opacity: 0.6 },
          { y: 0, opacity: 1, duration: 0.8, stagger: 0.2, ease: "power3.out" },
          "-=0.5",
        );
    }, sectionRef);

    return () => {
      ctx.revert();
    };
  }, []);

  return (
    <section
      id="motion"
      ref={sectionRef}
      className="manifesto"
      aria-label="Motion manifesto"
    >
      <div className="manifesto__inner">
        <p
          data-manifesto-eyebrow
          className="manifesto__eyebrow"
        >
          <span className="manifesto__eyebrow-dot" aria-hidden="true" />
          01 / Motion thesis
        </p>

        <h2 data-manifesto-line className="manifesto__title">
          <span className="manifesto__title-line">{TITLE_LINES[0]}</span>
          <span className="manifesto__title-line">{TITLE_LINES[1]}</span>
        </h2>

        <div data-manifesto-accent className="manifesto__accent" aria-hidden="true" />

        {BODY.map((paragraph, index) => (
          <p
            key={index}
            data-manifesto-body
            className="manifesto__text"
          >
            {paragraph}
          </p>
        ))}
      </div>
    </section>
  );
}
