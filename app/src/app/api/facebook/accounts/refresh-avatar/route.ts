import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { facebookAccounts } from "@/lib/db/schema";
import { and, inArray, eq } from "drizzle-orm";
import { buildFbAvatarUrl, probeFbAvatarUrl } from "@/lib/facebook";
import { readBody } from "@/lib/req-body";
import { getOwnerId } from "@/lib/scope";

export const runtime = "nodejs";

interface ItemResult {
  id: number;
  username: string;
  ok: boolean;
  pictureUrl?: string;
  error?: string;
}

/**
 * Refreshes `fb_profile_pic` to the public Graph picture redirector URL
 * keyed by `fb_user_id`. Accounts without a `fb_user_id` are skipped with
 * an actionable error — local usernames cannot resolve the Graph picture
 * endpoint reliably (FB rejects user vanity usernames with 400), so the
 * caller must run a token sync first to populate the UID. The URL is also
 * HEAD-probed before saving; failed probes clear `fb_profile_pic` to null
 * so the UI falls back to the initial-letter placeholder.
 */
export async function POST(req: Request) {
  const ownerId = await getOwnerId();
  let ids: number[] = [];
  try {
    const body = await readBody<{ ids?: number[] }>(req);
    ids = Array.isArray(body.ids)
      ? body.ids.filter(
          (x): x is number => typeof x === "number" && Number.isFinite(x),
        )
      : [];
  } catch {
    // empty body → 400 below
  }
  if (ids.length === 0) {
    return NextResponse.json({ error: "Thiếu danh sách id" }, { status: 400 });
  }

  const rows = await db
    .select({
      id: facebookAccounts.id,
      username: facebookAccounts.username,
      fbUserId: facebookAccounts.fbUserId,
    })
    .from(facebookAccounts)
    .where(
      and(
        inArray(facebookAccounts.id, ids),
        eq(facebookAccounts.ownerUserId, ownerId),
      ),
    );

  const results: ItemResult[] = [];
  let okCount = 0;
  let errCount = 0;
  let skipCount = 0;
  const now = new Date();

  for (const r of rows) {
    if (!r.fbUserId) {
      results.push({
        id: r.id,
        username: r.username,
        ok: false,
        error: "Thiếu fb_user_id — chạy sync token Facebook để lấy UID trước",
      });
      skipCount++;
      continue;
    }
    try {
      const pictureUrl = buildFbAvatarUrl(r.fbUserId);
      const works = await probeFbAvatarUrl(pictureUrl);
      if (!works) {
        await db
          .update(facebookAccounts)
          .set({ fbProfilePic: null, updatedAt: now })
          .where(eq(facebookAccounts.id, r.id));
        results.push({
          id: r.id,
          username: r.username,
          ok: false,
          error: "Graph từ chối — fb_user_id không tồn tại hoặc bị hạn chế",
        });
        errCount++;
        continue;
      }
      await db
        .update(facebookAccounts)
        .set({
          fbProfilePic: pictureUrl,
          lastSyncedAt: now,
          updatedAt: now,
        })
        .where(eq(facebookAccounts.id, r.id));
      results.push({
        id: r.id,
        username: r.username,
        ok: true,
        pictureUrl,
      });
      okCount++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ id: r.id, username: r.username, ok: false, error: msg });
      errCount++;
    }
  }

  return NextResponse.json({
    ok: true,
    total: rows.length,
    okCount,
    errCount,
    skipCount,
    results,
  });
}
