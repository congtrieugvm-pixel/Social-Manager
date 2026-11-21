// Shared helpers for the Bookmark Key API routes (YouTube, TikTok, RSS, links).

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ytChannels } from "@/lib/db/schema";
import { channelUrl } from "@/lib/youtube";
import { mergeItems, resolveBookmark, type BookmarkItem } from "@/lib/bookmark";

type Row = typeof ytChannels.$inferSelect;

export interface SafeChannel {
  id: number;
  channelId: string;
  kind: string;
  title: string;
  handle: string | null;
  avatar: string | null;
  url: string;
  groupId: number | null;
  note: string | null;
  videos: BookmarkItem[];
  lastSeenAt: number;
  checkedAt: number | null;
  checkError: string | null;
  /** Videos published after the user last opened the channel. */
  unread: number;
}

export function parseVideos(json: string | null): BookmarkItem[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function toSafeChannel(r: Row): SafeChannel {
  const videos = parseVideos(r.videos);
  return {
    id: r.id,
    channelId: r.channelId,
    kind: r.kind,
    title: r.title,
    handle: r.handle,
    avatar: r.avatar,
    url: r.url ?? channelUrl(r.channelId, r.handle),
    groupId: r.groupId,
    note: r.note,
    videos,
    lastSeenAt: r.lastSeenAt,
    checkedAt: r.checkedAt,
    checkError: r.checkError,
    unread: videos.filter((v) => Date.parse(v.published) / 1000 > r.lastSeenAt).length,
  };
}

export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Resolve one bookmark link and save it for the owner (deduped). Shared by the web API and the
 *  extension endpoint. Throws on resolve failure; the caller decides how to report it. */
export async function addBookmarkLink(ownerId: number, input: string, groupId: number | null, note: string | null):
    Promise<{ input: string; status: "added" | "exists"; channel: SafeChannel }> {
  const info = await resolveBookmark(input);
  const [dup] = await db.select().from(ytChannels)
    .where(and(eq(ytChannels.ownerUserId, ownerId), eq(ytChannels.channelId, info.key)));
  if (dup) return { input, status: "exists", channel: toSafeChannel(dup) };
  const now = Math.floor(Date.now() / 1000);
  const [row] = await db.insert(ytChannels).values({
    ownerUserId: ownerId, channelId: info.key, kind: info.kind, url: info.url, feedUrl: info.feedUrl,
    title: info.title, handle: info.handle, avatar: info.avatar, groupId, note,
    videos: JSON.stringify(mergeItems(info.items, [])),
    lastSeenAt: Math.ceil(Date.now() / 1000), checkedAt: now, checkError: info.checkError,
  }).returning();
  return { input, status: "added", channel: toSafeChannel(row) };
}
