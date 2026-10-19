/*
 * Server-side AI generation route.
 *
 * Accepts a conversation + current code, calls OpenRouter, validates
 * the structured result, compiles it, and returns it to the client.
 * Credentials are never exposed to the browser.
 */

import { generateReactProject, REACT_SYSTEM_PROMPT, type ProjectResult } from "@/lib/ai";
import { compileProject, type CompileInput } from "@/lib/compiler";
import { NextRequest, NextResponse } from "next/server";

interface GenerateRequest {
  model?: string;
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
    { role: "system", content: REACT_SYSTEM_PROMPT },
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
      content: `CURRENT PROJECT STATE (compiled output):\n--- HTML ---\n${body.currentHtml || "(empty)"}\n--- CSS ---\n${body.currentCss || "(empty)"}\n--- JAVASCRIPT ---\n${body.currentJs || "(empty)"}\n--- END ---\nModify this code to fulfill the user's request. Preserve what is working and only change what is needed.`,
    });
  }

  messages.push(...body.messages);

  try {
    const project = await generateReactProject(messages as never, model);

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

    if (compiled.diagnostics.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Compilation failed: ${compiled.diagnostics.join("\n")}`,
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