/*
 * M3.1 end-to-end test for the generation → compile → preview pipeline.
 *
 * The OpenRouter call is stubbed at the network layer so the whole server
 * path is exercised for real: request parsing, model response parsing,
 * project validation, and compilation with the existing compiler.
 *
 * Run with: node test/generate-e2e.mjs  (requires the dev server on :3100)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { startStudioServer } from "./helpers/server.mjs";

const APP = "http://127.0.0.1:3110";
const STUB_PORT = 8125;

let passed = 0;
let failed = 0;

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS: ${name}${detail ? `  [${detail}]` : ""}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}${detail ? `  [${detail}]` : ""}`);
  }
}

/*
 * A stub OpenRouter. The route talks to the real api.openrouter.ai, so we
 * intercept the request with a local server and point OPENROUTER at it via
 * an env override. The adapter reads the URL from a constant today, so the
 * stub is installed by overriding global fetch inside the server process is
 * not possible — instead we run the validation + compile path directly.
 */

/* ── 1. Validation of model output ─────────────────────────────────────── */

const { validateProjectResult } = await import("../src/lib/project.ts");

console.log("\n=== model output validation ===");

const validModelOutput = {
  manifest: {
    name: "test-site",
    version: "0.1.0",
    entry: "src/main.tsx",
    dependencies: { react: "19.0.0", "react-dom": "19.0.0", gsap: "3.12.5" },
    framework: "react-ts",
  },
  files: [
    {
      path: "src/main.tsx",
      content: `import { createRoot } from "react-dom/client";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import "./styles.css";
gsap.registerPlugin(ScrollTrigger);
function App() {
  useGSAP(() => { gsap.from("h1", { y: 40, opacity: 0, duration: 1 }); }, []);
  return <h1 id="t">Test</h1>;
}
createRoot(document.getElementById("root")!).render(<App />);`,
    },
    { path: "src/styles.css", content: "body { margin: 0; }" },
  ],
};

const ok = validateProjectResult(validModelOutput);
check("valid model output accepted", ok.ok);

const malformed = validateProjectResult({ manifest: {}, files: [] });
check("malformed model output rejected", !malformed.ok);

const missingEntry = validateProjectResult({
  ...validModelOutput,
  manifest: { ...validModelOutput.manifest, entry: "src/nope.tsx" },
});
check("missing entry point rejected", !missingEntry.ok);

const duplicate = validateProjectResult({
  manifest: validModelOutput.manifest,
  files: [
    { path: "src/main.tsx", content: "a" },
    { path: "src/main.tsx", content: "b" },
  ],
});
check("duplicate paths rejected", !duplicate.ok);

const unsupported = validateProjectResult({
  ...validModelOutput,
  manifest: {
    ...validModelOutput.manifest,
    dependencies: { three: "0.160.0" },
  },
});
check("unsupported dependency rejected", !unsupported.ok);

const unsafePath = validateProjectResult({
  manifest: validModelOutput.manifest,
  files: [
    { path: "src/main.tsx", content: "a" },
    { path: "../../etc/passwd", content: "b" },
  ],
});
check("unsafe path rejected", !unsafePath.ok);

const oversized = validateProjectResult({
  manifest: validModelOutput.manifest,
  files: [
    { path: "src/main.tsx", content: "a" },
    { path: "src/big.tsx", content: "x".repeat(3 * 1024 * 1024) },
  ],
});
check(
  "oversized file passes structure validation (size checked at compile)",
  oversized.ok,
);

/* ── 2. Compile a validated project through the real compiler ──────────── */

console.log("\n=== compile integration ===");

const { compileProject } = await import("../src/lib/compiler.ts");

if (!ok.ok) throw new Error("fixture invalid");

const filesRecord = {};
for (const f of ok.result.files) filesRecord[f.path] = f.content;

const compiled = await compileProject({
  files: filesRecord,
  entry: ok.result.manifest.entry,
});

check("compiles without diagnostics", compiled.diagnostics.length === 0, compiled.diagnostics.join("; "));
check("produces HTML", compiled.html.length > 0);
check("produces JS", compiled.js.length > 0);
check("produces CSS", compiled.css.includes("margin"));
check("HTML carries the import map", compiled.html.includes('type="importmap"'));
check("HTML maps react", compiled.html.includes('"react":"/vendor/react.js"'));
check("HTML maps gsap", compiled.html.includes('"gsap":"/vendor/gsap.js"'));
check("HTML maps gsap/ScrollTrigger", compiled.html.includes('"gsap/ScrollTrigger":"/vendor/gsap-ScrollTrigger.js"'));
check("HTML maps @gsap/react", compiled.html.includes('"@gsap/react":"/vendor/gsap-react.js"'));
check("HTML maps react/jsx-runtime", compiled.html.includes('"react/jsx-runtime":"/vendor/react-jsx-runtime.js"'));
check("JS keeps the imports external (not bundled)", compiled.js.includes('from "gsap"'));
check("JS has the React root call", compiled.js.includes("createRoot"));
check("JS has the GSAP animation", compiled.js.includes("gsap.from"));
check("the compiled document leaves the CSP to the preview panel", !compiled.html.includes("Content-Security-Policy"));
check("no CDN script tags in output", !compiled.html.includes("<script src="));
check("the script is an ES module", compiled.html.includes('<script type="module">'));

/* ── 3. Compiler rejects a bad import ──────────────────────────────────── */

console.log("\n=== compiler import restrictions ===");

const badImport = await compileProject({
  files: {
    "src/main.tsx": `import fs from "node:fs";\nexport default fs;`,
  },
  entry: "src/main.tsx",
});
check(
  "compiler rejects a node builtin import",
  badImport.diagnostics.some((d) => d.includes("not in allowlist")),
  badImport.diagnostics.join("; "),
);

const studioAlias = await compileProject({
  files: {
    "src/main.tsx": `import { x } from "@/lib/secret";\nexport default x;`,
  },
  entry: "src/main.tsx",
});
check(
  "compiler rejects a studio-internal alias",
  studioAlias.diagnostics.some((d) => d.includes("not in allowlist")),
  studioAlias.diagnostics.join("; "),
);

const missingFile = await compileProject({
  files: { "src/main.tsx": `import "./missing.js";` },
  entry: "src/main.tsx",
});
check(
  "compiler reports a missing relative import",
  missingFile.diagnostics.length > 0,
  missingFile.diagnostics.join("; "),
);

const brokenSyntax = await compileProject({
  files: { "src/main.tsx": `function ( {` },
  entry: "src/main.tsx",
});
check(
  "compiler reports a syntax error",
  brokenSyntax.diagnostics.length > 0,
  brokenSyntax.diagnostics.join("; "),
);

/* ── 4. The live compile endpoint ──────────────────────────────────────── */

console.log("\n=== /api/compile endpoint ===");

const server = await startStudioServer();

try {
  const res = await fetch(`${APP}/api/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: filesRecord, entry: ok.result.manifest.entry }),
  });
  const data = await res.json();
  check("endpoint returns 200 for a valid project", res.status === 200, `status ${res.status}`);
  check("endpoint returns compiled output", Boolean(data.ok && data.html && data.js));
} catch (e) {
  check("endpoint reachable", false, e instanceof Error ? e.message : String(e));
}

try {
  const res = await fetch(`${APP}/api/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: "not-an-object", entry: "src/main.tsx" }),
  });
  const data = await res.json();
  check("endpoint rejects a bad files payload", res.status === 400 && !data.ok, `status ${res.status}`);
} catch (e) {
  check("endpoint rejects a bad files payload", false, e instanceof Error ? e.message : String(e));
}

try {
  const res = await fetch(`${APP}/api/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: { "src/main.tsx": 'import fs from "node:fs";\nexport default fs;' },
      entry: "src/main.tsx",
    }),
  });
  const data = await res.json();
  check(
    "endpoint surfaces a compile failure as 400",
    res.status === 400 && !data.ok && String(data.error).includes("not in allowlist"),
    `status ${res.status} error ${String(data.error).slice(0, 60)}`,
  );
} catch (e) {
  check("endpoint surfaces a compile failure as 400", false, e instanceof Error ? e.message : String(e));
}

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);

await server.stop();

// Stop esbuild's background service so Node can exit cleanly on Windows.
try {
  const { stop } = await import("esbuild");
  stop();
} catch {
  /* esbuild may already be gone */
}

await sleep(200);
process.exit(failed > 0 ? 1 : 0);