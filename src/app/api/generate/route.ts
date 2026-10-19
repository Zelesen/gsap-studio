/*
 * Server-side AI generation route.
 *
 * Accepts a conversation + current code, calls OpenRouter, validates
 * the structured result, and returns it to the client. Credentials are
 * never exposed to the browser.
 */

import { generateWebsite } from "@/lib/ai";
import { NextRequest, NextResponse } from "next/server";

interface GenerateRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  currentHtml?: string;
  currentCss?: string;
  currentJs?: string;
}

const SYSTEM_PROMPT = `You are an expert front-end engineer and creative technologist. You build complete, single-file websites from natural language descriptions.

Your output must be a valid JSON object with exactly three keys: "html", "css", and "javascript". No markdown fences, no explanation text outside the JSON.

Design principles:
- Premium, minimal, cinematic aesthetic. Near-black backgrounds, warm-white typography, muted grey details, restrained accent color.
- Use semantic HTML5. Every image needs alt text. Use proper heading hierarchy.
- Fully responsive: mobile-first, fluid typography with clamp(), touch-friendly targets.
- Accessibility: sufficient color contrast, focus states, ARIA where appropriate, prefers-reduced-motion respected.
- Include GSAP (from a CDN) where motion adds value — subtle reveals, scroll-triggered animations, smooth hover transitions. Keep it restrained and intentional.
- CSS should be in a <style> block inside the HTML, JS in a <script> block, or as separate strings — the platform will assemble them.
- No external images, no external fonts beyond Google Fonts if needed, no external APIs.
- The HTML must be a complete document (<!DOCTYPE html><html><head><body>).
- Keep code clean, well-commented, and production-quality.

If this is a follow-up request, modify the existing code rather than starting from scratch unless the user explicitly asks for a new direction.`;

/**
 * POST /api/generate
 * Body: { model?, messages[], currentHtml?, currentCss?, currentJs? }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const modelFromEnv = process.env.OPENROUTER_MODEL;

  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json(
      { error: "messages array is required." },
      { status: 400 },
    );
  }

  const model = body.model || modelFromEnv || "openrouter/auto";

  // Build the message list: system prompt first, then conversation, with
  // current code injected as context on follow-ups.
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  // If we have existing code, inject it as context so the model modifies
  // rather than replaces on follow-ups.
  if (
    body.currentHtml ||
    body.currentCss ||
    body.currentJs
  ) {
    messages.push({
      role: "system",
      content: `CURRENT PROJECT STATE:\n--- HTML ---\n${body.currentHtml || "(empty)"}\n--- CSS ---\n${body.currentCss || "(empty)"}\n--- JAVASCRIPT ---\n${body.currentJs || "(empty)"}\n--- END ---\nModify this code to fulfill the user's request. Preserve what is working and only change what is needed.`,
    });
  }

  messages.push(...body.messages);

  try {
    const result = await generateWebsite(messages as never, model);

    return NextResponse.json({
      ok: true,
      model,
      html: result.html,
      css: result.css,
      javascript: result.javascript,
    });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "status" in err) {
      const e = err as { status?: number; message?: string; type?: string };
      return NextResponse.json(
        {
          ok: false,
          error: e.message || "AI generation failed.",
          type: e.type,
          status: e.status,
        },
        { status: e.status && e.status >= 500 ? 502 : 400 },
      );
    }

    return NextResponse.json(
      { ok: false, error: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}
