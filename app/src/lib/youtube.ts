// YouTube channel lookup for Bookmark Key — no API key: the channel page
// gives id / name / avatar / handle, the public RSS feed gives the latest 15
// videos with publish times. Verified live (2026-10) for @handle,
// /channel/UC…, youtu.be/… and watch?v=… links.

// `YT_BASE` lets tests point every request at a fake server.
const YT_BASE = process.env.YT_BASE || "https://www.youtube.com";
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
};

export interface YtVideo {
  id: string;
  title: string;
  published: string; // ISO
}

export interface YtChannelInfo {
  channelId: string;
  title: string;
  handle: string | null;
  avatar: string | null;
}

export class YtError extends Error {}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** Turn whatever the user pasted into a fetchable YouTube URL. */
export function normalizeInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^UC[\w-]{22}$/.test(s)) return `${YT_BASE}/channel/${s}`;
  if (/^@[\w.\-]+$/.test(s)) return `${YT_BASE}/${s}`;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  if (host === "youtu.be") return `${YT_BASE}/watch?v=${u.pathname.slice(1)}`;
  if (host !== "youtube.com") return null;
  return `${YT_BASE}${u.pathname}${u.search}`;
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS, redirect: "follow", cache: "no-store" });
  if (!res.ok) throw new YtError(`YouTube trả lỗi ${res.status}`);
  return res.text();
}

function meta(html: string, prop: string): string | null {
  const m = html.match(new RegExp(`<meta (?:property|name|itemprop)="${prop}" content="([^"]*)"`));
  return m ? decode(m[1]) : null;
}

/** Resolve a pasted link / handle / id to the channel. */
export async function resolveChannel(raw: string): Promise<YtChannelInfo> {
  const url = normalizeInput(raw);
  if (!url) throw new YtError("Không phải link YouTube hợp lệ");
  let html = await getText(url);
  const id =
    (html.match(/"externalId":"(UC[\w-]{22})"/) ||
      html.match(/<meta itemprop="channelId" content="(UC[\w-]{22})"/) ||
      html.match(/"channelId":"(UC[\w-]{22})"/) ||
      [])[1] ?? null;
  if (!id) throw new YtError("Không tìm thấy kênh từ link này");
  // A video / shorts link: read the channel page itself for name + avatar.
  if (!/"externalId":"UC/.test(html)) html = await getText(`${YT_BASE}/channel/${id}`);
  const handle = (html.match(/"canonicalBaseUrl":"\/(@[^"]+)"/) || [])[1] ?? null;
  return {
    channelId: id,
    title: meta(html, "og:title") ?? id,
    handle: handle ? decodeURIComponent(handle) : null,
    avatar: meta(html, "og:image"),
  };
}

/** Latest videos of a channel from its public RSS feed (newest first). */
export async function fetchFeed(channelId: string): Promise<{ title: string | null; videos: YtVideo[] }> {
  const xml = await getText(`${YT_BASE}/feeds/videos.xml?channel_id=${channelId}`);
  const title = (xml.match(/<title>([^<]*)<\/title>/) || [])[1];
  const videos: YtVideo[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const t = (e.match(/<title>([^<]*)<\/title>/) || [])[1];
    const published = (e.match(/<published>([^<]+)<\/published>/) || [])[1];
    if (id && published) videos.push({ id, title: decode(t ?? ""), published });
  }
  videos.sort((a, b) => b.published.localeCompare(a.published));
  return { title: title ? decode(title) : null, videos };
}

export function channelUrl(channelId: string, handle: string | null): string {
  return handle ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/channel/${channelId}`;
}
