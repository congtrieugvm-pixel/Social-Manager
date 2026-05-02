export async function register() {
  // Skip on edge / Cloudflare — Workers don't have a long-running process,
  // so setInterval-based schedulers don't work there. Use a Cron Trigger
  // Worker that POSTs to /api/scheduler instead (see deploy guide).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.APP_RUNTIME === "cloudflare") return;
  const { startAutoFetchScheduler } = await import("./lib/scheduler");
  startAutoFetchScheduler();
}
