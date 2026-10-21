/*
 * Starts the Studio's production server for a test run.
 *
 * The suites used to assume a server was already listening, which made them
 * fail with a bare "fetch failed" whenever it was not. Starting it here
 * makes each suite a single self-contained command.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_PORT = 3110;

/** The Next.js CLI, started through node so no shell wrapper is involved. */
function nextBin() {
  const bin = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(bin)) {
    throw new Error("next CLI not found — run npm install first");
  }
  return bin;
}

/**
 * Start `next start` on a free port and wait until it answers.
 *
 * Returns the base URL and a stop function. The stop function is safe to
 * call more than once.
 */
export async function startStudioServer({ port = DEFAULT_PORT, timeoutMs = 60000 } = {}) {
  const url = `http://127.0.0.1:${port}`;

  // Reuse a server that is already up rather than fighting over the port.
  if (await isUp(url)) {
    return { url, stop: async () => {} };
  }

  const child = spawn(
    process.execPath,
    [nextBin(), "start", "-p", String(port)],
    { cwd: process.cwd(), stdio: "ignore" },
  );

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    await sleep(200);
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next start exited with code ${child.exitCode}`);
    }
    if (await isUp(url)) {
      return { url, stop };
    }
    await sleep(300);
  }

  await stop();
  throw new Error(`server did not become ready on ${url} within ${timeoutMs}ms`);
}

async function isUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.status > 0;
  } catch {
    return false;
  }
}
