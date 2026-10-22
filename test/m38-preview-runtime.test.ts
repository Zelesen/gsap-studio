/*
 * M3.5 tests for the preview runtime contract.
 *
 * The preview renders a generated project inside a sandboxed iframe. Two
 * rules decide whether that preview works, and both are checked here:
 *
 *  - the runtime imports are normalized, so a namespace import of GSAP
 *    ("import * as gsap from \"gsap\"") cannot break the preview with
 *    "gsap.registerPlugin is not a function" — the module namespace has no
 *    registerPlugin;
 *  - a compiled project is one self-contained document, so the preview does
 *    not inject the ESM bundle a second time as a classic script.
 *
 * The compiler runs locally on fixtures — no paid or real-provider request is
 * made and no browser is started.
 *
 * Run with: npx tsx test/m38-preview-runtime.test.ts
 */

import { assembleDocument } from "@/components/studio/PreviewPanel";
import { compileProject } from "@/lib/compiler";
import { normalizeRuntimeImports } from "@/lib/imports";

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

/* ── import normalization ──────────────────────────────────────────────── */

console.log("\n=== import normalization ===");

{
  assert(
    normalizeRuntimeImports('import * as gsap from "gsap";') ===
      'import { gsap } from "gsap";',
    "a namespace import of gsap becomes a named import",
  );

  assert(
    normalizeRuntimeImports("import * as G from 'gsap';") ===
      "import { gsap as G } from 'gsap';",
    "the local binding is preserved",
  );

  assert(
    normalizeRuntimeImports('import * as ST from "gsap/ScrollTrigger";') ===
      'import { ScrollTrigger as ST } from "gsap/ScrollTrigger";',
    "a namespace import of ScrollTrigger becomes a named import",
  );

  assert(
    normalizeRuntimeImports('import { gsap } from "gsap";') ===
      'import { gsap } from "gsap";',
    "a named import is left alone",
  );

  assert(
    normalizeRuntimeImports('import gsap from "gsap";') ===
      'import gsap from "gsap";',
    "a default import is left alone",
  );

  assert(
    normalizeRuntimeImports('import * as React from "react";') ===
      'import * as React from "react";',
    "React's namespace is left alone — it does expose the API",
  );

  assert(
    normalizeRuntimeImports('import type * as Types from "gsap";') ===
      'import type * as Types from "gsap";',
    "a type-only import is left alone",
  );

  assert(
    normalizeRuntimeImports('const gsap = "not an import";') ===
      'const gsap = "not an import";',
    "unrelated code is left alone",
  );
}

/* ── the compiler ───────────────────────────────────────────────────────── */

console.log("\n=== compiled project runs ===");

const NAMESPACE_PROJECT: Record<string, string> = {
  "src/main.tsx": `import { createRoot } from "react-dom/client";
import * as gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

function App() {
  return <h1 id="title">Hello</h1>;
}

createRoot(document.getElementById("root")!).render(<App />);
`,
  "src/styles.css": "body { margin: 0; }\n",
};

async function main(): Promise<void> {
  const compiled = await compileProject({
    files: NAMESPACE_PROJECT,
    entry: "src/main.tsx",
  });

  assert(
    compiled.diagnostics.length === 0,
    "the project compiles",
    compiled.diagnostics.join("; "),
  );
  assert(
    compiled.js.includes('import { gsap } from "gsap"'),
    "the namespace import is normalized in the compiled output",
  );
  assert(
    !compiled.js.includes("import * as gsap"),
    "no namespace import of gsap reaches the browser",
  );
  assert(
    compiled.html.includes('type="importmap"'),
    "the compiled document carries the import map",
  );
  assert(
    compiled.html.includes('<script type="module">'),
    "the compiled document carries the module script",
  );

  /* ── stylesheets ──────────────────────────────────────────────────────── */

  console.log("\n=== stylesheets ===");

  {
    /*
     * `url("")` is an ordinary reset. esbuild routes every CSS url token
     * through onResolve, where it arrives as an *empty* path — the package
     * allowlist used to reject it with "Import '' not in allowlist" and
     * failed the whole build.
     */
    const compiled = await compileProject({
      files: {
        "src/main.tsx": 'import "./styles.css";\n\nexport default 1;\n',
        "src/styles.css": '.reset { background-image: url(""); }\n',
      },
      entry: "src/main.tsx",
    });

    assert(
      compiled.errors.length === 0,
      "an empty url() does not fail the build",
      compiled.errors.join("; "),
    );
    assert(
      !compiled.diagnostics.some((d) => d.includes("not in allowlist")),
      "the package allowlist does not see CSS urls",
    );
    assert(compiled.css.includes("url("), "the stylesheet is still compiled");
  }

  {
    const compiled = await compileProject({
      files: {
        "src/main.tsx": 'import "./styles.css";\n\nexport default 1;\n',
        "src/styles.css": [
          ".a { background-image: url(data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>); }",
          ".b { background-image: url(/images/hero.png); }",
          ".c { background-image: url(./hero.png); }",
          ".d { background-image: url(https://example.com/a.png); }",
          ".e { background-image: url(#gradient); }",
        ].join("\n"),
      },
      entry: "src/main.tsx",
    });

    assert(
      compiled.errors.length === 0,
      "no css url() form fails the build",
      compiled.errors.join("; "),
    );
    assert(
      compiled.css.includes("/images/hero.png"),
      "an absolute url is kept as authored",
    );
    assert(
      compiled.css.includes("#gradient"),
      "a fragment url is kept as authored",
    );
    assert(
      compiled.css.includes("https://example.com/a.png"),
      "a remote url is kept as authored",
    );
  }

  {
    const compiled = await compileProject({
      files: {
        "src/main.tsx": 'import "./styles.css";\n\nexport default 1;\n',
        "src/styles.css": '@import "./other.css";\n.a { color: red; }\n',
        "src/other.css": ".other { color: blue; }\n",
      },
      entry: "src/main.tsx",
    });

    assert(
      compiled.errors.length === 0,
      "a relative @import compiles",
      compiled.errors.join("; "),
    );
    assert(
      compiled.css.includes("color: blue"),
      "an imported stylesheet is bundled into the output",
    );
  }

  {
    /*
     * A warning is not a failure. The unquoted data url above makes esbuild
     * warn about the url token, but the build produced output — the compile
     * must not be rejected over it.
     */
    const compiled = await compileProject({
      files: {
        "src/main.tsx": 'import "./styles.css";\n\nexport default 1;\n',
        "src/styles.css":
          ".a { background-image: url(data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>); }\n",
      },
      entry: "src/main.tsx",
    });

    assert(
      compiled.diagnostics.length > 0,
      "the warning is reported",
      compiled.diagnostics.join("; "),
    );
    assert(
      compiled.errors.length === 0,
      "the warning does not become an error",
      compiled.errors.join("; "),
    );
    assert(compiled.css.length > 0, "the stylesheet still compiled");
  }

  {
    // The JavaScript package allowlist still applies.
    const compiled = await compileProject({
      files: {
        "src/main.tsx": 'import lodash from "lodash";\n\nexport default lodash;\n',
      },
      entry: "src/main.tsx",
    });

    assert(
      compiled.errors.length === 1,
      "a package outside the allowlist is still refused",
      compiled.errors.join("; "),
    );
    assert(
      compiled.errors[0]?.includes("not in allowlist"),
      "the refusal names the allowlist",
      compiled.errors[0] ?? "",
    );
  }

  /* ── the preview document ─────────────────────────────────────────────── */

  console.log("\n=== preview document assembly ===");

  {
    const assembled = assembleDocument({
      html: compiled.html,
      css: compiled.css,
      javascript: compiled.js,
      nonce: 1,
    });

    assert(
      assembled.includes("base-uri 'none'"),
      "the CSP is injected into the compiled document",
    );
    assert(
      (assembled.match(/<script type="module">/g) ?? []).length === 1,
      "the module script is not duplicated",
    );
    assert(
      (assembled.match(/import \{ createRoot \}/g) ?? []).length === 1,
      "the ESM bundle appears once — inside the module script only",
    );
    assert(
      !/<\/body>\s*<script>\s*import/.test(assembled),
      "no classic script carries an import statement",
    );
  }

  {
    // A legacy project is html + css + javascript and still needs the parts.
    const assembled = assembleDocument({
      html:
        "<html><head><title>Legacy</title></head><body><h1>hi</h1></body></html>",
      css: "body { color: red; }",
      javascript: "console.log('hi');",
      nonce: 2,
    });

    assert(
      assembled.includes("body { color: red; }"),
      "a legacy project still gets its stylesheet",
    );
    assert(
      assembled.includes("console.log('hi');"),
      "a legacy project still gets its script",
    );
    assert(
      assembled.includes("base-uri 'none'"),
      "a legacy project still gets the CSP",
    );
  }

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

void main();
