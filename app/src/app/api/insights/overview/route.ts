import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  fanpages,
  fanpagePosts,
  fanpageSnapshots,
  insightGroups,
  facebookAccounts,
} from "@/lib/db/schema";
import { eq, sql, desc, gte, and, inArray } from "drizzle-orm";
import { getOwnerId } from "@/lib/scope";

export const runtime = "nodejs";

interface OverviewRow {
  id: number;
  name: string;
  pictureUrl: string | null;
  link: string | null;
  username: string | null;
  category: string | null;
  hasPageToken: boolean;
  insightGroupId: number | null;
  groupName: string | null;
  groupColor: string | null;
  ownerFbName: string | null;
  ownerUsername: string | null;
  fanCount: number | null;
  followersCount: number | null;
  fanDelta7d: number | null;
  followerDelta7d: number | null;
  lastSyncedAt: number | null;
  lastSyncError: string | null;
  pageReach28d: number | null;
  postCount: number;
  postsWithReach: number;
  totalReach: number;
  totalImpressions: number;
  totalEngaged: number;
  totalClicks: number;
  totalReactions: number;
  totalComments: number;
  totalShares: number;
}

export async function GET() {
  const ownerId = await getOwnerId();
  // 1) Base fanpages + owner + group meta
  const base = await db
    .select({
      id: fanpages.id,
      name: fanpages.name,
      pictureUrl: fanpages.pictureUrl,
      link: fanpages.link,
      username: fanpages.username,
      category: fanpages.category,
      hasPageToken: fanpages.encPageAccessToken,
      insightGroupId: fanpages.insightGroupId,
      fanCount: fanpages.fanCount,
      followersCount: fanpages.followersCount,
      insightsJson: fanpages.insightsJson,
      lastSyncedAt: fanpages.lastSyncedAt,
      lastSyncError: fanpages.lastSyncError,
      groupName: insightGroups.name,
      groupColor: insightGroups.color,
      ownerFbName: facebookAccounts.fbName,
      ownerUsername: facebookAccounts.username,
    })
    .from(fanpages)
    .leftJoin(insightGroups, eq(fanpages.insightGroupId, insightGroups.id))
    .leftJoin(facebookAccounts, eq(fanpages.fbAccountId, facebookAccounts.id))
    .where(eq(fanpages.ownerUserId, ownerId))
    .orderBy(desc(fanpages.fanCount), desc(fanpages.id));

  const ids = base.map((r) => r.id);
  if (ids.length === 0) {
    return NextResponse.json({ rows: [] });
  }

  // 2) Post aggregates per fanpage
  const postAgg = await db
    .select({
      fanpageId: fanpagePosts.fanpageId,
      postCount: sql<number>`COUNT(${fanpagePosts.id})`,
      postsWithReach: sql<number>`SUM(CASE WHEN ${fanpagePosts.reach} IS NOT NULL THEN 1 ELSE 0 END)`,
      totalReach: sql<number>`COALESCE(SUM(${fanpagePosts.reach}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${fanpagePosts.impressions}), 0)`,
      totalEngaged: sql<number>`COALESCE(SUM(${fanpagePosts.engagedUsers}), 0)`,
      totalClicks: sql<number>`COALESCE(SUM(${fanpagePosts.clicks}), 0)`,
      totalReactions: sql<number>`COALESCE(SUM(${fanpagePosts.reactionsTotal}), 0)`,
      totalComments: sql<number>`COALESCE(SUM(${fanpagePosts.commentsTotal}), 0)`,
      totalShares: sql<number>`COALESCE(SUM(${fanpagePosts.sharesTotal}), 0)`,
    })
    .from(fanpagePosts)
    .where(inArray(fanpagePosts.fanpageId, ids))
    .groupBy(fanpagePosts.fanpageId);

  const postAggMap = new Map<number, (typeof postAgg)[number]>();
  for (const row of postAgg) postAggMap.set(row.fanpageId, row);

  // 3) Earliest snapshot within last 7 days (for delta calc)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const snapEarly = await db
    .select({
      fanpageId: fanpageSnapshots.fanpageId,
      fanCount: fanpageSnapshots.fanCount,
      followersCount: fanpageSnapshots.followersCount,
      takenAt: fanpageSnapshots.takenAt,
    })
    .from(fanpageSnapshots)
    .where(
      and(
        inArray(fanpageSnapshots.fanpageId, ids),
        gte(fanpageSnapshots.takenAt, weekAgo),
      ),
    )
    .orderBy(fanpageSnapshots.fanpageId, fanpageSnapshots.takenAt);

  // Keep earliest per fanpage (rows sorted ASC by takenAt within each fanpage)
  const earliestByFp = new Map<number, { fanCount: number | null; followersCount: number | null }>();
  for (const s of snapEarly) {
    if (!earliestByFp.has(s.fanpageId)) {
      earliestByFp.set(s.fanpageId, {
        fanCount: s.fanCount,
        followersCount: s.followersCount,
      });
    }
  }

  // 4) Merge all
  const rows: OverviewRow[] = base.map((r) => {
    const agg = postAggMap.get(r.id);
    const early = earliestByFp.get(r.id);
    // pageReach28d: prefer FB's rolling-28-day metric
    // (`page_impressions_unique_days_28`) — its latest value IS the
    // true 28-day-unique count. Sum-of-daily-uniques over 28 days
    // double-counts users (a fan returning daily counts up to 28×) so
    // it was reporting numbers ~10-28× too large for active pages.
    // Falls back to clamped daily-sum for rows synced before the
    // days_28 query was added; user can re-sync to upgrade.
    let pageReach28d: number | null = null;
    if (r.insightsJson) {
      try {
        const parsed = JSON.parse(r.insightsJson) as Record<
          string,
          Array<{
            values: Array<{
              value: number | Record<string, number>;
              end_time?: string;
            }>;
          }>
        >;
        const days28 = parsed["page_impressions_unique_days_28"]?.[0];
        if (days28 && days28.values.length > 0) {
          const latest = days28.values[days28.values.length - 1];
          if (typeof latest.value === "number") pageReach28d = latest.value;
        }
        if (pageReach28d === null) {
          const arr = parsed["page_impressions_unique"]?.[0];
          if (arr) {
            const sinceSec = Math.floor(Date.now() / 1000) - 28 * 86_400;
            pageReach28d = arr.values.reduce((s, v) => {
              const ts = v.end_time
                ? Math.floor(new Date(v.end_time).getTime() / 1000)
                : 0;
              if (!Number.isFinite(ts) || ts < sinceSec) return s;
              return s + (typeof v.value === "number" ? v.value : 0);
            }, 0);
          }
        }
      } catch {}
    }
    const fanDelta =
      early?.fanCount != null && r.fanCount != null
        ? r.fanCount - early.fanCount
        : null;
    const followerDelta =
      early?.followersCount != null && r.followersCount != null
        ? r.followersCount - early.followersCount
        : null;

    return {
      id: r.id,
      name: r.name,
      pictureUrl: r.pictureUrl,
      link: r.link,
      username: r.username,
      category: r.category,
      hasPageToken: !!r.hasPageToken,
      insightGroupId: r.insightGroupId,
      groupName: r.groupName,
      groupColor: r.groupColor,
      ownerFbName: r.ownerFbName,
      ownerUsername: r.ownerUsername,
      fanCount: r.fanCount,
      followersCount: r.followersCount,
      fanDelta7d: fanDelta,
      followerDelta7d: followerDelta,
      lastSyncedAt: r.lastSyncedAt ? Math.floor(r.lastSyncedAt.getTime() / 1000) : null,
      lastSyncError: r.lastSyncError,
      pageReach28d,
      postCount: Number(agg?.postCount ?? 0),
      postsWithReach: Number(agg?.postsWithReach ?? 0),
      totalReach: Number(agg?.totalReach ?? 0),
      totalImpressions: Number(agg?.totalImpressions ?? 0),
      totalEngaged: Number(agg?.totalEngaged ?? 0),
      totalClicks: Number(agg?.totalClicks ?? 0),
      totalReactions: Number(agg?.totalReactions ?? 0),
      totalComments: Number(agg?.totalComments ?? 0),
      totalShares: Number(agg?.totalShares ?? 0),
    };
  });

  return NextResponse.json({ rows });
}
