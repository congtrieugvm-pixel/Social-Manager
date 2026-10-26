// Shared helpers for the Bookmark Key API routes (YouTube, TikTok, RSS, links).

import { ytChannels } from "@/lib/db/schema";
import { channelUrl } from "@/lib/youtube";
import type { BookmarkItem } from "@/lib/bookmark";

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
