/*
 * M3.6 tests for provider-backed design brief and task-plan generation.
 *
 * The provider transport is stubbed at the `fetch` boundary, so the real
 * adapter, the real route handlers and the real validators all run — but
 * every request is answered locally. No paid or real-provider request is
 * ever made, and no API key is required: the adapter is called with
 * `skipAuthCheck` so a missing key is a placeholder instead of a failure.
 *
 * Run with: npx tsx test/m36-planning-routes.test.ts
 */

import { NextRequest } from "next/server";
import { generateRawCompletion, type AIError } from "@/lib/ai";
import { validateDesignBrief } from "@/lib/design-brief";
import { validateTaskPlan } from "@/lib/task-plan";
import { POST as designBriefRoute } from "../src/app/api/design-brief/route";
import { POST as taskPlanRoute } from "../src/app/api/task-plan/route";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}

/* ── deterministic transport stub ─────────────────────────────────────── */

interface StubReply {
  status: number;
  body: string;
}

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

let reply: StubReply = { status: 200, body: "" };
let requests: CapturedRequest[] = [];

globalThis.fetch = (async (
  input: unknown,
  init?: RequestInit,
): Promise<Response> => {
  const url =
    typeof input === "string"
      ? input
      : String((input as { url?: string } | null)?.url ?? input);
  const rawBody = typeof init?.body === "string" ? init.body : "";
  let body: Record<string, unknown> = {};
  try {
    body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  requests.push({ url, body });
  return new Response(reply.body, {
    status: reply.status,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

function stubChatContent(content: string): StubReply {
  return {
    status: 200,
    body: JSON.stringify({ choices: [{ message: { content } }] }),
  };
}

async function rawCompletion(
  replyValue: StubReply,
  model = "test-model",
): Promise<string> {
  reply = replyValue;
  return generateRawCompletion(
    [{ role: "user", content: "test request" }],
    model,
    { provider: "openrouter", skipAuthCheck: true },
  );
}

/* ── Main tests ────────────────────────────────────────────────────────── */

(async () => {
  // ── Valid raw text completion ─────────────────────────────────────

  console.log("\n=== generateRawCompletion ===");

  {
    const expectedBody = JSON.stringify({ brief: "valid" });
    const content = await rawCompletion(stubChatContent(expectedBody));
    assert(content === expectedBody, "raw text content is returned as-is");
  }

  // The request itself is shaped like an OpenAI-compatible chat completion.
  {
    requests = [];
    await rawCompletion(stubChatContent("{}"), "model-under-test");
    const sent = requests[0];
    assert(requests.length === 1, "exactly one provider request is made");
    assert(
      typeof sent?.url === "string" && sent.url.includes("chat/completions"),
      "the request targets the provider chat endpoint",
    );
    assert(
      sent?.body.model === "model-under-test",
      "the request carries the requested model",
    );
    assert(
      Array.isArray(sent?.body.messages) &&
        (sent?.body.messages as unknown[]).length === 1,
      "the request carries the conversation messages",
    );
  }

  // ── Provider error surfaces with status code ──────────────────────────

  {
    let threw = false;
    let status = 0;
    try {
      await rawCompletion({
        status: 502,
        body: JSON.stringify({ error: { message: "bad gateway", type: "upstream_error", code: 502 } }),
      });
    } catch (err) {
      threw = true; const e = err as AIError; status = e.status;
    }
    assert(threw, "provider error throws");
    assert(status === 502, "provider error carries HTTP status");
  }

  // ── Missing content ───────────────────────────────────────────────────

  {
    let threw = false;
    try {
      await rawCompletion({
        status: 200, body: JSON.stringify({ choices: [{ message: { content: null } }] }),
      });
    } catch { threw = true; }
    assert(threw, "null content throws");
  }

  // ── Design brief validation ───────────────────────────────────────────

  console.log("\n=== validateDesignBrief ===");

  const validBrief = {
    purpose: "A landing page", audience: "Users",
    contentGoals: ["Value"], visualDirection: { typography: "Inter", color: "black", layout: "centered" },
    sections: [{ name: "Hero", intent: "Promise" }], recommendedSections: [{ name: "Pricing", reason: "Buyers expect it" }],
    interactions: ["Reveals"], responsive: ["Single column below 768px"],
    accessibility: ["Focus visible"], constraints: ["No stock"],
    assumptions: ["Placeholder"], clarifyingQuestions: [],
  };

  const briefOk = validateDesignBrief(validBrief);
  assert(briefOk.ok, "complete brief validates");
  if (briefOk.ok) {
    assert(briefOk.value.purpose === validBrief.purpose, "purpose preserved");
    assert(briefOk.value.audience === validBrief.audience, "audience preserved");
  }
  assert(!validateDesignBrief({ ...validBrief, purpose: "  " }).ok, "blank purpose rejected");

  // ── Task plan validation ─────────────────────────────────────────────

  console.log("\n=== validateTaskPlan ===");

  const validPlan = {
    id: "plan-1", createdAt: 1000, status: "draft",
    brief: validBrief,
    tasks: [{ id: "t1", title: "Task", description: "Desc", position: 0, dependencies: [], acceptanceCriteria: ["C"], expectedFiles: ["f.tsx"] }],
  };
  assert(validateTaskPlan(validPlan).ok, "complete task plan validates");
  assert(!validateTaskPlan({ ...validPlan, tasks: [] }).ok, "empty task list rejected");

  // ── Malformed responses ──────────────────────────────────────────────

  console.log("\n=== malformed responses ===");

  {
    let threw = false;
    try { await rawCompletion({ status: 200, body: "not json" }); } catch { threw = true; }
    assert(threw, "invalid response throws");
  }
  {
    let threw = false;
    try { await rawCompletion({ status: 200, body: JSON.stringify([1,2,3]) }); } catch { threw = true; }
    assert(threw, "JSON array throws");
  }

  // ── Planning routes (mocked provider) ────────────────────────────────

  console.log("\n=== /api/design-brief (mocked provider) ===");

  // The routes resolve their own credentials, so a placeholder key is set
  // for the duration of the route tests. The transport is still the stub.
  process.env.OPENROUTER_API_KEY = "test-key";

  {
    reply = stubChatContent(JSON.stringify(validBrief));
    const res = await designBriefRoute(
      new NextRequest("http://localhost/api/design-brief", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "a landing page" }] }),
      }),
    );
    const data = (await res.json()) as { ok: boolean; brief?: { purpose?: string } };
    assert(res.status === 200, "a valid brief returns 200");
    assert(data.ok === true, "a valid brief returns ok");
    assert(data.brief?.purpose === validBrief.purpose, "the route returns the validated brief");
  }

  {
    reply = stubChatContent(JSON.stringify({ purpose: "no audience" }));
    const res = await designBriefRoute(
      new NextRequest("http://localhost/api/design-brief", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "a landing page" }] }),
      }),
    );
    const data = (await res.json()) as { ok: boolean; type?: string };
    assert(res.status === 502, "an invalid brief returns 502");
    assert(data.ok === false && data.type === "invalid_response", "an invalid brief is reported as an invalid response");
  }

  {
    const res = await designBriefRoute(
      new NextRequest("http://localhost/api/design-brief", {
        method: "POST",
        body: JSON.stringify({ messages: [] }),
      }),
    );
    assert(res.status === 400, "an empty conversation returns 400");
  }

  console.log("\n=== /api/task-plan (mocked provider) ===");

  {
    reply = stubChatContent(
      JSON.stringify({
        tasks: [
          { id: "scaffold", title: "Scaffold", description: "Set up the app", position: 0, dependencies: [], acceptanceCriteria: ["It mounts"], expectedFiles: ["src/main.tsx"] },
          { id: "hero", title: "Hero", description: "Build the hero", position: 1, dependencies: ["scaffold"], acceptanceCriteria: ["Hero renders"], expectedFiles: ["src/sections/Hero.tsx"] },
        ],
      }),
    );
    const res = await taskPlanRoute(
      new NextRequest("http://localhost/api/task-plan", {
        method: "POST",
        body: JSON.stringify({ brief: validBrief }),
      }),
    );
    const data = (await res.json()) as {
      ok: boolean;
      plan?: { tasks: Array<{ id: string; dependencies: string[] }>; status: string; brief: { purpose: string } };
    };
    assert(res.status === 200, "a valid plan returns 200");
    assert(data.ok === true, "a valid plan returns ok");
    assert(data.plan?.tasks.length === 2, "the route returns both tasks");
    assert(data.plan?.tasks[1]?.dependencies[0] === "scaffold", "dependencies survive the round trip");
    assert(data.plan?.status === "draft", "a generated plan starts as a draft");
    assert(data.plan?.brief.purpose === validBrief.purpose, "the validated brief is attached to the plan");
  }

  {
    reply = stubChatContent("not json at all");
    const res = await taskPlanRoute(
      new NextRequest("http://localhost/api/task-plan", {
        method: "POST",
        body: JSON.stringify({ brief: validBrief }),
      }),
    );
    const data = (await res.json()) as { ok: boolean; type?: string };
    assert(res.status === 502, "unparseable model output returns 502");
    assert(data.ok === false && data.type === "invalid_response", "unparseable model output is reported as an invalid response");
  }

  {
    const res = await taskPlanRoute(
      new NextRequest("http://localhost/api/task-plan", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    assert(res.status === 400, "a missing brief returns 400");
  }

  // ── Results ───────────────────────────────────────────────────────────

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})();
