if (typeof window === "undefined") {
  // Skip diagnostic in test mode (no OPENROUTER_API_KEY)
  if (process.env.OPENROUTER_API_KEY) {
    try {
      console.log(
        `[gsap-studio] AI provider: ${resolveProvider()} · key prefix: ${(providerApiKey(resolveProvider()).slice(0, 12))}...`,
      );
    } catch {
      console.log(`[gsap-studio] AI provider: ${resolveProvider()} · key: missing`);
    }
  }
}
﻿/*
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
import { normalizeRuntimeImports } from "@/lib/imports";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export type AIProvider = "openrouter" | "openai" | "google";

export type { ProjectResult, ProjectManifest, ProjectFile, APPROVED_DEPENDENCIES, isApprovedImport, validateProjectResult } from "@/lib/project";

/* Google (Gemini) model id: body wins, then `GOOGLE_MODEL` env, then default. */
export const GOOGLE_MODEL_DEFAULT = "gemini-3.6-flash";

/* Placeholder credential used when the caller explicitly skips the auth check. */
const AUTH_SKIPPED = "auth-check-skipped";

/** Resolve the Gemini API key (`GOOGLE_API_KEY`, `GOOGLE_MODAL` alias kept). */
export function googleApiKey(options?: { skipAuthCheck?: boolean }): string {
  try {
    return getEnv("GOOGLE_API_KEY", ["GOOGLE_MODAL"]);
  } catch (err) {
    if (options?.skipAuthCheck) return AUTH_SKIPPED;
    throw err;
  }
}

/**
 * Convert a chat-style transcript to Gemini `contents`.
 * Gemini roles are only "user" | "model": system turns become user turns
 * (Gemini's systemInstruction could host them, but folding keeps one path).
 * Consecutive same-role turns are merged, since Gemini requires alternation.
 */
export function toGeminiContents(messages: Message[]): Array<{
  role: "user" | "model";
  parts: Array<{ text: string }>;
}> {
  const contents: Array<{
    role: "user" | "model";
    parts: Array<{ text: string }>;
  }> = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : "user";
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push({ text: m.content });
    } else {
      contents.push({ role, parts: [{ text: m.content }] });
    }
  }
  return contents;
}

interface GeminiPart {
  text?: string;
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  error?: { message?: string; status?: string; code?: number };
}

const REACT_SYSTEM_PROMPT = `You are an expert React + TypeScript engineer. You build complete, single-page websites from natural language descriptions.

Your output must be a valid JSON object with exactly two keys: "manifest" and "files". No markdown fences, no explanation text outside the JSON.

manifest:
- name: kebab-case project name, e.g. "my-landing-page"
- version: "0.1.0"
- entry: "src/main.tsx" (must exist in files)
- dependencies: Only these packages are allowed:
    react, react-dom, react-dom/client, react/jsx-runtime,
    gsap, gsap/ScrollTrigger, @gsap/react
- framework: must be exactly the string "react-ts" (the only supported value — double-check it before answering)

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
- Include GSAP where motion adds value — subtle reveals, scroll-triggered animations, smooth hover transitions. Keep it restrained and intentional.
- Import the runtime with named imports, never with a namespace import:
    import { gsap } from "gsap";
    import { ScrollTrigger } from "gsap/ScrollTrigger";
    import { useGSAP } from "@gsap/react";
  'import * as gsap from "gsap"' gives you the module namespace, which has no registerPlugin, and the preview breaks.
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

class AIError extends Error {
  public readonly status: number;
  public readonly type?: string;
  public readonly code?: number;

  constructor(message: string, status: number, type?: string, code?: number) {
    super(message);
    this.name = "AIError";
    this.status = status;
    this.type = type;
    this.code = code;
  }
}

/* Backward-compatible alias; the generate route uses duck typing ("status" in err). */
class OpenRouterError extends AIError {}

function getEnv(key: string, fallbacks: string[] = []): string {
  const direct = process.env[key];
  if (direct) return direct.trim();
  const fallbackName = fallbacks.find((f) => Boolean(process.env[f]));
  if (fallbackName) return process.env[fallbackName]!.trim();
  throw new AIError(
    `Missing environment variable: ${key}${fallbacks.length > 0 ? ` (tried ${fallbacks.join(", ")})` : ""}`,
    500,
    "configuration_error",
  );
}

/*
 * Provider selection: explicit argument wins, then `AI_PROVIDER` env, then
 * OpenRouter (the existing default, so nothing changes unless opted in).
 */
function resolveProvider(explicit?: AIProvider): AIProvider {
  if (explicit === "google" || explicit === "openai" || explicit === "openrouter")
    return explicit;
  const env = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (env === "google" || env === "openai" || env === "openrouter") return env;
  return "openrouter";
}

function providerBaseUrl(provider: AIProvider): string {
  return provider === "openai"
    ? "https://api.openai.com/v1/chat/completions"
    : "https://openrouter.ai/api/v1/chat/completions";
}

function providerApiKey(
  provider: AIProvider,
  options?: { skipAuthCheck?: boolean },
): string {
  try {
    return provider === "openai"
      ? getEnv("OPENAI_API_KEY", ["OPEN_AI_API_KEY"])
      : getEnv("OPENROUTER_API_KEY");
  } catch (err) {
    /*
     * `skipAuthCheck` exists for callers that bring their own transport
     * (tests with a stubbed fetch): they need a placeholder credential
     * instead of a hard configuration failure. No route sets it, so a
     * missing key still fails loudly in production.
     */
    if (options?.skipAuthCheck) return AUTH_SKIPPED;
    throw err;
  }
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
  /*
   * The model sometimes writes `import * as gsap from "gsap"`, which compiles
   * but cannot run: the preview's import map hands the code the module
   * namespace, which has no `registerPlugin`. Normalizing here means the
   * project the studio stores is the project the preview can run.
   */
  return {
    ...validated.result,
    files: validated.result.files.map((file) => ({
      path: file.path,
      content: normalizeRuntimeImports(file.content),
    })),
  };
}

async function generateRawCompletion(
  messages: Message[],
  model: string,
  options?: { provider?: AIProvider; skipAuthCheck?: boolean },
): Promise<string> {
  const provider = resolveProvider(options?.provider);
  if (provider === "google") {
    return fetchGeminiRaw(messages, model, options);
  }
  const apiKey = providerApiKey(provider, options);
  const baseUrl = providerBaseUrl(provider);

  const body: OpenRouterChatCompletion = {
    model,
    messages,
    temperature: 0.4,
    max_tokens: 12000,
  };

  // OpenRouter-specific referral headers are unnecessary (and ignored) for
  // OpenAI; only attach them for the OpenRouter provider.
  const extraHeaders: Record<string, string> =
    provider === "openrouter"
      ? {
          "HTTP-Referer": "https://gsap-studio.local",
          "X-Title": "GSAP Studio AI Website Builder",
        }
      : {};

  let controller: AbortController | null = null;
  const timeoutMs = 120000;

  try {
    controller = new AbortController();
    const timeoutId = setTimeout(() => controller?.abort(), timeoutMs);

    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage = `${provider} API error (${response.status})`;
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

      throw new AIError(errorMessage, response.status, errorType, errorCode);
    }

    const data: OpenRouterResponse = await response.json();

    if (data.error) {
      throw new AIError(
        data.error.message || `${provider} returned an error.`,
        data.error.code || 502,
        data.error.type,
        data.error.code,
      );
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new AIError("Model returned no content.", 502, "invalid_response");
    }

    return content;
  } catch (err) {
    if (err instanceof AIError) {
      throw err;
    }
    if (err instanceof Error) {
      if (err.name === "AbortError") {
        throw new AIError(
          "Request timed out. Please try again.",
          504,
          "timeout",
        );
      }
      throw new AIError(`Unexpected error: ${err.message}`, 500, "unknown");
    }
    throw new AIError("Unknown error occurred.", 500, "unknown");
  } finally {
    controller = null;
  }
}

/* - end of provider adapters - */

/*
 * Google (Gemini) provider. Unlike OpenRouter/OpenAI (OpenAI-compatible
 * chat/completions with Bearer auth), Gemini uses generateContent with the
 * key in `x-goog-api-key`, a different payload (`contents` with user/model
 * roles), and a different response shape (`candidates[].content.parts`).
 * Response validation is shared (`parseProjectResult`) once text is out.
 */
/**
 * Fetch raw text from Google (Gemini). Returns the concatenated parts text,
 * or throws AIError.
 */
async function fetchGeminiRaw(
  messages: Message[],
  model: string,
  options?: { skipAuthCheck?: boolean },
): Promise<string> {
  const apiKey = googleApiKey(options);
  const cleanModel = model.includes("/") ? model.split("/").pop()! : model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent`;

  const body = {
    contents: toGeminiContents(messages),
    generationConfig: { temperature: 0.4, maxOutputTokens: 12000 },
  };

  let controller: AbortController | null = null;
  const timeoutMs = 120000;

  try {
    controller = new AbortController();
    const timeoutId = setTimeout(() => controller?.abort(), timeoutMs);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage = `google API error (${response.status})`;
      try {
        const errorBody = (await response.json()) as GeminiResponse;
        errorMessage = errorBody.error?.message || errorMessage;
      } catch {
        // Ignore parse errors on error responses
      }
      throw new AIError(errorMessage, response.status, "google_error");
    }

    const data = (await response.json()) as GeminiResponse;
    if (data.error) {
      throw new AIError(
        data.error.message || "google returned an error.",
        data.error.code || 502,
        data.error.status,
      );
    }

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const content = parts
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!content) {
      throw new AIError("Model returned no content.", 502, "invalid_response");
    }

    return content;
  } catch (err) {
    if (err instanceof AIError) {
      throw err;
    }
    if (err instanceof Error) {
      if (err.name === "AbortError") {
        throw new AIError(
          "Request timed out. Please try again.",
          504,
          "timeout",
        );
      }
      throw new AIError(`Unexpected error: ${err.message}`, 500, "unknown");
    }
    throw new AIError("Unknown error occurred.", 500, "unknown");
  } finally {
    controller = null;
  }
}

/**
 * Google (Gemini) provider. Wraps `fetchGeminiRaw` with JSON parsing and
 * project validation.
 */
async function generateGeminiProject(
  messages: Message[],
  model: string,
): Promise<ProjectResult> {
  const raw = await fetchGeminiRaw(messages, model);
  return parseProjectResult(raw);
}

/**
 * Generate a multi-file React + TypeScript project from a conversation.
 *
 * Wraps `generateRawCompletion` with JSON parsing and project validation.
 */
export async function generateReactProject(
  messages: Message[],
  model: string,
  options?: { provider?: AIProvider; skipAuthCheck?: boolean },
): Promise<ProjectResult> {
  const raw = await generateRawCompletion(messages, model, options);
  return parseProjectResult(raw);
}

export { AIError, OpenRouterError, REACT_SYSTEM_PROMPT, generateRawCompletion };
