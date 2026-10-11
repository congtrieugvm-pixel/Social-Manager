import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { insightPageAssignments, insightPageGroups } from "@/lib/db/schema";
import { getOwnerId } from "@/lib/scope";
import { readBody } from "@/lib/req-body";
import { errorResponse } from "../_util";

// D1 caps bound parameters at 100 per statement.
const IN_CHUNK = 90;
const ROWS_PER_INSERT = 30; // 3 params per row

// POST { pageIds: string[], groupId: number | null }
//   groupId = null → remove the pages from any group ("Chưa phân nhóm").
export async function POST(req: Request) {
  try {
    const ownerId = await getOwnerId();
    const body = await readBody<{ pageIds?: unknown; groupId?: unknown }>(req);
    const pageIds = Array.isArray(body.pageIds)
      ? [...new Set(body.pageIds.filter((p): p is string => typeof p === "string" && /^\d+$/.test(p)))]
      : [];
    if (pageIds.length === 0) return NextResponse.json({ error: "Chưa chọn Trang" }, { status: 400 });
    if (pageIds.length > 2000) return NextResponse.json({ error: "Tối đa 2000 Trang mỗi lần" }, { status: 400 });

    const groupId = body.groupId === null ? null : Number(body.groupId);
    if (groupId !== null) {
      if (!Number.isInteger(groupId)) return NextResponse.json({ error: "groupId không hợp lệ" }, { status: 400 });
      const [g] = await db
        .select({ id: insightPageGroups.id })
        .from(insightPageGroups)
        .where(and(eq(insightPageGroups.id, groupId), eq(insightPageGroups.ownerUserId, ownerId)));
      if (!g) return NextResponse.json({ error: "Không tìm thấy nhóm" }, { status: 404 });
    }

    for (let i = 0; i < pageIds.length; i += IN_CHUNK) {
      await db
        .delete(insightPageAssignments)
        .where(
          and(
            eq(insightPageAssignments.ownerUserId, ownerId),
            inArray(insightPageAssignments.pageId, pageIds.slice(i, i + IN_CHUNK)),
          ),
        );
    }
    if (groupId !== null) {
      for (let i = 0; i < pageIds.length; i += ROWS_PER_INSERT) {
        await db.insert(insightPageAssignments).values(
          pageIds.slice(i, i + ROWS_PER_INSERT).map((pageId) => ({ ownerUserId: ownerId, pageId, groupId })),
        );
      }
    }
    return NextResponse.json({ ok: true, count: pageIds.length });
  } catch (e) {
    return errorResponse(e);
  }
}
