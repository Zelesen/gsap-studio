/*
 * Server-side design brief generation route.
 *
 * Accepts a conversation + current project state, builds skill-aware
 * prompts, calls the AI provider for raw text, strictly parses JSON, and
 * validates the result with validateDesignBrief. Credentials are never
 * exposed to the browser.
 */

import { generateRawCompletion, type Message, type AIProvider } from "@/lib/ai";
import { buildGenerationMessages } from "@/lib/prompt-assembly";
import { validateDesignBrief, type DesignBrief } from "@/lib/design-brief";
import { NextRequest, NextResponse } from "next/server";

interface DesignBriefRequest {
  model?: string;
  provider?: AIProvider;
  messages: Array<{ role: string; content: string }>;
}

interface DesignBriefResponse {
  ok: boolean;
  brief?: DesignBrief;
  model?: string;
  error?: string;
  type?: string;
  status?: number;
}

/**
 * POST /api/design-brief
 * Body: { model?, provider?, messages[] }
 *
 * Generates a validated design brief from the conversation. Uses skill-aware
 * prompts and raw provider output; the response is strictly parsed as JSON
 * and validated against the design brief contract.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const modelFromEnv = process.env.OPENROUTER_MODEL?.trim();

  let body: DesignBriefRequest;
  try {
    body = (await req.json()) as DesignBriefRequest;
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

  const provider = (body.provider || process.env.AI_PROVIDER || undefined) as
    | AIProvider
    | undefined;

  let model: string;
  if (body.model) {
    model = body.model;
  } else if (provider === "google") {
    model = process.env.GOOGLE_MODEL?.trim() || "gemini-3.6-flash";
  } else if (provider === "openai") {
    model = "gpt-4o-mini";
  } else {
    model = modelFromEnv || "openrouter/free";
  }

  // Extract the user's latest request text for skill selection.
  const userRequest = body.messages
    .slice()
    .reverse()
    .find((m) => m.role === "user")
    ?.content ?? "";

  // Build skill-aware messages. No design brief context yet (this is the
  // first planning step); no current project state needed for brief gen.
  const { messages } = await buildGenerationMessages({
    userRequest,
    messages: body.messages as Message[],
    designBrief: null,
    wantsScrollAnimation: /scroll|parallax|pin|scrub/.test(
      userRequest.toLowerCase(),
    ),
    usesReactAndGsap: true,
  });

  try {
    const raw = await generateRawCompletion(messages, model, { provider });

    // Strictly parse JSON from the raw model output.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Try to extract a JSON object from within the text.
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        try {
          parsed = JSON.parse(raw.slice(start, end + 1));
        } catch {
          return NextResponse.json<DesignBriefResponse>(
            {
              ok: false,
              error: "Model returned invalid JSON that could not be parsed.",
              type: "invalid_response",
              status: 502,
            },
            { status: 502 },
          );
        }
      } else {
        return NextResponse.json<DesignBriefResponse>(
          {
            ok: false,
            error: "Model returned no parseable JSON object.",
            type: "invalid_response",
            status: 502,
          },
          { status: 502 },
        );
      }
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json<DesignBriefResponse>(
        {
          ok: false,
          error: "Model response is not a JSON object.",
          type: "invalid_response",
          status: 502,
        },
        { status: 502 },
      );
    }

    const validated = validateDesignBrief(parsed);
    if (!validated.ok) {
      return NextResponse.json<DesignBriefResponse>(
        {
          ok: false,
          error: `Brief validation failed: ${validated.error}`,
          type: "invalid_response",
          status: 502,
        },
        { status: 502 },
      );
    }

    return NextResponse.json<DesignBriefResponse>({
      ok: true,
      brief: validated.value,
      model,
    });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "status" in err) {
      const e = err as { status?: number; message?: string; type?: string };
      return NextResponse.json(
        {
          ok: false,
          error: e.message || "Design brief generation failed.",
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