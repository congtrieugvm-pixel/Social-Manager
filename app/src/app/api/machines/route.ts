import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { machines, accounts } from "@/lib/db/schema";
import { eq, sql, asc } from "drizzle-orm";
import { readBody } from "@/lib/req-body";

export async function GET() {
  const rows = await db
    .select({
      id: machines.id,
      name: machines.name,
      color: machines.color,
      note: machines.note,
      sortOrder: machines.sortOrder,
      createdAt: machines.createdAt,
      count: sql<number>`COUNT(${accounts.id})`.as("count"),
    })
    .from(machines)
    .leftJoin(accounts, eq(accounts.machineId, machines.id))
    .groupBy(machines.id)
    .orderBy(asc(machines.sortOrder), asc(machines.name));
  return NextResponse.json({ machines: rows });
}

export async function POST(req: Request) {
  const body = await readBody<{
    name?: string;
    color?: string;
    note?: string;
    sortOrder?: number;
  }>(req);
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Thiếu tên máy" }, { status: 400 });
  const color = body.color?.trim() || "#3f8fb0";
  const note = body.note?.trim() || null;
  const sortOrder =
    typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)
      ? body.sortOrder
      : 0;
  try {
    const [inserted] = await db
      .insert(machines)
      .values({ name, color, note, sortOrder })
      .returning();
    return NextResponse.json({ machine: inserted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "Tên máy đã tồn tại" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
