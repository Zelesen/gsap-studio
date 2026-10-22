/*
 * M3.5 tests for the task runner.
 *
 * Covers the execution rules of src/lib/task-runner.ts:
 *  - sequential execution, one task at a time, dependencies respected
 *  - dependency blocking (the provider is never called)
 *  - validation failures and compile failures leave the source untouched
 *  - recompiling unchanged source is not execution
 *  - a failed task can be retried and counts as a new attempt
 *  - plan progress persists through the project storage schema
 *  - the last valid preview survives a failed run
 *  - the route refuses a concurrent run for the same plan
 *
 * The provider is mocked at the `fetch` boundary and the compiler runs
 * locally on fixtures — no paid or real-provider request is made.
 *
 * Run with: npx tsx test/m37-task-runner.test.ts
 */

import { NextRequest } from "next/server";
import { compileProject, type CompileInput, type CompileResult } from "@/lib/compiler";
import { runTask, type TaskRunnerDeps } from "@/lib/task-runner";
import { approvePlan, validateTaskPlan, type TaskPlan } from "@/lib/task-plan";
import { loadProject, saveProject } from "@/lib/storage";
import { POST as taskRunRoute } from "../src/app/api/task-run/route";
import type { ProjectFile, ProjectManifest } from "@/lib/project";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${name}${detail ? `  [${detail}]` : ""}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}${detail ? `  [${detail}]` : ""}`);
  }
}

/* ── fixtures ─────────────────────────────────────────────────────────── */

const BRIEF = {
  purpose: "A landing page for a SaaS analytics product",
  audience: "Startup founders and product marketers",
  contentGoals: ["Explain the value", "Drive a signup"],
  visualDirection: {
    typography: "Inter",
    color: "near-black with electric accents",
    layout: "centered hero",
  },
  sections: [{ name: "Hero", intent: "State the promise" }],
  recommendedSections: [],
  interactions: ["Scroll-triggered reveals"],
  responsive: ["Single column below 768px"],
  accessibility: ["Focus visible on every interactive element"],
  constraints: ["No stock photography"],
  assumptions: ["Copy is placeholder"],
  clarifyingQuestions: [],
};

const MANIFEST: ProjectManifest = {
  name: "runner-site",
  version: "0.1.0",
  entry: "src/main.tsx",
  dependencies: { react: "19.0.0", gsap: "3.12.5" },
  framework: "react-ts",
};

const APP_SOURCE = `export default function App() {
  return <main><h1>Hello</h1></main>;
}`;

const BASE_FILES: ProjectFile[] = [
  {
    path: "src/main.tsx",
    content: `import { createRoot } from "react-dom/client";
import App from "./App";
createRoot(document.getElementById("root")!).render(<App />);`,
  },
  { path: "src/App.tsx", content: APP_SOURCE },
];

const HERO_SOURCE = `export default function App() {
  return <main><h1>Build faster</h1><p>Ship the site.</p></main>;
}`;

const FEATURES_SOURCE = `export default function App() {
  return <main><h1>Build faster</h1><ul><li>One</li></ul></main>;
}`;

interface TaskSpec {
  id: string;
  dependencies?: string[];
  title?: string;
}

function buildPlan(tasks: TaskSpec[], approved: boolean): TaskPlan {
  const check = validateTaskPlan({
    id: "plan-runner",
    createdAt: 1000,
    status: "draft",
    brief: BRIEF,
    tasks: tasks.map((task, index) => ({
      id: task.id,
      title: task.title ?? task.id,
      description: `Implement ${task.id}`,
      position: index,
      dependencies: task.dependencies ?? [],
      acceptanceCriteria: [`${task.id} works`],
      expectedFiles: ["src/App.tsx"],
    })),
  });
  if (!check.ok) throw new Error(check.error);
  if (!approved) return check.value;
  const approvedPlan = approvePlan(check.value);
  if (!approvedPlan.ok) throw new Error(approvedPlan.error);
  return approvedPlan.value;
}

/**
 * A provider that answers with a fixed payload and records every call.
 *
 * A list of payloads is answered in order (the last one repeats), so a
 * sequence of tasks can be served with a different edit per task — the same
 * edit twice would change nothing, which the runner refuses as "no_changes".
 */
function mockProvider(payload: unknown) {
  const calls: string[] = [];
  const queue = Array.isArray(payload) ? payload : [payload];
  const generate = async (messages: Array<{ content: string }>) => {
    calls.push(messages.map((message) => message.content).join("\n"));
    const answer = queue[Math.min(calls.length - 1, queue.length - 1)];
    return typeof answer === "string" ? answer : JSON.stringify(answer);
  };
  return { generate, calls };
}

/** A compiler that always succeeds. */
const mockCompile = async (): Promise<CompileResult> => ({
  html: "<html><body><div id=\"root\"></div></body></html>",
  js: "// compiled",
  css: "",
  diagnostics: [],
  errors: [],
});

function deps(
  generate: (messages: Array<{ content: string }>) => Promise<string>,
  compile: (input: CompileInput) => Promise<CompileResult> = mockCompile,
): TaskRunnerDeps {
  return {
    generate: generate as TaskRunnerDeps["generate"],
    compile,
    now: () => 4242,
  };
}

function editPayload(content: string, summary = "Updated the app.") {
  return {
    files: [{ path: "src/App.tsx", content }],
    summary,
  };
}

/* ── in-memory localStorage shim ── */

const store = new Map<string, string>();

(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  },
};

const LEGACY_FILES = [
  { name: "index.html", content: "<h1>hi</h1>" },
  { name: "style.css", content: "body{}" },
  { name: "script.js", content: "console.log(1)" },
];

async function main(): Promise<void> {
  /* ── sequential execution ─────────────────────────────────────────── */

  console.log("\n=== sequential execution ===");

  {
    const plan = buildPlan(
      [
        { id: "hero" },
        { id: "features", dependencies: ["hero"] },
      ],
      true,
    );
    const provider = mockProvider([
      editPayload(HERO_SOURCE),
      editPayload(FEATURES_SOURCE),
    ]);

    const first = await runTask(
      {
        plan,
        manifest: MANIFEST,
        files: BASE_FILES,
        approvedTasks: ["hero", "features"],
        model: "test-model",
      },
      deps(provider.generate),
    );

    assert(first.ok, "the first task completes");
    if (first.ok) {
      const task = first.plan.tasks.find((t) => t.id === "hero");
      assert(task?.status === "completed", "the first task is marked completed");
      assert(
        task?.verification?.ok === true,
        "the completed task carries a verification result",
      );
      assert(
        task?.verification?.checkedAt === 4242,
        "the verification is stamped with the injected clock",
      );
      assert(
        first.files.some((file) => file.content === HERO_SOURCE),
        "the new source tree carries the edit",
      );
      assert(
        first.files.some((file) => file.path === "src/main.tsx"),
        "the untouched files survive the edit",
      );
    }

    const second = await runTask(
      {
        plan: first.ok ? first.plan : plan,
        manifest: MANIFEST,
        files: first.ok ? first.files : BASE_FILES,
        approvedTasks: ["hero", "features"],
        model: "test-model",
      },
      deps(provider.generate),
    );

    assert(second.ok, "the dependent task runs after the first one");
    if (second.ok) {
      assert(
        second.plan.tasks.every((task) => task.status === "completed"),
        "both tasks are completed",
      );
      assert(second.plan.status === "completed", "the plan is completed");
    }
    assert(provider.calls.length === 2, "the provider was called once per task");
    assert(
      provider.calls[0]?.includes("TASK: hero"),
      "the first call carries the first task",
    );
    assert(
      provider.calls[1]?.includes("TASK: features"),
      "the second call carries the second task",
    );
    assert(
      provider.calls[0]?.includes("CURRENT PROJECT SOURCE"),
      "the provider receives the current source tree",
    );
  }

  /* ── dependency blocking ──────────────────────────────────────────── */

  console.log("\n=== dependency blocking ===");

  {
    const plan = buildPlan(
      [
        { id: "hero" },
        { id: "features", dependencies: ["hero"] },
      ],
      true,
    );
    const provider = mockProvider(editPayload(FEATURES_SOURCE));

    const blocked = await runTask(
      {
        plan,
        manifest: MANIFEST,
        files: BASE_FILES,
        taskId: "features",
        model: "test-model",
      },
      deps(provider.generate),
    );

    assert(!blocked.ok, "a task with unmet dependencies is refused");
    if (!blocked.ok) {
      assert(blocked.type === "blocked", "the refusal is reported as blocked");
      assert(
        blocked.error.includes("hero"),
        "the refusal names the blocking dependency",
      );
    }
    assert(provider.calls.length === 0, "the provider is not called");
    if (!blocked.ok) {
      const task = blocked.plan.tasks.find((t) => t.id === "features");
      assert(
        task?.status === "planned",
        "the blocked task keeps its planned status",
      );
    }
  }

  {
    /*
     * Auto-selection must not pick a task whose dependency is unfinished.
     *
     * The selection follows the dependency graph (`nextReadyTask`), not the
     * position order: "features" waits for "hero", so "hero" is the task that
     * may run — the same task the Studio's "Run next" button picks.
     */
    const plan = buildPlan(
      [
        { id: "features", dependencies: ["hero"] },
        { id: "hero" },
      ],
      true,
    );
    const provider = mockProvider(editPayload(HERO_SOURCE));
    const selected = await runTask(
      {
        plan,
        manifest: MANIFEST,
        files: BASE_FILES,
        model: "test-model",
      },
      deps(provider.generate),
    );
    assert(selected.ok, "the task whose dependencies are met runs");
    assert(
      provider.calls.length === 1,
      "exactly one task is sent to the provider",
    );
    assert(
      provider.calls[0]?.includes("TASK: hero"),
      "the blocked task is not the one that runs",
    );
    assert(
      !provider.calls[0]?.includes("TASK: features"),
      "the task with an unfinished dependency is skipped",
    );
    if (selected.ok) {
      const blockedTask = selected.plan.tasks.find((t) => t.id === "features");
      assert(
        blockedTask?.status === "planned",
        "the blocked task keeps its planned status",
      );
    }
  }

  /* ── approval gate ────────────────────────────────────────────────── */

  console.log("\n=== approval gate ===");

  {
    const draft = buildPlan([{ id: "hero" }], false);
    const provider = mockProvider(editPayload(HERO_SOURCE));
    const result = await runTask(
      {
        plan: draft,
        manifest: MANIFEST,
        files: BASE_FILES,
        model: "test-model",
      },
      deps(provider.generate),
    );
    assert(!result.ok, "a draft plan is not executed");
    if (!result.ok) {
      assert(result.type === "not_approved", "the draft plan is refused");
    }
    assert(provider.calls.length === 0, "the provider is not called");
  }

  {
    const plan = buildPlan([{ id: "hero" }], true);
    const provider = mockProvider(editPayload(HERO_SOURCE));
    const result = await runTask(
      {
        plan,
        manifest: MANIFEST,
        files: BASE_FILES,
        approvedTasks: ["other-task"],
        model: "test-model",
      },
      deps(provider.generate),
    );
    assert(!result.ok, "a task outside the approved list is refused");
    if (!result.ok) {
      assert(result.type === "not_approved", "the refusal is an approval error");
    }
    assert(provider.calls.length === 0, "the provider is not called");
  }

  /* ── validation failure ───────────────────────────────────────────── */

  console.log("\n=== validation failure ===");

  {
    const plan = buildPlan([{ id: "hero" }], true);
    const provider = mockProvider({
      files: [{ path: "../../etc/passwd", content: "nope" }],
      summary: "Edited something.",
    });
    const result = await runTask(
      {
        plan,
        manifest: MANIFEST,
        files: BASE_FILES,
        model: "test-model",
      },
      deps(provider.generate),
    );
    assert(!result.ok, "an invalid edit is refused");
    if (!result.ok) {
      assert(result.type === "invalid_edit", "the refusal is an invalid edit");
      assert(
        !("files" in result),
        "a failed run hands back no source tree",
      );
      const task = result.plan.tasks.find((t) => t.id === "hero");
      assert(task?.status === "failed", "the task is marked failed");
      assert(
        typeof task?.error === "string" && task.error.length > 0,
        "the failed task keeps an error summary",
      );
    }
  }

  {
    // An edit that drops the entry point must not be applied.
    const plan = buildPlan([{ id: "hero" }], true);
    const provider = mockProvider({
      files: [{ path: "src/App.tsx", content: HERO_SOURCE }],
      summary: "Dropped the entry.",
    });
    const result = await runTask(
      {
        plan,
        manifest: MANIFEST,
        files: BASE_FILES.filter((file) => file.path !== "src/main.tsx"),
        model: "test-model",
      },
      deps(provider.generate),
    );
    assert(!result.ok, "a tree without its entry point is refused");
    if (!result.ok) {
      assert(result.type === "invalid_edit", "the refusal is an invalid edit");
    }
  }

  /* ── unchanged source is not execution ────────────────────────────── */

  console.log("\n=== unchanged source ===");

  {
    const plan = buildPlan([{ id: "hero" }], true);
    const provider = mockProvider(editPayload(APP_SOURCE));
    const result = await runTask(
      {
        plan,
        manifest: MANIFEST,
        files: BASE_FILES,
        model: "test-model",
      },
      deps(provider.generate),
    );
    assert(!result.ok, "an unchanged tree is not a completed task");
    if (!result.ok) {
      assert(result.type === "no_changes", "the refusal reports no changes");
    }
    assert(provider.calls.length === 1, "the provider was still called once");
  }

  /* ── the applied source is the source that runs ─────────────────────── */

  console.log("\n=== runtime imports ===");

  {
    /*
     * A namespace import of GSAP compiles but cannot run: the preview's
     * import map hands the code the module namespace, which has no
     * `registerPlugin`. The runner normalizes the edit, so the source it
     * stores is the source the preview can run.
     */
    const plan = buildPlan([{ id: "hero" }], true);
    const provider = mockProvider(
      editPayload(`import * as gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export default function App() {
  return <main><h1>Build faster</h1></main>;
}`),
    );
    const result = await runTask(
      {
        plan,
        manifest: MANIFEST,
        files: BASE_FILES,
        model: "test-model",
      },
      deps(provider.generate, compileProject),
    );
    assert(result.ok, "the task with a namespace import still completes");
    if (result.ok) {
      const app = result.files.find((file) => file.path === "src/App.tsx");
      const content = app?.content ?? "";
      assert(
        content.includes('import { gsap } from "gsap"'),
        "the stored source uses the import that runs",
      );
      assert(
        !content.includes("import * as gsap"),
        "no namespace import of gsap is stored",
      );
      assert(
        result.compiled.js.includes('import { gsap } from "gsap"'),
        "the compiled preview uses the import that runs",
      );
    }
  }

  /* ── compile failure (real compiler, local fixture) ───────────────── */

  console.log("\n=== compile failure ===");

  {
    const plan = buildPlan([{ id: "hero" }], true);
    const provider = mockProvider(
      editPayload("export default function App() { return <main><h1>Broken</main>; }"),
    );
    const result = await runTask(
      {
        plan,
        manifest: MANIFEST,
        files: BASE_FILES,
        model: "test-model",
      },
      deps(provider.generate, compileProject),
    );
    assert(!result.ok, "a tree that does not compile is refused");
    if (!result.ok) {
      assert(
        result.type === "compilation_error",
        "the refusal is a compilation error",
      );
      assert(
        result.error.includes("Compilation failed"),
        "the error summary names the failure",
      );
      assert(!("files" in result), "a failed compile hands back no source tree");
    }
  }

  /* ── retry ────────────────────────────────────────────────────────── */

  console.log("\n=== retry ===");

  {
    const plan = buildPlan([{ id: "hero" }], true);
    const broken = mockProvider({
      files: [{ path: "../escape.tsx", content: "nope" }],
      summary: "Broken edit.",
    });
    const first = await runTask(
      {
        plan,
        manifest: MANIFEST,
        files: BASE_FILES,
        model: "test-model",
      },
      deps(broken.generate),
    );
    assert(!first.ok, "the first attempt fails");

    const good = mockProvider(editPayload(HERO_SOURCE, "Added the hero."));
    const retry = await runTask(
      {
        plan: first.ok ? plan : first.plan,
        manifest: MANIFEST,
        files: BASE_FILES,
        taskId: "hero",
        model: "test-model",
      },
      deps(good.generate),
    );
    assert(retry.ok, "the retry succeeds");
    if (retry.ok) {
      assert(retry.task.attempts === 2, "the retry counts as a second attempt");
      assert(retry.task.status === "completed", "the retried task is completed");
      assert(
        !retry.task.error,
        "the stale error is cleared by the successful retry",
      );
    }
  }

  /* ── persistence ──────────────────────────────────────────────────── */

  console.log("\n=== persistence ===");

  {
    const plan = buildPlan([{ id: "hero" }, { id: "features", dependencies: ["hero"] }], true);
    const provider = mockProvider(editPayload(HERO_SOURCE));
    const result = await runTask(
      {
        plan,
        manifest: MANIFEST,
        files: BASE_FILES,
        approvedTasks: ["hero", "features"],
        model: "test-model",
      },
      deps(provider.generate),
    );
    assert(result.ok, "the task completed before it is stored");

    store.clear();
    saveProject({
      id: "persist",
      updatedAt: 0,
      files: LEGACY_FILES,
      applied: LEGACY_FILES,
      conversation: [],
      source: BASE_FILES,
      appliedSource: BASE_FILES,
      manifest: MANIFEST,
      designBrief: BRIEF,
      taskPlan: result.ok ? result.plan : plan,
      approvedTasks: ["hero", "features"],
    });

    const loaded = loadProject();
    assert(loaded !== null, "the project reloads");
    assert(
      loaded?.taskPlan?.tasks.find((task) => task.id === "hero")?.status ===
        "completed",
      "the task progress survives a reload",
    );
    assert(
      loaded?.taskPlan?.tasks.find((task) => task.id === "hero")?.verification?.ok ===
        true,
      "the verification result survives a reload",
    );
    assert(
      loaded?.taskPlan?.tasks.find((task) => task.id === "features")?.status ===
        "planned",
      "the untouched tasks survive a reload",
    );
    assert(
      loaded?.approvedTasks?.length === 2,
      "the approved task list survives a reload",
    );
    assert(
      loaded?.designBrief?.purpose === BRIEF.purpose,
      "the design brief survives a reload",
    );
  }

  {
    // A malformed stored plan degrades to "no plan" instead of throwing.
    store.clear();
    store.set(
      "gsap_studio_project_v1",
      JSON.stringify({
        id: "broken",
        updatedAt: 1,
        files: LEGACY_FILES,
        conversation: [],
        taskPlan: { id: "x", brief: { purpose: "no audience" }, tasks: [] },
        designBrief: { purpose: "" },
      }),
    );
    const loaded = loadProject();
    assert(loaded !== null, "a project with a broken plan still loads");
    assert(
      !("taskPlan" in (loaded ?? {})),
      "a malformed plan is dropped, not half-restored",
    );
    assert(
      !("designBrief" in (loaded ?? {})),
      "a malformed brief is dropped, not half-restored",
    );
    assert(loaded?.approvedTasks?.length === 0, "no tasks are approved");
  }

  /* ── last valid preview survives a failure ────────────────────────── */

  console.log("\n=== last valid preview ===");

  {
    const plan = buildPlan([{ id: "hero" }], true);
    const provider = mockProvider({
      files: [{ path: "src/App.tsx", content: "export default function App() { return <main>oops" }],
      summary: "Broken.",
    });
    const result = await runTask(
      {
        plan,
        manifest: MANIFEST,
        files: BASE_FILES,
        model: "test-model",
      },
      deps(provider.generate, compileProject),
    );
    assert(!result.ok, "the run failed");

    // The client keeps the last valid tree: only the plan progress changes.
    store.clear();
    saveProject({
      id: "last-valid",
      updatedAt: 0,
      files: LEGACY_FILES,
      applied: LEGACY_FILES,
      conversation: [],
      source: BASE_FILES,
      appliedSource: BASE_FILES,
      manifest: MANIFEST,
      designBrief: BRIEF,
      taskPlan: result.ok ? plan : result.plan,
      approvedTasks: ["hero"],
    });
    const loaded = loadProject();
    assert(
      JSON.stringify(loaded?.appliedSource) === JSON.stringify(BASE_FILES),
      "the last valid source survives the failed run",
    );
    assert(
      loaded?.taskPlan?.tasks.find((task) => task.id === "hero")?.status ===
        "failed",
      "the failed task is persisted with its error",
    );
    assert(
      typeof loaded?.taskPlan?.tasks.find((task) => task.id === "hero")?.error ===
        "string",
      "the error summary is persisted",
    );
  }

  /* ── the route ────────────────────────────────────────────────────── */

  console.log("\n=== /api/task-run (mocked provider) ===");

  {
    // The route resolves its own credentials; the transport is stubbed, so
    // nothing leaves the machine.
    process.env.OPENROUTER_API_KEY = "test-key";

    const originalFetch = globalThis.fetch;
    let reply = JSON.stringify(editPayload(HERO_SOURCE, "Added the hero."));
    let gate: Promise<void> | null = null;
    let release: () => void = () => {};
    let markCalled: () => void = () => {};

    globalThis.fetch = (async () => {
      markCalled();
      if (gate) await gate;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: reply } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const post = (body: unknown) =>
      taskRunRoute(
        new NextRequest("http://localhost/api/task-run", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );

    const plan = buildPlan([{ id: "hero" }], true);
    const body = {
      plan,
      approvedTasks: ["hero"],
      manifest: MANIFEST,
      files: BASE_FILES,
    };

    // A successful run returns the new tree and the compiled preview.
    {
      const res = await post(body);
      const data = (await res.json()) as {
        ok: boolean;
        files?: ProjectFile[];
        compiled?: { html: string; css: string; javascript: string };
        verification?: { ok: boolean };
        plan?: TaskPlan;
      };
      assert(res.status === 200, "a successful run returns 200");
      assert(data.ok === true, "a successful run returns ok");
      assert(
        data.files?.some((file) => file.content === HERO_SOURCE) === true,
        "the route returns the edited source tree",
      );
      assert(
        typeof data.compiled?.html === "string" && data.compiled.html.length > 0,
        "the route returns the compiled preview",
      );
      assert(data.verification?.ok === true, "the route returns the verification");
      assert(
        data.plan?.tasks.find((task) => task.id === "hero")?.status === "completed",
        "the route returns the updated plan",
      );
    }

    // A second, concurrent run for the same plan is refused.
    {
      const called = new Promise<void>((resolve) => {
        markCalled = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      gate = blocked;
      const first = post(body);
      await called;
      const second = await post(body);
      assert(second.status === 409, "a concurrent run for the same plan is refused");
      const data = (await second.json()) as { ok: boolean; type?: string };
      assert(data.ok === false, "the refusal is not ok");
      assert(data.type === "already_running", "the refusal is reported as a duplicate run");
      release();
      gate = null;
      await first;
      await blocked;
    }

    // A draft plan never reaches the provider.
    {
      reply = JSON.stringify(editPayload(HERO_SOURCE));
      const draft = buildPlan([{ id: "hero" }], false);
      const res = await post({ ...body, plan: draft });
      const data = (await res.json()) as { ok: boolean; type?: string };
      assert(res.status === 400, "a draft plan is refused with 400");
      assert(data.type === "not_approved", "the refusal is an approval error");
    }

    globalThis.fetch = originalFetch;
  }

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
