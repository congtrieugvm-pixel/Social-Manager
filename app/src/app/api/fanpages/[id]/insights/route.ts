import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fanpages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { fetchPageInsights } from "@/lib/facebook";
import { recordFanpageSnapshot } from "@/lib/fanpage-snapshot";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const [row] = await db
    .select({
      id: fanpages.id,
      pageId: fanpages.pageId,
      encPageAccessToken: fanpages.encPageAccessToken,
      fanCount: fanpages.fanCount,
      followersCount: fanpages.followersCount,
    })
    .from(fanpages)
    .where(eq(fanpages.id, id));

  if (!row) {
    return NextResponse.json({ error: "Không tìm thấy fanpage" }, { status: 404 });
  }

  const pageToken = await decrypt(row.encPageAccessToken);
  if (!pageToken) {
    return NextResponse.json(
      { error: "Fanpage chưa có page access token — sync lại từ tài khoản chủ" },
      { status: 400 },
    );
  }

  const now = new Date();
  try {
    const insights = await fetchPageInsights(row.pageId, pageToken);
    await db
      .update(fanpages)
      .set({
        insightsJson: JSON.stringify(insights),
        lastSyncedAt: now,
        lastSyncError: null,
        updatedAt: now,
      })
      .where(eq(fanpages.id, id));
    await recordFanpageSnapshot(row.id, insights, {
      fanCount: row.fanCount,
      followersCount: row.followersCount,
    });
    return NextResponse.json({ ok: true, insights });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(fanpages)
      .set({
        lastSyncError: msg,
        lastSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(fanpages.id, id));
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const [row] = await db
    .select({
      id: fanpages.id,
      insightsJson: fanpages.insightsJson,
      lastSyncedAt: fanpages.lastSyncedAt,
      lastSyncError: fanpages.lastSyncError,
    })
    .from(fanpages)
    .where(eq(fanpages.id, id));
  if (!row) {
    return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  }
  return NextResponse.json({
    insights: row.insightsJson ? JSON.parse(row.insightsJson) : null,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncError: row.lastSyncError,
  });
}
