import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { insightGroups } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { readBody } from "@/lib/req-body";
import { getOwnerId } from "@/lib/scope";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ownerId = await getOwnerId();
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await readBody<{
    name?: string;
    color?: string;
    description?: string;
    sortOrder?: number;
  }>(req);
  const patch: Partial<typeof insightGroups.$inferInsert> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.color === "string" && body.color.trim()) patch.color = body.color.trim();
  if (typeof body.description === "string") patch.description = body.description.trim() || null;
  if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder))
    patch.sortOrder = body.sortOrder;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Không có trường nào để cập nhật" }, { status: 400 });
  }

  try {
    await db
      .update(insightGroups)
      .set(patch)
      .where(and(eq(insightGroups.id, id), eq(insightGroups.ownerUserId, ownerId)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "Tên nhóm đã tồn tại" }, { status: 409 });
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
    .delete(insightGroups)
    .where(and(eq(insightGroups.id, id), eq(insightGroups.ownerUserId, ownerId)));
  return NextResponse.json({ ok: true });
}
