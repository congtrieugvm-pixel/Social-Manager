import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { ytChannels } from "@/lib/db/schema";
import { getOwnerId } from "@/lib/scope";
import { readBody } from "@/lib/req-body";
import { AuthError } from "@/lib/auth";
import { fetchFeed } from "@/lib/youtube";
import { toSafeChannel } from "@/lib/yt-store";

const MAX = 20; // feeds per request (Worker subrequest budget)

// POST { ids: number[] } → { channels } — re-read the RSS feeds (6 at a time)
// and store the latest videos; the client sends the list in chunks.
export async function POST(req: Request) {
  try {
    const ownerId = await getOwnerId();
    const body = await readBody<{ ids?: unknown }>(req);
    const ids = (Array.isArray(body.ids) ? body.ids : []).filter((n): n is number => Number.isInteger(n)).slice(0, MAX);
    if (!ids.length) return NextResponse.json({ error: "Chưa chọn kênh" }, { status: 400 });
    const rows = await db
      .select()
      .from(ytChannels)
      .where(and(eq(ytChannels.ownerUserId, ownerId), inArray(ytChannels.id, ids)));
    let next = 0;
    const out: ReturnType<typeof toSafeChannel>[] = [];
    await Promise.all(
      Array.from({ length: Math.min(6, rows.length) }, async () => {
        while (next < rows.length) {
          const r = rows[next++];
          const now = Math.floor(Date.now() / 1000);
          let patch: Partial<typeof ytChannels.$inferInsert>;
          try {
            const feed = await fetchFeed(r.channelId);
            patch = { videos: JSON.stringify(feed.videos), checkedAt: now, checkError: null, ...(feed.title ? { title: feed.title } : {}) };
          } catch (e) {
            // Keep the previous videos; just record the error.
            patch = { checkedAt: now, checkError: e instanceof Error ? e.message : String(e) };
          }
          const [row] = await db.update(ytChannels).set(patch).where(eq(ytChannels.id, r.id)).returning();
          out.push(toSafeChannel(row));
        }
      }),
    );
    return NextResponse.json({ channels: out }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: `Lỗi server: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
}
