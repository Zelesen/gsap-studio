"use client";

type Variant = "glow" | "dots" | "frame";

interface ExperimentCardProps {
  className?: string;
  number: string;
  title: string;
  category: string;
  text: string;
  variant: Variant;
}

export default function ExperimentCard({
  className,
  number,
  title,
  category,
  text,
  variant,
}: ExperimentCardProps) {
  return (
    <article className={`gallery__card ${className ?? ""}`}>
      {/* Variant-specific CSS glow treatments — no external images. */}
      {variant === "glow" && (
        <div className="gallery__card-glow bg-blaze-magenta/25" />
      )}
      {variant === "dots" && (
        <div
          className="gallery__card-glow bg-blaze-indigo/20"
          style={{
            backgroundImage:
              "radial-gradient(var(--blaze-indigo) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        />
      )}
      {variant === "frame" && (
        <div className="gallery__card-glow bg-blaze-orange/15" />
      )}

      <div className="gallery__card-body">
        <div className="gallery__card-head">
          <span className="gallery__card-number">{number}</span>
          <span className="gallery__card-sep" aria-hidden="true" />
          <h3 className="gallery__card-title">{title}</h3>
        </div>

        <p className="gallery__card-text">{text}</p>

        <span className="gallery__card-tag">{category}</span>
      </div>
    </article>
  );
}
