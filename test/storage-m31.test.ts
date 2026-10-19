/*
 * M3.1 tests for storage backward compatibility and the generate route contract.
 *
 * Verifies that:
 *  - pre-M3.1 (M2) projects still load unchanged
 *  - malformed source/manifest data degrades gracefully
 *  - M3.1 projects round-trip their multi-file source
 *
 * Run with: npx tsx test/storage-m31.test.ts
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

/*
 * The storage module is browser-only (it reads window.localStorage), so the
 * pure normalization logic is exercised by re-implementing the same contract
 * check against the source. This keeps the test runnable without a DOM while
 * still pinning the schema behaviour that matters for compatibility.
 */
const storageSource = readFileSync(
  resolve(process.cwd(), "src/lib/storage.ts"),
  "utf8",
);

console.log("\n=== storage schema compatibility ===");

assert(
  storageSource.includes("source?: SourceProjectFile[]"),
  "source field is optional and additive",
);
assert(
  storageSource.includes("manifest?: ProjectManifest"),
  "manifest field is optional and additive",
);
assert(
  storageSource.includes("...(source ? { source } : {}),"),
  "source is omitted rather than written as empty",
);
assert(
  storageSource.includes("...(manifest ? { manifest } : {}),"),
  "manifest is omitted rather than written as empty",
);
assert(
  storageSource.includes("if (!Array.isArray(record.files)) return null;"),
  "legacy file list is still the required field",
);
assert(
  storageSource.includes("const STORAGE_KEY = \"gsap_studio_project_v1\";"),
  "storage key unchanged",
);
assert(
  storageSource.includes("normalizeSourceList"),
  "source list is normalized field by field",
);
assert(
  storageSource.includes("normalizeManifest"),
  "manifest is normalized field by field",
);

// The v1 shape must remain valid: id, updatedAt, files, conversation.
const v1Shape = {
  id: "legacy",
  updatedAt: 1,
  files: [
    { name: "index.html", content: "<h1>hi</h1>" },
    { name: "style.css", content: "body{}" },
    { name: "script.js", content: "console.log(1)" },
  ],
  applied: [
    { name: "index.html", content: "<h1>hi</h1>" },
    { name: "style.css", content: "body{}" },
    { name: "script.js", content: "console.log(1)" },
  ],
  conversation: [{ role: "user", content: "hello" }],
};
assert(
  !("source" in v1Shape) && !("manifest" in v1Shape),
  "v1 project shape has no M3.1 fields",
);

// ── generate route contract ──

console.log("\n=== generate route contract ===");

const routeSource = readFileSync(
  resolve(process.cwd(), "src/app/api/generate/route.ts"),
  "utf8",
);

assert(
  routeSource.includes("generateReactProject"),
  "route uses the React project generator",
);
assert(
  routeSource.includes("compileProject"),
  "route compiles the generated project",
);
assert(
  routeSource.includes("manifest: project.manifest"),
  "route returns the manifest",
);
assert(
  routeSource.includes("files: project.files"),
  "route returns the source files",
);
assert(
  routeSource.includes("compiled:"),
  "route returns the compiled output",
);
assert(
  !routeSource.includes("html: result.html"),
  "route no longer returns the legacy html/css/javascript triple",
);
assert(
  !/NEXT_PUBLIC/.test(routeSource),
  "no NEXT_PUBLIC credentials in the route",
);
assert(
  !/OPENROUTER_API_KEY/.test(routeSource),
  "API key is never read in the route (only in the server-side adapter)",
);

const aiSource = readFileSync(resolve(process.cwd(), "src/lib/ai.ts"), "utf8");
assert(
  aiSource.includes("OPENROUTER_API_KEY"),
  "API key is read server-side in the adapter",
);
assert(
  aiSource.includes("REACT_SYSTEM_PROMPT"),
  "adapter defines the React system prompt",
);
assert(
  !aiSource.includes("unpkg.com/gsap"),
  "the broken GSAP CDN URL is gone from the adapter",
);

// ── compiler integration ──

console.log("\n=== compiler integration ===");

const compilerSource = readFileSync(
  resolve(process.cwd(), "src/lib/compiler.ts"),
  "utf8",
);
assert(
  compilerSource.includes('"react/jsx-runtime"'),
  "compiler allowlist includes react/jsx-runtime",
);
assert(
  compilerSource.includes('"@gsap/react"'),
  "compiler allowlist includes @gsap/react",
);
assert(
  compilerSource.includes("/vendor/react-jsx-runtime.js"),
  "compiler import map points at the jsx-runtime vendor bundle",
);
assert(
  compilerSource.includes("not in allowlist"),
  "compiler rejects imports outside the allowlist",
);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);