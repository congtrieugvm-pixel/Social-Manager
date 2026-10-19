import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ytChannels, ytGroups } from "@/lib/db/schema";
import { getOwnerId } from "@/lib/scope";
import { readBody } from "@/lib/req-body";
import { errorResponse, parseId } from "../../../insight/_util";
import { COLOR_RE } from "@/lib/yt-store";

// PATCH { name?, color?, note? } → { group }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await getOwnerId();
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "id không hợp lệ" }, { status: 400 });
    const body = await readBody<{ name?: unknown; color?: unknown; note?: unknown }>(req);
    const patch: { name?: string; color?: string; note?: string | null } = {};
    if (typeof body.name === "string") {
      const name = body.name.trim().slice(0, 80);
      if (!name) return NextResponse.json({ error: "Tên nhóm trống" }, { status: 400 });
      patch.name = name;
    }
    if (typeof body.color === "string" && COLOR_RE.test(body.color)) patch.color = body.color;
    if (typeof body.note === "string") patch.note = body.note.trim().slice(0, 1000) || null;
    if (!Object.keys(patch).length) return NextResponse.json({ error: "Không có gì để sửa" }, { status: 400 });
    const [group] = await db
      .update(ytGroups)
      .set(patch)
      .where(and(eq(ytGroups.id, id), eq(ytGroups.ownerUserId, ownerId)))
      .returning({ id: ytGroups.id, name: ytGroups.name, color: ytGroups.color, note: ytGroups.note });
    if (!group) return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 });
    return NextResponse.json({ group });
  } catch (e) {
    return errorResponse(e);
  }
}

// DELETE → channels in the group become ungrouped.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await getOwnerId();
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "id không hợp lệ" }, { status: 400 });
    // D1 doesn't always enforce FK actions; clear explicitly.
    await db
      .update(ytChannels)
      .set({ groupId: null })
      .where(and(eq(ytChannels.groupId, id), eq(ytChannels.ownerUserId, ownerId)));
    const rows = await db
      .delete(ytGroups)
      .where(and(eq(ytGroups.id, id), eq(ytGroups.ownerUserId, ownerId)))
      .returning({ id: ytGroups.id });
    if (!rows.length) return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
