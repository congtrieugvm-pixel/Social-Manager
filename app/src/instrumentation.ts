export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startAutoFetchScheduler } = await import("./lib/scheduler");
  startAutoFetchScheduler();
}
