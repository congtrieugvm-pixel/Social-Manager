import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ytChannels, ytGroups } from "@/lib/db/schema";
import { getOwnerId } from "@/lib/scope";
import { readBody } from "@/lib/req-body";
import { AuthError } from "@/lib/auth";
import { toSafeChannel } from "@/lib/yt-store";

function fail(e: unknown) {
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
  return NextResponse.json({ error: `Lỗi server: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
}

const idOf = async (ctx: { params: Promise<{ id: string }> }) => {
  const n = Number((await ctx.params).id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// PATCH { groupId?: number | null, note?: string } → { channel }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await getOwnerId();
    const id = await idOf(ctx);
    if (!id) return NextResponse.json({ error: "id không hợp lệ" }, { status: 400 });
    const body = await readBody<{ groupId?: unknown; note?: unknown }>(req);
    const patch: { groupId?: number | null; note?: string | null } = {};
    if (body.groupId === null) patch.groupId = null;
    else if (typeof body.groupId === "number") {
      const [g] = await db
        .select({ id: ytGroups.id })
        .from(ytGroups)
        .where(and(eq(ytGroups.id, body.groupId), eq(ytGroups.ownerUserId, ownerId)));
      if (!g) return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 });
      patch.groupId = g.id;
    }
    if (typeof body.note === "string") patch.note = body.note.trim().slice(0, 500) || null;
    if (!Object.keys(patch).length) return NextResponse.json({ error: "Không có gì để sửa" }, { status: 400 });
    const [row] = await db
      .update(ytChannels)
      .set(patch)
      .where(and(eq(ytChannels.id, id), eq(ytChannels.ownerUserId, ownerId)))
      .returning();
    if (!row) return NextResponse.json({ error: "Không tìm thấy kênh" }, { status: 404 });
    return NextResponse.json({ channel: toSafeChannel(row) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await getOwnerId();
    const id = await idOf(ctx);
    if (!id) return NextResponse.json({ error: "id không hợp lệ" }, { status: 400 });
    const rows = await db
      .delete(ytChannels)
      .where(and(eq(ytChannels.id, id), eq(ytChannels.ownerUserId, ownerId)))
      .returning({ id: ytChannels.id });
    if (!rows.length) return NextResponse.json({ error: "Không tìm thấy kênh" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

// POST → mark as seen: the red badge (new videos) clears.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await getOwnerId();
    const id = await idOf(ctx);
    if (!id) return NextResponse.json({ error: "id không hợp lệ" }, { status: 400 });
    const [row] = await db
      .update(ytChannels)
      // Round up: an item published earlier in this same second is seen too.
      .set({ lastSeenAt: Math.ceil(Date.now() / 1000) })
      .where(and(eq(ytChannels.id, id), eq(ytChannels.ownerUserId, ownerId)))
      .returning();
    if (!row) return NextResponse.json({ error: "Không tìm thấy kênh" }, { status: 404 });
    return NextResponse.json({ channel: toSafeChannel(row) });
  } catch (e) {
    return fail(e);
  }
}
