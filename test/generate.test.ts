/*
 * M3.1 tests for AI generation validation.
 *
 * Tests the project manifest validation, file validation, and project
 * result validation logic in src/lib/project.ts.
 *
 * Run with: npx tsx test/generate.test.ts
 */
import {
  validateManifest,
  validateProjectFile,
  validateProjectResult,
  APPROVED_IMPORTS,
  isApprovedImport,
} from "@/lib/project";

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

// ── validateManifest tests ──

console.log("\n=== validateManifest ===");

// Valid manifest
const validManifest = {
  name: "my-project",
  version: "0.1.0",
  entry: "src/main.tsx",
  dependencies: { react: "19.0.0", "react-dom": "19.0.0", gsap: "3.12.5" },
  framework: "react-ts",
};
const r1 = validateManifest(validManifest);
assert(r1.ok, "valid manifest passes");
if (r1.ok) assert(r1.manifest.name === "my-project", "manifest name preserved");

// Missing name
const r2 = validateManifest({ ...validManifest, name: "" });
assert(!r2.ok, "empty name rejected");
if (!r2.ok) assert(r2.error.includes("name"), "error mentions name");

// Missing version
const r3 = validateManifest({ ...validManifest, version: "" });
assert(!r3.ok, "empty version rejected");

// Missing entry
const r4 = validateManifest({ ...validManifest, entry: "" });
assert(!r4.ok, "empty entry rejected");

// Entry not .tsx/.ts
const r5 = validateManifest({ ...validManifest, entry: "src/main.js" });
assert(!r5.ok, "non-ts entry rejected");

// Wrong framework
const r6 = validateManifest({ ...validManifest, framework: "vue-ts" as any });
assert(!r6.ok, "wrong framework rejected");

// Unapproved dependency
const r7 = validateManifest({
  ...validManifest,
  dependencies: { "three": "0.160.0" },
});
assert(!r7.ok, "unapproved dependency rejected");
if (!r7.ok) assert(r7.error.includes("three"), "error mentions dependency");

// Missing dependencies object
const r8 = validateManifest({ ...validManifest, dependencies: null as any });
assert(!r8.ok, "null dependencies rejected");

// ── validateProjectFile tests ──

console.log("\n=== validateProjectFile ===");

const r9 = validateProjectFile({ path: "src/main.tsx", content: "export {}" });
assert(r9.ok, "valid file passes");
if (r9.ok) assert(r9.file.path === "src/main.tsx", "path normalized");

// Path traversal
const r10 = validateProjectFile({ path: "../../etc/passwd", content: "x" });
assert(!r10.ok, "path traversal rejected");

// Absolute path
const r11 = validateProjectFile({ path: "/etc/passwd", content: "x" });
assert(!r11.ok, "absolute path rejected");

// Empty path
const r12 = validateProjectFile({ path: "", content: "x" });
assert(!r12.ok, "empty path rejected");

// Missing content
const r13 = validateProjectFile({ path: "src/main.tsx" } as any);
assert(!r13.ok, "missing content rejected");

// Too deep (9 segments > 8 limit)
const r14 = validateProjectFile({
  path: "src/components/ui/button/index/sub/deep/path/file.ts",
  content: "x",
});
assert(!r14.ok, "too deep path rejected");
if (!r14.ok) assert(r14.error.includes("too deep"), "error mentions depth");

// ── validateProjectResult tests ──

console.log("\n=== validateProjectResult ===");

const validResult = {
  manifest: validManifest,
  files: [
    { path: "src/main.tsx", content: "export {}" },
    { path: "src/App.tsx", content: "export const App = () => null" },
    { path: "src/styles.css", content: "body {}" },
  ],
};
const r15 = validateProjectResult(validResult);
assert(r15.ok, "valid project result passes");
if (r15.ok) assert(r15.result.files.length === 3, "all files preserved");

// Missing entry point
const r16 = validateProjectResult({
  ...validResult,
  manifest: { ...validManifest, entry: "src/missing.tsx" },
});
assert(!r16.ok, "missing entry point rejected");

// Duplicate paths
const r17 = validateProjectResult({
  manifest: validManifest,
  files: [
    { path: "src/main.tsx", content: "a" },
    { path: "src/main.tsx", content: "b" },
  ],
});
assert(!r17.ok, "duplicate paths rejected");

// Empty files
const r18 = validateProjectResult({
  manifest: validManifest,
  files: [],
});
assert(!r18.ok, "empty files rejected");

// ── isApprovedImport tests ──

console.log("\n=== isApprovedImport ===");

assert(isApprovedImport("react"), "react approved");
assert(isApprovedImport("react-dom"), "react-dom approved");
assert(isApprovedImport("react-dom/client"), "react-dom/client approved");
assert(isApprovedImport("react/jsx-runtime"), "react/jsx-runtime approved");
assert(isApprovedImport("gsap"), "gsap approved");
assert(isApprovedImport("gsap/ScrollTrigger"), "gsap/ScrollTrigger approved");
assert(isApprovedImport("@gsap/react"), "@gsap/react approved");
assert(!isApprovedImport("three"), "three not approved");
assert(!isApprovedImport("react-dom/server"), "react-dom/server not approved");
assert(!isApprovedImport("fs"), "fs not approved");
assert(isApprovedImport("gsap/ScrollTrigger"), "gsap/ScrollTrigger approved (prefix)");
assert(isApprovedImport("gsap/MotionPathPlugin"), "gsap/MotionPathPlugin approved (prefix)");

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);