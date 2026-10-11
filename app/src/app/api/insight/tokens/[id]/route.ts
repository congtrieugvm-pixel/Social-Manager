import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { insightTokens } from "@/lib/db/schema";
import { getOwnerId } from "@/lib/scope";
import { readBody } from "@/lib/req-body";
import { forgetToken } from "@/lib/page-reach";
import { errorResponse, parseId } from "../../_util";

// PATCH { label } — rename a token.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await getOwnerId();
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "id không hợp lệ" }, { status: 400 });
    const body = await readBody<{ label?: string }>(req);
    const rows = await db
      .update(insightTokens)
      .set({ label: body.label?.trim() || null })
      .where(and(eq(insightTokens.id, id), eq(insightTokens.ownerUserId, ownerId)))
      .returning({ id: insightTokens.id });
    if (!rows.length) return NextResponse.json({ error: "Không tìm thấy token" }, { status: 404 });
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
      .delete(insightTokens)
      .where(and(eq(insightTokens.id, id), eq(insightTokens.ownerUserId, ownerId)))
      .returning({ id: insightTokens.id });
    if (!rows.length) return NextResponse.json({ error: "Không tìm thấy token" }, { status: 404 });
    forgetToken(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
