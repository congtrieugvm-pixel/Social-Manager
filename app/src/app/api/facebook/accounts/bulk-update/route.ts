import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { facebookAccounts } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { readBody } from "@/lib/req-body";
import { getOwnerId } from "@/lib/scope";

export const runtime = "nodejs";

interface BulkBody {
  ids?: number[];
  groupId?: number | null;
  statusId?: number | null;
  countryId?: number | null;
  machineId?: number | null;
  employeeId?: number | null;
}

export async function POST(req: Request) {
  const ownerId = await getOwnerId();
  const body = await readBody<BulkBody>(req);
  const ids = (body.ids ?? []).filter((n): n is number => Number.isFinite(n));
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "Thiếu danh sách tài khoản" },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const fields: Array<keyof BulkBody> = [
    "groupId",
    "statusId",
    "countryId",
    "machineId",
    "employeeId",
  ];
  let hasField = false;
  for (const f of fields) {
    const v = body[f];
    if (v === null) {
      patch[f] = null;
      hasField = true;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      patch[f] = v;
      hasField = true;
    }
  }
  if (!hasField) {
    return NextResponse.json(
      { error: "Không có field nào để cập nhật" },
      { status: 400 },
    );
  }

  await db
    .update(facebookAccounts)
    .set(patch)
    .where(
      and(
        inArray(facebookAccounts.id, ids),
        eq(facebookAccounts.ownerUserId, ownerId),
      ),
    );
  return NextResponse.json({ ok: true, updated: ids.length });
}
