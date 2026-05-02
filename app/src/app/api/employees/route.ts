import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { employees, accounts } from "@/lib/db/schema";
import { eq, sql, asc } from "drizzle-orm";
import { readBody } from "@/lib/req-body";

export async function GET() {
  const rows = await db
    .select({
      id: employees.id,
      name: employees.name,
      color: employees.color,
      note: employees.note,
      sortOrder: employees.sortOrder,
      createdAt: employees.createdAt,
      count: sql<number>`COUNT(${accounts.id})`.as("count"),
    })
    .from(employees)
    .leftJoin(accounts, eq(accounts.employeeId, employees.id))
    .groupBy(employees.id)
    .orderBy(asc(employees.sortOrder), asc(employees.name));
  return NextResponse.json({ employees: rows });
}

export async function POST(req: Request) {
  const body = await readBody<{
    name?: string;
    color?: string;
    note?: string;
    sortOrder?: number;
  }>(req);
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Thiếu tên nhân viên" }, { status: 400 });
  const color = body.color?.trim() || "#b86a3f";
  const note = body.note?.trim() || null;
  const sortOrder =
    typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)
      ? body.sortOrder
      : 0;
  try {
    const [inserted] = await db
      .insert(employees)
      .values({ name, color, note, sortOrder })
      .returning();
    return NextResponse.json({ employee: inserted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "Tên nhân viên đã tồn tại" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
