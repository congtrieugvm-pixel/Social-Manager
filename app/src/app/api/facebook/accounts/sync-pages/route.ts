import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { facebookAccounts, fanpages } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { decrypt, encrypt } from "@/lib/crypto";
import { buildFbAvatarUrl, fetchUserPages } from "@/lib/facebook";

export const runtime = "nodejs";

interface ItemResult {
  id: number;
  username: string;
  ok: boolean;
  inserted?: number;
  updated?: number;
  pagesFound?: number;
  error?: string;
}

async function syncOne(
  accountId: number,
  username: string,
  encToken: string | null,
): Promise<ItemResult> {
  const token = decrypt(encToken);
  if (!token) {
    return {
      id: accountId,
      username,
      ok: false,
      error: "Chưa có access token",
    };
  }
  let pages;
  try {
    pages = await fetchUserPages(token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(facebookAccounts)
      .set({ lastSyncError: msg, lastSyncedAt: new Date() })
      .where(eq(facebookAccounts.id, accountId));
    return { id: accountId, username, ok: false, error: msg };
  }

  const now = new Date();
  let inserted = 0;
  let updated = 0;
  for (const p of pages) {
    const values = {
      fbAccountId: accountId,
      pageId: p.id,
      name: p.name,
      category: p.category ?? null,
      categoryList: p.category_list ? JSON.stringify(p.category_list) : null,
      about: p.about ?? null,
      description: p.description ?? null,
      // Avatar: stable redirector keyed by page id (never expires).
      pictureUrl: buildFbAvatarUrl(p.id),
      coverUrl: p.cover?.source ?? null,
      link: p.link ?? null,
      username: p.username ?? null,
      fanCount: p.fan_count ?? null,
      followersCount: p.followers_count ?? null,
      newLikeCount: p.new_like_count ?? null,
      ratingCount: p.rating_count ?? null,
      overallStarRating:
        p.overall_star_rating !== undefined
          ? String(p.overall_star_rating)
          : null,
      verificationStatus: p.verification_status ?? null,
      tasks: p.tasks ? JSON.stringify(p.tasks) : null,
      encPageAccessToken: p.access_token ? encrypt(p.access_token) : null,
      lastSyncedAt: now,
      lastSyncError: null,
      updatedAt: now,
    };
    const [existing] = await db
      .select({ id: fanpages.id })
      .from(fanpages)
      .where(
        and(eq(fanpages.fbAccountId, accountId), eq(fanpages.pageId, p.id)),
      );
    if (existing) {
      await db.update(fanpages).set(values).where(eq(fanpages.id, existing.id));
      updated++;
    } else {
      await db.insert(fanpages).values(values);
      inserted++;
    }
  }
  await db
    .update(facebookAccounts)
    .set({ lastSyncedAt: now, lastSyncError: null })
    .where(eq(facebookAccounts.id, accountId));
  return {
    id: accountId,
    username,
    ok: true,
    pagesFound: pages.length,
    inserted,
    updated,
  };
}

export async function POST(req: Request) {
  let ids: number[] = [];
  try {
    const body = (await req.json()) as { ids?: number[] };
    ids = (body.ids ?? []).filter((n): n is number => Number.isFinite(n));
  } catch {
    // empty body
  }
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "Thiếu danh sách tài khoản" },
      { status: 400 },
    );
  }
  const rows = await db
    .select({
      id: facebookAccounts.id,
      username: facebookAccounts.username,
      encAccessToken: facebookAccounts.encAccessToken,
    })
    .from(facebookAccounts)
    .where(inArray(facebookAccounts.id, ids));

  const results: ItemResult[] = [];
  // Sequential to be polite to Graph API.
  for (const r of rows) {
    results.push(await syncOne(r.id, r.username, r.encAccessToken));
  }

  return NextResponse.json({
    total: results.length,
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
