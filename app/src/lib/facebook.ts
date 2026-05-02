// Facebook Graph API wrapper. Read-only: fetch user info, owned pages, page insights.
// No browser automation or write operations.

// v23 introduced `content_monetization_earnings` (May 2025) — the consolidated
// earnings metric that replaces `page_daily_video_ad_break_earnings` and friends.
// All previously-working v21 endpoints (insights, /me/accounts, /me/permissions)
// continue to work on v23 unchanged.
const GRAPH_BASE = "https://graph.facebook.com/v23.0";

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

export interface FbPageInsights {
  [metric: string]: Array<{
    period: string;
    values: Array<{ value: number | Record<string, number>; end_time: string }>;
    title?: string;
    description?: string;
  }>;
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

async function graphFetch<T>(pathAndQuery: string, accessToken: string): Promise<T> {
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
      cursor = `${u.pathname.replace("/v21.0", "")}${u.search}`;
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

// Merge classic /me/accounts + Business Manager pages, dedup by page id.
// Prefer the variant that carries an `access_token` so downstream page-level
// Graph calls keep working. Used by callers that don't need step-by-step
// progress (eg. silent bulk sync).
export function mergeFbPages(...lists: FbPage[][]): FbPage[] {
  const byId = new Map<string, FbPage>();
  for (const list of lists) {
    for (const p of list) {
      const prev = byId.get(p.id);
      if (!prev) {
        byId.set(p.id, p);
        continue;
      }
      if (!prev.access_token && p.access_token) {
        byId.set(p.id, { ...prev, ...p });
      }
    }
  }
  return Array.from(byId.values());
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

// Graph v21 page-level metrics — VERIFIED LIVE against Graph v21 on 2026-04-21.
// Deprecation wave Nov 15, 2025 removed: `page_impressions` (no-suffix),
// `page_fans`, `page_fan_adds_unique`, `page_engaged_users`, `page_consumptions`.
// The promised `views` replacement is NOT LIVE at page-insights level yet
// (still returns #100) — do NOT include it or the whole batch 400s.
const PAGE_METRICS_SAFE = [
  "page_impressions_unique",   // unique reach (daily)
  "page_post_engagements",     // engagement total
  "page_views_total",          // page views
] as const;

const PAGE_METRICS_LEGACY = [
  "page_media_view",
  "page_total_media_view_unique",
  "page_follows",              // current follower count snapshot
  "page_video_views",
  "page_video_views_unique",
] as const;


type FbPageInsightRaw = {
  name: string;
  period: string;
  values: Array<{ value: number | Record<string, number>; end_time: string }>;
  title?: string;
  description?: string;
};

function mergeInsights(arr: FbPageInsightRaw[]): FbPageInsights {
  const out: FbPageInsights = {};
  for (const item of arr) {
    out[item.name] = [{
      period: item.period,
      values: item.values,
      title: item.title,
      description: item.description,
    }];
  }
  return out;
}

export interface PageInsightRange {
  /** epoch seconds; when both provided, used instead of `days`. */
  from?: number;
  to?: number;
  /** Fallback: last N days from now. Default 28. Facebook day-period supports up to ~93 days per call. */
  days?: number;
}

function buildRangeQs(range?: PageInsightRange): { qs: string; start: number; end: number } {
  const nowSec = Math.floor(Date.now() / 1000);
  let since: number;
  let until: number;
  if (range?.from && range?.to && range.to > range.from) {
    since = range.from;
    until = range.to;
  } else {
    // No clamp here — long ranges are handled by chunking wrappers below
    // (FB's `period=day` caps at ~93 days per call; the wrapper splits).
    const days = range?.days && range.days > 0 ? range.days : 28;
    until = nowSec;
    since = nowSec - days * 86_400;
  }
  return { qs: `period=day&since=${since}&until=${until}`, start: since, end: until };
}

/**
 * Split a [since, until] window into adjacent ≤maxDays sub-windows. FB Graph
 * caps `period=day` insights at ~93 days/call, so callers must chunk longer
 * ranges and merge results.
 */
function splitTimeRange(
  since: number,
  until: number,
  maxDays = 90,
): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  if (until <= since) return out;
  const maxSec = maxDays * 86_400;
  let cur = since;
  while (cur < until) {
    const next = Math.min(cur + maxSec, until);
    out.push({ from: cur, to: next });
    if (next >= until) break;
    cur = next;
  }
  return out;
}

/**
 * Fetches insights for a SINGLE FB-allowed window (since/until). Used as the
 * inner step for chunked long-range fetches.
 */
async function fetchPageInsightsWindow(
  pageId: string,
  pageAccessToken: string,
  since: number,
  until: number,
): Promise<FbPageInsightRaw[]> {
  const qs = `period=day&since=${since}&until=${until}`;
  const all: FbPageInsightRaw[] = [];

  // Core metrics (SAFE): try batched call; on failure fall back per-metric so
  // a single deprecated/unauthorized metric does not kill the sync.
  let batchErr: unknown = null;
  try {
    const res = await graphFetch<{ data: FbPageInsightRaw[] }>(
      `/${pageId}/insights?metric=${PAGE_METRICS_SAFE.join(",")}&${qs}`,
      pageAccessToken,
    );
    all.push(...res.data);
  } catch (e) {
    batchErr = e;
    const safeErrors: string[] = [];
    const settled = await Promise.allSettled(
      PAGE_METRICS_SAFE.map(async (m) => {
        const r = await graphFetch<{ data: FbPageInsightRaw[] }>(
          `/${pageId}/insights?metric=${m}&${qs}`,
          pageAccessToken,
        );
        return r.data;
      }),
    );
    for (const r of settled) {
      if (r.status === "fulfilled") all.push(...r.value);
      else safeErrors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
    if (all.length === 0) {
      const msg = batchErr instanceof Error ? batchErr.message : String(batchErr);
      throw new Error(
        `${msg} (per-metric also failed: ${safeErrors[0] ?? "unknown"})`,
      );
    }
  }

  // Legacy metrics — best-effort, failures ignored so deprecated metrics don't
  // block the response. If Facebook later removes them completely we lose data
  // silently but nothing breaks.
  const legacy = await Promise.allSettled(
    PAGE_METRICS_LEGACY.map(async (m) => {
      const r = await graphFetch<{ data: FbPageInsightRaw[] }>(
        `/${pageId}/insights?metric=${m}&${qs}`,
        pageAccessToken,
      );
      return r.data;
    }),
  );
  for (const r of legacy) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  return all;
}

/**
 * Fetches Page insights over a time range. When the range exceeds FB's
 * ~93-day per-call cap, splits into adjacent 90-day windows, fetches each
 * sequentially, and merges the daily values per metric.
 */
export async function fetchPageInsights(
  pageId: string,
  pageAccessToken: string,
  range?: PageInsightRange,
): Promise<FbPageInsights> {
  const { start, end } = buildRangeQs(range);
  const windows = splitTimeRange(start, end, 90);
  if (windows.length === 0) return {};
  if (windows.length === 1) {
    const all = await fetchPageInsightsWindow(
      pageId,
      pageAccessToken,
      windows[0].from,
      windows[0].to,
    );
    return mergeInsights(all);
  }
  // Multi-window: fetch sequentially (rate-limit friendly), then merge values
  // per metric (dedup by end_time so overlapping window edges don't double-count).
  const byMetric = new Map<string, FbPageInsightRaw>();
  for (const w of windows) {
    const partial = await fetchPageInsightsWindow(
      pageId,
      pageAccessToken,
      w.from,
      w.to,
    );
    for (const item of partial) {
      const existing = byMetric.get(item.name);
      if (!existing) {
        byMetric.set(item.name, {
          name: item.name,
          period: item.period,
          values: [...item.values],
          title: item.title,
          description: item.description,
        });
      } else {
        const seen = new Set(existing.values.map((v) => v.end_time));
        for (const v of item.values) {
          if (!seen.has(v.end_time)) existing.values.push(v);
        }
      }
    }
  }
  // Sort each metric's values by end_time for consistent series order
  for (const item of byMetric.values()) {
    item.values.sort((a, b) => a.end_time.localeCompare(b.end_time));
  }
  return mergeInsights(Array.from(byMetric.values()));
}

export function resolveInsightRange(range?: PageInsightRange): { start: number; end: number } {
  const { start, end } = buildRangeQs(range);
  return { start, end };
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

export interface FbPagePost {
  id: string;
  message?: string;
  story?: string;
  permalink_url?: string;
  full_picture?: string;
  status_type?: string;
  created_time?: string;
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  shares?: { count?: number };
}

/**
 * Fetches published posts for a Page. Uses the Page access token.
 * `limit` caps per-page results; pagination continues until `max` rows.
 */
export async function fetchPagePosts(
  pageId: string,
  pageAccessToken: string,
  opts: { limit?: number; max?: number } = {},
): Promise<FbPagePost[]> {
  const limit = opts.limit ?? 25;
  const max = opts.max ?? 100;
  const fields = [
    "id",
    "message",
    "story",
    "permalink_url",
    "full_picture",
    "status_type",
    "created_time",
    "reactions.summary(true).limit(0)",
    "comments.summary(true).limit(0)",
    "shares",
  ].join(",");

  const all: FbPagePost[] = [];
  let cursor: string | null = `/${pageId}/published_posts?fields=${fields}&limit=${limit}`;
  while (cursor && all.length < max) {
    const data: { data: FbPagePost[]; paging?: { next?: string } } =
      await graphFetch(cursor, pageAccessToken);
    all.push(...data.data);
    if (data.paging?.next && all.length < max) {
      const u = new URL(data.paging.next);
      u.searchParams.delete("access_token");
      cursor = `${u.pathname.replace("/v21.0", "")}${u.search}`;
    } else {
      cursor = null;
    }
  }
  return all.slice(0, max);
}

export interface FbPostInsightsRaw {
  name: string;
  period: string;
  values: Array<{ value: number | Record<string, number>; end_time?: string }>;
  title?: string;
  description?: string;
}

/**
 * Fetches per-post insights (reach / impressions / engaged users / clicks / video views).
 * Uses the Page access token.
 */
// Graph v21 post-level metrics. `post_engaged_users` was deprecated in v19 —
// including it causes the whole batch request to 400. If ANY metric in this
// list is deprecated on a given page/version, we fall back to per-metric calls
// so at least the working metrics come through.
const POST_METRICS = [
  "post_impressions",
  "post_impressions_unique",
  "post_clicks",
  "post_reactions_by_type_total",
  "post_video_views",
] as const;

export async function fetchPostInsights(
  postId: string,
  pageAccessToken: string,
): Promise<Record<string, FbPostInsightsRaw>> {
  // Fast path: single batched call.
  try {
    const res = await graphFetch<{ data: FbPostInsightsRaw[] }>(
      `/${postId}/insights?metric=${POST_METRICS.join(",")}`,
      pageAccessToken,
    );
    const out: Record<string, FbPostInsightsRaw> = {};
    for (const item of res.data) out[item.name] = item;
    return out;
  } catch (batchErr) {
    // If FB is rate-limiting / abuse-blocking this token, fanning out 5
    // per-metric calls will pile on and extend the cooldown. Bail out
    // immediately so the caller can stop the loop.
    if (isAbuseError(batchErr)) throw batchErr;
    // Slow path: per-metric so one bad metric doesn't nuke everything. At least
    // one metric must succeed — otherwise we rethrow the original batch error
    // (more informative than the last per-metric error).
    const out: Record<string, FbPostInsightsRaw> = {};
    const lastErrors: string[] = [];
    const settled = await Promise.allSettled(
      POST_METRICS.map(async (m) => {
        const res = await graphFetch<{ data: FbPostInsightsRaw[] }>(
          `/${postId}/insights?metric=${m}`,
          pageAccessToken,
        );
        return res.data;
      }),
    );
    for (const r of settled) {
      if (r.status === "fulfilled") {
        for (const item of r.value) out[item.name] = item;
      } else {
        lastErrors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      }
    }
    if (Object.keys(out).length === 0) {
      const msg = batchErr instanceof Error ? batchErr.message : String(batchErr);
      throw new Error(`${msg} (per-metric also failed: ${lastErrors[0] ?? "unknown"})`);
    }
    return out;
  }
}

export function extractPostMetric(
  insights: Record<string, FbPostInsightsRaw>,
  name: string,
): number | null {
  const item = insights[name];
  if (!item || item.values.length === 0) return null;
  const v = item.values[0].value;
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    return Object.values(v).reduce((s, n) => s + (n ?? 0), 0);
  }
  return null;
}

// =================== Monetization ===================
//
// Page earnings are reported by Graph as a daily series via the
// `page_daily_video_ad_break_earnings` metric. The `value` is a number in
// the page's earnings currency (typically USD). FB does NOT expose a
// boolean "is this page monetized" field — we infer it from whether the
// metric returns data and whether the values are non-zero.

export type MonetizationStatus =
  | "monetized"      // returned data with non-zero earnings somewhere in the window
  | "eligible"       // returned data but all zeros — page is set up, just no revenue
  | "not_monetized"  // FB rejected metrics — page not onboarded for any tracked program
  | "missing_scope"  // FB rejected with permission error — token can't read insights
  | "unknown";       // never checked or last sync errored before reaching the metric

export interface PageEarningsResult {
  status: MonetizationStatus;
  /** Total earnings in micro-units (×1_000_000) over the queried window. */
  totalMicros: number;
  currency: string | null;
  /** Daily series: [epochSec, micros]. Empty when status != "monetized"|"eligible". */
  daily: Array<{ ts: number; micros: number }>;
  rangeStart: number;
  rangeEnd: number;
  /** Scrubbed FB error message when status === "not_monetized". */
  error: string | null;
  /** Parsed Graph error so caller can branch on subcode/permission. */
  errorInfo: GraphErrorInfo | null;
}

const PAGE_EARNINGS_METRIC = "page_daily_video_ad_break_earnings";

/**
 * Fetches in-stream ad break earnings for a Page over a time window. Uses the
 * Page access token. Returns inferred monetization status based on the response:
 *   • Graph 200 with non-zero values → "monetized"
 *   • Graph 200 with all-zero values → "eligible"
 *   • Graph 400/403 / OAuth error    → "not_monetized" (with error captured)
 *
 * Window defaults to the last 28 days. FB caps insights `period=day` at ~93 days.
 */
export async function fetchPageEarnings(
  pageId: string,
  pageAccessToken: string,
  range?: PageInsightRange,
): Promise<PageEarningsResult> {
  const { qs, start, end } = buildRangeQs(range);
  try {
    const res = await graphFetch<{
      data: Array<{
        name: string;
        period: string;
        values: Array<{ value: number | Record<string, number>; end_time: string }>;
        title?: string;
        description?: string;
      }>;
    }>(`/${pageId}/insights?metric=${PAGE_EARNINGS_METRIC}&${qs}`, pageAccessToken);

    const series = res.data?.[0];
    if (!series || !Array.isArray(series.values) || series.values.length === 0) {
      return {
        status: "eligible",
        totalMicros: 0,
        currency: null,
        daily: [],
        rangeStart: start,
        rangeEnd: end,
        error: null,
        errorInfo: null,
      };
    }

    let totalMicros = 0;
    const daily: Array<{ ts: number; micros: number }> = [];
    for (const v of series.values) {
      const value = typeof v.value === "number" ? v.value : 0;
      const micros = Math.round(value * 1_000_000);
      const ts = Math.floor(new Date(v.end_time).getTime() / 1000);
      daily.push({ ts, micros });
      totalMicros += micros;
    }
    return {
      status: totalMicros > 0 ? "monetized" : "eligible",
      totalMicros,
      currency: "USD", // FB returns USD by default; per-page currency not in this metric
      daily,
      rangeStart: start,
      rangeEnd: end,
      error: null,
      errorInfo: null,
    };
  } catch (e) {
    const info = parseGraphError(e);
    return {
      status: "not_monetized",
      totalMicros: 0,
      currency: null,
      daily: [],
      rangeStart: start,
      rangeEnd: end,
      error: info.message,
      errorInfo: info,
    };
  }
}

export interface PostEarningsResult {
  /** Total earnings in micro-units. 0 when the post is not a video / not monetized. */
  totalMicros: number;
  currency: string | null;
  available: boolean;
  /** Scrubbed message when `available` is false. */
  error: string | null;
}

/**
 * Per-post (video) ad break earnings via /{video-id}/video_insights. Returns
 * `available: false` for non-video posts or when FB rejects the metric.
 */
export async function fetchPostVideoEarnings(
  postId: string,
  pageAccessToken: string,
): Promise<PostEarningsResult> {
  try {
    const res = await graphFetch<{
      data: Array<{
        name: string;
        values: Array<{ value: number | Record<string, number> }>;
      }>;
    }>(
      `/${postId}/video_insights?metric=total_video_ad_break_earnings`,
      pageAccessToken,
    );
    const series = res.data?.[0];
    if (!series || !Array.isArray(series.values) || series.values.length === 0) {
      return { totalMicros: 0, currency: null, available: true, error: null };
    }
    const v = series.values[0].value;
    const num = typeof v === "number" ? v : 0;
    return {
      totalMicros: Math.round(num * 1_000_000),
      currency: "USD",
      available: true,
      error: null,
    };
  } catch (e) {
    const info = parseGraphError(e);
    return {
      totalMicros: 0,
      currency: null,
      available: false,
      error: info.message,
    };
  }
}

/** Convert micro-units back to a JS-display number (USD-like). */
export function microsToAmount(micros: number | null | undefined): number {
  if (!micros) return 0;
  return micros / 1_000_000;
}

// =================== Earnings breakdown ===================
//
// As of Graph API v23, the older metrics (`page_daily_video_ad_break_earnings`,
// etc.) return HTTP 400 #100. Two replacement metrics exist:
//   • `monetization_approximate_earnings` — broad "approximate earnings"
//     across all monetization programs (the number users see in Meta Business
//     Suite "Approximate earnings"). Confirmed live to return non-zero for
//     pages earning via Reel ads / video ad breaks.
//   • `content_monetization_earnings` — specific "Content Monetization"
//     program enrollment. Returns 0 for pages not enrolled in that exact
//     program even when the page IS earning via other monetization paths.
//
// We use `monetization_approximate_earnings` as the primary signal because
// it reflects what users actually see in Meta's UI. Per-source breakdown
// (Reels / Photos / Stories / Text / Extra bonus) is no longer exposed via
// Graph API — Creator Studio UI is the only place to see the split.
// Sub-source enum entries are kept for visual continuity (UI tiles render
// "không hỗ trợ").

export type EarningsSource =
  | "total"           // content_monetization_earnings (sole live metric)
  | "in_stream_ads"   // deprecated — no v23 replacement
  | "subscriptions"   // deprecated — no v23 replacement
  | "live"            // deprecated — no v23 replacement
  | "reels_bonus"     // never exposed by Graph API (creator program)
  | "photos_bonus"    // never exposed
  | "stories_bonus"   // never exposed
  | "text_bonus"      // never exposed
  | "extra_bonus";    // never exposed

export interface EarningsSourceResult {
  source: EarningsSource;
  micros: number;
  /** True when FB returned a value (even zero). False when metric unsupported. */
  available: boolean;
  error: string | null;
}

export interface PageEarningsBreakdown {
  status: MonetizationStatus;
  totalMicros: number;
  currency: string | null;
  rangeStart: number;
  rangeEnd: number;
  sources: EarningsSourceResult[];
  /** First Graph error (used to set monetization_status when ALL metrics fail). */
  error: string | null;
  errorInfo: GraphErrorInfo | null;
}

interface MetricSpec {
  source: EarningsSource;
  metric: string;
}

// `monetization_approximate_earnings` is the live metric for the "Approximate
// earnings" number in Meta Business Suite. All older per-source metrics
// (in-stream / subs / live / Reels) return #100 on v23 — kept in the source
// enum with `metric: null` so the UI tiles still render but show "không hỗ trợ".
const EARNINGS_METRICS: Array<MetricSpec | { source: EarningsSource; metric: null }> = [
  { source: "total", metric: "monetization_approximate_earnings" },
  { source: "in_stream_ads", metric: null },
  { source: "subscriptions", metric: null },
  { source: "live", metric: null },
  { source: "reels_bonus", metric: null },
  { source: "photos_bonus", metric: null },
  { source: "stories_bonus", metric: null },
  { source: "text_bonus", metric: null },
  { source: "extra_bonus", metric: null },
];

async function fetchSingleEarningsMetric(
  pageId: string,
  pageAccessToken: string,
  qs: string,
  metric: string,
): Promise<{ micros: number; error: string | null; errorKind: GraphErrorInfo["kind"] | null }> {
  try {
    const res = await graphFetch<{
      data: Array<{
        name: string;
        values: Array<{ value: number | Record<string, number>; end_time: string }>;
      }>;
    }>(`/${pageId}/insights?metric=${metric}&${qs}`, pageAccessToken);
    const series = res.data?.[0];
    if (!series || !Array.isArray(series.values)) {
      return { micros: 0, error: null, errorKind: null };
    }
    let total = 0;
    for (const v of series.values) {
      const value = typeof v.value === "number" ? v.value : 0;
      total += Math.round(value * 1_000_000);
    }
    return { micros: total, error: null, errorKind: null };
  } catch (e) {
    const info = parseGraphError(e);
    return { micros: 0, error: info.message, errorKind: info.kind };
  }
}

/**
 * Fetches earnings broken down by source. Queries all available Graph metrics
 * in parallel; metrics not exposed by Graph (creator bonuses) are returned with
 * `available: false` so the UI can match Creator Studio's layout.
 *
 * Status logic:
 *   • Any source returns >0 micros        → "monetized"
 *   • All sources return 0 (no errors)    → "eligible"
 *   • Every supported source errors out   → "not_monetized"
 *   • Mixed (some succeed, some fail)     → "monetized" or "eligible" by total
 */
export async function fetchPageEarningsBreakdown(
  pageId: string,
  pageAccessToken: string,
  range?: PageInsightRange,
): Promise<PageEarningsBreakdown> {
  const { start, end } = buildRangeQs(range);
  const fetchable = EARNINGS_METRICS.filter(
    (m): m is MetricSpec => m.metric !== null,
  );
  const windows = splitTimeRange(start, end, 90);
  // Aggregate across windows: sum micros, keep first error + kind per source.
  const aggregated = new Map<
    EarningsSource,
    { micros: number; error: string | null; errorKind: GraphErrorInfo["kind"] | null }
  >();
  for (const w of windows) {
    const qs = `period=day&since=${w.from}&until=${w.to}`;
    const settled = await Promise.all(
      fetchable.map((m) =>
        fetchSingleEarningsMetric(pageId, pageAccessToken, qs, m.metric).then(
          (r) => ({ source: m.source, ...r }),
        ),
      ),
    );
    for (const r of settled) {
      const prev = aggregated.get(r.source);
      if (!prev) {
        aggregated.set(r.source, {
          micros: r.micros,
          error: r.error,
          errorKind: r.errorKind,
        });
      } else {
        aggregated.set(r.source, {
          micros: prev.micros + r.micros,
          error: prev.error ?? r.error,
          errorKind: prev.errorKind ?? r.errorKind,
        });
      }
    }
  }
  const fetchedBySource = aggregated;

  const sources: EarningsSourceResult[] = EARNINGS_METRICS.map((m) => {
    if (m.metric === null) {
      return { source: m.source, micros: 0, available: false, error: null };
    }
    const r = fetchedBySource.get(m.source);
    return {
      source: m.source,
      micros: r?.micros ?? 0,
      available: r != null && r.error == null,
      error: r?.error ?? null,
    };
  });

  let totalMicros = 0;
  let supportedCount = 0;
  let supportedErrors = 0;
  let permissionErrors = 0;
  let firstError: string | null = null;
  for (const s of sources) {
    if (s.available || s.error != null) {
      supportedCount++;
      if (s.error != null) {
        supportedErrors++;
        if (!firstError) firstError = s.error;
        const r = fetchedBySource.get(s.source);
        if (
          r?.errorKind === "permission" ||
          r?.errorKind === "expired" ||
          r?.errorKind === "invalid"
        ) {
          permissionErrors++;
        }
      }
      totalMicros += s.micros;
    }
  }

  let status: MonetizationStatus;
  if (totalMicros > 0) {
    status = "monetized";
  } else if (
    supportedErrors === supportedCount &&
    supportedErrors > 0 &&
    permissionErrors === supportedErrors
  ) {
    // ALL metrics rejected with auth-class errors → token can't read insights.
    // Requiring all-permission (not majority) prevents misclassifying a
    // genuinely-not-onboarded page that also happens to have one expired-token
    // error: that case stays `not_monetized` so the user gets the right hint.
    // Pages-not-onboarded return code 100 ("Object does not support...") which
    // parseGraphError tags as kind="other".
    status = "missing_scope";
  } else if (supportedErrors === supportedCount) {
    status = "not_monetized";
  } else {
    status = "eligible";
  }

  return {
    status,
    totalMicros,
    currency: totalMicros > 0 ? "USD" : null,
    rangeStart: start,
    rangeEnd: end,
    sources,
    error:
      status === "not_monetized" || status === "missing_scope" ? firstError : null,
    errorInfo: null,
  };
}

/** Vietnamese label for an earnings source. */
export function earningsSourceLabel(source: EarningsSource): string {
  switch (source) {
    case "total":         return "Tổng (Approximate Earnings)";
    case "in_stream_ads": return "Quảng cáo trong video";
    case "subscriptions": return "Đăng ký fan";
    case "live":          return "Phát trực tiếp";
    case "reels_bonus":   return "Reels";
    case "photos_bonus":  return "Photos";
    case "stories_bonus": return "Stories";
    case "text_bonus":    return "Text";
    case "extra_bonus":   return "Extra bonus";
  }
}
