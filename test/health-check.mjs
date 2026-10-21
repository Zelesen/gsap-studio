/* Health check: does the running server compile a React project? */
const files = {
  "src/main.tsx": [
    'import { createRoot } from "react-dom/client";',
    'import { gsap } from "gsap";',
    'import "./styles.css";',
    'createRoot(document.getElementById("root")!).render(<h1>hi</h1>);',
  ].join("\n"),
  "src/styles.css": "body{margin:0}",
};

const base = process.argv[2] || "http://127.0.0.1:3000";

const studio = await fetch(`${base}/studio`);
console.log(`GET /studio -> ${studio.status} (${studio.rawContentLength} bytes)`);

const res = await fetch(`${base}/api/compile`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ files, entry: "src/main.tsx" }),
});
const j = await res.json();
console.log(`POST /api/compile -> ${res.status} keys=${Object.keys(j).join(",")}`);
console.log(
  `  ok=${j.ok} html=${(j.html || "").length} js=${(j.js || "").length} css=${(j.css || "").length} diagnostics=${(j.diagnostics || []).length} err=${j.error ?? ""}`,
);
