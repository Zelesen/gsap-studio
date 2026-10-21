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
import { toGeminiContents } from "@/lib/ai";

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
if (!r6.ok) assert(r6.error.includes("vue-ts"), "error echoes the received value");

/*
 * The framework label is a constant for us, but models dress constants up.
 * Every react-flavoured spelling — and an absent key — must canonicalize
 * instead of killing an otherwise valid generation (this is the exact
 * failure behind "manifest.framework must be 'react-ts'").
 */
const fw1 = validateManifest({ ...validManifest, framework: "React" });
assert(fw1.ok, "capitalised framework accepted");
if (fw1.ok) assert(fw1.manifest.framework === "react-ts", "normalized to react-ts");

const fw2 = validateManifest({ ...validManifest, framework: " react-ts " });
assert(fw2.ok, "whitespace-padded framework accepted");

const fw3 = validateManifest({ ...validManifest, framework: "React TypeScript" });
assert(fw3.ok, "verbose framework spelling accepted");

const fw4 = validateManifest({ ...validManifest, framework: "reactjs" });
assert(fw4.ok, "reactjs alias accepted");

const fw5 = validateManifest({ ...validManifest, framework: undefined });
assert(fw5.ok, "missing framework defaults to react-ts");

const fw6 = validateManifest({ ...validManifest, framework: "" });
assert(fw6.ok, "blank framework defaults to react-ts");

const fw7 = validateManifest({ ...validManifest, framework: 42 });
assert(!fw7.ok, "non-string framework rejected");

const fw8 = validateManifest({ ...validManifest, framework: "svelte" });
assert(!fw8.ok, "non-react framework still rejected");

// Unapproved dependency
const r7 = validateManifest({
  ...validManifest,
  dependencies: { "three": "0.160.0" },
});
assert(!r7.ok, "unapproved dependency rejected");
if (!r7.ok) assert(r7.error.includes("three"), "error mentions dependency");

// ── Google (Gemini) helpers ──

const gm1 = toGeminiContents([
  { role: "system", content: "sys" },
  { role: "user", content: "hi" },
  { role: "assistant", content: "hello" },
]);
assert(
  gm1.length === 2 &&
    gm1[0].role === "user" &&
    gm1[1].role === "model" &&
    gm1[0].parts.length === 2,
  "system folds into user and consecutive user turns merge",
);

const gm2 = toGeminiContents([{ role: "system", content: "sys" }]);
assert(
  gm2.length === 1 && gm2[0].role === "user",
  "single system turn becomes one user turn",
);

// Missing dependencies object
const r8 = validateManifest({ ...validManifest, dependencies: null as any });
assert(!r8.ok, "null dependencies rejected");

/*
 * dependencies is another field models drop or mangle. An absent key
 * defaults to the approved set (every key is compiler-approved); arrays of
 * strings or name/version objects are converted when mappable; null,
 * strings, numbers, and unmappable/empty arrays are still rejected.
 */
const dep1 = validateManifest({ ...validManifest, dependencies: undefined });
assert(dep1.ok, "missing dependencies defaulted to approved set");
if (dep1.ok) {
  assert(
    dep1.manifest.dependencies.react === "19.0.0",
    "defaulted dependencies contain react",
  );
  assert(
    dep1.manifest.dependencies.gsap === "3.12.5",
    "defaulted dependencies contain gsap",
  );
}

const dep2 = validateManifest({
  ...validManifest,
  dependencies: ["react", "gsap"],
});
assert(dep2.ok, "array of strings converted to dependency map");
if (dep2.ok) {
  assert(dep2.manifest.dependencies.react === "19.0.0", "string array maps react");
  assert(dep2.manifest.dependencies.gsap === "3.12.5", "string array maps gsap");
}

const dep2b = validateManifest({
  ...validManifest,
  dependencies: [
    { name: "react", version: "19.0.0" },
    { name: "gsap", version: "3.12.5" },
  ],
});
assert(dep2b.ok, "array of name/version objects converted");
if (dep2b.ok) {
  assert(
    dep2b.manifest.dependencies.react === "19.0.0",
    "object array maps react",
  );
  assert(
    dep2b.manifest.dependencies.gsap === "3.12.5",
    "object array maps gsap",
  );
}

const dep2c = validateManifest({
  ...validManifest,
  dependencies: ["unknown-pkg"],
});
assert(!dep2c.ok, "array with unmappable package rejected");

const dep2d = validateManifest({
  ...validManifest,
  dependencies: [{ name: "react" }],
});
assert(!dep2d.ok, "array entry without version rejected");

const dep2e = validateManifest({
  ...validManifest,
  dependencies: [],
});
assert(!dep2e.ok, "empty array rejected");

const dep3 = validateManifest({
  ...validManifest,
  dependencies: "react, gsap",
});
assert(!dep3.ok, "string dependencies rejected");
if (!dep3.ok) assert(dep3.error.includes('"react, gsap"'), "error echoes string");

const dep4 = validateManifest({ ...validManifest, dependencies: 42 });
assert(!dep4.ok, "number dependencies rejected");
if (!dep4.ok) assert(dep4.error.includes("number"), "error echoes number");

const dep5 = validateManifest({
  ...validManifest,
  dependencies: { react: 19 },
});
assert(!dep5.ok, "non-string dependency value rejected");
if (!dep5.ok) assert(dep5.error.includes("version must be a string"), "error mentions version");

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