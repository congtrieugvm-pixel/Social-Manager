export interface TikTokProfile {
  username: string;
  nickname: string;
  avatarUrl: string;
  followerCount: number;
  followingCount: number;
  /** Only the profile page reports it; null when the data came from the embed page. */
  videoCount: number | null;
  heartCount: number;
  verified: boolean;
  privateAccount: boolean;
  region: string;
}

export interface TikTokVideo {
  id: string;
  caption: string;
  coverUrl: string;
  playUrl: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  postedAt: number;
}

/**
 * `retryable` = TikTok refused this one request (rate limit, overload,
 * geo / login redirect, page without data) — another attempt, another source
 * or another region usually succeeds. Not retryable = the account itself is
 * missing / banned.
 */
export class TikTokError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

// Sources are tried in turn with a short pause between attempts. On
// Cloudflare each attempt also goes out from a different region (see
// workers/tiktok-fetcher): TikTok rate-limits per IP, and redirects every
// request from Hong Kong — where Vietnamese users' requests usually run.
const PROFILE_PLAN = ["embed", "profile", "embed", "profile"] as const;
// Only the embed page lists videos; the profile step tells a missing /
// banned account (embed then answers HTTP 400) from a temporary refusal.
const VIDEO_PLAN = ["embed", "embed", "profile", "embed"] as const;
const REGIONS = ["wnam", "enam", "weur"];
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function stripAtPrefix(u: string): string {
  return u.trim().replace(/^@/, "");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetries<T>(plan: readonly ("embed" | "profile")[], run: (src: "embed" | "profile", attempt: number) => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < plan.length; i++) {
    if (i > 0) await sleep(350 * i);
    try {
      return await run(plan[i], i);
    } catch (e) {
      if (e instanceof TikTokError && !e.retryable) throw e;
      last = e;
    }
  }
  const msg = last instanceof Error ? last.message : String(last);
  throw new TikTokError(`TikTok tạm thời từ chối sau ${plan.length} lần thử (${msg}) — bấm lấy lại sau ít phút`, true);
}

export async function fetchProfile(username: string): Promise<TikTokProfile> {
  const u = stripAtPrefix(username);
  return withRetries(PROFILE_PLAN, (src, attempt) => (src === "embed" ? profileFromEmbed(u, attempt) : profileFromPage(u, attempt)));
}

/** Latest public videos ([] for private accounts or accounts with no videos). */
export async function fetchRecentVideos(username: string, limit = 3): Promise<TikTokVideo[]> {
  const u = stripAtPrefix(username);
  return withRetries(VIDEO_PLAN, async (src, attempt) => {
    if (src === "profile") {
      const p = await profileFromPage(u, attempt);
      if (p.privateAccount || p.videoCount === 0) return [];
      throw new TikTokError("trang embed chưa trả danh sách video", true);
    }
    const pageData = await fetchEmbedPageData(u, attempt);
    if (pageData.userInfo?.privateAccount) return [];
    const videoList = Array.isArray(pageData.videoList) ? pageData.videoList : [];
    return videoList.slice(0, limit).map(toVideo);
  });
}

// ── embed page: /embed/@user (__FRONTITY_CONNECT_STATE__) ────────────────

interface EmbedVideoItem {
  id: string;
  desc?: string;
  coverUrl?: string;
  originCoverUrl?: string;
  dynamicCoverUrl?: string;
  playAddr?: string;
  playCount?: number;
  privateItem?: boolean;
  createTime?: number;
}

interface EmbedUserInfo {
  uniqueId?: string;
  nickname?: string;
  avatarThumbUrl?: string;
  followerCount?: number;
  followingCount?: number;
  heartCount?: number;
  verified?: boolean;
  privateAccount?: boolean;
  code?: number;
  customErrorCode?: number;
}

interface EmbedPageData {
  videoList?: EmbedVideoItem[];
  userInfo?: EmbedUserInfo;
}

async function fetchEmbedPageData(username: string, attempt: number): Promise<EmbedPageData> {
  const html = await fetchPage(`https://www.tiktok.com/embed/@${username}`, attempt);
  const scriptMatch = html.match(/<script[^>]*id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/);
  if (!scriptMatch) throw new TikTokError("trang embed không có dữ liệu", true);
  let state: unknown;
  try {
    state = JSON.parse(scriptMatch[1]);
  } catch {
    throw new TikTokError("dữ liệu embed hỏng", true);
  }
  const dataBag = (state as { source?: { data?: Record<string, unknown> } }).source?.data ?? {};
  const pageData = dataBag[`/embed/@${username}`] as EmbedPageData | undefined;
  if (!pageData) throw new TikTokError("trang embed không có dữ liệu tài khoản", true);
  const info = pageData.userInfo;
  if (info && info.code !== undefined && info.code !== 200) {
    throw new TikTokError("Tài khoản không tồn tại hoặc đã bị khoá", false);
  }
  return pageData;
}

async function profileFromEmbed(username: string, attempt: number): Promise<TikTokProfile> {
  const info = (await fetchEmbedPageData(username, attempt)).userInfo;
  if (!info || (!info.avatarThumbUrl && !info.uniqueId)) throw new TikTokError("embed thiếu thông tin user", true);
  return {
    username: info.uniqueId ?? username,
    nickname: info.nickname ?? "",
    avatarUrl: info.avatarThumbUrl ?? "",
    followerCount: info.followerCount ?? 0,
    followingCount: info.followingCount ?? 0,
    videoCount: null,
    heartCount: info.heartCount ?? 0,
    verified: !!info.verified,
    privateAccount: !!info.privateAccount,
    region: "",
  };
}

// ── profile page: /@user (__UNIVERSAL_DATA_FOR_REHYDRATION__) ────────────

interface UserDetail {
  statusCode?: number;
  userInfo?: {
    user?: { uniqueId?: string; nickname?: string; avatarThumb?: string; verified?: boolean; privateAccount?: boolean; region?: string };
    stats?: { followerCount?: number; followingCount?: number; videoCount?: number; heartCount?: number };
  };
}

async function profileFromPage(username: string, attempt: number): Promise<TikTokProfile> {
  const html = await fetchPage(`https://www.tiktok.com/@${username}`, attempt);
  const m = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new TikTokError("trang profile không có dữ liệu", true);
  let detail: UserDetail | undefined;
  try {
    detail = (JSON.parse(m[1]) as { __DEFAULT_SCOPE__?: Record<string, UserDetail> }).__DEFAULT_SCOPE__?.["webapp.user-detail"];
  } catch {
    throw new TikTokError("dữ liệu profile hỏng", true);
  }
  const user = detail?.userInfo?.user;
  const stats = detail?.userInfo?.stats;
  // 10202 = no such user, 10221/10222 = banned / restricted.
  if (detail?.statusCode && [10202, 10221, 10222].includes(detail.statusCode)) {
    throw new TikTokError("Tài khoản không tồn tại hoặc đã bị khoá", false);
  }
  if (!user?.uniqueId || !stats) throw new TikTokError("trang profile thiếu thông tin user", true);
  return {
    username: user.uniqueId,
    nickname: user.nickname ?? "",
    avatarUrl: user.avatarThumb ?? "",
    followerCount: stats.followerCount ?? 0,
    followingCount: stats.followingCount ?? 0,
    videoCount: typeof stats.videoCount === "number" ? stats.videoCount : null,
    heartCount: stats.heartCount ?? 0,
    verified: !!user.verified,
    privateAccount: !!user.privateAccount,
    region: user.region ?? "",
  };
}

function toVideo(v: EmbedVideoItem): TikTokVideo {
  return {
    id: v.id,
    caption: v.desc ?? "",
    coverUrl: v.dynamicCoverUrl || v.coverUrl || v.originCoverUrl || "",
    playUrl: v.playAddr ?? "",
    viewCount: typeof v.playCount === "number" ? v.playCount : 0,
    // Embed endpoint doesn't expose likes/comments/shares — leave 0.
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    // Derive posted timestamp from snowflake-style id (upper 32 bits = unix seconds).
    postedAt: typeof v.createTime === "number" ? v.createTime : idToTimestamp(v.id),
  };
}

function idToTimestamp(id: string): number {
  try {
    return Number(BigInt(id) >> BigInt(32));
  } catch {
    return 0;
  }
}

// ── transport ────────────────────────────────────────────────────────────

interface Fetcher {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

/** The `TIKTOK_FETCHER` service binding when running on Cloudflare. */
function getFetcher(): Fetcher | null {
  if (process.env.APP_RUNTIME !== "cloudflare") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cf = require("@opennextjs/cloudflare") as typeof import("@opennextjs/cloudflare");
    return (cf.getCloudflareContext().env as { TIKTOK_FETCHER?: Fetcher }).TIKTOK_FETCHER ?? null;
  } catch {
    return null;
  }
}

async function fetchPage(url: string, attempt: number): Promise<string> {
  const fetcher = getFetcher();
  let status: number;
  let location: string | null;
  let text: string;
  if (fetcher) {
    const res = await fetcher.fetch("https://tiktok-fetcher/", {
      headers: { "x-target": url, "x-region": REGIONS[attempt % REGIONS.length] },
    });
    if (!res.ok) throw new TikTokError(`proxy HTTP ${res.status}`, true);
    status = Number(res.headers.get("x-upstream-status")) || 0;
    location = res.headers.get("x-upstream-location");
    text = await res.text();
  } else {
    const cookie = process.env.TIKTOK_COOKIE?.trim();
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      redirect: "manual",
    });
    status = res.status;
    location = res.headers.get("location");
    text = await res.text();
  }
  if (status >= 300 && status < 400) {
    throw new TikTokError(/\/about/.test(location ?? "") ? "TikTok chặn theo vùng" : "TikTok chuyển hướng đăng nhập", true);
  }
  if (status === 429) throw new TikTokError("TikTok giới hạn tốc độ (429)", true);
  if (status >= 500) throw new TikTokError(`TikTok quá tải (${status})`, true);
  if (status !== 200) throw new TikTokError(`HTTP ${status}`, true);
  return text;
}
