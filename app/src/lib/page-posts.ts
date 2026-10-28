// Page posts for the Insight "Nội dung" tab — latest posts per page with
// lifetime reach/views and engagement, read through the token pool in one
// Graph Batch call per group of pages (fetchPageBatch).
//
// Verified live (Graph v23, 2026-10): post_impressions_unique / post_impressions
// / post_engaged_users fail #100; post_total_media_view_unique (unique
// viewers ≈ reach) and post_media_view (views) work, and can be read inline
// with the post list: insights.metric(…).period(lifetime).

import { fetchPageBatch, type ReachCandidate } from "@/lib/page-reach";

export const POSTS_PER_PAGE = 25;

const POST_FIELDS = [
  "id",
  "message",
  "created_time",
  "permalink_url",
  "full_picture",
  "status_type",
  "shares",
  "reactions.summary(total_count).limit(0)",
  "comments.summary(total_count).limit(0)",
  "insights.metric(post_total_media_view_unique,post_media_view).period(lifetime)",
].join(",");

export interface PagePost {
  id: string;
  message: string | null;
  createdTime: string; // ISO
  permalink: string | null;
  picture: string | null;
  type: string | null; // status_type: added_video, added_photos, mobile_status_update, …
  reactions: number;
  comments: number;
  shares: number;
  reach: number | null; // post_total_media_view_unique (lifetime)
  views: number | null; // post_media_view (lifetime)
}

export interface PagePosts {
  posts: PagePost[];
}

interface RawPost {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
  full_picture?: string;
  status_type?: string;
  shares?: { count?: number };
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  insights?: { data?: Array<{ name: string; values?: Array<{ value: unknown }> }> };
}

function metric(p: RawPost, name: string): number | null {
  const v = p.insights?.data?.find((x) => x.name === name)?.values?.[0]?.value;
  return typeof v === "number" ? v : null;
}

export function parsePosts(data: unknown): PagePosts {
  const raw = (data as { data?: RawPost[] })?.data ?? [];
  return {
    posts: raw.map((p) => ({
      id: p.id,
      message: p.message ? p.message.slice(0, 500) : null,
      createdTime: p.created_time,
      permalink: p.permalink_url ?? null,
      picture: p.full_picture ?? null,
      type: p.status_type ?? null,
      reactions: p.reactions?.summary?.total_count ?? 0,
      comments: p.comments?.summary?.total_count ?? 0,
      shares: p.shares?.count ?? 0,
      reach: metric(p, "post_total_media_view_unique"),
      views: metric(p, "post_media_view"),
    })),
  };
}

export function fetchPostsBatch(items: Array<{ pageId: string; candidates: ReachCandidate[] }>) {
  return fetchPageBatch<PagePosts>(
    items,
    (pageId) => `/${pageId}/published_posts?fields=${POST_FIELDS}&limit=${POSTS_PER_PAGE}`,
    parsePosts,
  );
}

// ── Scheduled posts ──────────────────────────────────────────────────────
// GET /{page-id}/scheduled_posts (Page token; pages_read_engagement or
// pages_manage_metadata …). Read alongside published_posts; a page whose
// scheduled list fails keeps its published posts (error kept per page).

export const SCHEDULED_PER_PAGE = 50;

const SCHEDULED_FIELDS = ["id", "message", "created_time", "scheduled_publish_time", "permalink_url", "full_picture", "status_type"].join(",");

export interface ScheduledPost {
  id: string;
  message: string | null;
  scheduledTime: string | null; // ISO; null if Graph gave none
  createdTime: string | null;
  permalink: string | null;
  picture: string | null;
  type: string | null;
}

interface RawScheduled {
  id: string;
  message?: string;
  created_time?: string;
  scheduled_publish_time?: number | string;
  permalink_url?: string;
  full_picture?: string;
  status_type?: string;
}

/** scheduled_publish_time comes as unix seconds (number or numeric string) or ISO. */
function toIso(v: number | string | undefined): string | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : /^\d+$/.test(v) ? Number(v) : NaN;
  const ms = Number.isFinite(n) ? n * 1000 : Date.parse(String(v));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function parseScheduled(data: unknown): { scheduled: ScheduledPost[] } {
  const raw = (data as { data?: RawScheduled[] })?.data ?? [];
  return {
    scheduled: raw.map((p) => ({
      id: p.id,
      message: p.message ? p.message.slice(0, 500) : null,
      scheduledTime: toIso(p.scheduled_publish_time),
      createdTime: p.created_time ?? null,
      permalink: p.permalink_url ?? null,
      picture: p.full_picture ?? null,
      type: p.status_type ?? null,
    })),
  };
}

export function fetchScheduledBatch(items: Array<{ pageId: string; candidates: ReachCandidate[] }>) {
  return fetchPageBatch<{ scheduled: ScheduledPost[] }>(
    items,
    (pageId) => `/${pageId}/scheduled_posts?fields=${SCHEDULED_FIELDS}&limit=${SCHEDULED_PER_PAGE}`,
    parseScheduled,
  );
}
