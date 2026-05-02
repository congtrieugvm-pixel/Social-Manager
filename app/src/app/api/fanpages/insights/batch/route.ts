import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fanpages } from "@/lib/db/schema";
import { inArray, isNotNull } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { fetchPageInsights, resolveInsightRange } from "@/lib/facebook";
import { recordFanpageSnapshot } from "@/lib/fanpage-snapshot";

export const runtime = "nodejs";

interface BatchBody {
  ids?: number[];
  /** Last N days. Ignored when `from`/`to` are supplied. */
  days?: number;
  /** Epoch seconds. */
  from?: number;
  to?: number;
}

interface ItemResult {
  id: number;
  pageId: string;
  name: string;
  ok: boolean;
  error?: string;
}

export async function POST(req: Request) {
  let body: BatchBody = {};
  try {
    body = (await req.json()) as BatchBody;
  } catch {
    // empty ok
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
    : [];

  const rangeOpts = {
    // Default to last 365 days. Library chunks ranges >93d into 90-day windows.
    days: typeof body.days === "number" && Number.isFinite(body.days) && body.days > 0
      ? body.days
      : 365,
    from: typeof body.from === "number" && Number.isFinite(body.from) && body.from > 0
      ? body.from
      : undefined,
    to: typeof body.to === "number" && Number.isFinite(body.to) && body.to > 0
      ? body.to
      : undefined,
  };
  const { start: rangeStart, end: rangeEnd } = resolveInsightRange(rangeOpts);

  const rows = await db
    .select({
      id: fanpages.id,
      pageId: fanpages.pageId,
      name: fanpages.name,
      encPageAccessToken: fanpages.encPageAccessToken,
      fanCount: fanpages.fanCount,
      followersCount: fanpages.followersCount,
    })
    .from(fanpages)
    .where(
      ids.length > 0
        ? inArray(fanpages.id, ids)
        : isNotNull(fanpages.encPageAccessToken),
    );

  const results: ItemResult[] = [];
  let okCount = 0;
  let skipCount = 0;
  let errCount = 0;

  // Sequential to avoid hammering Graph API / hitting rate limits.
  for (const r of rows) {
    const token = decrypt(r.encPageAccessToken);
    if (!token) {
      results.push({
        id: r.id,
        pageId: r.pageId,
        name: r.name,
        ok: false,
        error: "Chưa có page access token",
      });
      skipCount++;
      continue;
    }
    const now = new Date();
    try {
      const insights = await fetchPageInsights(r.pageId, token, rangeOpts);
      await db
        .update(fanpages)
        .set({
          insightsJson: JSON.stringify(insights),
          lastSyncedAt: now,
          lastSyncError: null,
          updatedAt: now,
        })
        .where(inArray(fanpages.id, [r.id]));
      await recordFanpageSnapshot(r.id, insights, {
        fanCount: r.fanCount,
        followersCount: r.followersCount,
        rangeStart,
        rangeEnd,
      });
      results.push({ id: r.id, pageId: r.pageId, name: r.name, ok: true });
      okCount++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db
        .update(fanpages)
        .set({ lastSyncError: msg, lastSyncedAt: now, updatedAt: now })
        .where(inArray(fanpages.id, [r.id]));
      results.push({
        id: r.id,
        pageId: r.pageId,
        name: r.name,
        ok: false,
        error: msg,
      });
      errCount++;
    }
  }

  return NextResponse.json({
    ok: true,
    total: rows.length,
    okCount,
    errCount,
    skipCount,
    rangeStart,
    rangeEnd,
    results,
  });
}
