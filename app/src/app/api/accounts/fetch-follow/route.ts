import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { inArray, eq } from "drizzle-orm";
import { fetchProfile } from "@/lib/tiktok";

const CONCURRENCY = 3;
const DELAY_MS = 300;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function processOne(
  id: number,
  username: string
): Promise<{
  id: number;
  username: string;
  ok: boolean;
  error?: string;
  follower?: number;
  following?: number;
  videoCount?: number;
}> {
  try {
    const profile = await fetchProfile(username);
    // Embed endpoint never reports videoCount — skip it instead of zeroing the
    // existing value. Same for region (not in schema, so no write either).
    await db
      .update(accounts)
      .set({
        followerCount: profile.followerCount,
        followingCount: profile.followingCount,
        avatarUrl: profile.avatarUrl,
        lastSyncedAt: new Date(),
        lastSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, id));
    return {
      id,
      username,
      ok: true,
      follower: profile.followerCount,
      following: profile.followingCount,
      videoCount: profile.videoCount,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(accounts)
      .set({ lastSyncError: msg, updatedAt: new Date() })
      .where(eq(accounts.id, id));
    return { id, username, ok: false, error: msg };
  }
}

export async function POST(req: Request) {
  const { ids } = (await req.json()) as { ids: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "Thiếu danh sách id" }, { status: 400 });
  }

  const rows = await db
    .select({ id: accounts.id, username: accounts.username })
    .from(accounts)
    .where(inArray(accounts.id, ids));

  const results: Awaited<ReturnType<typeof processOne>>[] = [];

  // Simple batched concurrency
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
