import { context, type Plugin, type OnResolveArgs, type OnLoadArgs, type OnLoadOptions, type OnResolveOptions, type OnResolveResult, type OnLoadResult } from "esbuild";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { mkdtemp, writeFile, rm, mkdir } from "fs/promises";

// esbuild types don't include context/rebuild with signal yet

export interface CompileInput {
  files: Record<string, string>;  // path -> content
  entry: string;
}

export interface CompileResult {
  html: string;
  js: string;
  css: string;
  diagnostics: string[];
}

const ALLOWED_EXTERNALS = new Set([
  "react", "react-dom", "react-dom/client", "react/jsx-runtime",
  "gsap", "gsap/ScrollTrigger", "@gsap/react",
]);

const importValidationPlugin: Plugin = {
  name: "import-validation",
  setup(build: { onResolve: (options: OnResolveOptions, handler: (args: OnResolveArgs) => Promise<OnResolveResult | null | undefined>) => void }) {
    build.onResolve({ filter: /.*/ }, async (args: OnResolveArgs): Promise<OnResolveResult | null | undefined> => {
      // Allow relative imports, absolute paths (entry points), and Windows paths
      if (args.path.startsWith(".") || args.path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(args.path)) return;
      if (!ALLOWED_EXTERNALS.has(args.path) && !args.path.startsWith("gsap/")) {
        return { errors: [{ text: `Import '${args.path}' not in allowlist` }] };
      }
      return { path: args.path, external: true };
    });
  },
};

const cssExtractPlugin: Plugin = {
  name: "css-extract",
  setup(build: { onLoad: (options: OnLoadOptions, handler: (args: OnLoadArgs) => Promise<OnLoadResult | null | undefined>) => void }) {
    build.onLoad({ filter: /\.css$/ }, async (args: OnLoadArgs): Promise<OnLoadResult | null | undefined> => {
      const fs = await import("fs/promises");
      const content = await fs.readFile(args.path, "utf8");
      return { contents: content, loader: "css" };
    });
  },
};

export async function compileProject(input: CompileInput): Promise<CompileResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "gsapstudio-compile-"));
  const entryPath = join(tempDir, input.entry);
  const outDir = join(tempDir, "out");

  try {
    // Write all files to temp directory
    for (const [path, content] of Object.entries(input.files)) {
      const filePath = join(tempDir, path);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");
    }

    await mkdir(outDir, { recursive: true });

    const ctx = await context({
      entryPoints: [entryPath],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      external: ["react", "react-dom", "react-dom/client", "gsap", "gsap/ScrollTrigger", "@gsap/react"],
      plugins: [importValidationPlugin, cssExtractPlugin],
      define: { "process.env.NODE_ENV": '"production"' },
      jsx: "automatic",
      jsxImportSource: "react",
      outdir: outDir,
      write: true,
      absWorkingDir: tempDir,
      // Diagnostics are returned to the caller, not printed to the server log.
      logLevel: "silent",
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    type EsbuildMessage = {
      text: string;
      location?: { file?: string; line?: number };
    };
    type EsbuildResult = {
      errors: EsbuildMessage[];
      warnings: EsbuildMessage[];
      outputFiles: unknown[];
    };

    let result: EsbuildResult;
    try {
      // esbuild 0.20+ supports signal option on rebuild; types are outdated
      result = await (
        ctx as unknown as {
          rebuild: (options: { signal: AbortSignal }) => Promise<EsbuildResult>;
        }
      ).rebuild({ signal: controller.signal });
      clearTimeout(timeoutId);
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error("Compile timeout (60s)");
      }
      /*
       * A failed build is a normal outcome, not a crash: esbuild throws a
       * BuildFailure carrying the diagnostics. Surface them as diagnostics so
       * the caller can report "this import is not allowed" instead of a
       * generic server error.
       */
      const failure = e as { errors?: EsbuildMessage[]; warnings?: EsbuildMessage[] };
      if (Array.isArray(failure.errors) && failure.errors.length > 0) {
        const diagnostics = failure.errors.map(
          (error) =>
            `${error.location?.file ?? "unknown"}:${error.location?.line ?? 0}: ${error.text}`,
        );
        for (const warning of failure.warnings ?? []) {
          diagnostics.push(`Warning: ${warning.text}`);
        }
        return { html: "", js: "", css: "", diagnostics };
      }
      throw e;
    } finally {
      await ctx.dispose();
    }

    const diagnostics: string[] = [];
    for (const error of result.errors) {
      diagnostics.push(`${error.location?.file ?? "unknown"}:${error.location?.line ?? 0}: ${error.text}`);
    }
    for (const warning of result.warnings) {
      diagnostics.push(`Warning: ${warning.text}`);
    }

    // Read output files from the out directory
    const { readdir, readFile } = await import("fs/promises");
    const outFiles = await readdir(outDir);
    let html = "";
    let js = "";
    let css = "";

    for (const file of outFiles) {
      const filePath = join(outDir, file);
      const content = await readFile(filePath, "utf8");
      if (file.endsWith(".js")) js = content;
      else if (file.endsWith(".css")) css = content;
    }

    // Generate HTML with import map
    const importMap = {
      imports: {
        react: "/vendor/react.js",
        "react-dom": "/vendor/react-dom.js",
        "react-dom/client": "/vendor/react-dom-client.js",
        "react/jsx-runtime": "/vendor/react-jsx-runtime.js",
        gsap: "/vendor/gsap.js",
        "gsap/ScrollTrigger": "/vendor/gsap-ScrollTrigger.js",
        "@gsap/react": "/vendor/gsap-react.js",
      },
    };

    /*
     * The compiled document is a preview artifact, not a distributable one.
     * The Content-Security-Policy and the error bridge are injected by the
     * Studio's preview panel, which owns them for every project (legacy
     * HTML/CSS/JS and compiled React alike) — adding them here would
     * duplicate the policy in two places.
     */
    html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <script type="importmap">${JSON.stringify(importMap)}</script>
  ${css ? `<style>\n${css}\n</style>` : ""}
</head>
<body>
  <div id="root"></div>
  ${js ? `<script type="module">\n${js}\n</script>` : ""}
</body>
</html>`;

    return { html, js, css, diagnostics };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}