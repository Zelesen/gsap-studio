/*
 * Server-side AI generation route.
 *
 * Accepts a conversation + current code, calls OpenRouter, validates
 * the structured result, compiles it, and returns it to the client.
 * Credentials are never exposed to the browser.
 */

import { generateReactProject, type AIProvider, type Message, type ProjectResult } from "@/lib/ai";
import { buildGenerationMessages } from "@/lib/prompt-assembly";
import { compileProject, type CompileInput } from "@/lib/compiler";
import { NextRequest, NextResponse } from "next/server";

interface GenerateRequest {
  model?: string;
  provider?: "openrouter" | "openai" | "google";
  messages: Array<{ role: string; content: string }>;
  currentHtml?: string;
  currentCss?: string;
  currentJs?: string;
}

interface CompiledOutput {
  /**
   * The complete preview document: import map, inlined CSS and the compiled
   * module script. It is self-contained so the preview can render it without
   * re-assembling anything.
   */
  html: string;
  /** The raw CSS and JS bundles, kept for diagnostics and future tooling. */
  css: string;
  javascript: string;
}

interface GenerateResponse {
  ok: boolean;
  model?: string;
  manifest?: ProjectResult["manifest"];
  files?: ProjectResult["files"];
  compiled?: CompiledOutput;
  error?: string;
  type?: string;
  status?: number;
}

/**
 * POST /api/generate
 * Body: { model?, messages[], currentHtml?, currentCss?, currentJs? }
 *
 * Generates a multi-file React + TypeScript project, compiles it, and
 * returns both the raw project files and the compiled output ready for
 * the preview iframe.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const modelFromEnv = process.env.OPENROUTER_MODEL?.trim();

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

  // Build messages: trusted system prompt + supplemental skill guidance +
  // optional design brief + current project state + conversation. Skill
  // guidance is lower priority and cannot override the trusted system prompt.
  const { messages } = await buildGenerationMessages({
    userRequest,
    messages: body.messages as Message[],
    currentHtml: body.currentHtml,
    currentCss: body.currentCss,
    currentJs: body.currentJs,
    designBrief: null, // design-brief pipeline is out of scope for this phase.
    wantsScrollAnimation: /scroll|parallax|pin|scrub/.test(
      userRequest.toLowerCase()
    ),
    usesReactAndGsap: true,
  });

  try {
    const project = await generateReactProject(messages as never, model, {
      provider,
    });

    // Compile the generated project using the existing compiler pipeline.
    const filesRecord: Record<string, string> = {};
    for (const file of project.files) {
      filesRecord[file.path] = file.content;
    }

    const compileInput: CompileInput = {
      files: filesRecord,
      entry: project.manifest.entry,
    };

    const compiled = await compileProject(compileInput);

    if (compiled.errors.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Compilation failed: ${compiled.errors.join("\n")}`,
          type: "compilation_error",
          status: 400,
        },
        { status: 400 },
      );
    }

    return NextResponse.json<GenerateResponse>({
      ok: true,
      model,
      manifest: project.manifest,
      files: project.files,
      compiled: {
        /*
         * The compiled document already contains the CSS and the module
         * script, so it is handed over whole. The preview panel injects the
         * CSP and the error bridge into it exactly as it does for legacy
         * projects, so there is one owner for both.
         */
        html: compiled.html,
        css: "",
        javascript: "",
      },
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