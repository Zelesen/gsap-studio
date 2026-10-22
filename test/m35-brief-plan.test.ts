/*
 * M3.5 tests for the design brief and task plan contracts.
 *
 * Tests the hand-rolled validators in src/lib/design-brief.ts and
 * src/lib/task-plan.ts:
 *  - brief normalization and required fields
 *  - plan normalization, id handling, dense positions
 *  - dependency resolution, self-dependency and cycle rejection
 *  - determinism (same input -> same output, no clock/random ids)
 *
 * Run with: npx tsx test/m35-brief-plan.test.ts
 */
import {
  validateDesignBrief,
  formatDesignBrief,
} from "@/lib/design-brief";
import {
  validateTaskPlan,
  normalizePlanTask,
  hasDependencyCycle,
  orderTasks,
  nextReadyTask,
  dependenciesSatisfied,
} from "@/lib/task-plan";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}`);
  }
}

const baseBrief = {
  purpose: "A landing page for a SaaS analytics product",
  audience: "Startup founders and product marketers",
  contentGoals: ["Explain the value", "Drive a signup"],
  visualDirection: {
    typography: "Inter",
    color: "near-black with electric accents",
    layout: "centered hero, alternating feature bands",
  },
  sections: [
    { name: "Hero", intent: "State the promise" },
    { name: "Features", intent: "Show the three pillars" },
  ],
  recommendedSections: [{ name: "Pricing", reason: "Buyers expect it" }],
  interactions: ["Scroll-triggered reveals", "Parallax hero"],
  responsive: ["Single column below 768px"],
  accessibility: ["Focus visible on every interactive element"],
  constraints: ["No stock photography"],
  assumptions: ["Copy is placeholder"],
  clarifyingQuestions: [],
};

/** Build a plan payload with sensible defaults. */
function planPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    createdAt: 1000,
    status: "draft",
    brief: baseBrief,
    tasks: [
      {
        id: "scaffold",
        title: "Scaffold the app",
        description: "Create the React entry and stylesheet",
        position: 0,
        dependencies: [],
        acceptanceCriteria: ["App mounts without errors"],
        expectedFiles: ["src/main.tsx"],
      },
      {
        id: "hero",
        title: "Build the hero",
        description: "Hero section with the headline",
        position: 1,
        dependencies: ["scaffold"],
        acceptanceCriteria: ["Hero renders", "Animation fires on scroll"],
        expectedFiles: ["src/sections/Hero.tsx"],
      },
    ],
    ...overrides,
  };
}

// ── design brief ──

console.log("\n=== validateDesignBrief ===");

const briefCheck = validateDesignBrief(baseBrief);
assert(briefCheck.ok, "a complete brief validates");
assert(
  briefCheck.ok && briefCheck.value.sections.length === 2,
  "sections are preserved in order",
);
assert(
  briefCheck.ok && briefCheck.value.sections[0].name === "Hero",
  "the first section keeps its name",
);

const missingPurpose = validateDesignBrief({ ...baseBrief, purpose: "  " });
assert(!missingPurpose.ok, "a blank purpose is rejected");
assert(
  !missingPurpose.ok && missingPurpose.error.includes("purpose"),
  "the purpose error names the field",
);

const missingAudience = validateDesignBrief({ ...baseBrief, audience: "" });
assert(!missingAudience.ok, "a missing audience is rejected");

const notAnObject = validateDesignBrief("nope");
assert(!notAnObject.ok, "a non-object brief is rejected");

const messy = validateDesignBrief({
  purpose: "A site",
  audience: "Someone",
  contentGoals: ["ok", 42, "  ", null, "fine"],
  sections: "not-an-array",
  visualDirection: null,
});
assert(messy.ok, "a sparse brief still validates");
assert(
  messy.ok && messy.value.contentGoals.length === 2,
  "non-string list entries are dropped",
);
assert(
  messy.ok && messy.value.sections.length === 0,
  "a malformed section list becomes empty",
);
assert(
  messy.ok && messy.value.visualDirection.typography === "",
  "a malformed visual direction becomes empty strings",
);

const formatted = formatDesignBrief(baseBrief);
assert(formatted.includes("Purpose:"), "the formatted brief states the purpose");
assert(formatted.includes("Hero"), "the formatted brief lists the sections");

// ── task plan ──

console.log("\n=== validateTaskPlan ===");

const planCheck = validateTaskPlan(planPayload());
assert(planCheck.ok, "a well-formed plan validates");
assert(
  planCheck.ok && planCheck.value.tasks.length === 2,
  "the plan keeps both tasks",
);
assert(
  planCheck.ok && planCheck.value.tasks[0].position === 0,
  "the first task has position 0",
);
assert(
  planCheck.ok && planCheck.value.tasks[1].position === 1,
  "the second task has position 1",
);
assert(
  planCheck.ok && planCheck.value.status === "draft",
  "the plan status is preserved",
);

const emptyTasks = validateTaskPlan(planPayload({ tasks: [] }));
assert(!emptyTasks.ok, "an empty task list is rejected");

const badBrief = validateTaskPlan(planPayload({ brief: { purpose: "x" } }));
assert(!badBrief.ok, "an invalid brief fails the plan");
assert(
  !badBrief.ok && badBrief.error.startsWith("brief:"),
  "the brief error is prefixed for context",
);

const duplicateIds = validateTaskPlan(
  planPayload({
    tasks: [
      { id: "same", title: "One", position: 0 },
      { id: "same", title: "Two", position: 1 },
    ],
  }),
);
assert(!duplicateIds.ok, "duplicate task ids are rejected");

const selfDep = validateTaskPlan(
  planPayload({
    tasks: [{ id: "a", title: "A", position: 0, dependencies: ["a"] }],
  }),
);
assert(!selfDep.ok, "a self-dependency is rejected");
assert(
  !selfDep.ok && selfDep.error.includes("itself"),
  "the self-dependency error explains the problem",
);

const unknownDep = validateTaskPlan(
  planPayload({
    tasks: [{ id: "a", title: "A", position: 0, dependencies: ["ghost"] }],
  }),
);
assert(!unknownDep.ok, "a dependency on a missing task is rejected");

const cycle = validateTaskPlan(
  planPayload({
    tasks: [
      { id: "a", title: "A", position: 0, dependencies: ["b"] },
      { id: "b", title: "B", position: 1, dependencies: ["a"] },
    ],
  }),
);
assert(!cycle.ok, "a dependency cycle is rejected");

const twoActive = validateTaskPlan(
  planPayload({
    tasks: [
      { id: "a", title: "A", position: 0, status: "in_progress" },
      { id: "b", title: "B", position: 1, status: "verifying" },
    ],
  }),
);
assert(!twoActive.ok, "two simultaneously running tasks are rejected");

const completedUnverified = validateTaskPlan(
  planPayload({
    tasks: [{ id: "a", title: "A", position: 0, status: "completed" }],
  }),
);
assert(
  !completedUnverified.ok,
  "a completed task without verification is rejected",
);

const verified = validateTaskPlan(
  planPayload({
    tasks: [
      {
        id: "a",
        title: "A",
        position: 0,
        status: "completed",
        verification: { ok: true, summary: "built", checkedAt: 5 },
      },
    ],
  }),
);
assert(verified.ok, "a completed task with verification is accepted");
// ── positions and ordering ──

console.log("\n=== positions and ordering ===");

const sparsePositions = validateTaskPlan(
  planPayload({
    tasks: [
      { id: "a", title: "A", position: 0 },
      { id: "b", title: "B", position: 7 },
    ],
  }),
);
assert(sparsePositions.ok, "sparse positions are accepted and normalized");
assert(
  sparsePositions.ok && sparsePositions.value.tasks[1].position === 1,
  "positions are re-indexed to a dense sequence",
);

const swapped = validateTaskPlan(
  planPayload({
    tasks: [
      { id: "second", title: "Second", position: 5 },
      { id: "first", title: "First", position: 1 },
    ],
  }),
);
assert(swapped.ok, "out-of-order positions are accepted");
assert(
  swapped.ok && swapped.value.tasks[0].id === "first",
  "tasks are ordered by ascending position",
);
assert(
  swapped.ok && swapped.value.tasks[0].position === 0,
  "the re-ordered task is placed first",
);

const ties = validateTaskPlan(
  planPayload({
    tasks: [
      { id: "a", title: "A", position: 3 },
      { id: "b", title: "B", position: 3 },
    ],
  }),
);
assert(ties.ok, "tied positions are accepted");
assert(
  ties.ok &&
    ties.value.tasks[0].id === "a" &&
    ties.value.tasks[1].id === "b",
  "ties keep their input order",
);
assert(
  ties.ok &&
    ties.value.tasks[0].position === 0 &&
    ties.value.tasks[1].position === 1,
  "tied positions are given distinct dense positions",
);

// ── deterministic ids ──

console.log("\n=== deterministic ids ===");

const noIds = validateTaskPlan(
  planPayload({
    tasks: [
      { title: "One", position: 0 },
      { title: "Two", position: 1 },
    ],
  }),
);
assert(noIds.ok, "tasks without ids are accepted");
assert(
  noIds.ok && noIds.value.tasks[0].id === "task-1",
  "a missing id falls back to an index-derived id",
);

const noIdsAgain = validateTaskPlan(
  planPayload({
    tasks: [
      { title: "One", position: 0 },
      { title: "Two", position: 1 },
    ],
  }),
);
assert(noIdsAgain.ok, "the same plan validates a second time");
assert(
  noIdsAgain.ok &&
    noIds.ok &&
    JSON.stringify(noIdsAgain.value) === JSON.stringify(noIds.value),
  "validating the same plan twice yields identical output",
);

const collision = validateTaskPlan(
  planPayload({
    tasks: [
      { id: "task-2", title: "Explicit", position: 0 },
      { title: "Fallback", position: 1 },
    ],
  }),
);
assert(collision.ok, "a fallback id colliding with an explicit id is resolved");
assert(
  collision.ok && collision.value.tasks[1].id === "task-2-2",
  "the fallback id avoids the explicit id",
);

const fallbackCollides = validateTaskPlan(
  planPayload({
    tasks: [
      { id: "task-1", title: "Explicit", position: 0 },
      { title: "Fallback", position: 1 },
    ],
  }),
);
assert(fallbackCollides.ok, "an explicit task-1 does not break validation");
assert(
  fallbackCollides.ok && fallbackCollides.value.tasks[1].id === "task-2",
  "a free fallback id is used as-is",
);

const noPlanId = validateTaskPlan(
  planPayload({ id: undefined, createdAt: undefined }),
);
assert(noPlanId.ok, "a plan without an id validates");
assert(
  noPlanId.ok &&
    typeof noPlanId.value.id === "string" &&
    noPlanId.value.id.length > 0,
  "a missing plan id gets a deterministic fallback",
);
assert(
  noPlanId.ok && noPlanId.value.createdAt === 0,
  "a missing timestamp falls back to 0 rather than the clock",
);

// ── helpers ──

console.log("\n=== plan helpers ===");

const normalized = normalizePlanTask({ title: "  Trimmed  " }, "fallback", 2);
assert(normalized.id === "fallback", "normalizePlanTask honours the fallback id");
assert(normalized.title === "Trimmed", "normalizePlanTask trims the title");
assert(normalized.position === 2, "normalizePlanTask honours the fallback position");
assert(normalized.status === "planned", "normalizePlanTask defaults the status");

const acyclic = hasDependencyCycle(
  new Map([
    ["a", ["b"]],
    ["b", []],
  ]),
);
assert(acyclic === null, "an acyclic graph reports no cycle");

const cyclic = hasDependencyCycle(
  new Map([
    ["a", ["b"]],
    ["b", ["a"]],
  ]),
);
assert(cyclic !== null, "a cyclic graph reports the cycle path");

const helperPlan = planCheck.ok ? planCheck.value : null;
assert(helperPlan !== null, "the helper plan is available");
if (helperPlan) {
  const first = helperPlan.tasks[0];
  const second = helperPlan.tasks[1];
  assert(dependenciesSatisfied(helperPlan, first), "the first task has no unmet deps");
  assert(
    !dependenciesSatisfied(helperPlan, second),
    "the second task waits for the first",
  );
  assert(
    nextReadyTask(helperPlan)?.id === first.id,
    "the next ready task is the first one",
  );
  const ordered = orderTasks(helperPlan.tasks);
  assert(
    ordered[0].id === first.id && ordered[1].id === second.id,
    "orderTasks returns tasks in position order",
  );
}

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
