import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { insightGroups, fanpages } from "@/lib/db/schema";
import { and, eq, sql, asc  } from "drizzle-orm";
import { readBody } from "@/lib/req-body";
import { getOwnerId } from "@/lib/scope";

export const runtime = "nodejs";

export async function GET() {
  const ownerId = await getOwnerId();
  const rows = await db
    .select({
      id: insightGroups.id,
      name: insightGroups.name,
      color: insightGroups.color,
      description: insightGroups.description,
      sortOrder: insightGroups.sortOrder,
      createdAt: insightGroups.createdAt,
      count: sql<number>`COUNT(${fanpages.id})`.as("count"),
    })
    .from(insightGroups)
    .leftJoin(fanpages, eq(fanpages.insightGroupId, insightGroups.id))
    .groupBy(insightGroups.id)
    .where(eq(insightGroups.ownerUserId, ownerId)).orderBy(asc(insightGroups.sortOrder), asc(insightGroups.name));
  return NextResponse.json({ groups: rows });
}

export async function POST(req: Request) {
  const ownerId = await getOwnerId();
  const body = await readBody<{
    name?: string;
    color?: string;
    description?: string;
    sortOrder?: number;
  }>(req);
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Thiếu tên nhóm" }, { status: 400 });
  const color = body.color?.trim() || "#5e6ad2";
  try {
    const [inserted] = await db
      .insert(insightGroups)
      .values({ ownerUserId: ownerId,
        name,
        color,
        description: body.description?.trim() || null,
        sortOrder: Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0,
      })
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
