import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: [],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Prevent esbuild from being bundled by Next.js
  serverExternalPackages: ["esbuild", "@esbuild/win32-x64"],
  /*
   * The vendor runtime is loaded by the preview frame, which runs in an
   * opaque origin (`sandbox="allow-scripts"` without `allow-same-origin`).
   * A module script there imports these files cross-origin, so the browser
   * requires CORS headers. The bundles are public open-source React/GSAP
   * builds served without credentials, exactly like a CDN — hence `*`.
   */
  async headers() {
    return [
      {
        source: "/vendor/:path*",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default nextConfig;
