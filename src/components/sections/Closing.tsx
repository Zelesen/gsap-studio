"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";

export default function Closing() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const ctx = gsap.context(() => {
      const section = sectionRef.current;
      if (!section) return;

      const title = section.querySelector<HTMLElement>("[data-closing-title]");
      const text = section.querySelector<HTMLElement>("[data-closing-text]");
      const contact = section.querySelector<HTMLElement>("[data-closing-contact]");
      const footer = section.querySelector<HTMLElement>("[data-closing-footer]");

      if (prefersReduced) {
        gsap.set([title, text, contact, footer].filter(
          (el): el is HTMLElement => el !== null,
        ), { clearProps: "all", y: 0, opacity: 1, filter: "none" });
        return;
      }

      // Content visible by default; GSAP choreographs the closing reveal on scroll.
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: "top 70%",
          end: "bottom 20%",
          toggleActions: "play none none reverse",
          once: true,
        },
      });

      tl.fromTo(
        title,
        { y: 30, opacity: 0.6, filter: "blur(8px)" },
        {
          y: 0,
          opacity: 1,
          filter: "blur(0px)",
          duration: 1,
          ease: "power3.out",
        },
      )
        .fromTo(
          text,
          { y: 20, opacity: 0.6 },
          { y: 0, opacity: 1, duration: 0.8, ease: "power3.out" },
          "-=0.5",
        )
        .fromTo(
          contact,
          { y: 20, opacity: 0.6 },
          { y: 0, opacity: 1, duration: 0.8, ease: "power3.out" },
          "-=0.45",
        )
        .fromTo(
          footer,
          { y: 15, opacity: 0.6 },
          { y: 0, opacity: 1, duration: 0.7, ease: "power3.out" },
          "-=0.4",
        );
    }, sectionRef);

    return () => {
      ctx.revert();
    };
  }, []);

  return (
    <section
      id="about"
      ref={sectionRef}
      className="closing"
      aria-label="About"
    >
      <div className="closing__inner">
        <h2 data-closing-title className="closing__title">
          Let’s build something that moves.<br />
          <span>GSAP® STUDIO</span>
        </h2>

        <p data-closing-text className="closing__text">
          GSAP® STUDIO is an independent digital laboratory. No templates, no
          brute force — just motion, engineered.
        </p>

        <div data-closing-contact className="closing__contact">
          <span className="closing__contact-label">Contact / placeholder</span>
          <a
            href="mailto:hello@example.invalid"
            className="closing__contact-value"
            rel="noopener noreferrer"
          >
            hello@example.invalid
          </a>
          <span className="closing__contact-note">
            Placeholder contact address — no real inbox. This is a demo.
          </span>
        </div>

        <footer data-closing-footer className="closing__footer">
          <div className="closing__footer-line">
            <span>© 2026 GSAP® STUDIO.</span>
            <span>Built with Next.js, GSAP, and Tailwind CSS.</span>
          </div>
          <div className="closing__footer-line">
            <span>All projects are fictional concepts created for this showcase.</span>
          </div>
        </footer>
      </div>
    </section>
  );
}
