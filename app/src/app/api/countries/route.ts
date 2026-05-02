import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { countries, accounts } from "@/lib/db/schema";
import { eq, sql, asc } from "drizzle-orm";
import { readBody } from "@/lib/req-body";

export async function GET() {
  const rows = await db
    .select({
      id: countries.id,
      name: countries.name,
      code: countries.code,
      color: countries.color,
      sortOrder: countries.sortOrder,
      createdAt: countries.createdAt,
      count: sql<number>`COUNT(${accounts.id})`.as("count"),
    })
    .from(countries)
    .leftJoin(accounts, eq(accounts.countryId, countries.id))
    .groupBy(countries.id)
    .orderBy(asc(countries.sortOrder), asc(countries.name));
  return NextResponse.json({ countries: rows });
}

export async function POST(req: Request) {
  const body = await readBody<{
    name?: string;
    code?: string;
    color?: string;
    sortOrder?: number;
  }>(req);
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Thiếu tên quốc gia" }, { status: 400 });
  const code = body.code?.trim() || null;
  const color = body.color?.trim() || "#5e6ad2";
  const sortOrder =
    typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)
      ? body.sortOrder
      : 0;
  try {
    const [inserted] = await db
      .insert(countries)
      .values({ name, code, color, sortOrder })
      .returning();
    return NextResponse.json({ country: inserted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "Tên quốc gia đã tồn tại" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
