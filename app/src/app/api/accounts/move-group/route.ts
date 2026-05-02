import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { readBody } from "@/lib/req-body";

export async function POST(req: Request) {
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
    .where(inArray(accounts.id, ids));
  return NextResponse.json({ ok: true, updated: ids.length, groupId });
}
