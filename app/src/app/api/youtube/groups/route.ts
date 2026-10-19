import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ytGroups } from "@/lib/db/schema";
import { getOwnerId } from "@/lib/scope";
import { readBody } from "@/lib/req-body";
import { errorResponse } from "../../insight/_util";
import { COLOR_RE } from "@/lib/yt-store";

// POST { name, color?, note? } → { group }
export async function POST(req: Request) {
  try {
    const ownerId = await getOwnerId();
    const body = await readBody<{ name?: unknown; color?: unknown; note?: unknown }>(req);
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (!name) return NextResponse.json({ error: "Chưa nhập tên nhóm" }, { status: 400 });
    const color = typeof body.color === "string" && COLOR_RE.test(body.color) ? body.color : "#5e6ad2";
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 1000) : null;
    const [group] = await db
      .insert(ytGroups)
      .values({ ownerUserId: ownerId, name, color, note })
      .returning({ id: ytGroups.id, name: ytGroups.name, color: ytGroups.color, note: ytGroups.note });
    return NextResponse.json({ group });
  } catch (e) {
    return errorResponse(e);
  }
}
