// Shared helpers for the Bookmark Key (YouTube) API routes.

import { ytChannels } from "@/lib/db/schema";
import { channelUrl, type YtVideo } from "@/lib/youtube";

type Row = typeof ytChannels.$inferSelect;

export interface SafeChannel {
  id: number;
  channelId: string;
  title: string;
  handle: string | null;
  avatar: string | null;
  url: string;
  groupId: number | null;
  note: string | null;
  videos: YtVideo[];
  lastSeenAt: number;
  checkedAt: number | null;
  checkError: string | null;
  /** Videos published after the user last opened the channel. */
  unread: number;
}

export function parseVideos(json: string | null): YtVideo[] {
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
    title: r.title,
    handle: r.handle,
    avatar: r.avatar,
    url: channelUrl(r.channelId, r.handle),
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
