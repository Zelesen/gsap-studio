/*
 * Runtime import normalization.
 *
 * The preview loads its runtime through an import map
 * (src/lib/compiler.ts), so a namespace import of GSAP hands the code the
 * *module namespace* instead of the GSAP core:
 *
 *   import * as gsap from "gsap";
 *   gsap.registerPlugin(ScrollTrigger);   // TypeError: not a function
 *
 * The namespace exposes `gsap` and `default` — the core — but not the core's
 * own methods, so `registerPlugin`, `to`, `timeline` and friends are all
 * missing. Models write that import often enough to matter, and the failure
 * only shows up in the preview, long after the task was marked complete.
 *
 * The fix belongs in the source, not in the vendor bundle: a namespace
 * import of GSAP is rewritten into the named import that carries the same
 * local binding, so the call sites keep working unchanged. React's namespace
 * and @gsap/react's namespace are left alone — those do expose the API the
 * generated code calls.
 */

/** A namespace import that has to be rewritten, and the export that is the API. */
export interface RuntimeImportRule {
  /** The bare specifier the model used. */
  specifier: string;
  /** The named export that actually is the API the code calls. */
  exportName: string;
}

/** The namespace imports that do not carry the API they are used for. */
export const NAMESPACE_IMPORT_RULES: readonly RuntimeImportRule[] = [
  { specifier: "gsap", exportName: "gsap" },
  { specifier: "gsap/ScrollTrigger", exportName: "ScrollTrigger" },
];

/*
 * `import * as local from "specifier";` — the specifier is limited to the
 * rules above, so nothing else in the file is touched.
 */
const NAMESPACE_IMPORT = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*(["'])(gsap|gsap\/ScrollTrigger)\2\s*;?/g;

/**
 * Rewrite the namespace imports that cannot work at runtime into the named
 * import with the same local binding.
 *
 * `import * as gsap from "gsap"` becomes `import { gsap } from "gsap"`, and
 * `import * as G from "gsap"` becomes `import { gsap as G } from "gsap"` — the
 * call sites are unchanged.
 */
export function normalizeRuntimeImports(source: string): string {
  if (!source.includes("import")) return source;
  return source.replace(
    NAMESPACE_IMPORT,
    (match, local: string, quote: string, specifier: string) => {
      const rule = NAMESPACE_IMPORT_RULES.find(
        (candidate) => candidate.specifier === specifier,
      );
      if (!rule) return match;
      const binding =
        local === rule.exportName
          ? rule.exportName
          : `${rule.exportName} as ${local}`;
      return `import { ${binding} } from ${quote}${specifier}${quote};`;
    },
  );
}
