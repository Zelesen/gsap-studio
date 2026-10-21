/*
 * M3.2 tests: draft source vs. applied source.
 *
 * Verifies that:
 *  - `appliedSource` is optional and additive in the storage schema
 *  - pre-M3.2 (M3.1) blobs migrate: their single `source` becomes the
 *    applied copy, since it is what the preview was compiled from
 *  - M3.2 projects round-trip draft and applied source distinctly
 *  - legacy (pre-M3.1) blobs keep loading without either field
 *  - malformed appliedSource data degrades to the source fallback
 *  - the studio page only advances the applied source through
 *    /api/generate (fresh generation) or a successful /api/compile
 *
 * The storage module is exercised for real by shimming `window.localStorage`
 * — the module only touches window inside load/save, so the shim is installed
 * before the first call, not before import.
 *
 * Run with: npx tsx test/m32-source.test.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";

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

// ── in-memory localStorage shim ──

const store = new Map<string, string>();

const fakeLocalStorage = {
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
};

(globalThis as unknown as { window: unknown }).window = {
  localStorage: fakeLocalStorage,
};

const STORAGE_KEY = "gsap_studio_project_v1";

// The module body never touches window (only load/save do), so a static
// import is safe here — the shim below is installed before the first call.
import { loadProject, saveProject, clearProject } from "../src/lib/storage";

type LoadedProject = NonNullable<ReturnType<typeof loadProject>>;

function rawBlob(): Record<string, unknown> | null {
  const raw = store.get(STORAGE_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as Record<string, unknown>;
}

const FILES_V1 = [
  { name: "index.html", content: "<h1>hi</h1>" },
  { name: "style.css", content: "body{}" },
  { name: "script.js", content: "console.log(1)" },
];

const SOURCE = [
  { path: "src/main.tsx", content: "export const a = 1;" },
  {
    path: "src/App.tsx",
    content: "export default function App() { return null; }",
  },
];

const DRAFT_SOURCE = [
  { path: "src/main.tsx", content: "export const a = 2;" },
  {
    path: "src/App.tsx",
    content: "export default function App() { return null; }",
  },
  { path: "src/New.tsx", content: "export const added = true;" },
];

const MANIFEST = {
  name: "test-site",
  version: "0.1.0",
  entry: "src/main.tsx",
  dependencies: { react: "19.0.0", gsap: "3.12.5" },
  framework: "react-ts",
} as const;

// ── 1. schema shape ──

console.log("\n=== storage schema (source text) ===");

const storageSource = readFileSync(
  resolve(process.cwd(), "src/lib/storage.ts"),
  "utf8",
);

assert(
  storageSource.includes("appliedSource?: SourceProjectFile[]"),
  "appliedSource field is optional and additive",
);
assert(
  storageSource.includes("...(appliedSource ? { appliedSource } : {}),"),
  "appliedSource is omitted rather than written as empty",
);
assert(
  storageSource.includes("normalizeSourceList(record.appliedSource) ?? source"),
  "load falls back to source when appliedSource is absent",
);
assert(
  storageSource.includes(
    "normalizeSourceList(project.appliedSource) ?? source",
  ),
  "save applies the same fallback (migration on write)",
);
assert(
  storageSource.includes('const STORAGE_KEY = "gsap_studio_project_v1";'),
  "storage key unchanged",
);

// ── 2. real round-trips ──

console.log("\n=== migration & persistence (real load/save) ===");

// Pre-M3.2 M3.1 blob: source + manifest, no appliedSource.
store.set(
  STORAGE_KEY,
  JSON.stringify({
    id: "m31",
    updatedAt: 1,
    files: FILES_V1,
    conversation: [],
    source: SOURCE,
    manifest: MANIFEST,
  }),
);

let project: LoadedProject | null = loadProject();
assert(project !== null, "M3.1 blob loads");
assert(
  JSON.stringify(project?.source) === JSON.stringify(SOURCE),
  "M3.1 draft source preserved",
);
assert(
  JSON.stringify(project?.appliedSource) === JSON.stringify(SOURCE),
  "M3.1 blob migrates: source becomes the applied copy",
);

// Save the migrated project back and confirm the field is persisted.
if (project) saveProject(project);
let blob = rawBlob();
assert(
  JSON.stringify(blob?.appliedSource) === JSON.stringify(SOURCE),
  "migrated appliedSource is written on next save",
);

// Draft and applied diverge: a M3.2 project keeps both distinctly.
store.clear();
saveProject({
  id: "m32",
  updatedAt: 0,
  files: FILES_V1,
  applied: FILES_V1,
  conversation: [],
  source: DRAFT_SOURCE,
  appliedSource: SOURCE,
  manifest: MANIFEST,
});
project = loadProject();
assert(
  JSON.stringify(project?.source) === JSON.stringify(DRAFT_SOURCE),
  "draft source round-trips (edited tree)",
);
assert(
  JSON.stringify(project?.appliedSource) === JSON.stringify(SOURCE),
  "applied source round-trips unchanged (last good build)",
);
assert(
  JSON.stringify(project?.manifest) === JSON.stringify(MANIFEST),
  "manifest still round-trips alongside both copies",
);

// Save with source but no appliedSource: the fallback is applied on write,
// so the blob never claims an applied state it cannot name.
store.clear();
saveProject({
  id: "single",
  updatedAt: 0,
  files: FILES_V1,
  conversation: [],
  source: SOURCE,
  manifest: MANIFEST,
});
blob = rawBlob();
assert(
  JSON.stringify(blob?.appliedSource) === JSON.stringify(SOURCE),
  "save derives appliedSource from source when the caller has one copy",
);

// Legacy pre-M3.1 blob: neither field exists, neither is invented.
store.clear();
store.set(
  STORAGE_KEY,
  JSON.stringify({
    id: "legacy",
    updatedAt: 1,
    files: FILES_V1,
    conversation: [{ role: "user", content: "hello" }],
  }),
);
project = loadProject();
assert(project !== null, "legacy v1 blob loads");
assert(!("source" in (project ?? {})), "legacy blob has no source field");
assert(
  !("appliedSource" in (project ?? {})),
  "legacy blob has no appliedSource field",
);

// Save a legacy-shaped project: neither key is written.
store.clear();
saveProject({
  id: "legacy2",
  updatedAt: 0,
  files: FILES_V1,
  conversation: [],
});
blob = rawBlob();
assert(!("source" in (blob ?? {})), "save omits source when absent");
assert(
  !("appliedSource" in (blob ?? {})),
  "save omits appliedSource when there is no source to derive from",
);

// Malformed appliedSource degrades to the source fallback, never throws.
store.clear();
store.set(
  STORAGE_KEY,
  JSON.stringify({
    id: "bad",
    updatedAt: 1,
    files: FILES_V1,
    conversation: [],
    source: SOURCE,
    manifest: MANIFEST,
    appliedSource: "not-an-array",
  }),
);
project = loadProject();
assert(project !== null, "blob with malformed appliedSource still loads");
assert(
  JSON.stringify(project?.appliedSource) === JSON.stringify(SOURCE),
  "malformed appliedSource falls back to source",
);

store.clear();
store.set(
  STORAGE_KEY,
  JSON.stringify({
    id: "bad2",
    updatedAt: 1,
    files: FILES_V1,
    conversation: [],
    source: SOURCE,
    manifest: MANIFEST,
    appliedSource: [{ nope: true }, null, 42],
  }),
);
project = loadProject();
assert(
  JSON.stringify(project?.appliedSource) === JSON.stringify(SOURCE),
  "appliedSource with no valid entries falls back to source",
);

// Two distinct copies are never merged or reordered by a save/load cycle.
store.clear();
saveProject({
  id: "order",
  updatedAt: 0,
  files: FILES_V1,
  conversation: [],
  source: DRAFT_SOURCE,
  appliedSource: SOURCE,
  manifest: MANIFEST,
});
project = loadProject();
assert(
  project?.appliedSource?.[0]?.content === SOURCE[0].content &&
    project?.source?.[0]?.content === DRAFT_SOURCE[0].content,
  "two distinct copies are never merged or reordered",
);

clearProject();
assert(rawBlob() === null, "clearProject removes the stored blob");

// ── 3. studio page contract ──

console.log("\n=== studio apply pipeline (source text) ===");

const pageSource = readFileSync(
  resolve(process.cwd(), "src/app/studio/page.tsx"),
  "utf8",
);

assert(
  pageSource.includes('fetch("/api/compile"'),
  "Apply compiles the draft source through /api/compile",
);
assert(
  pageSource.includes("setAppliedSourceFiles(projectFiles)"),
  "successful compile advances the applied source",
);
assert(
  pageSource.includes("setAppliedSourceFiles(data.files ?? [])"),
  "generation seeds both copies from the generated files",
);
assert(
  pageSource.includes(
    "setAppliedSourceFiles(stored.appliedSource ?? stored.source ?? [])",
  ),
  "hydration restores appliedSource with the M3.1 fallback",
);
assert(
  pageSource.includes("appliedSource: appliedSourceFiles"),
  "both copies are persisted",
);

// Inside handleApply, the commit must come after the response check: a failed
// build never advances the applied source.
const applyStart = pageSource.indexOf("const handleApply");
const applyEnd = pageSource.indexOf("const handleRerender");
const applyBody = pageSource.slice(applyStart, applyEnd);
assert(applyStart > -1 && applyEnd > applyStart, "handleApply exists");
assert(
  applyBody.includes("if (!response.ok || !data.ok)"),
  "apply checks the compile response before committing",
);
const checkIdx = applyBody.indexOf("if (!response.ok || !data.ok)");
const commitIdx = applyBody.indexOf("setAppliedSourceFiles(projectFiles)");
assert(
  checkIdx > -1 && commitIdx > checkIdx,
  "applied source is only advanced after a successful build",
);
assert(
  applyBody.includes("setApplied(drafts)") &&
    applyBody.indexOf("setApplied(drafts)") <
      applyBody.indexOf("setIsCompiling(true)"),
  "legacy (no source) apply still copies drafts directly, before any compile",
);
assert(
  pageSource.includes("setAppliedSourceFiles([])"),
  "new project clears the applied source",
);

// ── 4. editor contract ──

console.log("\n=== editor source mode (source text) ===");

const panelSource = readFileSync(
  resolve(process.cwd(), "src/components/studio/CodePanel.tsx"),
  "utf8",
);

assert(
  panelSource.includes("source?: ProjectFile[]"),
  "panel accepts draft source files",
);
assert(
  panelSource.includes("appliedSource?: ProjectFile[]"),
  "panel accepts the applied source baseline",
);
assert(
  panelSource.includes("function diffSource"),
  "source dirty state is diffed by path and content",
);
assert(
  panelSource.includes(
    "if (!draftPaths.has(file.path)) changed.add(file.path)",
  ),
  "removed files count as not-yet-in-preview",
);
assert(
  panelSource.includes("isSourceMode"),
  "source mode takes over when source files exist",
);
assert(
  panelSource.includes("FILE_LABELS") && panelSource.includes("index.html"),
  "legacy three-tab editor is retained",
);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);

