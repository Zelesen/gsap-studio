/* Scratch: allowlist behaviour + diagnostics handling. */
import { compileProject } from "@/lib/compiler";

const cases: Array<[string, Record<string, string>]> = [
  [
    "lodash-unused",
    {
      "src/main.tsx": `import lodash from "lodash";\n\nexport default 1;\n`,
    },
  ],
  [
    "lodash-used",
    {
      "src/main.tsx": `import lodash from "lodash";\n\nexport default lodash;\n`,
    },
  ],
  [
    "evil-used",
    {
      "src/main.tsx": `import x from "some-evil-package";\n\nexport default x;\n`,
    },
  ],
  [
    "empty-url-only",
    {
      "src/main.tsx": `import "./styles.css";\n\nexport default 1;\n`,
      "src/styles.css": `.reset { background-image: url(""); }\n`,
    },
  ],
  [
    "url-space-only",
    {
      "src/main.tsx": `import "./styles.css";\n\nexport default 1;\n`,
      "src/styles.css": `.reset { background-image: url(); }\n`,
    },
  ],
  [
    "single-quote-url",
    {
      "src/main.tsx": `import "./styles.css";\n\nexport default 1;\n`,
      "src/styles.css": `.reset { background-image: url(''); }\n`,
    },
  ],
];

async function main(): Promise<void> {
  for (const [name, files] of cases) {
    const result = await compileProject({ files, entry: "src/main.tsx" });
    console.log(`--- ${name}`);
    console.log("  diagnostics:", JSON.stringify(result.diagnostics));
    console.log("  css:", JSON.stringify(result.css));
    console.log("  js:", JSON.stringify(result.js.slice(0, 160)));
  }
}

void main();
