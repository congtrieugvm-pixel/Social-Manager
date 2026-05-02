import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { groups, accounts } from "@/lib/db/schema";
import { eq, sql, asc } from "drizzle-orm";
import { readBody } from "@/lib/req-body";

export async function GET() {
  const rows = await db
    .select({
      id: groups.id,
      name: groups.name,
      color: groups.color,
      description: groups.description,
      createdAt: groups.createdAt,
      count: sql<number>`COUNT(${accounts.id})`.as("count"),
    })
    .from(groups)
    .leftJoin(accounts, eq(accounts.groupId, groups.id))
    .groupBy(groups.id)
    .orderBy(asc(groups.name));
  return NextResponse.json({ groups: rows });
}

export async function POST(req: Request) {
  const body = await readBody<{ name?: string; color?: string; description?: string }>(req);
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Thiếu tên nhóm" }, { status: 400 });
  const color = body.color?.trim() || "#d94a1f";
  try {
    const [inserted] = await db
      .insert(groups)
      .values({ name, color, description: body.description?.trim() || null })
      .returning();
    return NextResponse.json({ group: inserted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "Tên nhóm đã tồn tại" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
