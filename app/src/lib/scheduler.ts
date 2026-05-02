import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { fetchProfile, fetchRecentVideos } from "@/lib/tiktok";

const INTERVAL_MS = 4 * 60 * 60 * 1000; // 4h
const FIRST_RUN_DELAY_MS = 60_000; // 60s after server boot
const CONCURRENCY = 2;
const DELAY_MS = 600;
const VIDEO_LIMIT = 3;

type GlobalWithFlag = typeof globalThis & {
  __ttSchedulerStarted?: boolean;
  __ttSchedulerInterval?: NodeJS.Timeout;
  __ttSchedulerLastRunAt?: number;
  __ttSchedulerRunning?: boolean;
};

const g = globalThis as GlobalWithFlag;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function syncOne(id: number, username: string) {
  try {
    const [profile, videos] = await Promise.all([
      fetchProfile(username).catch((e) => {
        throw e;
      }),
      fetchRecentVideos(username, VIDEO_LIMIT).catch(() => [] as const),
    ]);
    await db
      .update(accounts)
      .set({
        followerCount: profile.followerCount,
        followingCount: profile.followingCount,
        avatarUrl: profile.avatarUrl,
        lastVideos: videos.length > 0 ? JSON.stringify(videos) : undefined,
        lastSyncedAt: new Date(),
        lastSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(accounts)
      .set({ lastSyncError: msg, updatedAt: new Date() })
      .where(eq(accounts.id, id));
  }
}

export async function runAutoFetchAll(): Promise<{
  total: number;
  durationMs: number;
}> {
  if (g.__ttSchedulerRunning) {
    return { total: 0, durationMs: 0 };
  }
  g.__ttSchedulerRunning = true;
  const startedAt = Date.now();
  try {
    const rows = await db
      .select({ id: accounts.id, username: accounts.username })
      .from(accounts);

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batch = rows.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map((r) => syncOne(r.id, r.username)));
      if (i + CONCURRENCY < rows.length) await sleep(DELAY_MS);
    }

    g.__ttSchedulerLastRunAt = Date.now();
    return { total: rows.length, durationMs: Date.now() - startedAt };
  } finally {
    g.__ttSchedulerRunning = false;
  }
}

export function startAutoFetchScheduler() {
  if (g.__ttSchedulerStarted) return;
  g.__ttSchedulerStarted = true;

  const tick = async () => {
    try {
      const res = await runAutoFetchAll();
      // eslint-disable-next-line no-console
      console.log(
        `[scheduler] auto-fetched ${res.total} accounts in ${res.durationMs}ms`
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[scheduler] auto-fetch failed:", e);
    }
  };

  setTimeout(tick, FIRST_RUN_DELAY_MS);
  g.__ttSchedulerInterval = setInterval(tick, INTERVAL_MS);
  // eslint-disable-next-line no-console
  console.log(
    `[scheduler] started — first run in ${FIRST_RUN_DELAY_MS / 1000}s, then every ${INTERVAL_MS / 60000}min`
  );
}

export function getSchedulerStatus() {
  return {
    started: Boolean(g.__ttSchedulerStarted),
    running: Boolean(g.__ttSchedulerRunning),
    lastRunAt: g.__ttSchedulerLastRunAt ?? null,
    intervalMs: INTERVAL_MS,
  };
}
