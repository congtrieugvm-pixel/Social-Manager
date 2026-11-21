import { NextResponse } from "next/server";
import { readBody } from "@/lib/req-body";
import { AuthError } from "@/lib/auth";
import { YtError } from "@/lib/youtube";
import { requireExtKey } from "@/lib/ext-auth";
import { addBookmarkLink } from "@/lib/yt-store";

// Save one YouTube channel to Bookmark Key from the browser extension.
// Auth: `Authorization: Bearer <ext key>` (not the web session cookie).
//   POST { url } → { status: "added" | "exists", title }
const noStore = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  try {
    const ownerId = await requireExtKey(req);
    const body = await readBody<{ url?: unknown; note?: unknown }>(req);
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url || url.length > 500) return NextResponse.json({ error: "Thiếu link kênh" }, { status: 400, headers: noStore });
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
    const r = await addBookmarkLink(ownerId, url, null, note);
    return NextResponse.json({ status: r.status, title: r.channel.title, channelId: r.channel.channelId }, { headers: noStore });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status, headers: noStore });
    if (e instanceof YtError) return NextResponse.json({ error: e.message }, { status: 400, headers: noStore });
    return NextResponse.json({ error: "Không lưu được kênh" }, { status: 500, headers: noStore });
  }
}
