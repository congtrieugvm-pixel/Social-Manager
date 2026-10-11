import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { insightPageAssignments, insightPageGroups } from "@/lib/db/schema";
import { getOwnerId } from "@/lib/scope";
import { readBody } from "@/lib/req-body";
import { errorResponse, parseId } from "../../_util";

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// PATCH { name?, color? }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await getOwnerId();
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "id không hợp lệ" }, { status: 400 });
    const body = await readBody<{ name?: string; color?: string }>(req);
    const patch: { name?: string; color?: string } = {};
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) return NextResponse.json({ error: "Tên nhóm không được trống" }, { status: 400 });
      if (name.length > 60) return NextResponse.json({ error: "Tên nhóm tối đa 60 ký tự" }, { status: 400 });
      patch.name = name;
    }
    if (body.color !== undefined) {
      if (!COLOR_RE.test(body.color)) return NextResponse.json({ error: "Màu không hợp lệ" }, { status: 400 });
      patch.color = body.color;
    }
    if (!Object.keys(patch).length) return NextResponse.json({ error: "Không có gì để sửa" }, { status: 400 });
    const rows = await db
      .update(insightPageGroups)
      .set(patch)
      .where(and(eq(insightPageGroups.id, id), eq(insightPageGroups.ownerUserId, ownerId)))
      .returning({ id: insightPageGroups.id, name: insightPageGroups.name, color: insightPageGroups.color });
    if (!rows.length) return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 });
    return NextResponse.json({ group: rows[0] });
  } catch (e) {
    return errorResponse(e);
  }
}

// DELETE — the group's pages become "Chưa phân nhóm".
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await getOwnerId();
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "id không hợp lệ" }, { status: 400 });
    // Explicit delete of assignments too: don't rely on FK cascade being on.
    await db
      .delete(insightPageAssignments)
      .where(and(eq(insightPageAssignments.groupId, id), eq(insightPageAssignments.ownerUserId, ownerId)));
    const rows = await db
      .delete(insightPageGroups)
      .where(and(eq(insightPageGroups.id, id), eq(insightPageGroups.ownerUserId, ownerId)))
      .returning({ id: insightPageGroups.id });
    if (!rows.length) return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
