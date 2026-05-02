import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fanpages } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { readBody } from "@/lib/req-body";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let ids: number[] = [];
  try {
    const body = await readBody<{ ids?: number[] }>(req);
    ids = (body.ids ?? []).filter((n): n is number => Number.isFinite(n));
  } catch {
    // empty body → 400 below
  }
  if (ids.length === 0) {
    return NextResponse.json({ error: "Thiếu danh sách fanpage" }, { status: 400 });
  }
  await db.delete(fanpages).where(inArray(fanpages.id, ids));
  return NextResponse.json({ ok: true, deleted: ids.length });
}
