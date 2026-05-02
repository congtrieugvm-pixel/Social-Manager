import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    ids?: number[];
    groupId?: number | null;
    statusId?: number | null;
    countryId?: number | null;
    machineId?: number | null;
    employeeId?: number | null;
  };
  const ids = (body.ids ?? []).filter((n): n is number => Number.isFinite(n));
  if (ids.length === 0) {
    return NextResponse.json({ error: "Thiếu danh sách tài khoản" }, { status: 400 });
  }

  const patch: Partial<typeof accounts.$inferInsert> = { updatedAt: new Date() };
  let touched = false;
  if (body.groupId === null) {
    patch.groupId = null;
    touched = true;
  } else if (typeof body.groupId === "number" && Number.isFinite(body.groupId)) {
    patch.groupId = body.groupId;
    touched = true;
  }
  if (body.statusId === null) {
    patch.statusId = null;
    touched = true;
  } else if (typeof body.statusId === "number" && Number.isFinite(body.statusId)) {
    patch.statusId = body.statusId;
    touched = true;
  }
  if (body.countryId === null) {
    patch.countryId = null;
    touched = true;
  } else if (typeof body.countryId === "number" && Number.isFinite(body.countryId)) {
    patch.countryId = body.countryId;
    touched = true;
  }
  if (body.machineId === null) {
    patch.machineId = null;
    touched = true;
  } else if (typeof body.machineId === "number" && Number.isFinite(body.machineId)) {
    patch.machineId = body.machineId;
    touched = true;
  }
  if (body.employeeId === null) {
    patch.employeeId = null;
    touched = true;
  } else if (typeof body.employeeId === "number" && Number.isFinite(body.employeeId)) {
    patch.employeeId = body.employeeId;
    touched = true;
  }

  if (!touched) {
    return NextResponse.json({ error: "Không có trường nào để cập nhật" }, { status: 400 });
  }

  await db.update(accounts).set(patch).where(inArray(accounts.id, ids));
  return NextResponse.json({ ok: true, updated: ids.length });
}
