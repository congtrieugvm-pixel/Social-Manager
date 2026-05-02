import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { and, inArray, eq } from "drizzle-orm";
import { fetchRecentVideos } from "@/lib/tiktok";
import { getOwnerId } from "@/lib/scope";

const CONCURRENCY = 3;
const DELAY_MS = 300;
const VIDEO_LIMIT = 3;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function processOne(id: number, username: string) {
  try {
    const videos = await fetchRecentVideos(username, VIDEO_LIMIT);
    await db
      .update(accounts)
      .set({
        lastVideos: JSON.stringify(videos),
        lastSyncedAt: new Date(),
        lastSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, id));
    return { id, username, ok: true as const, count: videos.length, videos };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(accounts)
      .set({ lastSyncError: msg, updatedAt: new Date() })
      .where(eq(accounts.id, id));
    return { id, username, ok: false as const, error: msg };
  }
}

export async function POST(req: Request) {
  const ownerId = await getOwnerId();
  const { ids } = (await req.json()) as { ids: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "Thiếu danh sách id" }, { status: 400 });
  }

  const rows = await db
    .select({ id: accounts.id, username: accounts.username })
    .from(accounts)
    .where(and(inArray(accounts.id, ids), eq(accounts.ownerUserId, ownerId)));

  const results: Awaited<ReturnType<typeof processOne>>[] = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map((r) => processOne(r.id, r.username)));
    results.push(...batchResults);
    if (i + CONCURRENCY < rows.length) await sleep(DELAY_MS);
  }

  return NextResponse.json({
    total: results.length,
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
