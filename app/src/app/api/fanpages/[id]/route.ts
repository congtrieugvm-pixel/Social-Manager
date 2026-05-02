import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fanpages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  await db.delete(fanpages).where(eq(fanpages.id, id));
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const body = (await req.json()) as {
    fbAccountId?: number | null;
    insightGroupId?: number | null;
  };
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.fbAccountId === "number" && Number.isFinite(body.fbAccountId)) {
    patch.fbAccountId = body.fbAccountId;
  }
  if (body.insightGroupId === null) {
    patch.insightGroupId = null;
  } else if (
    typeof body.insightGroupId === "number" &&
    Number.isFinite(body.insightGroupId)
  ) {
    patch.insightGroupId = body.insightGroupId;
  }
  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "Không có thay đổi" }, { status: 400 });
  }
  await db.update(fanpages).set(patch).where(eq(fanpages.id, id));
  return NextResponse.json({ ok: true });
}
