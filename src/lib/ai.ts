/*
 * OpenRouter provider adapter â€” OpenAI-compatible chat completions.
 *
 * This adapter is intentionally isolated so the provider can be swapped
 * without touching the UI. All credential handling happens server-side;
 * the client never sees the API key.
 *
 * Milestone 3.1: the model returns a multi-file React + TypeScript project
 * (a manifest plus a source tree), not the single-file HTML/CSS/JS triple
 * Milestone 2 produced. The old contract and its parser are gone; the
 * project contract is validated in src/lib/project.ts.
 */

import { validateProjectResult, type ProjectResult } from "@/lib/project";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export type { ProjectResult, ProjectManifest, ProjectFile, APPROVED_DEPENDENCIES, isApprovedImport, validateProjectResult } from "@/lib/project";

const REACT_SYSTEM_PROMPT = `You are an expert React + TypeScript engineer. You build complete, single-page websites from natural language descriptions.

Your output must be a valid JSON object with exactly two keys: "manifest" and "files". No markdown fences, no explanation text outside the JSON.

manifest:
- name: kebab-case project name, e.g. "my-landing-page"
- version: "0.1.0"
- entry: "src/main.tsx" (must exist in files)
- dependencies: Only these packages are allowed:
    react, react-dom, react-dom/client, react/jsx-runtime,
    gsap, gsap/ScrollTrigger, @gsap/react
- framework: "react-ts"

files: Array of { path: string, content: string }
- Must include the entry point specified in manifest
- Use only approved imports from the dependencies list above
- CSS files can be imported from TypeScript/TSX files
- No external images, no external fonts, no external APIs, no CDN scripts
- Keep code clean, well-commented, and production-quality

Design principles:
- Premium, minimal, cinematic aesthetic. Near-black backgrounds, warm-white typography, muted grey details, restrained accent color.
- Use semantic HTML5. Every image needs alt text. Use proper heading hierarchy.
- Fully responsive: mobile-first, fluid typography with clamp(), touch-friendly targets.
- Accessibility: sufficient color contrast, focus states, ARIA where appropriate, prefers-reduced-motion respected.
- Include GSAP where motion adds value â€” subtle reveals, scroll-triggered animations, smooth hover transitions. Keep it restrained and intentional.
- Register GSAP plugins explicitly (e.g. gsap.registerPlugin(ScrollTrigger)).
- Use React 19 with createRoot for DOM rendering.
- Use @gsap/react's useGSAP for GSAP integration in React components.

If this is a follow-up request, modify the existing code rather than starting from scratch unless the user explicitly asks for a new direction.`;

interface OpenRouterChatCompletion {
  model: string;
  messages: Message[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
}

interface OpenRouterChoice {
  message: { content: string | null };
}

interface OpenRouterResponse {
  id?: string;
  choices: OpenRouterChoice[];
  error?: {
    message: string;
    type?: string;
    code?: number;
  };
}

class OpenRouterError extends Error {
  public readonly status: number;
  public readonly type?: string;
  public readonly code?: number;

  constructor(message: string, status: number, type?: string, code?: number) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
    this.type = type;
    this.code = code;
  }
}

function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new OpenRouterError(
      `Missing environment variable: ${key}`,
      500,
      "configuration_error",
    );
  }
  return value;
}

function parseProjectResult(raw: string): ProjectResult {
  let cleaned = raw.trim();

  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        parsed = JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        throw new OpenRouterError(
          "Model returned invalid JSON that could not be parsed.",
          502,
          "invalid_response",
        );
      }
    } else {
      throw new OpenRouterError(
        "Model returned no parseable JSON object.",
        502,
        "invalid_response",
      );
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OpenRouterError(
      "Model response is not a JSON object.",
      502,
      "invalid_response",
    );
  }

  const validated = validateProjectResult(parsed);
  if (!validated.ok) {
    throw new OpenRouterError(
      `Model response validation failed: ${validated.error}`,
      502,
      "invalid_response",
    );
  }
  return validated.result;
}

export async function generateReactProject(
  messages: Message[],
  model: string,
): Promise<ProjectResult> {
  const apiKey = getEnv("OPENROUTER_API_KEY");

  const body: OpenRouterChatCompletion = {
    model,
    messages,
    temperature: 0.4,
    max_tokens: 12000,
    response_format: { type: "json_object" },
  };

  let controller: AbortController | null = null;
  const timeoutMs = 120000;

  try {
    controller = new AbortController();
    const timeoutId = setTimeout(() => controller?.abort(), timeoutMs);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://gsap-studio.local",
        "X-Title": "GSAP Studio AI Website Builder",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage = `OpenRouter API error (${response.status})`;
      let errorType: string | undefined;
      let errorCode: number | undefined;

      try {
        const errorBody = (await response.json()) as OpenRouterResponse;
        errorMessage = errorBody.error?.message || errorMessage;
        errorType = errorBody.error?.type;
        errorCode = errorBody.error?.code;
      } catch {
        // Ignore parse errors on error responses
      }

      throw new OpenRouterError(errorMessage, response.status, errorType, errorCode);
    }

    const data: OpenRouterResponse = await response.json();

    if (data.error) {
      throw new OpenRouterError(
        data.error.message || "OpenRouter returned an error.",
        data.error.code || 502,
        data.error.type,
        data.error.code,
      );
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new OpenRouterError(
        "Model returned no content.",
        502,
        "invalid_response",
      );
    }

    return parseProjectResult(content);
  } catch (err) {
    if (err instanceof OpenRouterError) {
      throw err;
    }
    if (err instanceof Error) {
      if (err.name === "AbortError") {
        throw new OpenRouterError(
          "Request timed out. Please try again.",
          504,
          "timeout",
        );
      }
      throw new OpenRouterError(
        `Unexpected error: ${err.message}`,
        500,
        "unknown",
      );
    }
    throw new OpenRouterError("Unknown error occurred.", 500, "unknown");
  } finally {
    controller = null;
  }
}

export { OpenRouterError, REACT_SYSTEM_PROMPT };
