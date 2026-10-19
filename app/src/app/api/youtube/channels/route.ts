import { NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ytChannels, ytGroups } from "@/lib/db/schema";
import { getOwnerId } from "@/lib/scope";
import { readBody } from "@/lib/req-body";
import { AuthError } from "@/lib/auth";
import { YtError, fetchFeed, resolveChannel } from "@/lib/youtube";
import { toSafeChannel } from "@/lib/yt-store";

const MAX_LINKS = 20;

function fail(e: unknown) {
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: `Lỗi server: ${msg}` }, { status: 500 });
}

// GET → { channels, groups }
export async function GET() {
  try {
    const ownerId = await getOwnerId();
    const [rows, groups] = await Promise.all([
      db.select().from(ytChannels).where(eq(ytChannels.ownerUserId, ownerId)).orderBy(desc(ytChannels.id)),
      db
        .select({ id: ytGroups.id, name: ytGroups.name, color: ytGroups.color, note: ytGroups.note })
        .from(ytGroups)
        .where(eq(ytGroups.ownerUserId, ownerId))
        .orderBy(asc(ytGroups.name)),
    ]);
    return NextResponse.json({ channels: rows.map(toSafeChannel), groups }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

// POST { links: string[], groupId?, note? } → { results: [{ input, status, channel?, error? }] }
// status: "added" | "exists" | "error". New channels start with 0 unread.
export async function POST(req: Request) {
  try {
    const ownerId = await getOwnerId();
    const body = await readBody<{ links?: unknown; groupId?: unknown; note?: unknown }>(req);
    const links = (Array.isArray(body.links) ? body.links : [])
      .filter((l): l is string => typeof l === "string" && l.trim().length > 0)
      .map((l) => l.trim())
      .slice(0, MAX_LINKS);
    if (links.length === 0) return NextResponse.json({ error: "Chưa nhập link YouTube" }, { status: 400 });
    let groupId: number | null = null;
    if (typeof body.groupId === "number") {
      const [g] = await db
        .select({ id: ytGroups.id })
        .from(ytGroups)
        .where(and(eq(ytGroups.id, body.groupId), eq(ytGroups.ownerUserId, ownerId)));
      groupId = g ? g.id : null;
    }
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;

    const results: Array<{ input: string; status: "added" | "exists" | "error"; channel?: ReturnType<typeof toSafeChannel>; error?: string }> = [];
    for (const input of links) {
      try {
        const info = await resolveChannel(input);
        const [dup] = await db
          .select()
          .from(ytChannels)
          .where(and(eq(ytChannels.ownerUserId, ownerId), eq(ytChannels.channelId, info.channelId)));
        if (dup) {
          results.push({ input, status: "exists", channel: toSafeChannel(dup) });
          continue;
        }
        let videos: Awaited<ReturnType<typeof fetchFeed>>["videos"] = [];
        let checkError: string | null = null;
        try {
          videos = (await fetchFeed(info.channelId)).videos;
        } catch (e) {
          checkError = e instanceof Error ? e.message : String(e);
        }
        const now = Math.floor(Date.now() / 1000);
        const [row] = await db
          .insert(ytChannels)
          .values({
            ownerUserId: ownerId,
            channelId: info.channelId,
            title: info.title,
            handle: info.handle,
            avatar: info.avatar,
            groupId,
            note,
            videos: JSON.stringify(videos),
            lastSeenAt: now,
            checkedAt: now,
            checkError,
          })
          .returning();
        results.push({ input, status: "added", channel: toSafeChannel(row) });
      } catch (e) {
        results.push({ input, status: "error", error: e instanceof YtError ? e.message : `Lỗi: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    return NextResponse.json({ results });
  } catch (e) {
    return fail(e);
  }
}
