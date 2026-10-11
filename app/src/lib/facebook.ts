// Facebook Graph API wrapper. Read-only: fetch user info, owned pages, page insights.
// No browser automation or write operations.

// v23 introduced `content_monetization_earnings` (May 2025) — the consolidated
// earnings metric that replaces `page_daily_video_ad_break_earnings` and friends.
// All previously-working v21 endpoints (insights, /me/accounts, /me/permissions)
// continue to work on v23 unchanged.
// `FB_GRAPH_BASE` lets tests point every Graph call at a fake server.
export const GRAPH_BASE =
  process.env.FB_GRAPH_BASE || "https://graph.facebook.com/v23.0";

// Returns a UI-safe preview of a Facebook access token. Never expose the full
// token to the client — only enough to recognise which token is in play.
export function previewToken(token: string | null | undefined): string {
  if (!token) return "";
  const t = token.trim();
  if (t.length <= 16) return "***";
  return `${t.slice(0, 10)}…${t.slice(-6)}`;
}

export interface FbUser {
  id: string;
  name: string;
  picture?: { data: { url: string } };
}

export interface FbPage {
  id: string;
  name: string;
  category: string | null;
  category_list?: Array<{ id: string; name: string }>;
  about?: string | null;
  description?: string | null;
  link?: string;
  username?: string | null;
  picture?: { data: { url: string } };
  cover?: { source: string };
  fan_count?: number;
  followers_count?: number;
  new_like_count?: number;
  rating_count?: number;
  overall_star_rating?: number;
  verification_status?: string;
  access_token?: string;
  tasks?: string[];
}

// Graph API error messages occasionally echo the request URL (which contains the
// user's access_token) back to the caller. Scrub token-shaped substrings before
// they hit the DB or HTTP response.
export function scrubGraphMessage(msg: string): string {
  return msg
    .replace(/access_token=[^\s&"]+/gi, "access_token=***")
    .replace(/\bEAA[A-Za-z0-9_-]{20,}/g, "***token***");
}

// FB returns these codes when a token has been throttled or blocked for abuse.
// Hitting any of these means slowing down or backing off — fanning out further
// requests (e.g. per-metric retries) makes it strictly worse, so callers must
// detect and stop.
//   4   = application-level rate limit
//   17  = user request limit reached
//   32  = page-level rate limit
//   368 = "action deemed abusive" — sticky cooldown on the page token
//   613 = custom-rate-limit reached
export function isAbuseError(err: unknown): boolean {
  const g = (err as { graph?: { code?: number; error_subcode?: number } } | null)
    ?.graph;
  const code = g?.code;
  if (code === 4 || code === 17 || code === 32 || code === 368 || code === 613) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /deemed abusive|rate limit|request limit|too many calls/i.test(msg);
}

export async function graphFetch<T>(pathAndQuery: string, accessToken: string): Promise<T> {
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const url = `${GRAPH_BASE}${pathAndQuery}${sep}access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw =
      data?.error?.message ?? `Graph API ${res.status} ${res.statusText}`;
    const err = new Error(scrubGraphMessage(String(raw)));
    (err as Error & { graph?: unknown; httpStatus?: number }).graph = data?.error;
    (err as Error & { httpStatus?: number }).httpStatus = res.status;
    throw err;
  }
  return data as T;
}

export async function fetchMe(accessToken: string): Promise<FbUser> {
  // Identity-only — avatars are NOT taken from this response. App rule:
  // every avatar URL must be derived from a UID or username via
  // `buildFbAvatarUrl()`, which yields a stable redirector URL that does
  // not expire (the underlying Graph CDN URLs do).
  return graphFetch<FbUser>("/me?fields=id,name", accessToken);
}

/**
 * Builds the public Graph picture redirector URL for a FB user or page.
 * The browser hits `graph.facebook.com`, which 302-redirects to the live
 * CDN URL on every load, so this URL itself never expires.
 *
 * Resolution support (verified against Graph v21):
 *   • Numeric FB UID (any user or page) — works.
 *   • Page slug (e.g. "cocacola") — works.
 *   • User vanity username (e.g. "zuck") — DOES NOT WORK; FB returns 400.
 *     The /username/picture endpoint was restricted for users in 2018+.
 *   • Internal placeholder strings ("fb_xxx") — does not work.
 *
 * Callers that may pass a non-numeric key should probe the URL with
 * `probeFbAvatarUrl()` before storing it.
 */
export function buildFbAvatarUrl(
  idOrUsername: string,
  opts: { width?: number; height?: number } = {},
): string {
  const w = opts.width ?? 200;
  const h = opts.height ?? 200;
  const key = encodeURIComponent(idOrUsername);
  return `https://graph.facebook.com/${key}/picture?type=large&width=${w}&height=${h}`;
}

/**
 * HEAD-probes a Graph picture URL and returns true only when FB redirects
 * to a REAL avatar on `scontent.*.fbcdn.net`. Rejected:
 *   • 400/404 (broken key, missing perms, deleted account)
 *   • 302 → `static.xx.fbcdn.net/rsrc.php/...` (FB's silhouette placeholder
 *     served for any numeric ID that isn't a real account — saving this
 *     URL produces a generic icon less informative than the initial-letter
 *     placeholder we render for null avatars).
 *   • Network errors.
 */
export async function probeFbAvatarUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual", cache: "no-store" });
    if (res.status !== 302) return false;
    const loc = res.headers.get("location");
    if (!loc || !loc.includes("fbcdn.net")) return false;
    // Reject FB's static silhouette ("/rsrc.php/" path on static.xx.fbcdn.net).
    if (loc.includes("/rsrc.php/")) return false;
    return true;
  } catch {
    return false;
  }
}

export interface FbDebugTokenInfo {
  is_valid: boolean;
  app_id?: string;
  user_id?: string;
  type?: string;
  application?: string;
  expires_at?: number;
  data_access_expires_at?: number;
  scopes?: string[];
  error?: { code: number; message: string; subcode?: number };
}

/**
 * Calls Graph /debug_token to inspect a user access token. Returns validity,
 * expiry, scopes. Requires FB_APP_ID + FB_APP_SECRET in env (uses an app
 * access token to authenticate the inspection). Throws if not configured.
 */
export async function debugUserToken(
  userToken: string,
): Promise<FbDebugTokenInfo> {
  const appId = process.env.FB_APP_ID;
  const appSecret = process.env.FB_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("FB_APP_ID/FB_APP_SECRET chưa cấu hình trong .env");
  }
  const appAccess = `${appId}|${appSecret}`;
  const url =
    `${GRAPH_BASE}/debug_token` +
    `?input_token=${encodeURIComponent(userToken)}` +
    `&access_token=${encodeURIComponent(appAccess)}`;
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) {
    const msg =
      json?.error?.message ?? `debug_token ${res.status} ${res.statusText}`;
    throw new Error(scrubGraphMessage(String(msg)));
  }
  return (json?.data ?? {}) as FbDebugTokenInfo;
}

// Graph error metadata extracted from FB error payloads. Callers care about
// discrimination (expired? missing scope? rate-limited?), not the full envelope.
export interface GraphErrorInfo {
  code: number | null;
  subcode: number | null;
  type: string | null;
  message: string;
  fbtraceId: string | null;
  kind:
    | "expired"        // subcode 463 / 467 — session expired
    | "invalid"        // 190 / subcode 458 — invalid or revoked token
    | "permission"     // 10 / 200 / 299 — missing scope
    | "rate_limit"     // 4 / 17 / 32 / 613
    | "network"        // no Graph payload — fetch / parse failure
    | "other";
}

interface RawGraphError {
  code?: number;
  error_subcode?: number;
  type?: string;
  message?: string;
  fbtrace_id?: string;
}

export function parseGraphError(err: unknown): GraphErrorInfo {
  const fallbackMsg = err instanceof Error ? err.message : String(err);
  const fallback: GraphErrorInfo = {
    code: null,
    subcode: null,
    type: null,
    message: scrubGraphMessage(fallbackMsg),
    fbtraceId: null,
    kind: "network",
  };
  const carrier = err as
    | { graph?: RawGraphError; error?: RawGraphError }
    | null
    | undefined;
  const graph: RawGraphError | undefined = carrier?.graph ?? carrier?.error;
  if (!graph || typeof graph !== "object") return fallback;
  const code = typeof graph.code === "number" ? graph.code : null;
  const sub = typeof graph.error_subcode === "number" ? graph.error_subcode : null;
  const message = scrubGraphMessage(graph.message ?? fallbackMsg);
  let kind: GraphErrorInfo["kind"] = "other";
  if (sub === 463 || sub === 467) kind = "expired";
  else if (sub === 458) kind = "invalid";
  else if (code === 190 || code === 102) kind = "invalid";
  else if (code === 10 || code === 200 || code === 299) kind = "permission";
  else if (code === 4 || code === 17 || code === 32 || code === 613) kind = "rate_limit";
  return {
    code,
    subcode: sub,
    type: graph.type ?? null,
    message,
    fbtraceId: graph.fbtrace_id ?? null,
    kind,
  };
}

export interface AppLessVerifyResult {
  ok: true;
  userId: string;
  userName: string;
  scopes: string[];
  missingRequired: string[];
  missingRecommended: string[];
  /** True when /me/permissions errored — scopes/missingRequired are unknown. */
  permissionsCheckFailed: boolean;
  permissionsError: GraphErrorInfo | null;
}

export interface AppLessVerifyFail {
  ok: false;
  step: "me";
  error: GraphErrorInfo;
}

export type AppLessVerify = AppLessVerifyResult | AppLessVerifyFail;

const REQUIRED_SCOPES = ["pages_show_list"] as const;
const RECOMMENDED_SCOPES = [
  "pages_read_engagement",
  "pages_manage_metadata",
] as const;

/**
 * Verifies a user access token without FB_APP_ID/FB_APP_SECRET. Calls
 * /me?fields=id,name + /me/permissions so callers can distinguish
 * expired/invalid/missing-scope before hitting /me/accounts.
 *
 * /me/permissions failures are SOFT — Page Access Tokens, system-user tokens,
 * and some restricted app configurations can't query that endpoint even when
 * /me/accounts works. In that case we return ok:true with empty scopes and
 * `permissionsCheckFailed:true` so the caller can let /me/accounts be the
 * real test. /me failure is hard (token can't even identify itself).
 */
export async function verifyTokenWithoutAppCreds(
  token: string,
): Promise<AppLessVerify> {
  let me: FbUser;
  try {
    me = await fetchMe(token);
  } catch (e) {
    return { ok: false, step: "me", error: parseGraphError(e) };
  }
  let perms: { data?: Array<{ permission: string; status: string }> } = { data: [] };
  let permissionsError: GraphErrorInfo | null = null;
  try {
    perms = await graphFetch<{ data?: Array<{ permission: string; status: string }> }>(
      "/me/permissions",
      token,
    );
  } catch (e) {
    permissionsError = parseGraphError(e);
  }
  const granted = new Set(
    (perms.data ?? [])
      .filter((p) => p.status === "granted")
      .map((p) => p.permission),
  );
  const scopes = Array.from(granted).sort();
  // When permissions check failed, we cannot know what's missing — return
  // empty arrays so the caller does not falsely block on "missing scopes".
  const missingRequired = permissionsError
    ? []
    : REQUIRED_SCOPES.filter((s) => !granted.has(s));
  const missingRecommended = permissionsError
    ? []
    : RECOMMENDED_SCOPES.filter((s) => !granted.has(s));
  return {
    ok: true,
    userId: me.id,
    userName: me.name,
    scopes,
    missingRequired,
    missingRecommended,
    permissionsCheckFailed: !!permissionsError,
    permissionsError,
  };
}

/** Maps a parsed Graph error to a Vietnamese, user-actionable message. */
export function mapTokenErrorToVi(err: GraphErrorInfo): string {
  switch (err.kind) {
    case "expired":
      return "Token đã hết hạn. Vui lòng vào Graph API Explorer tạo token mới.";
    case "invalid":
      return "Token không hợp lệ hoặc đã bị thu hồi. Vui lòng dán token mới.";
    case "permission":
      return `Token thiếu quyền truy cập (${err.message}). Hãy cấp lại với scope pages_show_list, pages_read_engagement.`;
    case "rate_limit":
      return "Facebook đang giới hạn truy cập. Hãy thử lại sau ít phút.";
    case "network":
      return `Không gọi được Graph API: ${err.message}`;
    default:
      // FB code #1 ("API Unknown") + #2 ("Service Unavailable") are generic
      // catch-alls. Most common cause: the token cannot access a requested
      // field (deprecated, requires app review, wrong token type).
      if (err.code === 1 || err.code === 2) {
        return `Lỗi Graph API #${err.code} (${err.message}) — thường do field bị hạn chế hoặc token không phải User Access Token. Thử dán lại User Token từ Graph API Explorer với scope pages_show_list.`;
      }
      return `Lỗi Graph API${err.code ? ` (#${err.code}${err.subcode ? `/${err.subcode}` : ""})` : ""}: ${err.message}`;
  }
}

// Avatars are NOT requested here — they are derived from `id` via
// `buildFbAvatarUrl()` (stable redirector that never expires). The signed
// CDN URL Graph returns under `picture.data.url` becomes invalid after a
// few days, so storing it caused intermittent broken-image renders.
const PAGE_FIELDS = [
  "id",
  "name",
  "category",
  "category_list",
  "about",
  "description",
  "link",
  "username",
  "cover{source}",
  "fan_count",
  "followers_count",
  "new_like_count",
  "rating_count",
  "overall_star_rating",
  "verification_status",
  "access_token",
  "tasks",
].join(",");

// Minimal field set used as a fallback when the full PAGE_FIELDS triggers an
// "Invalid request" / "Tried accessing nonexisting field" error from FB
// (typical when an app lacks review or one of the rich fields was deprecated
// for the token's permission level). These fields are guaranteed for any
// page the token can administer.
const PAGE_FIELDS_SAFE = ["id", "name", "category", "access_token", "tasks"].join(",");

async function paginate<T>(
  startPath: string,
  accessToken: string,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = startPath;
  while (cursor) {
    const data: { data: T[]; paging?: { next?: string } } = await graphFetch(
      cursor,
      accessToken,
    );
    out.push(...data.data);
    if (data.paging?.next) {
      const u = new URL(data.paging.next);
      u.searchParams.delete("access_token");
      // Strip whatever `/vNN.NN` prefix FB echoed back — graphFetch will
      // re-prepend GRAPH_BASE which already contains the version. Hard-
      // coding "/v21.0" here was stale (GRAPH_BASE is v23.0), making
      // cursor doubly-versioned and 400-ing on every page after the first.
      cursor = `${u.pathname.replace(/^\/v\d+\.\d+/, "")}${u.search}`;
    } else {
      cursor = null;
    }
  }
  return out;
}

// Classic user-admin pages. Does NOT include Business Manager–owned pages.
// Falls back to a minimal safe field set when the full set hits FB error
// #1 (Invalid request) or #100 (nonexisting field) — keeps the sync alive
// even when the token's app cannot read enriched fields.
export async function fetchMeAccounts(accessToken: string): Promise<FbPage[]> {
  try {
    return await paginate<FbPage>(
      `/me/accounts?fields=${PAGE_FIELDS}&limit=100`,
      accessToken,
    );
  } catch (e) {
    const info = parseGraphError(e);
    if (info.code === 1 || info.code === 100) {
      return paginate<FbPage>(
        `/me/accounts?fields=${PAGE_FIELDS_SAFE}&limit=100`,
        accessToken,
      );
    }
    throw e;
  }
}

export interface FetchBusinessPagesResult {
  pages: FbPage[];
  /** Number of businesses the token can list. 0 means missing scope or no businesses. */
  businessCount: number;
  /** Per-edge errors, scrubbed. Empty when nothing failed. */
  errors: string[];
  /** True when /me/businesses itself failed (likely missing `business_management` scope). */
  scopeMissing: boolean;
}

// Pages accessible via Business Manager (owned_pages + client_pages).
// Requires `business_management` scope. Returns details so the sync UI can
// surface scope/permission problems instead of silently dropping pages.
export async function fetchBusinessPages(
  accessToken: string,
): Promise<FetchBusinessPagesResult> {
  let businesses: Array<{ id: string }> = [];
  try {
    businesses = await paginate<{ id: string }>(
      `/me/businesses?fields=id&limit=100`,
      accessToken,
    );
  } catch (e) {
    return {
      pages: [],
      businessCount: 0,
      errors: [e instanceof Error ? e.message : String(e)],
      scopeMissing: true,
    };
  }
  const all: FbPage[] = [];
  const errors: string[] = [];
  for (const biz of businesses) {
    for (const edge of ["owned_pages", "client_pages"] as const) {
      try {
        let pages: FbPage[];
        try {
          pages = await paginate<FbPage>(
            `/${biz.id}/${edge}?fields=${PAGE_FIELDS}&limit=100`,
            accessToken,
          );
        } catch (innerErr) {
          const info = parseGraphError(innerErr);
          if (info.code !== 1 && info.code !== 100) throw innerErr;
          pages = await paginate<FbPage>(
            `/${biz.id}/${edge}?fields=${PAGE_FIELDS_SAFE}&limit=100`,
            accessToken,
          );
        }
        all.push(...pages);
      } catch (e) {
        errors.push(
          `${biz.id}/${edge}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
  return {
    pages: all,
    businessCount: businesses.length,
    errors,
    scopeMissing: false,
  };
}

// Re-fetch a single page directly to recover `access_token` (business edges
// sometimes return null for non-admin tasks). Best-effort, failures ignored.
export async function fetchPageDetail(
  pageId: string,
  userToken: string,
): Promise<FbPage | null> {
  try {
    return await graphFetch<FbPage>(
      `/${pageId}?fields=${PAGE_FIELDS}`,
      userToken,
    );
  } catch {
    return null;
  }
}

export async function fetchUserPages(accessToken: string): Promise<FbPage[]> {
  // Merge classic /me/accounts + Business Manager pages, dedup by page id.
  // Prefer the variant that carries an `access_token` so downstream page-level
  // Graph calls keep working.
  const byId = new Map<string, FbPage>();
  const upsert = (p: FbPage) => {
    const prev = byId.get(p.id);
    if (!prev) {
      byId.set(p.id, p);
      return;
    }
    if (!prev.access_token && p.access_token) {
      byId.set(p.id, { ...prev, ...p });
    }
  };

  for (const p of await fetchMeAccounts(accessToken)) upsert(p);
  for (const p of (await fetchBusinessPages(accessToken)).pages) upsert(p);

  // Backfill missing per-page access tokens (business edges can omit them).
  for (const [id, p] of byId) {
    if (!p.access_token) {
      const detail = await fetchPageDetail(id, accessToken);
      if (detail) byId.set(id, { ...p, ...detail });
    }
  }

  return Array.from(byId.values());
}

/**
 * Exchanges a short-lived user access token for a long-lived one (~60 days).
 * Requires a Facebook App client_id + client_secret (set via env).
 */
export async function exchangeLongLivedUserToken(
  shortToken: string,
): Promise<{ accessToken: string; expiresIn: number | null }> {
  const appId = process.env.FB_APP_ID;
  const appSecret = process.env.FB_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("FB_APP_ID / FB_APP_SECRET chưa cấu hình trong .env");
  }
  const url =
    `${GRAPH_BASE}/oauth/access_token` +
    `?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&fb_exchange_token=${encodeURIComponent(shortToken)}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message ?? `Exchange failed ${res.status}`;
    throw new Error(scrubGraphMessage(String(msg)));
  }
  return {
    accessToken: data.access_token as string,
    expiresIn: (data.expires_in as number | undefined) ?? null,
  };
}

export function isFacebookConfigured(): boolean {
  return !!(process.env.FB_APP_ID && process.env.FB_APP_SECRET);
}
