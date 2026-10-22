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

/** Escape a specifier for use in a RegExp. */
function escapeSpecifier(specifier: string): string {
  return specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\//g, "\\/");
}

/**
 * Whether `binding` is already brought into scope by an import from `specifier`.
 */
function isImported(source: string, binding: string, specifier: string): boolean {
  const escSpec = escapeSpecifier(specifier);
  // named import: import { ... binding ... } from "specifier"
  const namedRe = new RegExp(
    `import\\s*\\{[^}]*\\b${binding}\\b[^}]*\\}\\s*from\\s*["']${escSpec}["']`,
  );
  if (namedRe.test(source)) return true;
  // default import: import binding from "specifier"
  const defaultRe = new RegExp(
    `import\\s+${binding}\\s+from\\s*["']${escSpec}["']`,
  );
  if (defaultRe.test(source)) return true;
  // namespace import: import * as binding from "specifier"
  const nsRe = new RegExp(
    `import\\s*\\*\\s*as\\s+${binding}\\s+from\\s*["']${escSpec}["']`,
  );
  if (nsRe.test(source)) return true;
  return false;
}



/** The canonical module each runtime binding must come from. */
const CANONICAL_SPECIFIER: Record<string, string> = {
  gsap: "gsap",
  ScrollTrigger: "gsap/ScrollTrigger",
  useGSAP: "@gsap/react",
};

/** A named-import statement: `import { a, b as c } from "spec";`. */
const NAMED_IMPORT = /import\s*\{([^}]*)\}\s*from\s*(["'])([^"']+?)\2\s*;?/g;

/**
 * Rewrite named imports whose specifier is wrong for a known binding, e.g.
 * `import { gsap } from "gsap/ScrollTrigger"` -> `import { gsap } from "gsap"`.
 * Bindings that share a target specifier are grouped; mixed imports are split.
 */
function fixNamedImports(source: string): string {
  return source.replace(
    NAMED_IMPORT,
    (match: string, bindingsStr: string, quote: string, specifier: string) => {
      const bindings = bindingsStr
        .split(",")
        .map((b: string) => b.trim())
        .filter(Boolean);
      if (bindings.length === 0) return match;

      const groups = new Map<string, string[]>();
      for (const binding of bindings) {
        const importedName = binding.split(/\s+as\s+/)[0].trim();
        const target = CANONICAL_SPECIFIER[importedName] ?? specifier;
        if (!groups.has(target)) groups.set(target, []);
        groups.get(target)!.push(binding);
      }

      // Nothing to change: single group matching the original specifier.
      if (groups.size === 1 && groups.has(specifier)) return match;

      const parts: string[] = [];
      for (const [spec, bs] of groups) {
        parts.push(`import { ${bs.join(", ")} } from ${quote}${spec}${quote};`);
      }
      return parts.join("\n");
    },
  );
}


export function normalizeRuntimeImports(source: string): string {
  // 1. Rewrite namespace imports that cannot work at runtime.
/**
 * Rewrite namespace imports that cannot work at runtime and correct
 * wrong-specifier imports; inject any missing runtime imports.
 */

  let result = source;
  if (source.includes("import")) {
    result = source.replace(
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

  // 2. Correct specifiers for known bindings imported from the wrong module.
  if (result.includes("import")) {
    result = fixNamedImports(result);
  }

  // 3. Inject imports for runtime identifiers that are used but not declared.
  //    Only inject when the identifier is actually *used* as a value (a member
  //    access or a call), so a stray mention in a comment or a
  //    `const gsap = …` declaration does not create a spurious import.
  const injections: string[] = [];

  if (/\bgsap\s*[.(]/.test(result) && !isImported(result, "gsap", "gsap")) {
    injections.push('import { gsap } from "gsap";');
  }
  if (
    (/\bScrollTrigger\s*[.(]/.test(result) ||
      /registerPlugin\s*\(\s*ScrollTrigger\b/.test(result)) &&
    !isImported(result, "ScrollTrigger", "gsap/ScrollTrigger")
  ) {
    injections.push('import { ScrollTrigger } from "gsap/ScrollTrigger";');
  }
  if (/\buseGSAP\b/.test(result) && !isImported(result, "useGSAP", "@gsap/react")) {
    // useGSAP is a hook: inject whenever it is referenced and not imported.
    injections.push('import { useGSAP } from "@gsap/react";');
  }

  if (injections.length > 0) {
    result = injections.join("\n") + "\n" + result;
  }

  return result;
}
