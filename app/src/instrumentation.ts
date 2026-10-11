export async function register() {
  // Skip on edge / Cloudflare — Workers don't have a long-running process,
  // so setInterval-based schedulers don't work there. Use a Cron Trigger
  // Worker that POSTs to /api/scheduler instead (see deploy guide).
  // Keep the positive `=== "nodejs"` wrapper: webpack only prunes the import
  // from the Edge instrumentation bundle in this form (an early return isn't
  // pruned, which drags better-sqlite3 into the Edge build).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.APP_RUNTIME === "cloudflare") return;
    const { startAutoFetchScheduler } = await import("./lib/scheduler");
    startAutoFetchScheduler();
  }
}
