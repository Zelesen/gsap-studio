/*
 * Second-origin static server used by the sandbox tests.
 *
 * A different port is a different origin, so anything loaded from here proves
 * the sandboxed preview can still reach the network — which it must, for CDN
 * scripts and fonts.
 *
 * It also counts hits per path, which gives the tests a channel that does not
 * depend on the preview being able to postMessage to its parent.
 */
import { createServer } from "node:http";

const GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64",
);

const ROUTES = {
  "/ext.js": ["application/javascript", "window.__externalLoaded = true;"],
  "/blank.svg": [
    "image/svg+xml",
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
  ],
  "/submit-target": ["text/html", "<!DOCTYPE html><title>submitted</title>ok"],
};

/**
 * Start the second origin and return its URL plus a stop function.
 */
export async function startSecondOrigin({ port = 8123 } = {}) {
  const hits = new Map();

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    if (url.pathname === "/counts") {
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify(Object.fromEntries(hits)));
      return;
    }
    if (url.pathname === "/reset") {
      hits.clear();
      res.writeHead(200, {
        "content-type": "text/plain",
        "access-control-allow-origin": "*",
      });
      res.end("reset");
      return;
    }
    if (url.pathname.startsWith("/hit/")) {
      hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);
      res.writeHead(200, {
        "content-type": "image/gif",
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      });
      res.end(GIF);
      return;
    }

    const hit = ROUTES[url.pathname];
    if (!hit) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": hit[0],
      "access-control-allow-origin": "*",
    });
    res.end(hit[1]);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  return {
    url: `http://127.0.0.1:${port}`,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
