import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

export async function POST(req: Request) {
  const body = (await req.json()) as { ids?: number[] };
  const ids = (body.ids ?? []).filter((n): n is number => Number.isFinite(n));
  if (ids.length === 0) {
    return NextResponse.json({ error: "Thiếu danh sách tài khoản" }, { status: 400 });
  }
  await db.delete(accounts).where(inArray(accounts.id, ids));
  return NextResponse.json({ ok: true, deleted: ids.length });
}
