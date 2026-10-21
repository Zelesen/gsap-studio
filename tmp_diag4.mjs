import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { rmSync } from "node:fs";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const APP = "http://127.0.0.1:3110";
const DEBUG_PORT = 9337;
const PROFILE = "C:\\Users\\amanm\\AppData\\Local\\Temp\\gsap-diag4-profile";
try { rmSync(PROFILE, { recursive: true, force: true }); } catch { }

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener("message", e => {
      const m = JSON.parse(e.data);
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        this.errors.push(m.params.args.map(a => a.value ?? a.description ?? "").join(" "));
      }
      if (m.method === "Runtime.exceptionThrown") {
        this.errors.push("EXCEPTION: " + (m.params.exceptionDetails.exception?.description ?? ""));
      }
      if (m.id && this.pending.has(m.id)) {
        const r = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) r.rej(new Error(m.error.message));
        else r.res(m.result);
        return;
      }
    });
  }
  send(m, p = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method: m, params: p }));
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error("eval failed:" + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result?.value;
  }
}
async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json());
      const p = list.find(t => t.type === "page");
      if (p) {
        const ws = new WebSocket(p.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
        return new CDP(ws);
      }
    } catch { }
    await sleep(200);
  }
  throw new Error("no connect");
}
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=" + DEBUG_PORT, "--user-data-dir=" + PROFILE, "--remote-allow-origins=*", "about:blank"], { stdio: "ignore" });
try {
  const cdp = await connect();
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable"); await cdp.send("Log.enable");
  await cdp.send("Page.navigate", { url: APP + "/studio" });
  await sleep(1000);
  await cdp.eval(`localStorage.clear(); true`);
  await cdp.send("Page.navigate", { url: APP + "/studio" });
  await sleep(2500);
  const state = await cdp.eval(`(()=>{
    const se=document.querySelector(".studio-editor");
    const ta=document.querySelector(".studio-editor textarea");
    const pane=document.querySelector(".studio-pane");
    const active=document.querySelector(".studio-pane--active");
    const hidden=document.querySelector(".studio-pane--hidden");
    return {
      hasStudioEditor: !!se,
      textarea: ta ? ta.value.slice(0,40) : null,
      allTextareas: document.querySelectorAll("textarea").length,
      hasAnyPane: !!pane,
      hasActive: !!active,
      hasHidden: !!hidden,
      h1: document.querySelector("h1")?.textContent,
      title: document.title
    };
  })()`);
  console.log("STATE", JSON.stringify(state, null, 2));
  console.log("ERRORS", JSON.stringify(cdp.errors.slice(0, 8)));
  cdp.ws.close();
} finally {
  edge.kill();
  await sleep(500);
}
