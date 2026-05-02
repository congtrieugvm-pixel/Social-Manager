export interface TikTokProfile {
  username: string;
  nickname: string;
  avatarUrl: string;
  followerCount: number;
  followingCount: number;
  videoCount: number;
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

function stripAtPrefix(u: string): string {
  return u.trim().replace(/^@/, "");
}

export async function fetchProfile(username: string): Promise<TikTokProfile> {
  const u = stripAtPrefix(username);
  const pageData = await fetchEmbedPageData(u);
  const info = pageData.userInfo;
  if (!info || (info.code !== undefined && info.code !== 200)) {
    throw new Error("Embed không có dữ liệu tài khoản (tài khoản không tồn tại?)");
  }
  if (!info.avatarThumbUrl && !info.uniqueId) {
    throw new Error("Embed thiếu thông tin user");
  }
  return {
    username: info.uniqueId ?? u,
    nickname: info.nickname ?? "",
    avatarUrl: info.avatarThumbUrl ?? "",
    followerCount: info.followerCount ?? 0,
    followingCount: info.followingCount ?? 0,
    videoCount: 0,
    heartCount: info.heartCount ?? 0,
    verified: !!info.verified,
    privateAccount: !!info.privateAccount,
    region: "",
  };
}

export async function fetchRecentVideos(username: string, limit = 3): Promise<TikTokVideo[]> {
  const u = stripAtPrefix(username);
  // TikTok's frontity-powered /embed/@username page exposes videoList without auth.
  return scrapeEmbedVideos(u, limit);
}

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

async function fetchEmbedPageData(username: string): Promise<EmbedPageData> {
  const url = `https://www.tiktok.com/embed/@${username}`;
  const html = await fetchHtml(url);

  const scriptMatch = html.match(
    /<script[^>]*id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!scriptMatch) {
    throw new Error("Không tìm thấy dữ liệu nhúng từ trang embed TikTok");
  }

  let state: unknown;
  try {
    state = JSON.parse(scriptMatch[1]);
  } catch {
    throw new Error("Parse JSON embed state thất bại");
  }

  const source = (state as { source?: { data?: Record<string, unknown> } }).source;
  const dataBag = source?.data ?? {};
  const dataKey = `/embed/@${username}`;
  const pageData = dataBag[dataKey] as EmbedPageData | undefined;
  if (!pageData) {
    throw new Error("Embed không có dữ liệu tài khoản (tài khoản không tồn tại?)");
  }
  return pageData;
}

async function scrapeEmbedVideos(username: string, limit: number): Promise<TikTokVideo[]> {
  const pageData = await fetchEmbedPageData(username);

  if (pageData.userInfo?.privateAccount) {
    throw new Error("Tài khoản đang ở chế độ riêng tư");
  }

  const videoList = Array.isArray(pageData.videoList) ? pageData.videoList : [];
  if (videoList.length === 0) {
    throw new Error("Tài khoản chưa có video công khai");
  }

  return videoList.slice(0, limit).map((v) => ({
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
  }));
}

function idToTimestamp(id: string): number {
  try {
    return Number(BigInt(id) >> BigInt(32));
  } catch {
    return 0;
  }
}

async function fetchHtml(url: string): Promise<string> {
  const cookie = process.env.TIKTOK_COOKIE?.trim();
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  };
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} khi tải embed profile`);
  return res.text();
}
