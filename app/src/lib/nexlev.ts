// NexLev REST API (https://docs.nexlev.io/docs/api) — niche research for
// Bookmark Key. Server-only: the key lives in NEXLEV_API_KEY (Cloudflare
// secret / .env.local) and never reaches the browser.
//
// Quota per call (NexLev bills the account, failed calls are free):
//   youtube search 1 · similar channels 20 (levels 1-3) · niche overview 20
// Niche Finder and Faceless Outliers exist only on NexLev's MCP server, which
// accepts the same API key as a Bearer token (stateless JSON-RPC over HTTP,
// counted against the account's MCP tool-call limit instead of API quota).
// Responses are trimmed to what the UI shows.

const BASE = "https://prod.dashboard.nexlev.io/api/external";
const MCP_URL = "https://prod.dashboard.nexlev.io/api/claude-mcp";

export class NexlevError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export const QUOTA = { search: 1, similar: 20, niche: 20 } as const;

export interface NicheChannel {
  channelId: string;
  title: string;
  handle: string | null;
  avatar: string | null;
  description: string | null;
  subs: number | null;
  views: number | null;
  videos: number | null;
  avgLength: string | null;
  lastUpload: string | null;
  country: string | null;
  ageDays: number | null;
  hasShorts: boolean | null;
  similarity: number | null;
  tags: string[];
  // Niche Finder (MCP) only
  revenue?: number | null; // est. AdSense USD / month
  rpm?: number | null;
  outlier?: number | null;
  avgViews?: number | null;
  uploadsPerWeek?: number | null;
  faceless?: boolean | null;
  monetized?: boolean | null;
  quality?: string | null;
  category?: string | null;
}

export interface NicheVideo {
  videoId: string;
  title: string;
  channelId: string | null;
  channelTitle: string | null;
  channelAvatar: string | null;
  channelSubs: number | null;
  views: number | null;
  published: string | null;
  duration: string | null;
  thumb: string | null;
  outlier: number | null;
  vph: number | null;
  isShort: boolean;
  /** Channel average views (faceless outliers) */
  channelAvg?: number | null;
}

export interface SearchParams {
  query: string;
  type?: "channel" | "video" | "shorts";
  sortBy?: "relevance" | "popularity" | "date" | "views";
  uploadDate?: "hour" | "today" | "week" | "month" | "year";
  duration?: "short" | "medium" | "long";
  geo?: string;
  token?: string;
}

function apiKey(): string {
  const k = process.env.NEXLEV_API_KEY;
  if (!k) throw new NexlevError("Chưa cấu hình NEXLEV_API_KEY trên server", 500);
  return k;
}

async function call<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    throw new NexlevError(`Không kết nối được NexLev: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const detail =
      (data && typeof data === "object" && ((data as Record<string, unknown>).message || (data as Record<string, unknown>).error)) ||
      text.slice(0, 200) ||
      res.statusText;
    if (res.status === 401 || res.status === 403) throw new NexlevError("API key NexLev không hợp lệ hoặc gói không có quyền API", res.status);
    if (res.status === 429) throw new NexlevError("Hết quota NexLev hoặc gọi quá nhanh — thử lại sau", 429);
    if (res.status === 408) throw new NexlevError("NexLev xử lý quá lâu (timeout) — thử mức tìm thấp hơn", 504);
    throw new NexlevError(`NexLev lỗi ${res.status}: ${String(detail)}`, res.status >= 500 ? 502 : res.status);
  }
  return data as T;
}

// ── helpers ──────────────────────────────────────────────

type Thumb = { url?: string; width?: number }[] | string | undefined | null;

/** Largest thumbnail, protocol-relative URLs made absolute. */
function pickThumb(t: Thumb): string | null {
  const url = typeof t === "string" ? t : Array.isArray(t) && t.length ? [...t].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url : null;
  if (!url) return null;
  return url.startsWith("//") ? `https:${url}` : url;
}

/** "1.2M views", "2,643,412", 2643412 → number. */
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const m = v.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mul = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Number.isFinite(n) ? Math.round(n * mul) : null;
}

/** Fix UTF-8 read as Latin-1 ("Â ") that some search snippets carry. */
function clean(s: unknown): string | null {
  if (typeof s !== "string" || !s.trim()) return null;
  return s.replace(/Â /g, " ").replace(/ /g, " ").trim();
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const UNITS: Record<string, string> = {
  s: "giây", sec: "giây", second: "giây", min: "phút", minute: "phút", h: "giờ", hr: "giờ", hour: "giờ",
  d: "ngày", day: "ngày", w: "tuần", wk: "tuần", week: "tuần", mo: "tháng", month: "tháng", y: "năm", yr: "năm", year: "năm",
};

/** "3 days ago" / "4mo ago" / "Streamed 2 weeks ago" → "3 ngày trước". Unknown text is kept. */
function ago(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/(\d+)\s*([a-z]+?)s?\s+ago/i);
  const unit = m && UNITS[m[2].toLowerCase()];
  return m && unit ? `${m[1]} ${unit} trước` : s;
}

// ── endpoints ────────────────────────────────────────────

interface RawSearchItem {
  type?: string;
  videoId?: string;
  title?: string;
  channelTitle?: string;
  channelId?: string;
  channelHandle?: string;
  description?: string;
  viewCount?: string | number;
  publishedTime?: string;
  duration?: string;
  thumbnail?: Thumb;
}

export async function searchYoutube(p: SearchParams): Promise<{
  channels: NicheChannel[];
  videos: NicheVideo[];
  continuation: string | null;
  estimated: number | null;
}> {
  const q = new URLSearchParams({ query: p.query });
  for (const k of ["type", "sortBy", "uploadDate", "duration", "geo", "token"] as const) {
    const v = p[k];
    if (v) q.set(k, v);
  }
  const data = await call<{ results?: RawSearchItem[]; continuation?: string | null; estimatedResults?: string }>(`/youtube/search?${q}`);
  const channels: NicheChannel[] = [];
  const videos: NicheVideo[] = [];
  for (const r of data.results ?? []) {
    if (r.type === "channel" && r.channelId) {
      channels.push({
        channelId: r.channelId,
        title: clean(r.title) ?? r.channelId,
        handle: str(r.channelHandle),
        avatar: pickThumb(r.thumbnail),
        description: clean(r.description),
        subs: null,
        views: null,
        videos: null,
        avgLength: null,
        lastUpload: null,
        country: null,
        ageDays: null,
        hasShorts: null,
        similarity: null,
        tags: [],
      });
    } else if ((r.type === "video" || r.type === "shorts") && r.videoId) {
      videos.push({
        videoId: r.videoId,
        title: clean(r.title) ?? r.videoId,
        channelId: str(r.channelId),
        channelTitle: clean(r.channelTitle),
        channelAvatar: null,
        channelSubs: null,
        views: num(r.viewCount),
        published: ago(r.publishedTime),
        duration: str(r.duration),
        thumb: pickThumb(r.thumbnail) ?? `https://i.ytimg.com/vi/${r.videoId}/mqdefault.jpg`,
        outlier: null,
        vph: null,
        isShort: r.type === "shorts",
      });
    }
  }
  return { channels, videos, continuation: data.continuation ?? null, estimated: num(data.estimatedResults) };
}

interface RawAbout {
  channelId?: string;
  channelName?: string;
  description?: string;
  subscriberCount?: number;
  videoCount?: number;
  viewCount?: number;
  thumbnail?: Thumb;
  country?: string;
  daysSinceStart?: number;
  lastVideoUploadDate?: string;
  avgVideoLength?: string;
  hasShorts?: boolean;
  channelUrl?: string;
}

function fromAbout(a: RawAbout, extra: { similarity?: unknown; tags?: unknown }): NicheChannel | null {
  if (!a?.channelId) return null;
  const handle = (a.channelUrl ?? "").match(/\/(@[^/?#]+)/)?.[1] ?? null;
  return {
    channelId: a.channelId,
    title: clean(a.channelName) ?? a.channelId,
    handle,
    avatar: pickThumb(a.thumbnail),
    description: clean(a.description),
    subs: num(a.subscriberCount),
    views: num(a.viewCount),
    videos: num(a.videoCount),
    avgLength: str(a.avgVideoLength),
    lastUpload: ago(a.lastVideoUploadDate),
    country: str(a.country),
    ageDays: num(a.daysSinceStart),
    hasShorts: typeof a.hasShorts === "boolean" ? a.hasShorts : null,
    similarity: num(extra.similarity),
    tags: Array.isArray(extra.tags) ? extra.tags.filter((t): t is string => typeof t === "string").slice(0, 6) : [],
  };
}

export async function similarChannels(channelId: string, level: 1 | 2 | 3, channelType: "all" | "short"): Promise<NicheChannel[]> {
  const data = await call<{ data?: { about?: RawAbout; similarityScore?: number; tags?: string[] }[] }>("/similar-channels/search", {
    method: "POST",
    body: { channelId, level, channelType },
  });
  return (data.data ?? [])
    .map((d) => fromAbout(d.about ?? {}, { similarity: d.similarityScore, tags: d.tags }))
    .filter((c): c is NicheChannel => !!c && c.channelId !== channelId);
}

interface RawNicheVideo {
  type?: string;
  videoId?: string;
  title?: string;
  viewCount?: string | number;
  publishedTimeText?: string;
  lengthText?: string;
  thumbnail?: Thumb;
  vph?: number;
  outlierScore?: number;
}

export async function nicheOverview(channelId: string): Promise<{ channels: NicheChannel[]; videos: NicheVideo[]; totalVideos: number | null }> {
  const data = await call<{
    similarChannels?: { channelId?: string; channelName?: string; similarityScore?: number }[];
    videos?: { channelId?: string; channelName?: string; channelThumbnail?: Thumb; subscriptionCount?: number; videos?: RawNicheVideo[] }[];
    totalVideos?: number;
  }>("/niche-overview/analyze", { method: "POST", body: { channelId } });

  const groups = data.videos ?? [];
  const meta = new Map(groups.map((g) => [g.channelId, g]));
  const channels: NicheChannel[] = (data.similarChannels ?? [])
    .filter((s) => s.channelId && s.channelId !== channelId)
    .map((s) => {
      const g = meta.get(s.channelId);
      return {
        channelId: s.channelId!,
        title: clean(s.channelName) ?? s.channelId!,
        handle: null,
        avatar: pickThumb(g?.channelThumbnail),
        description: null,
        subs: num(g?.subscriptionCount),
        views: null,
        videos: g?.videos?.length ?? null,
        avgLength: null,
        lastUpload: null,
        country: null,
        ageDays: null,
        hasShorts: null,
        similarity: num(s.similarityScore),
        tags: [],
      };
    });

  const videos: NicheVideo[] = [];
  for (const g of groups) {
    for (const v of g.videos ?? []) {
      if (!v.videoId) continue;
      videos.push({
        videoId: v.videoId,
        title: clean(v.title) ?? v.videoId,
        channelId: str(g.channelId),
        channelTitle: clean(g.channelName),
        channelAvatar: pickThumb(g.channelThumbnail),
        channelSubs: num(g.subscriptionCount),
        views: num(v.viewCount),
        published: ago(v.publishedTimeText),
        duration: str(v.lengthText),
        thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
        outlier: typeof v.outlierScore === "number" ? Math.round(v.outlierScore * 100) / 100 : null,
        vph: typeof v.vph === "number" ? Math.round(v.vph) : null,
        isShort: v.type === "shorts" || v.type === "short",
      });
    }
  }
  // Best performers first; the UI shows the top slice.
  videos.sort((a, b) => (b.outlier ?? 0) - (a.outlier ?? 0));
  return { channels, videos: videos.slice(0, 120), totalVideos: num(data.totalVideos) };
}

// ── MCP (Niche Finder, Faceless Outliers) ────────────────

let rpcId = 0;

/** One stateless `tools/call`; returns the JSON block of the tool result. */
async function mcpCall<T>(name: string, args: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
    });
  } catch (e) {
    throw new NexlevError(`Không kết nối được NexLev MCP: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new NexlevError("NexLev MCP từ chối API key", res.status);
  if (res.status === 429) throw new NexlevError("Đã hết lượt gọi MCP NexLev trong tuần — thử lại sau", 429);
  if (!res.ok) throw new NexlevError(`NexLev MCP lỗi ${res.status}: ${text.slice(0, 200)}`, 502);

  // Body is either plain JSON or SSE ("event: message\ndata: {...}").
  const payloads = text.includes("data:")
    ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())
    : [text];
  type Rpc = { result?: { content?: { type: string; text?: string }[]; isError?: boolean }; error?: { message?: string } };
  let msg: Rpc | null = null;
  for (const p of payloads) {
    try {
      const j = JSON.parse(p) as Rpc;
      if (j.result || j.error) msg = j;
    } catch {
      /* keep-alive / partial line */
    }
  }
  if (!msg) throw new NexlevError("NexLev MCP trả về dữ liệu không đọc được");
  if (msg.error) throw new NexlevError(`NexLev MCP: ${msg.error.message ?? "lỗi không rõ"}`);
  const blocks = (msg.result?.content ?? []).filter((c) => c.type === "text" && c.text).map((c) => c.text!);
  if (msg.result?.isError) {
    const t = blocks.join(" ").slice(0, 300);
    if (/limit|quota/i.test(t)) throw new NexlevError(`NexLev: ${t}`, 429);
    throw new NexlevError(`NexLev: ${t || "lỗi không rõ"}`);
  }
  for (const b of [...blocks].reverse()) {
    const s = b.trim();
    if (!s.startsWith("{") && !s.startsWith("[")) continue;
    try {
      return JSON.parse(s) as T;
    } catch {
      /* not the JSON block */
    }
  }
  throw new NexlevError(`NexLev: ${blocks.join(" ").slice(0, 200) || "không có dữ liệu"}`);
}

const roundTo = (v: unknown, d = 2): number | null => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : null;
  return n == null ? null : Math.round(n * 10 ** d) / 10 ** d;
};
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

const secToClock = (v: unknown): string | null => {
  const s = typeof v === "number" && v > 0 ? Math.round(v) : null;
  if (s == null) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

const daysAgo = (iso: unknown): string | null => {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const d = Math.max(0, Math.floor((Date.now() - t) / 86400000));
  return d === 0 ? "hôm nay" : d < 30 ? `${d} ngày trước` : d < 365 ? `${Math.round(d / 30)} tháng trước` : `${(d / 365).toFixed(1)} năm trước`;
};

/** Filters accepted by search_niche_finder_channels (the subset the UI offers). */
export interface FinderParams {
  query: string;
  page?: number;
  minSubscribers?: number;
  maxSubscribers?: number;
  minMonthlyRevenue?: number;
  minRpm?: number;
  minAvgViewsPerVideo?: number;
  minOutlierScore?: number;
  isFaceless?: boolean;
  isMonetizationEnabled?: boolean;
  isShortsOnly?: boolean;
  channelCreatedAfter?: string;
  lastUploadAfter?: string;
  sortBy?: "subscribers" | "avgViewsPerVideo" | "daysSinceStart" | "totalVideos" | "totalRevenue" | "createdAt";
}

interface RawFinderChannel {
  ytChannelId?: string;
  title?: string;
  description?: string;
  username?: string;
  thumbnailUrl?: string;
  location?: string;
  channelCreationDate?: string;
  isMonetizationEnabled?: boolean;
  isFaceless?: boolean;
  quality?: string;
  outlierScore?: number;
  tags?: string[];
  category?: { name?: string };
  score?: number;
  stats?: {
    subscribers?: number;
    monthlyRevenue?: number;
    totalViews?: number;
    totalVideos?: number;
    avgViewsPerVideo?: number;
    avgVideoLength?: number;
    uploadsPerWeek?: number;
    lastVideoDate?: string;
    rpm?: { total?: number; base?: number };
  };
}

const FINDER_LIMIT = 24;

export async function nicheFinder(
  p: FinderParams,
): Promise<{ channels: NicheChannel[]; total: number | null; hasMore: boolean; topicTags: string[] }> {
  const args: Record<string, unknown> = { ...p, query: p.query.trim() || "*", limit: FINDER_LIMIT, page: p.page ?? 1 };
  if (args.sortBy) args.sortOrder = "desc";
  const data = await mcpCall<{ channels?: RawFinderChannel[]; totalResults?: number; hasMore?: boolean; topicTags?: string[] }>(
    "search_niche_finder_channels",
    args,
  );
  const channels: NicheChannel[] = [];
  for (const c of data.channels ?? []) {
    if (!c.ytChannelId) continue;
    const s = c.stats ?? {};
    const created = c.channelCreationDate ? Date.parse(c.channelCreationDate) : NaN;
    channels.push({
      channelId: c.ytChannelId,
      title: clean(c.title) ?? c.ytChannelId,
      handle: c.username ? `@${c.username.replace(/^@/, "")}` : null,
      avatar: pickThumb(c.thumbnailUrl),
      description: clean(c.description),
      subs: num(s.subscribers),
      views: num(s.totalViews),
      videos: num(s.totalVideos),
      avgLength: secToClock(s.avgVideoLength),
      lastUpload: daysAgo(s.lastVideoDate),
      country: str(c.location),
      ageDays: Number.isFinite(created) ? Math.max(0, Math.floor((Date.now() - created) / 86400000)) : null,
      hasShorts: null,
      similarity: typeof c.score === "number" ? Math.round(c.score * 100) : null,
      tags: (c.tags ?? []).filter((t) => typeof t === "string").slice(0, 5),
      revenue: roundTo(s.monthlyRevenue, 0),
      rpm: roundTo(s.rpm?.total ?? s.rpm?.base, 1),
      outlier: roundTo(c.outlierScore),
      avgViews: roundTo(s.avgViewsPerVideo, 0),
      uploadsPerWeek: roundTo(s.uploadsPerWeek, 1),
      faceless: bool(c.isFaceless),
      monetized: bool(c.isMonetizationEnabled),
      quality: str(c.quality),
      category: str(c.category?.name),
    });
  }
  return { channels, total: num(data.totalResults), hasMore: !!data.hasMore, topicTags: (data.topicTags ?? []).slice(0, 8) };
}

/** Filters accepted by faceless_outliers_videos (the subset the UI offers). */
export interface OutlierParams {
  query?: string;
  page?: number;
  minOutlierScore?: number;
  maxSubscribers?: number;
  minViews?: number;
  videoType?: "long" | "shorts";
  minUploadDate?: string;
  isAiContent?: boolean;
  sortBy?: "outlierScore" | "videoViews" | "videoPublishedAt" | "channelSubCount";
}

interface RawOutlier {
  videoId?: string;
  videoTitle?: string;
  videoThumbnail?: string;
  videoViews?: number;
  videoLengthSeconds?: number;
  videoPublishedAt?: string;
  videoType?: string;
  outlierScore?: number;
  avgViews?: number;
  ytChannelId?: string;
  channelTitle?: string;
  channelAvatar?: string;
  channelSubCount?: number;
}

const OUTLIER_LIMIT = 30;

export async function facelessOutliers(p: OutlierParams): Promise<{ videos: NicheVideo[]; total: number | null; hasMore: boolean }> {
  const args: Record<string, unknown> = { ...p, query: p.query?.trim() || "*", limit: OUTLIER_LIMIT, page: p.page ?? 1 };
  if (args.query !== "*") delete args.sortBy; // sorting would discard semantic ranking
  if (args.sortBy) args.sortDirection = "desc";
  const data = await mcpCall<{ videos?: RawOutlier[]; total?: number; hasMore?: boolean }>("faceless_outliers_videos", args);
  const videos: NicheVideo[] = [];
  for (const v of data.videos ?? []) {
    if (!v.videoId) continue;
    videos.push({
      videoId: v.videoId,
      title: clean(v.videoTitle) ?? v.videoId,
      channelId: str(v.ytChannelId),
      channelTitle: clean(v.channelTitle),
      channelAvatar: pickThumb(v.channelAvatar),
      channelSubs: num(v.channelSubCount),
      views: num(v.videoViews),
      published: daysAgo(v.videoPublishedAt),
      duration: secToClock(v.videoLengthSeconds),
      thumb: pickThumb(v.videoThumbnail) ?? `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
      outlier: roundTo(v.outlierScore, 1),
      vph: null,
      isShort: v.videoType === "shorts",
      channelAvg: roundTo(v.avgViews, 0),
    });
  }
  return { videos, total: num(data.total), hasMore: !!data.hasMore };
}
