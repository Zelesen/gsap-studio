/*
 * Builds the browser runtime the Studio preview loads.
 *
 * The preview frame runs in an opaque origin and imports these bundles
 * through an import map, so every one of them has to be a real ES module
 * with the named exports generated code expects — and every shared library
 * has to exist exactly once, or React's hooks and GSAP's plugin registry
 * break.
 *
 * Three passes, because esbuild's `external` is per build, not per entry:
 *
 *   1. React family — built from the shims in scripts/vendor/entries, with
 *      `splitting` so react, react-dom and react-dom/client share one
 *      React and one scheduler.
 *   2. GSAP family — gsap and gsap/ScrollTrigger share one gsap-core, so
 *      `gsap.registerPlugin(ScrollTrigger)` registers into the same
 *      instance the application uses.
 *   3. @gsap/react — left external against gsap and react so it binds to
 *      the very same instances the application imports.
 */
import { build } from "esbuild";
import { mkdir } from "fs/promises";
import { join } from "path";

const VENDOR_DIR = join(process.cwd(), "public", "vendor");
const ENTRIES_DIR = join(process.cwd(), "scripts", "vendor", "entries");

const SHARED = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  outdir: VENDOR_DIR,
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  write: true,
} as const;

const REACT_ENTRIES = {
  react: join(ENTRIES_DIR, "react.js"),
  "react-dom": join(ENTRIES_DIR, "react-dom.js"),
  "react-dom-client": join(ENTRIES_DIR, "react-dom-client.js"),
  "react-jsx-runtime": join(ENTRIES_DIR, "react-jsx-runtime.js"),
};

const GSAP_ENTRIES = {
  gsap: "gsap",
  "gsap-ScrollTrigger": "gsap/ScrollTrigger",
};

async function buildVendor() {
  await mkdir(VENDOR_DIR, { recursive: true });

  console.log("Building the React runtime...");
  await build({ ...SHARED, entryPoints: REACT_ENTRIES });

  console.log("Building the GSAP runtime...");
  await build({ ...SHARED, entryPoints: GSAP_ENTRIES });

  console.log("Building the @gsap/react integration...");
  await build({
    entryPoints: { "gsap-react": "@gsap/react" },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    outfile: join(VENDOR_DIR, "gsap-react.js"),
    write: true,
    // Bound to the application's own gsap and react instances.
    external: ["gsap", "react"],
  });

  console.log("Vendor runtime built.");
}

buildVendor().catch((e) => {
  console.error(e);
  process.exit(1);
});
