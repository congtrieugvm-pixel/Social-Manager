import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { facebookAccounts } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { readBody } from "@/lib/req-body";
import { getOwnerId } from "@/lib/scope";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ownerId = await getOwnerId();
  let ids: number[] = [];
  try {
    const body = await readBody<{ ids?: number[] }>(req);
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
  await db
    .delete(facebookAccounts)
    .where(
      and(
        inArray(facebookAccounts.id, ids),
        eq(facebookAccounts.ownerUserId, ownerId),
      ),
    );
  return NextResponse.json({ ok: true, deleted: ids.length });
}
