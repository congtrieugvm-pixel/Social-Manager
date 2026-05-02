import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { statuses } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { readBody } from "@/lib/req-body";
import { getOwnerId } from "@/lib/scope";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ownerId = await getOwnerId();
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await readBody<{
    name?: string;
    color?: string;
    sortOrder?: number;
  }>(req);
  const patch: Partial<typeof statuses.$inferInsert> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.color === "string" && body.color.trim()) patch.color = body.color.trim();
  if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)) {
    patch.sortOrder = body.sortOrder;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Không có trường nào để cập nhật" }, { status: 400 });
  }

  try {
    await db
      .update(statuses)
      .set(patch)
      .where(and(eq(statuses.id, id), eq(statuses.ownerUserId, ownerId)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "Tên trạng thái đã tồn tại" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ownerId = await getOwnerId();
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  await db
    .delete(statuses)
    .where(and(eq(statuses.id, id), eq(statuses.ownerUserId, ownerId)));
  return NextResponse.json({ ok: true });
}
