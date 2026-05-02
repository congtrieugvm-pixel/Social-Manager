import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { readBody } from "@/lib/req-body";
import { getOwnerId } from "@/lib/scope";

export async function POST(req: Request) {
  const ownerId = await getOwnerId();
  const body = await readBody<{ ids?: number[]; groupId?: number | null }>(req);
  const ids = (body.ids ?? []).filter((n): n is number => Number.isFinite(n));
  if (ids.length === 0) {
    return NextResponse.json({ error: "Thiếu danh sách tài khoản" }, { status: 400 });
  }
  const groupId =
    body.groupId === null
      ? null
      : typeof body.groupId === "number" && Number.isFinite(body.groupId)
        ? body.groupId
        : null;

  await db
    .update(accounts)
    .set({ groupId, updatedAt: new Date() })
    .where(and(inArray(accounts.id, ids), eq(accounts.ownerUserId, ownerId)));
  return NextResponse.json({ ok: true, updated: ids.length, groupId });
}
