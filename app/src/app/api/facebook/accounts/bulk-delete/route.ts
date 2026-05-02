import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { facebookAccounts } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let ids: number[] = [];
  try {
    const body = (await req.json()) as { ids?: number[] };
    ids = (body.ids ?? []).filter((n): n is number => Number.isFinite(n));
  } catch {
    // empty body → 400 below
  }
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "Thiếu danh sách tài khoản" },
      { status: 400 },
    );
  }
  // Cascades to fanpages (and from there to fanpage_posts / fanpage_snapshots).
  await db.delete(facebookAccounts).where(inArray(facebookAccounts.id, ids));
  return NextResponse.json({ ok: true, deleted: ids.length });
}
