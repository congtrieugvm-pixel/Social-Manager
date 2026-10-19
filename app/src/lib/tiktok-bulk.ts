// Shared body of /api/accounts/fetch-{follow,videos,avatar}.
//
// Each account can take up to 4 TikTok requests (retries) + 1 D1 write, and a
// Worker on the Free plan gets 50 subrequests per invocation — so one call
// handles at most MAX_IDS accounts and the client sends the selection in
// chunks (src/app/page.tsx runFetchBulk).

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { readBody } from "@/lib/req-body";
import { getOwnerId } from "@/lib/scope";
import { TikTokError } from "@/lib/tiktok";

export const MAX_IDS = 5;
const CONCURRENCY = 2;

export type BulkResult = { id: number; username: string; ok: boolean; error?: string; retryable?: boolean } & Record<string, unknown>;

/** Run `work` for one account; on failure store the error but keep the old data. */
export async function processAccount(
  id: number,
  username: string,
  work: () => Promise<Record<string, unknown>>,
): Promise<BulkResult> {
  try {
    return { id, username, ok: true, ...(await work()) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(accounts).set({ lastSyncError: msg, updatedAt: new Date() }).where(eq(accounts.id, id));
    return { id, username, ok: false, error: msg, retryable: !(e instanceof TikTokError) || e.retryable };
  }
}

export async function runBulk(req: Request, one: (id: number, username: string) => Promise<BulkResult>) {
  const ownerId = await getOwnerId();
  // req.json() throws on Cloudflare Workers (unenv polyfill bug) — ids come
  // in the X-Body header.
  const body = await readBody<{ ids?: number[] }>(req);
  const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : [];
  if (ids.length === 0) return NextResponse.json({ error: "Thiếu danh sách id" }, { status: 400 });
  if (ids.length > MAX_IDS) return NextResponse.json({ error: `Tối đa ${MAX_IDS} tài khoản mỗi lần gọi` }, { status: 400 });

  const rows = await db
    .select({ id: accounts.id, username: accounts.username })
    .from(accounts)
    .where(and(inArray(accounts.id, ids), eq(accounts.ownerUserId, ownerId)));

  const results: BulkResult[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
      while (next < rows.length) {
        const r = rows[next++];
        results.push(await one(r.id, r.username));
      }
    }),
  );

  return NextResponse.json({
    total: results.length,
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
