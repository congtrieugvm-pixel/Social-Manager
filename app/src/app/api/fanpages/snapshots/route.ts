import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fanpages, fanpageSnapshots } from "@/lib/db/schema";
import { asc, eq, inArray, gte, lte, and, type SQL } from "drizzle-orm";
import { getOwnerId } from "@/lib/scope";

export const runtime = "nodejs";

// GET /api/fanpages/snapshots?ids=1,2,3[&days=30][&from=<epoch>&to=<epoch>]
// `from`/`to` are epoch seconds and override `days` when provided.
export async function GET(req: Request) {
  const ownerId = await getOwnerId();
  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids") ?? "";
  const daysParam = url.searchParams.get("days");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const ids = idsParam
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (ids.length === 0) {
    return NextResponse.json({ rows: [] });
  }

  // Filter ids to only those the current user owns. Defends against
  // logged-in user A querying user B's fanpage snapshots by guessing IDs.
  const ownedFp = await db
    .select({ id: fanpages.id })
    .from(fanpages)
    .where(and(eq(fanpages.ownerUserId, ownerId), inArray(fanpages.id, ids)));
  const ownedIds = ownedFp.map((r) => r.id);
  if (ownedIds.length === 0) {
    return NextResponse.json({ rows: [] });
  }

  const fromSec = Number(fromParam);
  const toSec = Number(toParam);
  const days = Number(daysParam);
  let sinceDate: Date | null = null;
  let untilDate: Date | null = null;
  if (Number.isFinite(fromSec) && fromSec > 0) {
    sinceDate = new Date(fromSec * 1000);
  }
  if (Number.isFinite(toSec) && toSec > 0) {
    untilDate = new Date(toSec * 1000);
  }
  if (!sinceDate && Number.isFinite(days) && days > 0) {
    sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  const conds: SQL[] = [inArray(fanpageSnapshots.fanpageId, ownedIds)];
  if (sinceDate) conds.push(gte(fanpageSnapshots.takenAt, sinceDate));
  if (untilDate) conds.push(lte(fanpageSnapshots.takenAt, untilDate));
  const whereExpr = conds.length === 1 ? conds[0] : and(...conds);

  const rows = await db
    .select({
      id: fanpageSnapshots.id,
      fanpageId: fanpageSnapshots.fanpageId,
      takenAt: fanpageSnapshots.takenAt,
      fanCount: fanpageSnapshots.fanCount,
      followersCount: fanpageSnapshots.followersCount,
      pageImpressions: fanpageSnapshots.pageImpressions,
      pageImpressionsUnique: fanpageSnapshots.pageImpressionsUnique,
      pageEngagements: fanpageSnapshots.pageEngagements,
      pageViews: fanpageSnapshots.pageViews,
      pageVideoViews: fanpageSnapshots.pageVideoViews,
      rangeStart: fanpageSnapshots.rangeStart,
      rangeEnd: fanpageSnapshots.rangeEnd,
    })
    .from(fanpageSnapshots)
    .where(whereExpr)
    .orderBy(asc(fanpageSnapshots.takenAt));

  // Serialize takenAt as epoch seconds (JSON would otherwise turn Date into ISO
  // string, which breaks numeric plotting in the client).
  const normalized = rows.map((r) => ({
    ...r,
    takenAt: r.takenAt ? Math.floor(r.takenAt.getTime() / 1000) : null,
  }));

  return NextResponse.json({ rows: normalized });
}
