/*
 * OpenRouter provider adapter — OpenAI-compatible chat completions.
 *
 * This adapter is intentionally isolated so the provider can be swapped
 * without touching the UI. All credential handling happens server-side;
 * the client never sees the API key.
 */

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface WebsiteResult {
  html: string;
  css: string;
  javascript: string;
}

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

function parseWebsiteResult(raw: string): WebsiteResult {
  let cleaned = raw.trim();

  // Strip markdown code fences if the model wrapped JSON in ```json ... ```
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to extract a JSON object from within the text
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

  const obj = parsed as Record<string, unknown>;
  const html = obj["html"];
  const css = obj["css"];
  const javascript = obj["javascript"];

  if (
    typeof html !== "string" ||
    typeof css !== "string" ||
    typeof javascript !== "string"
  ) {
    throw new OpenRouterError(
      "Model response missing required fields: html, css, javascript.",
      502,
      "invalid_response",
    );
  }

  if (html.trim().length === 0) {
    throw new OpenRouterError(
      "Model returned empty HTML.",
      502,
      "invalid_response",
    );
  }

  return { html, css, javascript };
}

export async function generateWebsite(
  messages: Message[],
  model: string,
): Promise<WebsiteResult> {
  const apiKey = getEnv("OPENROUTER_API_KEY");

  const body: OpenRouterChatCompletion = {
    model,
    messages,
    temperature: 0.4,
    max_tokens: 8000,
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

    return parseWebsiteResult(content);
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

export { OpenRouterError };
