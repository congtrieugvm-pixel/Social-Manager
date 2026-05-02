import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { statuses, accounts } from "@/lib/db/schema";
import { and, eq, sql, asc  } from "drizzle-orm";
import { readBody } from "@/lib/req-body";
import { getOwnerId } from "@/lib/scope";

export async function GET() {
  const ownerId = await getOwnerId();
  const rows = await db
    .select({
      id: statuses.id,
      name: statuses.name,
      color: statuses.color,
      sortOrder: statuses.sortOrder,
      createdAt: statuses.createdAt,
      count: sql<number>`COUNT(${accounts.id})`.as("count"),
    })
    .from(statuses)
    .leftJoin(accounts, eq(accounts.statusId, statuses.id))
    .groupBy(statuses.id)
    .where(eq(statuses.ownerUserId, ownerId)).orderBy(asc(statuses.sortOrder), asc(statuses.name));
  return NextResponse.json({ statuses: rows });
}

export async function POST(req: Request) {
  const ownerId = await getOwnerId();
  const body = await readBody<{
    name?: string;
    color?: string;
    sortOrder?: number;
  }>(req);
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Thiếu tên trạng thái" }, { status: 400 });
  const color = body.color?.trim() || "#7a766a";
  const sortOrder =
    typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)
      ? body.sortOrder
      : 0;
  try {
    const [inserted] = await db
      .insert(statuses)
      .values({ ownerUserId: ownerId, name, color, sortOrder })
      .returning();
    return NextResponse.json({ status: inserted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "Tên trạng thái đã tồn tại" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
