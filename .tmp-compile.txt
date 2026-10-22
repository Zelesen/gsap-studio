import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import { compileProject } from "@/lib/compiler";

interface CompileRequest {
  files: Record<string, string>;
  entry: string;
}

const compileMutex = (() => {
  let running = 0;
  const queue: Array<() => void> = [];
  return {
    async acquire() {
      if (running < 2) { running++; return; }
      await new Promise<void>(resolve => queue.push(resolve));
      running++;
    },
    release() {
      running--;
      if (queue.length) queue.shift()!();
    },
  };
})();

export async function POST(req: NextRequest): Promise<NextResponse> {
  const release = await compileMutex.acquire();
  try {
    let body: CompileRequest;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    if (!body.files || typeof body.files !== "object") {
      return NextResponse.json({ ok: false, error: "files object required" }, { status: 400 });
    }
    if (!body.entry || typeof body.entry !== "string") {
      return NextResponse.json({ ok: false, error: "entry string required" }, { status: 400 });
    }

    // Validate limits
    const files = Object.entries(body.files);
    if (files.length > 500) return NextResponse.json({ ok: false, error: "Too many files (max 500)" }, { status: 413 });

    let totalSize = 0;
    for (const [path, content] of files) {
      if (path.length > 256) return NextResponse.json({ ok: false, error: `Path too long: ${path}` }, { status: 400 });
      const depth = path.split("/").filter(Boolean).length;
      if (depth > 8) return NextResponse.json({ ok: false, error: `Path too deep: ${path}` }, { status: 400 });
      const size = Buffer.byteLength(content, "utf8");
      if (size > 2_000_000) return NextResponse.json({ ok: false, error: `File too large: ${path}` }, { status: 413 });
      totalSize += size;
    }
    if (totalSize > 50_000_000) return NextResponse.json({ ok: false, error: "Project too large (max 50MB)" }, { status: 413 });

    try {
      const result = await compileProject({ files: body.files, entry: body.entry });
      if (result.diagnostics.length > 0) {
        // A failed build is a client-side problem (bad import, syntax error),
        // not a server fault.
        return NextResponse.json({ ok: false, error: result.diagnostics.join("\n") }, { status: 400 });
      }
      return NextResponse.json({ ok: true, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Compilation failed";
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  } finally {
    compileMutex.release();
  }
}