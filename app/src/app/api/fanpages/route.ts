import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fanpages, facebookAccounts, insightGroups } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getOwnerId } from "@/lib/scope";

export async function GET(req: Request) {
  const ownerId = await getOwnerId();
  const url = new URL(req.url);
  const accountIdStr = url.searchParams.get("accountId");
  const accountId = accountIdStr ? Number(accountIdStr) : null;

  const rows = await db
    .select({
      id: fanpages.id,
      fbAccountId: fanpages.fbAccountId,
      insightGroupId: fanpages.insightGroupId,
      pageId: fanpages.pageId,
      name: fanpages.name,
      category: fanpages.category,
      categoryList: fanpages.categoryList,
      about: fanpages.about,
      description: fanpages.description,
      pictureUrl: fanpages.pictureUrl,
      coverUrl: fanpages.coverUrl,
      link: fanpages.link,
      username: fanpages.username,
      fanCount: fanpages.fanCount,
      followersCount: fanpages.followersCount,
      newLikeCount: fanpages.newLikeCount,
      ratingCount: fanpages.ratingCount,
      overallStarRating: fanpages.overallStarRating,
      verificationStatus: fanpages.verificationStatus,
      tasks: fanpages.tasks,
      hasPageToken: fanpages.encPageAccessToken,
      insightsJson: fanpages.insightsJson,
      lastSyncedAt: fanpages.lastSyncedAt,
      lastSyncError: fanpages.lastSyncError,
      monetizationStatus: fanpages.monetizationStatus,
      monetizationError: fanpages.monetizationError,
      earningsValue: fanpages.earningsValue,
      earningsCurrency: fanpages.earningsCurrency,
      earningsRangeStart: fanpages.earningsRangeStart,
      earningsRangeEnd: fanpages.earningsRangeEnd,
      earningsUpdatedAt: fanpages.earningsUpdatedAt,
      earningsBreakdownJson: fanpages.earningsBreakdownJson,
      ownerUsername: facebookAccounts.username,
      ownerFbName: facebookAccounts.fbName,
      groupName: insightGroups.name,
      groupColor: insightGroups.color,
    })
    .from(fanpages)
    .leftJoin(
      facebookAccounts,
      eq(fanpages.fbAccountId, facebookAccounts.id),
    )
    .leftJoin(insightGroups, eq(fanpages.insightGroupId, insightGroups.id))
    .where(
      accountId && Number.isFinite(accountId)
        ? and(eq(fanpages.ownerUserId, ownerId), eq(fanpages.fbAccountId, accountId))
        : eq(fanpages.ownerUserId, ownerId),
    )
    .orderBy(desc(fanpages.fanCount), desc(fanpages.id));

  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      hasPageToken: !!r.hasPageToken,
    })),
  });
}
