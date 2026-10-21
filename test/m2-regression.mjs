/*
 * Milestone 2 browser tests — real Edge over the Chrome DevTools Protocol.
 *
 * Drives the actual /studio route in a production build and asserts the
 * sandbox, draft/applied model, viewport behaviour, persistence, and error
 * reporting against the implementation that ships, not a stand-in.
 *
 * The suite starts everything it needs: the production server and the second
 * origin the sandbox fixtures load from. It is a single command.
 */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { startStudioServer } from "./helpers/server.mjs";
import { startSecondOrigin } from "./helpers/second-origin.mjs";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const APP = "http://127.0.0.1:3110";
const DEBUG_PORT = 9333;
const PROFILE = join(tmpdir(), "gsap-studio-m2-edge-profile");
const STORAGE_KEY = "gsap_studio_project_v1";

/* ---------------------------------------------------------------- cdp --- */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.console = [];
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
        this.console.push(
          "exception: " + (msg.params.exceptionDetails.exception?.description ?? ""),
        );
      }
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        this.console.push(msg.params.entry.text);
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

  /** Evaluate an expression in the page and return its value. */
  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      throw new Error(
        "eval failed: " +
          (res.exceptionDetails.exception?.description ?? res.exceptionDetails.text),
      );
    }
    return res.result?.value;
  }
}

async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res, { once: true });
          ws.addEventListener("error", rej, { once: true });
        });
        return new CDP(ws);
      }
    } catch {
      /* browser not up yet */
    }
    await sleep(200);
  }
  throw new Error("could not connect to Edge over CDP");
}

/* ------------------------------------------------------------- fixtures -- */

const PROBE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <base href="http://base-should-be-blocked.example/">
  <title>Probe page</title>
</head>
<body>
  <h1 id="probe-heading">Probe</h1>
  <object data="http://127.0.0.1:8123/blank.svg" width="1" height="1"></object>
  <form action="http://127.0.0.1:8123/submit-target" method="get"><input name="a" value="1"></form>
  <script src="http://127.0.0.1:8123/ext.js"></script>
</body>
</html>`;

const PROBE_CSS = `body { background: rgb(1, 2, 3); color: rgb(250, 250, 250); }`;

const PROBE_JS = `(function () {
  var results = {};
  var record = function (name, fn) {
    try {
      var v = fn();
      results[name] = { ok: true, value: v === undefined ? "undefined" : String(v).slice(0, 140) };
    } catch (err) {
      results[name] = {
        ok: false,
        error: String(err && err.name ? err.name + ": " + err.message : err).slice(0, 160),
      };
    }
  };

  window.__probeRuns = (window.__probeRuns || 0) + 1;

  record("parentDocument", function () { return window.parent.document.title; });
  record("topDocument", function () { return window.top.document.title; });
  record("parentLocalStorage", function () { return window.parent.localStorage.length; });
  record("parentFetch", function () { return String(window.parent.fetch); });
  record("ownLocalStorage", function () { return window.localStorage.getItem("gsap_studio_project_v1"); });
  record("ownSessionStorage", function () { return window.sessionStorage.length; });
  record("cookie", function () { return document.cookie; });
  record("opener", function () { return String(window.opener); });
  record("popup", function () { return String(window.open("about:blank")); });
  record("sandboxEscape", function () {
    var frame = window.parent.document.querySelector("iframe");
    frame.removeAttribute("sandbox");
    return "sandbox=" + String(frame.getAttribute("sandbox"));
  });
  record("topNavigation", function () { window.top.location = "https://example.com/"; return "assigned"; });
  record("baseURI", function () { return document.baseURI; });
  record("cspIsFirstInHead", function () {
    var first = document.head.firstElementChild;
    return String(first && first.getAttribute("http-equiv"));
  });
  record("htmlElementCount", function () { return document.querySelectorAll("html").length; });
  record("bodyElementCount", function () { return document.querySelectorAll("body").length; });
  record("bodyBackground", function () { return getComputedStyle(document.body).backgroundColor; });
  record("headingText", function () { return document.getElementById("probe-heading").textContent; });
  record("formSubmit", function () { document.querySelector("form").submit(); return "submitted"; });

  var asyncResults = {};
  var obj = document.querySelector("object");
  if (obj) {
    obj.addEventListener("load", function () { asyncResults.objectFiredLoad = "yes"; });
    obj.addEventListener("error", function () { asyncResults.objectFiredLoad = "error"; });
  }
  setTimeout(function () {
    asyncResults.objectFiredLoad = asyncResults.objectFiredLoad || "no";
    asyncResults.externalLoaded = String(window.__externalLoaded);
    asyncResults.stillHere = String(location.href).slice(0, 40);
    send();
  }, 400);

  var send = function () {
    try {
      window.parent.postMessage({ __probe: { run: window.__probeRuns, results: results, async: asyncResults } }, "*");
    } catch (e) {}
  };

  send();
  setTimeout(send, 350);
  setTimeout(send, 900);
})();`;

function project(files, applied = files, conversation = []) {
  return {
    id: "test-project",
    updatedAt: Date.now(),
    files: [
      { name: "index.html", content: files.html },
      { name: "style.css", content: files.css },
      { name: "script.js", content: files.javascript },
    ],
    applied: [
      { name: "index.html", content: applied.html },
      { name: "style.css", content: applied.css },
      { name: "script.js", content: applied.javascript },
    ],
    conversation,
  };
}

const SEED_PROBE = (conversation = []) =>
  project(
    { html: PROBE_HTML, css: PROBE_CSS, javascript: PROBE_JS },
    undefined,
    conversation,
  );

/* --------------------------------------------------------------- suite --- */

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
}

const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h.toString(36);
};

async function main() {
  // The production server and the second origin the fixtures load from.
  const studio = await startStudioServer();
  const secondOrigin = await startSecondOrigin();

  const edge = spawn(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${PROFILE}`,
      "--remote-allow-origins=*",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let cdp;
  try {
    cdp = await connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1600,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });

    /*
     * Collect every message the preview posts, installed before any document
     * script runs — otherwise a navigation wipes the collector and messages
     * sent during load are lost.
     */
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__msgs = [];
        window.addEventListener("message", function (e) {
          var frame = document.querySelector(".studio-well iframe");
          window.__msgs.push({
            origin: String(e.origin),
            fromFrame: frame ? e.source === frame.contentWindow : false,
            data: e.data
          });
        });`,
    });

    /* 1. Fresh visit: the starter template is both draft and applied. */
    await cdp.send("Page.navigate", { url: `${APP}/studio` });
    await sleep(1200);
    await cdp.eval(`localStorage.removeItem(${JSON.stringify(STORAGE_KEY)}); true`);
    await cdp.send("Page.navigate", { url: `${APP}/studio` });
    for (let i = 0; i < 40; i++) {
      const ready = await cdp.eval(`!!localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`);
      if (ready) break;
      await sleep(150);
    }
    await sleep(600);

    const freshState = await cdp.eval(`({
      editorIsStarter: document.querySelector(".studio-editor textarea").value.includes("Hello, studio."),
      applyDisabled: [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Apply"))?.disabled ?? null,
      footText: document.querySelector(".studio-panel-foot .studio-hint")?.textContent ?? null,
      hasIframe: !!document.querySelector(".studio-well iframe"),
    })`);
    check("new project opens on the starter template", freshState.editorIsStarter);
    check("starter template is already applied, so the preview shows it", freshState.hasIframe === true);
    check("Apply is disabled when nothing is edited", freshState.applyDisabled === true);
    check("code foot reports the preview as up to date", freshState.footText === "Preview up to date", freshState.footText);

    /* 1b. A project with no code at all: the real empty state. */
    await cdp.eval(`localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(JSON.stringify(project({ html: "", css: "", javascript: "" })))}); true`);
    await cdp.send("Page.navigate", { url: `${APP}/studio` });
    await sleep(1600);
    const emptyState = await cdp.eval(`({
      hasIframe: !!document.querySelector(".studio-well iframe"),
      emptyText: document.querySelector(".studio-well__empty")?.textContent?.trim().slice(0, 30) ?? null,
      rerenderDisabled: [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Re-render preview")?.disabled ?? null,
    })`);
    check("empty preview renders the empty state, not an iframe", !emptyState.hasIframe && !!emptyState.emptyText, emptyState.emptyText);
    check("re-render is disabled with nothing to render", emptyState.rerenderDisabled === true);

    /* 2. Install a message collector, then seed the probe project. */
    await cdp.eval(`
      window.__msgs = [];
      window.addEventListener("message", (e) => {
        window.__msgs.push({
          origin: String(e.origin),
          fromFrame: e.source === document.querySelector(".studio-well iframe")?.contentWindow,
          data: e.data,
        });
      });
      true;
    `);
    await cdp.eval(
      `localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(JSON.stringify(SEED_PROBE(["assistant", "assistant"].map(() => ({ role: "assistant", content: "seeded" })))))}); true`,
    );
    await cdp.send("Page.navigate", { url: `${APP}/studio` });
    await sleep(2200);

    /* 3. Sandbox + srcdoc shape. */
    const frame = await cdp.eval(`(() => {
      const el = document.querySelector(".studio-well iframe");
      if (!el) return null;
      return { sandbox: el.getAttribute("sandbox"), srcdoc: el.getAttribute("srcdoc") };
    })()`);
    check("iframe sandbox is allow-scripts only", frame?.sandbox === "allow-scripts", frame?.sandbox);
    check("document is delivered via srcdoc", (frame?.srcdoc?.length ?? 0) > 500, `${frame?.srcdoc?.length ?? 0} chars`);
    check("CSP meta is present in the preview document", frame?.srcdoc?.includes("Content-Security-Policy"));
    check("error bridge is injected", frame?.srcdoc?.includes("studioPreview"));
    check("generated CSS is spliced in", frame?.srcdoc?.includes("rgb(1, 2, 3)"));

    /* 4. Isolation from the parent side. */
    const parentSide = await cdp.eval(`(() => {
      const el = document.querySelector(".studio-well iframe");
      const out = {};
      try { out.contentDocument = String(el.contentDocument); } catch (e) { out.contentDocument = "threw " + e.name; }
      try { out.contentWindowDocument = String(el.contentWindow.document); } catch (e) { out.contentWindowDocument = "threw " + e.name; }
      out.sameOriginHint = el.contentWindow ? "contentWindow reachable" : "no contentWindow";
      return out;
    })()`);
    check("parent cannot read the framed document", /null|threw/.test(parentSide.contentDocument), parentSide.contentDocument);
    check("parent cannot reach the framed document via contentWindow", /threw/.test(parentSide.contentWindowDocument), parentSide.contentWindowDocument);

    /* 5. Probes from inside the preview. */
    const step5 = await cdp.eval(`(function () {
      var el = document.querySelector(".studio-well iframe");
      var src = el ? el.getAttribute("srcdoc") : null;
      return {
        msgs: (window.__msgs || []).length,
        kinds: (window.__msgs || []).map(function (m) {
          var d = m.data;
          return (typeof d === "string" ? "str:" + d.slice(0, 20) : Object.keys(d || {}).join(",")) + (m.fromFrame ? "(frame)" : "");
        }),
        iframes: document.querySelectorAll("iframe").length,
        hasProbe: src ? src.indexOf("__probeRuns") > -1 : null,
        hasExternal: src ? src.indexOf("8123/ext.js") > -1 : null,
        hasForm: src ? src.indexOf("<form") > -1 : null,
        hasJsWrapper: src ? src.indexOf("__probeRuns") > -1 && src.slice(src.indexOf("__probeRuns") - 40, src.indexOf("__probeRuns")) : null,
        collectorPresent: typeof window.__msgs !== "undefined",
        errorBar: (document.querySelector(".studio-preview-error")?.textContent || "").replace(/\\s+/g, " ").slice(0, 200),
        status: (document.querySelector(".studio-preview-status")?.textContent || "").replace(/\\s+/g, " ").slice(0, 80)
      };
    })()`);
    console.log("STEP5", JSON.stringify(step5));
    const probePosts = await cdp.eval(
      `JSON.stringify((window.__msgs || []).filter((m) => m.data && m.data.__probe).map((m) => ({ origin: m.origin, fromFrame: m.fromFrame, probe: m.data.__probe })))`,
    );
    const posts = JSON.parse(probePosts ?? "[]");
    const latest = posts[posts.length - 1]?.probe;
    console.log("POSTS", JSON.stringify(posts.map((p) => ({
      run: p.probe?.run,
      resultKeys: Object.keys(p.probe?.results ?? {}).length,
      asyncKeys: Object.keys(p.probe?.async ?? {}),
      ext: p.probe?.async?.externalLoaded,
      obj: p.probe?.async?.objectFiredLoad,
      still: p.probe?.async?.stillHere,
    }))));
    check("preview reports over postMessage", posts.length > 0, `${posts.length} posts`);
    check("postMessage arrives with an opaque (null) origin", posts.every((p) => p.origin === "null"), posts[0]?.origin);
    check("messages are attributed to our iframe", posts.every((p) => p.fromFrame === true));

    const r = latest?.results ?? {};
    const blocked = (k) => r[k] && r[k].ok === false;
    check("generated code cannot read the parent document", blocked("parentDocument"), r.parentDocument?.error);
    check("generated code cannot read the top document", blocked("topDocument"), r.topDocument?.error);
    check("generated code cannot read the parent's localStorage", blocked("parentLocalStorage"), r.parentLocalStorage?.error);
    check("parent fetch is not exposed as a value", r.parentFetch?.value === "undefined" || blocked("parentFetch"), r.parentFetch?.value);
    check("preview has no storage of its own", blocked("ownLocalStorage"), r.ownLocalStorage?.error);
    check("preview has no sessionStorage", blocked("ownSessionStorage"), r.ownSessionStorage?.error);
    check("preview has no cookies", r.cookie?.value === "" || blocked("cookie"), r.cookie?.value ?? r.cookie?.error);
    check("no opener handle", r.opener?.value === "null", r.opener?.value);
    check("popups are blocked", r.popup?.value === "null", r.popup?.value);
    check("sandbox cannot be removed from inside", /sandbox=allow-scripts/.test(r.sandboxEscape?.value ?? "") || blocked("sandboxEscape"), r.sandboxEscape?.value ?? r.sandboxEscape?.error);
    check("top navigation is blocked", blocked("topNavigation"), r.topNavigation?.error ?? r.topNavigation?.value);
    const parentUrl = await cdp.eval("location.href");
    check("the studio page did not navigate away", parentUrl.startsWith(APP), parentUrl);
    // A srcdoc document's base URL is its parent's, so the value is the studio
    // URL — what matters is that <base href> did not take effect.
    check("<base> is ignored (base-uri 'none')",
      typeof r.baseURI?.value === "string" && !r.baseURI.value.startsWith("http://base-should-be-blocked.example"),
      r.baseURI?.value);
    check("CSP meta is the first element in <head>", r.cspIsFirstInHead?.value === "Content-Security-Policy", r.cspIsFirstInHead?.value);
    check("full document is not nested", r.htmlElementCount?.value === "1" && r.bodyElementCount?.value === "1", `html=${r.htmlElementCount?.value} body=${r.bodyElementCount?.value}`);
    check("generated CSS actually applies", r.bodyBackground?.value === "rgb(1, 2, 3)", r.bodyBackground?.value);
    check("generated markup survives splicing", r.headingText?.value === "Probe", r.headingText?.value);
    check("external scripts still load", latest?.async?.externalLoaded === "true", latest?.async?.externalLoaded);
    check("object elements are blocked", latest?.async?.objectFiredLoad !== "yes", latest?.async?.objectFiredLoad);
    check("form submission is blocked", latest?.async?.stillHere === "about:srcdoc", latest?.async?.stillHere);
    // Every probe above is wrapped in try/catch, so a healthy page must not
    // surface anything — this also proves the bridge is not firing spuriously.
    const probeErr = await cdp.eval(`document.querySelector(".studio-preview-error")?.textContent?.trim() ?? ""`);
    check("a healthy page reports no preview errors", probeErr.length === 0, probeErr.slice(0, 80) || "(none)");

    /* 6. Draft vs applied. */
    const beforeEdit = await cdp.eval(`(() => {
      const el = document.querySelector(".studio-well iframe");
      return { srcdoc: el.getAttribute("srcdoc"), dots: document.querySelectorAll(".studio-tab__dot").length, foot: document.querySelector(".studio-panel-foot .studio-hint").textContent };
    })()`);
    await cdp.eval(`(() => {
      const ta = document.querySelector(".studio-editor textarea");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, "<!DOCTYPE html><html><head><title>Draft only</title></head><body><p id=\\"draft-mark\\">DRAFT</p></body></html>");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await sleep(350);
    const afterEdit = await cdp.eval(`(() => {
      const el = document.querySelector(".studio-well iframe");
      return { srcdoc: el.getAttribute("srcdoc"), dots: document.querySelectorAll(".studio-tab__dot").length, foot: document.querySelector(".studio-panel-foot .studio-hint").textContent, applyDisabled: [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Apply"))?.disabled };
    })()`);
    check("editing marks the file as modified", afterEdit.dots > beforeEdit.dots, `${beforeEdit.dots} -> ${afterEdit.dots}`);
    check("editing does NOT change the preview", afterEdit.srcdoc === beforeEdit.srcdoc);
    check("foot states what is not in the preview", /not in the preview/.test(afterEdit.foot), afterEdit.foot);
    check("Apply becomes available", afterEdit.applyDisabled === false);

    /* tab switch keeps drafts */
    await cdp.eval(`[...document.querySelectorAll(".studio-tab")].find((b) => b.textContent.includes("style.css")).click(); true`);
    await sleep(150);
    await cdp.eval(`[...document.querySelectorAll(".studio-tab")].find((b) => b.textContent.includes("index.html")).click(); true`);
    await sleep(150);
    const keptDraft = await cdp.eval(`document.querySelector(".studio-editor textarea").value.includes("DRAFT")`);
    check("switching tabs keeps the draft", keptDraft);

    /* apply */
    await cdp.eval(`[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Apply")).click(); true`);
    await sleep(1200);
    const afterApply = await cdp.eval(`(() => {
      const el = document.querySelector(".studio-well iframe");
      return { srcdoc: el.getAttribute("srcdoc"), dots: document.querySelectorAll(".studio-tab__dot").length, foot: document.querySelector(".studio-panel-foot .studio-hint").textContent, marker: el.getAttribute("srcdoc").includes("DRAFT") };
    })()`);
    check("Apply puts the draft into the preview", afterApply.marker === true);
    check("Apply changes the rendered document", afterApply.srcdoc !== afterEdit.srcdoc);
    check("dirty indicator clears after Apply", afterApply.dots === 0);
    check("foot reports up to date after Apply", afterApply.foot === "Preview up to date", afterApply.foot);

    /* 7. Viewport behaviour. */
    const clickViewport = async (label) =>
      cdp.eval(`(() => { document.querySelector('[aria-label="Preview viewport"] [aria-label="${label} viewport"]').click(); return true; })()`);
    await clickViewport("Mobile");
    await sleep(400);
    const mobile = await cdp.eval(`(() => {
      const el = document.querySelector(".studio-well iframe");
      return { w: el.style.width, h: el.style.height, transform: el.style.transform, dims: document.querySelector(".studio-preview-dims")?.textContent, srcdoc: el.getAttribute("srcdoc") };
    })()`);
    check("mobile renders at 390x844", mobile.w === "390px" && mobile.h === "844px", `${mobile.w} x ${mobile.h}`);
    check("mobile frame is scaled, not squeezed", /^scale\(/.test(mobile.transform ?? ""), mobile.transform);
    check("head states the true viewport size", (mobile.dims ?? "").includes("390 × 844"), mobile.dims);
    check("switching viewport does not re-run the page", mobile.srcdoc === afterApply.srcdoc);

    await clickViewport("Tablet");
    await sleep(300);
    const tablet = await cdp.eval(`(() => { const el = document.querySelector(".studio-well iframe"); return { w: el.style.width, h: el.style.height, dims: document.querySelector(".studio-preview-dims")?.textContent }; })()`);
    check("tablet renders at 768x1024", tablet.w === "768px" && tablet.h === "1024px", `${tablet.w} x ${tablet.h}`);
    check("tablet head states the true size", (tablet.dims ?? "").includes("768 × 1024"), tablet.dims);

    await clickViewport("Desktop");
    await sleep(400);
    const desktop = await cdp.eval(`(() => { const el = document.querySelector(".studio-well iframe"); return { w: el.style.width, transform: el.style.transform, dims: document.querySelector(".studio-preview-dims")?.textContent }; })()`);
    check("desktop fills the well", desktop.w === "100%", desktop.w);
    check("desktop reports its measured box", /^Desktop · \d+ × \d+$/.test(desktop.dims ?? ""), desktop.dims);

    /* 8. Re-render executes exactly once more.
     * The probe posts 4 times per run (immediately, at 350ms, from the async
     * block at 400ms, and at 900ms), and a run takes ~900ms — so after a
     * 1400ms wait one execution is exactly 4 posts and a double execution
     * would be 8. */
    await cdp.eval(`window.__msgs = []; true`);
    await sleep(700);
    const beforeRerender = await cdp.eval(`(window.__msgs || []).filter((m) => m.data && m.data.__probe).length`);
    await cdp.eval(`[...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Re-render preview").click(); true`);
    await sleep(1400);
    const afterRerender = await cdp.eval(`(window.__msgs || []).filter((m) => m.data && m.data.__probe).length`);
    check("re-render runs the page exactly once more", afterRerender - beforeRerender === 4, `${beforeRerender} -> ${afterRerender} (4 posts per run)`);

    /* 9. Persistence of both states. */
    await cdp.eval(`(() => {
      const ta = document.querySelector(".studio-editor textarea");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, "<!DOCTYPE html><html><head><title>Draft only</title></head><body><p id=\\"draft-mark\\">DRAFT2</p></body></html>");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await sleep(400);
    await cdp.send("Page.navigate", { url: `${APP}/studio` });
    await sleep(2000);
    const restored = await cdp.eval(`(() => {
      const el = document.querySelector(".studio-well iframe");
      return {
        draft: document.querySelector(".studio-editor textarea").value.includes("DRAFT2"),
        dots: document.querySelectorAll(".studio-tab__dot").length,
        previewHasDraft: el ? el.getAttribute("srcdoc").includes("DRAFT2") : null,
        previewHasApplied: el ? el.getAttribute("srcdoc").includes("DRAFT") : null,
      };
    })()`);
    check("drafts survive a refresh", restored.draft === true);
    check("unapplied edits are still marked after refresh", restored.dots > 0, `${restored.dots} dots`);
    check("preview still shows the last applied version", restored.previewHasApplied === true && restored.previewHasDraft === false);

    /* 10. Malformed storage never crashes the route. */
    const malformed = [
      ["not json", "{{{ not json"],
      ["wrong type", JSON.stringify({ files: "nope" })],
      ["null entries", JSON.stringify({ files: [null, 42, { name: 1, content: {} }] })],
      ["missing fields", JSON.stringify({ files: [{ name: "index.html", content: "<p>x</p>" }], conversation: "nope" })],
      ["bad conversation", JSON.stringify({ files: [{ name: "index.html", content: "<p>x</p>" }], conversation: [{ role: "root", content: 1 }, null] })],
      ["empty object", "{}"],
    ];
    for (const [label, raw] of malformed) {
      await cdp.eval(`localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(raw)}); true`);
      await cdp.send("Page.navigate", { url: `${APP}/studio` });
      await sleep(1200);
      const state = await cdp.eval(`({
        mounted: !!document.querySelector(".studio-editor textarea"),
        chat: document.querySelectorAll(".studio-msg").length,
      })`);
      check(`malformed storage (${label}) does not crash`, state.mounted === true, JSON.stringify(state));
    }

    /* 11. Error reporting: parent path, runtime, syntax, and a blocked CDN. */
    const dumpMsgs = async () =>
      cdp.eval(`JSON.stringify((function () {
        var m = window.__msgs;
        return {
          n: m ? m.length : -1,
          k: (m || []).map(function (x) { var d = x.data; return typeof d === "string" ? "str" : Object.keys(d || {}).join(","); }),
          url: location.href.slice(0, 50),
          iframe: !!document.querySelector(".studio-well iframe")
        };
      })())`);
    const errorSeed = (js, html = "<!DOCTYPE html><html><head><title>Err</title></head><body><p>err</p></body></html>") =>
      // Double-stringified: the eval below interpolates this as a JS expression,
      // so it must be a string literal holding JSON, not a JSON object literal.
      JSON.stringify(JSON.stringify(project({ html, css: "", javascript: js })));

    // A forged message from inside the preview exercises the parent-side path
    // in isolation, so a failure below can be attributed correctly.
    await cdp.eval(`localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${errorSeed("window.parent.postMessage({ studioPreview: { kind: 'error', message: 'FORGED_MESSAGE' } }, '*');")}); true`);
    await cdp.send("Page.navigate", { url: `${APP}/studio` });
    await sleep(1600);
    const forgedDiag = await cdp.eval(`(function () {
      var el = document.querySelector(".studio-well iframe");
      var src = el ? el.getAttribute("srcdoc") : null;
      return {
        storedHasForged: (localStorage.getItem("${STORAGE_KEY}") || "").indexOf("FORGED_MESSAGE") > -1,
        srcdocHasForged: src ? src.indexOf("FORGED_MESSAGE") > -1 : null,
        srcdocLen: src ? src.length : 0,
        srcdocHead: src ? src.slice(0, 60) : null,
        frames: window.frames.length,
        bar: (document.querySelector(".studio-preview-error")?.textContent || "").slice(0, 60)
      };
    })()`);
    console.log("FORGED-DIAG", JSON.stringify(forgedDiag));
    const forged = await cdp.eval(`document.querySelector(".studio-preview-error")?.textContent ?? ""`);
    check("the parent accepts messages from the preview iframe", forged.includes("FORGED_MESSAGE"), forged.slice(0, 60) || `(msgs: ${await dumpMsgs()})`);

    await cdp.eval(`localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${errorSeed("setTimeout(function () { throw new Error('BOOM_RUNTIME'); }, 30);")}); true`);
    await cdp.send("Page.navigate", { url: `${APP}/studio` });
    await sleep(2000);
    const runtimeErr = await cdp.eval(`document.querySelector(".studio-preview-error")?.textContent ?? ""`);
    check("an uncaught runtime error is surfaced in the preview", runtimeErr.includes("BOOM_RUNTIME"), runtimeErr.slice(0, 80) || `(msgs: ${await dumpMsgs()})`);

    await cdp.eval(`localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${errorSeed("function ( {")}); true`);
    await cdp.send("Page.navigate", { url: `${APP}/studio` });
    await sleep(2000);
    const syntaxErr = await cdp.eval(`document.querySelector(".studio-preview-error")?.textContent ?? ""`);
    check("a syntax error in generated JS is surfaced", syntaxErr.length > 0, syntaxErr.slice(0, 80) || `(msgs: ${await dumpMsgs()})`);

    /*
     * Regression: a generated page importing GSAP from a URL that does not
     * exist. The failed <script> never reaches window.onerror, so without
     * capture-phase reporting the only symptom is a downstream
     * "gsap.init is not a function" with no hint of the real cause.
     */
    const cdnHtml = `<!DOCTYPE html><html><head><title>CDN</title></head><body><p>cdn</p>
<script src="https://unpkg.com/gsap@3.12.2/dist/gsap.es.js"></script>
</body></html>`;
    await cdp.eval(`localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${errorSeed("setTimeout(function () { gsap.init(); }, 40);", cdnHtml)}); true`);
    await cdp.send("Page.navigate", { url: `${APP}/studio` });
    await sleep(3000);
    const cdnErr = await cdp.eval(`document.querySelector(".studio-preview-error")?.textContent ?? ""`);
    check("a blocked CDN script is reported by cause", cdnErr.includes("Failed to load script"), cdnErr.replace(/\s+/g, " ").slice(0, 110) || `(msgs: ${await dumpMsgs()})`);
    check("the downstream symptom is kept alongside the cause", cdnErr.includes("ReferenceError"), cdnErr.replace(/\s+/g, " ").slice(0, 110));

    /* 12. No hydration or React errors anywhere along the way. */
    const consoleErrors = cdp.console.filter((c) => c && !/favicon|404|Failed to load resource/i.test(c));
    check("no React/hydration errors in the console", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | ").slice(0, 200));
  } finally {
    try {
      cdp?.ws?.close();
    } catch {
      /* ignore */
    }
    edge.kill();
    await sleep(500);
    try {
      rmSync(PROFILE, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    await studio.stop();
    await secondOrigin.stop();
  }

  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  - ${f.name}  [${f.detail}]`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("driver error:", err);
  process.exit(2);
});
