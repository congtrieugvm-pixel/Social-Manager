import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fanpages, fanpagePosts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import {
  extractPostMetric,
  fetchPostInsights,
  fetchPostVideoEarnings,
} from "@/lib/facebook";
import { getOwnerId } from "@/lib/scope";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ownerId = await getOwnerId();
  const { id: idStr } = await ctx.params;
  const postRowId = Number(idStr);
  if (!Number.isFinite(postRowId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // Inner-join to fanpages to enforce owner scope on the post.
  const [row] = await db
    .select({
      id: fanpagePosts.id,
      postId: fanpagePosts.postId,
      fanpageId: fanpagePosts.fanpageId,
    })
    .from(fanpagePosts)
    .innerJoin(fanpages, eq(fanpagePosts.fanpageId, fanpages.id))
    .where(
      and(
        eq(fanpagePosts.id, postRowId),
        eq(fanpages.ownerUserId, ownerId),
      ),
    );
  if (!row) {
    return NextResponse.json({ error: "Không tìm thấy post" }, { status: 404 });
  }

  const [fp] = await db
    .select({ encPageAccessToken: fanpages.encPageAccessToken })
    .from(fanpages)
    .where(and(eq(fanpages.id, row.fanpageId), eq(fanpages.ownerUserId, ownerId)));
  const token = await decrypt(fp?.encPageAccessToken ?? null);
  if (!token) {
    return NextResponse.json(
      { error: "Fanpage chưa có page token" },
      { status: 400 },
    );
  }

  const now = new Date();
  try {
    const [insights, earnings] = await Promise.all([
      fetchPostInsights(row.postId, token),
      fetchPostVideoEarnings(row.postId, token),
    ]);
    const patch = {
      impressions: extractPostMetric(insights, "post_impressions"),
      impressionsUnique: extractPostMetric(insights, "post_impressions_unique"),
      reach: extractPostMetric(insights, "post_impressions_unique"),
      engagedUsers: extractPostMetric(insights, "post_engaged_users"),
      clicks: extractPostMetric(insights, "post_clicks"),
      videoViews: extractPostMetric(insights, "post_video_views"),
      insightsJson: JSON.stringify(insights),
      adBreakEarnings: earnings.available ? earnings.totalMicros : null,
      adBreakCurrency: earnings.available ? earnings.currency : null,
      earningsUpdatedAt: now,
      earningsError: earnings.available ? null : earnings.error,
      lastInsightsAt: now,
      lastInsightsError: null,
      updatedAt: now,
    };
    await db
      .update(fanpagePosts)
      .set(patch)
      .where(eq(fanpagePosts.id, row.id));
    return NextResponse.json({ ok: true, insights, earnings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(fanpagePosts)
      .set({
        lastInsightsError: msg,
        lastInsightsAt: now,
        updatedAt: now,
      })
      .where(eq(fanpagePosts.id, row.id));
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
