import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "better-sqlite3",
    "@tobyg74/tiktok-api-dl",
    "playwright",
    "playwright-core",
  ],
  // Keep these out of the server function bundle that opennextjs builds for
  // Cloudflare Workers. better-sqlite3 has a native .node binding that
  // crashes V8 isolates; playwright requires a Chromium binary that doesn't
  // ship in the Workers runtime. Both are accessed only on Node (local dev)
  // via the runtime DB proxy + edge guards in `hotmail-login.ts`.
  outputFileTracingExcludes: {
    "*": [
      "node_modules/better-sqlite3/**",
      "node_modules/playwright/**",
      "node_modules/playwright-core/**",
      "node_modules/@tobyg74/**",
    ],
  },
};

export default nextConfig;
