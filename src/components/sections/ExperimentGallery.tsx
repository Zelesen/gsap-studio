"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";
import ExperimentCard from "@/components/sections/ExperimentCard";

const PROJECTS = [
  {
    id: "lumen",
    number: "01",
    title: "Lumen",
    category: "Kinetic typography",
    text: "Type that leans into the pointer. A study in spring easing, variable fonts, and motion as rhythm.",
    variant: "glow",
  },
  {
    id: "kyma",
    number: "02",
    title: "Kyma",
    category: "Sound-reactive geometry",
    text: "A grid of quiet circles that breathe in place. No audio — just the implication of sound, timed to a slow clock.",
    variant: "dots",
  },
  {
    id: "flux",
    number: "03",
    title: "Flux",
    category: "Interface prototype",
    text: "A scrolling interface that resists easing. Everything arrives late, on purpose.",
    variant: "frame",
  },
] as const;

export default function ExperimentGallery() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isMobile =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 768px)").matches;

    const pin = pinRef.current;
    const track = trackRef.current;
    if (!pin || !track) return undefined;

    // Reduced motion: keep the track natively scrollable instead of pinned.
    pin.style.overflowX = prefersReduced && !isMobile ? "auto" : "hidden";

    if (prefersReduced || isMobile) return undefined;

    const ctx = gsap.context(() => {
      const travel = () => track.scrollWidth - pin.clientWidth;

      // Pin the gallery container while the track scrubs horizontally.
      gsap.to(track, {
        x: () => -travel(),
        ease: "none",
        scrollTrigger: {
          trigger: pin,
          start: "top top",
          end: () => `+=${travel()}`,
          pin: pin,
          scrub: 1,
          invalidateOnRefresh: true,
          anticipatePin: 1,
        },
      });

      // Cards enter with a staggered slide-up as they scroll into the pinned viewport.
      const cards = gsap.utils.toArray(
        track.querySelectorAll<HTMLElement>(".gallery__card"),
      );

      gsap.fromTo(
        cards,
        { y: 40, opacity: 0.7 },
        {
          y: 0,
          opacity: 1,
          duration: 0.9,
          ease: "power3.out",
          stagger: 0.15,
          scrollTrigger: {
            trigger: pin,
            start: "top 70%",
            end: "bottom 20%",
            toggleActions: "play none none reverse",
            once: true,
          },
        },
      );
    }, pinRef);

    return () => {
      ctx.revert();
      pin.style.overflowX = "";
    };
  }, []);

  return (
    <section
      id="work"
      ref={sectionRef}
      className="gallery"
      aria-label="Selected experiments"
    >
      <div className="gallery__inner">
        <p
          className="gallery__eyebrow"
        >
          <span className="gallery__eyebrow-dot" aria-hidden="true" />
          02 / Selected experiments
        </p>

        <h1 className="gallery__title">
          Experiments in motion.
        </h1>

        <p className="gallery__subtitle">
          A horizontal study of three concepts. Pin, scrub, and look closer.
        </p>

        <div
          ref={pinRef}
          className="gallery__pin"
        >
          <div
            ref={trackRef}
            className="gallery__track scrollbar-hide"
          >
            {PROJECTS.map((project) => (
              <ExperimentCard
                key={project.id}
                {...project}
              />
            ))}
          </div>
        </div>

        <p className="gallery__mobile-hint">
          Desktop: scroll to scrub the track horizontally.
        </p>
      </div>
    </section>
  );
}
