/*
 * Server-side task plan generation route.
 *
 * Accepts a validated design brief plus conversation context, builds
 * skill-aware prompts, calls the AI provider for raw text, strictly parses
 * JSON, and validates the result with validateTaskPlan. Credentials are
 * never exposed to the browser.
 */

import { generateRawCompletion, type Message, type AIProvider } from "@/lib/ai";
import { buildGenerationMessages } from "@/lib/prompt-assembly";
import { validateTaskPlan, type TaskPlan } from "@/lib/task-plan";
import { validateDesignBrief, type DesignBrief } from "@/lib/design-brief";
import { NextRequest, NextResponse } from "next/server";

interface TaskPlanRequest {
  model?: string;
  provider?: AIProvider;
  brief: DesignBrief;
  messages?: Array<{ role: string; content: string }>;
}

interface TaskPlanResponse {
  ok: boolean;
  plan?: TaskPlan;
  model?: string;
  error?: string;
  type?: string;
  status?: number;
}

/**
 * POST /api/task-plan
 * Body: { model?, provider?, brief, messages? }
 *
 * Generates a validated task plan from a design brief. Uses skill-aware
 * prompts and raw provider output; the response is strictly parsed as JSON
 * and validated against the task plan contract.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const modelFromEnv = process.env.OPENROUTER_MODEL?.trim();

  let body: TaskPlanRequest;
  try {
    body = (await req.json()) as TaskPlanRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  if (!body.brief) {
    return NextResponse.json(
      { error: "brief is required." },
      { status: 400 },
    );
  }

  // Validate the incoming brief before using it as context.
  const briefCheck = validateDesignBrief(body.brief);
  if (!briefCheck.ok) {
    return NextResponse.json(
      { error: `Invalid brief: ${briefCheck.error}` },
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

  // Build the user-facing request text from the brief + optional messages.
  const briefText = `Design brief: ${briefCheck.value.purpose} — audience: ${briefCheck.value.audience}. Sections: ${briefCheck.value.sections.map((s) => s.name).join(", ")}.`;
  const userRequest = body.messages?.slice().reverse().find((m) => m.role === "user")?.content ?? briefText;

  // Build skill-aware messages with the validated brief as context.
  const { messages } = await buildGenerationMessages({
    userRequest,
    messages: (body.messages as Message[]) ?? [],
    designBrief: JSON.stringify(briefCheck.value),
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
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        try {
          parsed = JSON.parse(raw.slice(start, end + 1));
        } catch {
          return NextResponse.json<TaskPlanResponse>(
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
        return NextResponse.json<TaskPlanResponse>(
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
      return NextResponse.json<TaskPlanResponse>(
        {
          ok: false,
          error: "Model response is not a JSON object.",
          type: "invalid_response",
          status: 502,
        },
        { status: 502 },
      );
    }

    // The model is expected to return { tasks: [...] }; wrap with plan-level
    // fields so validateTaskPlan can normalize it.
    const planPayload = {
      id: undefined,
      createdAt: undefined,
      status: "draft",
      brief: briefCheck.value,
      ...parsed,
    };

    const validated = validateTaskPlan(planPayload);
    if (!validated.ok) {
      return NextResponse.json<TaskPlanResponse>(
        {
          ok: false,
          error: `Plan validation failed: ${validated.error}`,
          type: "invalid_response",
          status: 502,
        },
        { status: 502 },
      );
    }

    return NextResponse.json<TaskPlanResponse>({
      ok: true,
      plan: validated.value,
      model,
    });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "status" in err) {
      const e = err as { status?: number; message?: string; type?: string };
      return NextResponse.json(
        {
          ok: false,
          error: e.message || "Task plan generation failed.",
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