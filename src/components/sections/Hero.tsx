
"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUpRight, Sparkles } from "lucide-react";
import { gsap } from "@/lib/gsap";
import GauzeBlaze from "@/components/GauzeBlaze";

const examples = [
  "A cinematic portfolio with fluid scroll animations",
  "A futuristic product landing page with WebGL visuals",
  "An editorial fashion website with immersive transitions",
];

export default function Hero() {
  const rootRef = useRef<HTMLElement>(null);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const context = gsap.context(() => {
      const intro = root.querySelectorAll("[data-hero-intro]");

      gsap.fromTo(
        intro,
        { y: 28, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.9,
          stagger: 0.12,
          ease: "power3.out",
          clearProps: "transform",
        },
      );
    }, root);

    return () => context.revert();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const value = prompt.trim();
    if (!value) return;

    // UI-only for now: no fake AI generation or broken route.
    setStatus(
      "Your prompt is ready. Connect the Studio route to continue building.",
    );
  }

  function chooseExample(example: string) {
    setPrompt(example);
    setStatus("");
  }

  return (
    <section ref={rootRef} className="hero" id="home">
      <div className="hero__visual" aria-hidden="true">
        <GauzeBlaze />
      </div>

      <div className="hero__shade" aria-hidden="true" />
      <div className="hero__grid" aria-hidden="true" />

      <div className="hero__content">
        <div className="hero__eyebrow" data-hero-intro>
          <span className="hero__status-dot" />
          THE CREATIVE WEB, REIMAGINED
          <span className="hero__eyebrow-line" />
          <span className="hero__version">01 / 01</span>
        </div>

        <h1 className="hero__title" data-hero-intro>
          Make the web
          <br />
          <span className="hero__title-muted">feel </span>
          <span className="hero__title-gradient">something.</span>
        </h1>

        <p className="hero__description" data-hero-intro>
          Describe the experience in your head.
          <br className="hero__desktop-break" />
          Turn ambitious ideas into extraordinary web experiences.
        </p>

        <div className="hero__composer-wrap" data-hero-intro>
          <form className="hero__composer" onSubmit={handleSubmit}>
            <div className="hero__composer-top">
              <Sparkles
                className="hero__sparkle"
                size={18}
                aria-hidden="true"
              />
              <span>YOUR NEXT IDEA STARTS HERE</span>
              <span className="hero__composer-tag">CREATIVE MODE</span>
            </div>

            <label className="hero__sr-only" htmlFor="hero-prompt">
              Describe the website you want to create
            </label>

            <textarea
              id="hero-prompt"
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                setStatus("");
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="A cinematic website with liquid light, bold typography..."
              rows={3}
              maxLength={2000}
            />

            <div className="hero__composer-bottom">
              <span className="hero__hint">
                <kbd>↵</kbd> to continue
                <span className="hero__hint-divider">·</span>
                <kbd>⇧ ↵</kbd> new line
              </span>

              <button
                className="hero__submit"
                type="submit"
                disabled={!prompt.trim()}
                aria-label="Continue with your prompt"
              >
                <span>Explore idea</span>
                <ArrowUpRight size={17} />
              </button>
            </div>
          </form>

          {status && (
            <p className="hero__status-message" role="status">
              {status}
            </p>
          )}

          <div className="hero__examples">
            <span className="hero__examples-label">NEED A SPARK?</span>
            {examples.map((example, index) => (
              <button
                className="hero__example"
                key={example}
                type="button"
                onClick={() => chooseExample(example)}
              >
                {index === 0 ? "Portfolio" : index === 1 ? "WebGL" : "Editorial"}
                <ArrowUpRight size={12} />
              </button>
            ))}
          </div>
        </div>

        <div className="hero__bottom" data-hero-intro>
          <span className="hero__bottom-note">
            <span className="hero__bottom-star">✳</span>
            DESIGNED TO BE EXPERIENCED
          </span>

          <a className="hero__scroll" href="#manifesto">
            SCROLL TO EXPLORE
            <span className="hero__scroll-icon">
              <ArrowDown size={14} />
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}
