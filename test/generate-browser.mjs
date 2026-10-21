/*
 * M3.1 browser test: a compiled React + GSAP project renders in the existing
 * sandboxed Studio preview, with the animation running and no CDN requests.
 *
 * Run with: node test/generate-browser.mjs   (dev server must be on :3100)
 */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { startStudioServer } from "./helpers/server.mjs";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const APP = "http://127.0.0.1:3110";
const PORT = 9334;
const PROFILE = "C:\\Users\\amanm\\AppData\\Local\\Temp\\opencode\\studio-m31-browser";
const STORAGE_KEY = "gsap_studio_project_v1";

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

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.console = [];
    this.network = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        this.console.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
      }
      if (msg.method === "Runtime.exceptionThrown") {
        this.console.push("exception: " + (msg.params.exceptionDetails.exception?.description ?? ""));
      }
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        this.console.push(msg.params.entry.text);
      }
      if (msg.method === "Network.requestWillBeSent") {
        this.network.push(msg.params.request.url);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true, userGesture: true,
    });
    if (res.exceptionDetails) {
      throw new Error("eval failed: " + (res.exceptionDetails.exception?.description ?? res.exceptionDetails.text));
    }
    return res.result?.value;
  }
}

async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res, { once: true });
          ws.addEventListener("error", rej, { once: true });
        });
        return new CDP(ws);
      }
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error("could not connect to Edge over CDP");
}

// A React + GSAP + ScrollTrigger project, compiled through the real endpoint.
//
// The fixture reports back to the parent once it has rendered, so the test can
// prove that the module really executed inside the sandboxed frame: React
// mounted, GSAP loaded, and the animation moved the element. The parent cannot
// read the frame's DOM (opaque origin), so the fixture is the only witness.
const PROJECT_FILES = {
  "src/main.tsx": `import { createRoot } from "react-dom/client";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import "./styles.css";

gsap.registerPlugin(ScrollTrigger);

function App() {
  useGSAP(() => {
    gsap.from("#m31-title", {
      y: 40,
      opacity: 0,
      duration: 0.6,
      scrollTrigger: { trigger: "#m31-title", start: "top center" },
    });
  }, []);
  return <h1 id="m31-title">M3.1 generated site</h1>;
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);

setTimeout(() => {
  const el = document.getElementById("m31-title");
  const style = el ? getComputedStyle(el) : null;
  window.parent.postMessage({
    __m31proof: {
      mounted: !!document.getElementById("root")?.children.length,
      title: el ? el.textContent : null,
      opacity: style ? style.opacity : null,
      transform: style ? style.transform : null,
      gsapVersion: gsap.version,
      hasScrollTrigger: typeof ScrollTrigger !== "undefined",
    },
  }, "*");
}, 1500);
`,
  "src/styles.css": `body { margin: 0; background: rgb(4, 5, 9); color: rgb(245, 241, 255); font-family: system-ui; }
#m31-title { padding: 40px; font-weight: 400; }
`,
};

const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  "--remote-allow-origins=*", "about:blank",
], { stdio: "ignore" });

let cdp;
let server;
try {
  server = await startStudioServer();

  console.log("=== compile the generated project ===");
  const compileRes = await fetch(`${APP}/api/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: PROJECT_FILES, entry: "src/main.tsx" }),
  });
  const compiled = await compileRes.json();
  check("compile succeeds", compileRes.status === 200 && compiled.ok, `status ${compileRes.status}`);
  check("compiled HTML has the import map", compiled.html.includes('type="importmap"'));

  // Seed a project whose applied code is the compiled document.
  const seeded = {
    id: "m31-browser",
    updatedAt: Date.now(),
    files: [
      { name: "index.html", content: PROJECT_FILES["src/main.tsx"] },
      { name: "style.css", content: PROJECT_FILES["src/styles.css"] },
      { name: "script.js", content: "" },
    ],
    applied: [
      { name: "index.html", content: compiled.html },
      { name: "style.css", content: "" },
      { name: "script.js", content: "" },
    ],
    conversation: [],
    source: Object.entries(PROJECT_FILES).map(([path, content]) => ({ path, content })),
    manifest: {
      name: "m31-browser", version: "0.1.0", entry: "src/main.tsx",
      dependencies: { react: "19.0.0", "react-dom": "19.0.0", gsap: "3.12.5" },
      framework: "react-ts",
    },
  };

  cdp = await connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
  });

  // Collect the fixture's report from inside the parent window.
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__proof = null;
      window.addEventListener("message", function (e) {
        if (e.data && e.data.__m31proof) window.__proof = e.data.__m31proof;
      });`,
  });

  // Establish the origin, then seed, then reload.
  await cdp.send("Page.navigate", { url: `${APP}/studio` });
  await sleep(2500);
  const json = JSON.stringify(seeded);
  const escaped = json.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  await cdp.eval(`localStorage.setItem("${STORAGE_KEY}", "${escaped}"); true`);
  await cdp.send("Page.reload");
  await sleep(4000);

  console.log("\n=== preview rendering ===");
  const frame = await cdp.eval(`(() => {
    const el = document.querySelector(".studio-well iframe");
    if (!el) return { hasIframe: false };
    return {
      hasIframe: true,
      sandbox: el.getAttribute("sandbox"),
      hasImportMap: (el.getAttribute("srcdoc") || "").includes('type="importmap"'),
      hasCsp: (el.getAttribute("srcdoc") || "").includes("base-uri 'none'"),
    };
  })()`);
  check("preview iframe exists", frame.hasIframe);
  check("sandbox is allow-scripts only", frame.sandbox === "allow-scripts", frame.sandbox);
  check("srcdoc carries the import map", frame.hasImportMap);
  check("srcdoc carries the CSP", frame.hasCsp);

  // The preview runs in an opaque origin, so the parent cannot read its DOM.
  // Use the error bridge: a broken page would report an error.
  const errorBar = await cdp.eval(`document.querySelector(".studio-preview-error")?.textContent ?? ""`);
  check("no preview errors reported", errorBar.trim() === "", errorBar.slice(0, 120));

  console.log("\n=== the generated app actually rendered ===");
  const proof = await cdp.eval(`window.__proof`);
  check("the app reported back from the sandboxed frame", Boolean(proof), JSON.stringify(proof));
  if (proof) {
    check("React mounted content", proof.mounted === true, `mounted=${proof.mounted}`);
    check("the heading rendered", proof.title === "M3.1 generated site", String(proof.title));
    check("GSAP is loaded", typeof proof.gsapVersion === "string" && proof.gsapVersion.length > 0, String(proof.gsapVersion));
    check("ScrollTrigger is loaded", proof.hasScrollTrigger === true);
    check(
      "the GSAP animation ran (element transformed)",
      proof.transform !== "none" && proof.transform !== null,
      `transform=${proof.transform} opacity=${proof.opacity}`,
    );
  }

  console.log("\n=== network ===");
  const cdnRequests = cdp.network.filter((u) =>
    /unpkg\.com|cdnjs\.cloudflare\.com|jsdelivr\.net|esm\.sh|skypack\.dev/i.test(u),
  );
  check("no CDN requests for approved dependencies", cdnRequests.length === 0, cdnRequests.join(", "));

  // The preview frame is an opaque origin, so its own requests are not
  // reported to the page's Network domain. Check the vendor files are
  // actually served with the CORS headers a module import needs.
  for (const file of ["react.js", "react-dom-client.js", "gsap.js", "gsap-ScrollTrigger.js", "gsap-react.js", "react-jsx-runtime.js"]) {
    const res = await fetch(`${APP}/vendor/${file}`);
    const cors = res.headers.get("access-control-allow-origin");
    check(`vendor ${file} is served with CORS for the opaque frame`, res.ok === true && cors === "*", `status ${res.status} cors ${cors}`);
  }

  console.log("\n=== console ===");
  const unexpected = cdp.console.filter(
    (line) => !/Minified React error #418/.test(line),
  );
  check("no unexpected console errors", unexpected.length === 0, unexpected.slice(0, 2).join(" | "));

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
} catch (e) {
  console.error("Test failed:", e);
  failed++;
} finally {
  try { cdp?.ws?.close(); } catch {}
  try { edge.kill(); } catch {}
  if (server) await server.stop();
  await sleep(400);
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}
}

process.exit(failed > 0 ? 1 : 0);