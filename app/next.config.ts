import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@tobyg74/tiktok-api-dl"],
  // Ensures instrumentation.ts register() fires on server boot
};

export default nextConfig;
