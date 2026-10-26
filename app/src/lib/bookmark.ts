// Bookmark Key: resolve any pasted link into something to track.
//
//   youtube — channel / @handle / video link → channel RSS (src/lib/youtube.ts)
//   tiktok  — tiktok.com/@user → latest videos (src/lib/tiktok.ts)
//   feed    — any page that advertises an RSS/Atom feed, or a feed URL itself
//   link    — everything else: saved with its title and icon, not tracked
//
// A page that can't be fetched (blocked, login wall, timeout) is still saved
// as a plain link — "any link" must always be accepted.

import { YtError, fetchFeed, resolveChannel, type YtVideo } from "@/lib/youtube";
import { fetchProfile, fetchRecentVideos } from "@/lib/tiktok";

export type BookmarkKind = "youtube" | "tiktok" | "feed" | "link";

export interface BookmarkItem extends YtVideo {
  /** Link to open; YouTube items omit it (built from the video id). */
  url?: string;
}

export interface ResolvedBookmark {
  kind: BookmarkKind;
  /** Dedup key per owner (column channel_id). */
  key: string;
  title: string;
  handle: string | null;
  avatar: string | null;
  url: string | null;
  feedUrl: string | null;
  items: BookmarkItem[];
  checkError: string | null;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
// Pages are parsed with regexes; cap what we read (Worker CPU budget).
const MAX_BYTES = 600_000;
const MAX_ITEMS = 15;

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim();

/** "example.com/a/" → https URL; null for anything that isn't http(s). */
export function parseLink(raw: string): URL | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".") || isPrivateHost(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

/** No fetching of local / private-network addresses from the server. */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^(127|10|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h.includes(":")) return true; // IPv6 literals
  return false;
}

function normalizeKey(u: URL): string {
  const copy = new URL(u.toString());
  copy.hash = "";
  copy.hostname = copy.hostname.replace(/^www\./, "");
  let s = copy.toString();
  if (copy.pathname !== "/" && s.endsWith("/")) s = s.slice(0, -1);
  return `url:${s.replace(/^https?:\/\//, "")}`;
}

const isYoutube = (raw: string) =>
  /^UC[\w-]{22}$/.test(raw.trim()) ||
  /^@[\w.\-]+$/.test(raw.trim()) ||
  /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtu\.be)\//i.test(raw.trim());

export async function resolveBookmark(raw: string): Promise<ResolvedBookmark> {
  if (isYoutube(raw)) return resolveYoutube(raw);
  const u = parseLink(raw);
  if (!u) throw new YtError("Không phải link hợp lệ (cần http/https)");
  const tiktok = u.hostname.replace(/^(www|m)\./, "") === "tiktok.com" && u.pathname.match(/^\/@([\w.\-]+)\/?$/);
  if (tiktok) return resolveTiktok(tiktok[1]);
  return resolveWeb(u, /^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()));
}

async function resolveYoutube(raw: string): Promise<ResolvedBookmark> {
  const info = await resolveChannel(raw);
  let items: BookmarkItem[] = [];
  let checkError: string | null = null;
  try {
    items = (await fetchFeed(info.channelId)).videos;
  } catch (e) {
    checkError = e instanceof Error ? e.message : String(e);
  }
  return { kind: "youtube", key: info.channelId, title: info.title, handle: info.handle, avatar: info.avatar, url: null, feedUrl: null, items, checkError };
}

async function resolveTiktok(user: string): Promise<ResolvedBookmark> {
  const url = `https://www.tiktok.com/@${user}`;
  const base = { kind: "tiktok" as const, key: `tiktok:${user.toLowerCase()}`, handle: `@${user}`, url, feedUrl: null };
  try {
    const [profile, items] = await Promise.all([fetchProfile(user), tiktokItems(user)]);
    return { ...base, title: profile.nickname || `@${user}`, avatar: profile.avatarUrl || null, items, checkError: null };
  } catch (e) {
    return { ...base, title: `@${user}`, avatar: null, items: [], checkError: e instanceof Error ? e.message : String(e) };
  }
}

async function tiktokItems(user: string): Promise<BookmarkItem[]> {
  const videos = await fetchRecentVideos(user, MAX_ITEMS);
  return videos.map((v) => ({
    id: v.id,
    title: v.caption || "(không có mô tả)",
    published: new Date((v.postedAt || 0) * 1000).toISOString(),
    url: `https://www.tiktok.com/@${user}/video/${v.id}`,
  }));
}

async function resolveWeb(u: URL, typedScheme: boolean): Promise<ResolvedBookmark> {
  let page: { text: string; type: string; finalUrl: string } | null = null;
  try {
    page = await getText(u.toString());
  } catch {
    // "site.com" was tried as https; a site without https gets one go on http.
    if (!typedScheme && u.protocol === "https:") {
      const http = new URL(u.toString());
      http.protocol = "http:";
      try {
        page = await getText(http.toString());
        u = http;
      } catch {}
    }
  }
  const key = normalizeKey(u);
  // A plain link is not tracked, so a page we can't read is not an error.
  const fallback = (): ResolvedBookmark => ({
    kind: "link",
    key,
    title: u.hostname.replace(/^www\./, "") + (u.pathname !== "/" ? u.pathname : ""),
    handle: u.hostname.replace(/^www\./, ""),
    avatar: `${u.origin}/favicon.ico`,
    url: u.toString(),
    feedUrl: null,
    items: [],
    checkError: null,
  });
  if (!page) return fallback();
  // The link is a feed itself.
  if (looksLikeFeed(page.text, page.type)) {
    const feed = parseFeed(page.text, page.finalUrl);
    return { kind: "feed", key, title: feed.title || u.hostname, handle: u.hostname.replace(/^www\./, ""), avatar: `${u.origin}/favicon.ico`, url: feed.link || u.toString(), feedUrl: u.toString(), items: feed.items, checkError: null };
  }
  const html = page.text;
  const title = meta(html, "og:title") || meta(html, "twitter:title") || decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] ?? "") || null;
  const icon = absolute(meta(html, "og:image") || linkHref(html, /(?:^|\s)(?:apple-touch-icon|icon|shortcut icon)(?:\s|$)/i), page.finalUrl);
  const site = meta(html, "og:site_name") || u.hostname.replace(/^www\./, "");
  const base = fallback();
  const out: ResolvedBookmark = { ...base, title: title?.slice(0, 200) || base.title, handle: site, avatar: icon || base.avatar };
  const feedHref = absolute(linkHref(html, /alternate/i, /application\/(rss|atom)\+xml|application\/feed\+json/i), page.finalUrl);
  if (!feedHref) return out;
  try {
    const feedPage = await getText(feedHref);
    if (!looksLikeFeed(feedPage.text, feedPage.type)) return out;
    return { ...out, kind: "feed", feedUrl: feedHref, items: parseFeed(feedPage.text, feedPage.finalUrl).items };
  } catch {
    return out;
  }
}

/** Re-read the tracked items of a saved bookmark. `link` has none. */
export async function fetchBookmarkItems(row: { kind: string; channelId: string; feedUrl: string | null }): Promise<BookmarkItem[] | null> {
  if (row.kind === "youtube") return (await fetchFeed(row.channelId)).videos;
  if (row.kind === "tiktok") return tiktokItems(row.channelId.replace(/^tiktok:/, ""));
  if (row.kind === "feed" && row.feedUrl) {
    const page = await getText(row.feedUrl);
    if (!looksLikeFeed(page.text, page.type)) throw new YtError("Feed không còn trả RSS/Atom");
    return parseFeed(page.text, page.finalUrl).items;
  }
  return null;
}

/**
 * Items without a date get the time they were first seen, so they still
 * count as new once and keep that time on later checks.
 */
export function mergeItems(fresh: BookmarkItem[], previous: BookmarkItem[]): BookmarkItem[] {
  const before = new Map(previous.map((i) => [i.id, i.published]));
  const now = new Date().toISOString();
  return fresh
    .map((i) => ({ ...i, published: i.published || before.get(i.id) || now }))
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, MAX_ITEMS);
}

// ── fetching / parsing ──────────────────────────────────────────────────

async function getText(url: string): Promise<{ text: string; type: string; finalUrl: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "vi,en;q=0.8" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new YtError(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") || "";
    if (!/text|xml|json|html/i.test(type) && type) throw new YtError(`không phải trang web (${type.split(";")[0]})`);
    const reader = res.body?.getReader();
    if (!reader) return { text: await res.text(), type, finalUrl: res.url || url };
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    reader.cancel().catch(() => {});
    const buf = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.length;
    }
    return { text: new TextDecoder().decode(buf), type, finalUrl: res.url || url };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new YtError("quá 10 giây");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const looksLikeFeed = (text: string, type: string) =>
  /(rss|atom)\+xml/i.test(type) || /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 2000));

function meta(html: string, prop: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = (tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (name?.toLowerCase() !== prop) continue;
    const content = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (content) return decode(content);
  }
  return null;
}

function linkHref(html: string, rel: RegExp, type?: RegExp): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const r = (tag.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!r || !rel.test(r)) continue;
    if (type && !type.test((tag.match(/\btype\s*=\s*["']([^"']+)["']/i) || [])[1] ?? "")) continue;
    const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (href) return decode(href);
  }
  return null;
}

function absolute(href: string | null, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function isoDate(s: string | undefined): string {
  if (!s) return "";
  const t = Date.parse(decode(s));
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

const tagText = (block: string, tag: string) => {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  // Unwrap CDATA first: stripping tags would eat "<![CDATA[ … ]]>" whole.
  return m ? decode(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")) : "";
};

/** RSS 2.0 / RSS 1.0 (RDF) / Atom → newest-first items. */
export function parseFeed(xml: string, base: string): { title: string; link: string | null; items: BookmarkItem[] } {
  const atom = /<feed[\s>]/i.test(xml.slice(0, 2000)) && !/<rss[\s>]/i.test(xml.slice(0, 2000));
  const head = xml.split(/<(?:item|entry)\b/i)[0];
  const title = tagText(head, "title");
  const link = atom ? absolute((head.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || head.match(/<link\b[^>]*href=["']([^"']+)["']/i) || [])[1] ?? null, base) : absolute(tagText(head, "link") || null, base);
  const items: BookmarkItem[] = [];
  const re = atom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi;
  for (const m of xml.matchAll(re)) {
    const b = m[0];
    const href = atom
      ? (b.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || b.match(/<link\b[^>]*href=["']([^"']+)["']/i) || [])[1]
      : tagText(b, "link") || (b.match(/<item\b[^>]*rdf:about=["']([^"']+)["']/i) || [])[1];
    const url = absolute(href ? decode(href) : null, base) ?? undefined;
    const id = tagText(b, atom ? "id" : "guid") || url || tagText(b, "title");
    if (!id) continue;
    const published = isoDate(atom ? tagText(b, "published") || tagText(b, "updated") : tagText(b, "pubDate") || tagText(b, "dc:date"));
    items.push({ id: id.slice(0, 300), title: (tagText(b, "title") || url || id).slice(0, 300), published, url });
    if (items.length >= 50) break;
  }
  items.sort((a, b) => b.published.localeCompare(a.published));
  return { title, link, items: items.slice(0, MAX_ITEMS) };
}
