import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fanpages, fanpagePosts } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { fetchPagePosts } from "@/lib/facebook";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const fanpageId = Number(idStr);
  if (!Number.isFinite(fanpageId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(fanpagePosts)
    .where(eq(fanpagePosts.fanpageId, fanpageId))
    .orderBy(desc(fanpagePosts.createdTime))
    .limit(200);

  return NextResponse.json({ rows });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const fanpageId = Number(idStr);
  if (!Number.isFinite(fanpageId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: { max?: number } = {};
  try {
    body = (await req.json()) as { max?: number };
  } catch {
    // empty ok
  }
  const max = typeof body.max === "number" && body.max > 0 ? Math.min(body.max, 200) : 50;

  const [fp] = await db
    .select({
      id: fanpages.id,
      pageId: fanpages.pageId,
      encPageAccessToken: fanpages.encPageAccessToken,
    })
    .from(fanpages)
    .where(eq(fanpages.id, fanpageId));

  if (!fp) {
    return NextResponse.json({ error: "Không tìm thấy fanpage" }, { status: 404 });
  }

  const token = await decrypt(fp.encPageAccessToken);
  if (!token) {
    return NextResponse.json(
      { error: "Fanpage chưa có page access token — sync lại từ tài khoản chủ" },
      { status: 400 },
    );
  }

  let posts;
  try {
    posts = await fetchPagePosts(fp.pageId, token, { max });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  const now = new Date();
  let inserted = 0;
  let updated = 0;
  for (const p of posts) {
    const createdTimeSec = p.created_time
      ? Math.floor(new Date(p.created_time).getTime() / 1000)
      : null;
    const values = {
      fanpageId,
      postId: p.id,
      message: p.message ?? null,
      story: p.story ?? null,
      permalinkUrl: p.permalink_url ?? null,
      fullPictureUrl: p.full_picture ?? null,
      statusType: p.status_type ?? null,
      createdTime: createdTimeSec,
      reactionsTotal: p.reactions?.summary?.total_count ?? null,
      commentsTotal: p.comments?.summary?.total_count ?? null,
      sharesTotal: p.shares?.count ?? null,
      updatedAt: now,
    };

    const [existing] = await db
      .select({ id: fanpagePosts.id })
      .from(fanpagePosts)
      .where(
        and(
          eq(fanpagePosts.fanpageId, fanpageId),
          eq(fanpagePosts.postId, p.id),
        ),
      );

    if (existing) {
      await db
        .update(fanpagePosts)
        .set(values)
        .where(eq(fanpagePosts.id, existing.id));
      updated++;
    } else {
      await db.insert(fanpagePosts).values(values);
      inserted++;
    }
  }

  return NextResponse.json({
    ok: true,
    fanpageId,
    found: posts.length,
    inserted,
    updated,
  });
}
