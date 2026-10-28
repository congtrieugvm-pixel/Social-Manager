import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { fbCommentRules } from "@/lib/db/schema";
import { getOwnerId } from "@/lib/scope";
import { readBody } from "@/lib/req-body";
import { cleanRule, type RuleInput } from "@/lib/autocomment";
import { errorResponse, parseId } from "../../_util";

// PATCH { targetType?, targetId?, comments?, enabled? } — turning a rule back on
// starts from now (posts made while it was off get no comment).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await getOwnerId();
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "id không hợp lệ" }, { status: 400 });
    const [cur] = await db.select().from(fbCommentRules).where(and(eq(fbCommentRules.id, id), eq(fbCommentRules.ownerUserId, ownerId)));
    if (!cur) return NextResponse.json({ error: "Không tìm thấy cài đặt" }, { status: 404 });
    const r = await cleanRule(ownerId, await readBody<RuleInput>(req), true);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
    const patch: Partial<typeof fbCommentRules.$inferInsert> = { ...r.value };
    if (r.value.enabled === true && !cur.enabled) patch.activeSince = Math.floor(Date.now() / 1000);
    if (!Object.keys(patch).length) return NextResponse.json({ error: "Không có gì để sửa" }, { status: 400 });
    await db.update(fbCommentRules).set(patch).where(eq(fbCommentRules.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await getOwnerId();
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "id không hợp lệ" }, { status: 400 });
    const rows = await db
      .delete(fbCommentRules)
      .where(and(eq(fbCommentRules.id, id), eq(fbCommentRules.ownerUserId, ownerId)))
      .returning({ id: fbCommentRules.id });
    if (!rows.length) return NextResponse.json({ error: "Không tìm thấy cài đặt" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
