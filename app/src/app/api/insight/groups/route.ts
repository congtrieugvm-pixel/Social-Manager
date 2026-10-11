import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { insightPageAssignments, insightPageGroups } from "@/lib/db/schema";
import { getOwnerId } from "@/lib/scope";
import { readBody } from "@/lib/req-body";
import { errorResponse } from "../_util";

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// GET → { groups: [{ id, name, color }], assignments: { [pageId]: groupId } }
export async function GET() {
  try {
    const ownerId = await getOwnerId();
    const groups = await db
      .select({ id: insightPageGroups.id, name: insightPageGroups.name, color: insightPageGroups.color })
      .from(insightPageGroups)
      .where(eq(insightPageGroups.ownerUserId, ownerId))
      .orderBy(asc(insightPageGroups.sortOrder), asc(insightPageGroups.name));
    const rows = await db
      .select({ pageId: insightPageAssignments.pageId, groupId: insightPageAssignments.groupId })
      .from(insightPageAssignments)
      .where(eq(insightPageAssignments.ownerUserId, ownerId));
    const assignments: Record<string, number> = {};
    for (const r of rows) assignments[r.pageId] = r.groupId;
    return NextResponse.json({ groups, assignments });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST { name, color? } → { group }
export async function POST(req: Request) {
  try {
    const ownerId = await getOwnerId();
    const body = await readBody<{ name?: string; color?: string }>(req);
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: "Chưa nhập tên nhóm" }, { status: 400 });
    if (name.length > 60) return NextResponse.json({ error: "Tên nhóm tối đa 60 ký tự" }, { status: 400 });
    const color = body.color && COLOR_RE.test(body.color) ? body.color : "#5e6ad2";
    const [group] = await db
      .insert(insightPageGroups)
      .values({ ownerUserId: ownerId, name, color })
      .returning({ id: insightPageGroups.id, name: insightPageGroups.name, color: insightPageGroups.color });
    return NextResponse.json({ group });
  } catch (e) {
    return errorResponse(e);
  }
}
