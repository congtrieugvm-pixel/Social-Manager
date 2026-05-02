import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { groups, accounts } from "@/lib/db/schema";
import { and, eq, sql, asc } from "drizzle-orm";
import { readBody } from "@/lib/req-body";
import { getOwnerId } from "@/lib/scope";

export async function GET() {
  const ownerId = await getOwnerId();
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
    .where(eq(groups.ownerUserId, ownerId))
    .groupBy(groups.id)
    .orderBy(asc(groups.name));
  return NextResponse.json({ groups: rows });
}

export async function POST(req: Request) {
  const ownerId = await getOwnerId();
  const body = await readBody<{ name?: string; color?: string; description?: string }>(req);
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Thiếu tên nhóm" }, { status: 400 });
  const color = body.color?.trim() || "#d94a1f";
  // Per-user uniqueness: name must be unique within this user's groups,
  // not globally (different users can each have a "Default").
  const dup = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.ownerUserId, ownerId), eq(groups.name, name)));
  if (dup[0]) return NextResponse.json({ error: "Tên nhóm đã tồn tại" }, { status: 409 });
  try {
    const [inserted] = await db
      .insert(groups)
      .values({
        ownerUserId: ownerId,
        name,
        color,
        description: body.description?.trim() || null,
      })
      .returning();
    return NextResponse.json({ group: inserted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
