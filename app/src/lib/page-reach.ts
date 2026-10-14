// Page Reach for the Insight screen.
//
// Pages are never stored: they are listed live from Graph with the tokens the
// owner pasted into Insight (table insight_tokens). A page reachable through
// several tokens has several candidates. Every Graph call for a page goes
// through `fetchPageReach()`, which:
//   - rotates the starting candidate per page (load-balances tokens),
//   - "cools" a token for COOL_MS after a rate-limit error and moves on to the
//     next candidate (whole token for #4/#17/#613, just that page for #32/#368),
//   - tries reach metrics in order, skipping ones Graph rejects as invalid,
//     and remembers the working metric per page.
//
// ONE Graph call per page answers all three ranges: omitting `period` makes
// Graph return the day, week and days_28 series together, so switching
// Hôm nay / 7 ngày / 28 ngày in the UI needs no new request.
//
// Reach counts UNIQUE people, so 7d / 28d are NEVER summed from daily values
// (that double-counts people seen on several days). We read Graph's own
// period values: week for 7 days, days_28 for 28 days, day for today.
//
// State lives in module memory (per Worker isolate / Node process) — a
// best-effort cache; losing it only costs a few extra Graph calls.

import { graphFetch, isAbuseError, parseGraphError } from "@/lib/facebook";

export type ReachRange = "today" | "7d" | "28d";

export const REACH_RANGES: ReachRange[] = ["today", "7d", "28d"];

// Tried in order. Verified on live Graph v23 (2026-10): page_impressions_unique
// and page_posts_impressions_unique now fail with #100 "must be a valid
// insights metric"; page_total_media_view_unique ("Người xem", Meta's
// replacement) works for day/week/days_28. Older apps/pages may still serve
// the legacy ones, so they stay as fallbacks.
export const REACH_METRICS = [
  "page_total_media_view_unique",
  "page_impressions_unique",
  "page_posts_impressions_unique",
] as const;

const COOL_MS = 5 * 60 * 1000;
const DAY = 86_400;
// 28 daily points + the 28d value 28 days before the latest one, with slack.
const WINDOW_DAYS = 31;

export interface ReachCandidate {
  tokenId: number;
  label: string;
  kind: "user" | "page";
  /** For kind="page": the page id the token belongs to. */
  fbId: string | null;
  token: string;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD (Pacific day the value belongs to)
  value: number | null;
}

export interface RangeReach {
  reach: number | null;
  prev: number | null;
  daily: DailyPoint[];
  /** Hôm nay: Facebook hasn't published today's number yet. */
  todayPending?: boolean;
}

export interface ReachResult {
  metric: string | null;
  via: string | null;
  ranges: Record<ReachRange, RangeReach>;
  unsupported?: boolean;
  reason?: string;
}

export class CoolingError extends Error {
  readonly code = "COOLING";
  constructor(public retryAfterSec: number) {
    super(
      `Mọi token của Trang này đang bị Facebook giới hạn — thử lại sau khoảng ${Math.ceil(
        retryAfterSec / 60,
      )} phút.`,
    );
  }
}

const pageTokens = new Map<string, string>(); // `${tokenId}:${pageId}` → page token
// Cooled until (ms): "a:<tokenId>" (every page of that token) or
// "p:<tokenId>:<pageId>" (page-level limit, only that page's token).
const cooling = new Map<string, number>();
const reachMetric = new Map<string, string>(); // pageId → working metric
const rotation = new Map<string, number>(); // pageId → round-robin counter

/** Test hook: forget all cached tokens / metrics / cool-downs. */
export function resetReachState() {
  pageTokens.clear();
  cooling.clear();
  reachMetric.clear();
  rotation.clear();
}

/** Seed the page-token cache from a page listing (saves one call later). */
export function rememberPageToken(tokenId: number, pageId: string, token: string) {
  pageTokens.set(`${tokenId}:${pageId}`, token);
}

/** Drop everything cached for a token (it was deleted or replaced). */
export function forgetToken(tokenId: number) {
  for (const key of [...pageTokens.keys()]) if (key.startsWith(`${tokenId}:`)) pageTokens.delete(key);
  for (const key of [...cooling.keys()]) {
    if (key === `a:${tokenId}` || key.startsWith(`p:${tokenId}:`)) cooling.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Dates — Insights `end_time` is midnight Pacific time at the END of the day
// the value covers, so the value's day = end_time minus one day.
// ---------------------------------------------------------------------------

const pacificDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dayOf(endTime: string): string {
  // −12h instead of −24h stays on the right day across DST switches.
  return pacificDate.format(new Date(new Date(endTime).getTime() - 12 * 3600_000));
}

function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------------

interface InsightResponse {
  data?: Array<{
    name: string;
    period: string;
    values?: Array<{ value: unknown; end_time: string }>;
  }>;
}

type Series = Map<string, number>; // day → value

async function fetchAllPeriods(
  pageId: string,
  metric: string,
  pageToken: string,
  now: Date,
): Promise<Record<string, Series>> {
  const nowSec = Math.floor(now.getTime() / 1000);
  const data = await graphFetch<InsightResponse>(
    `/${pageId}/insights?metric=${metric}&since=${nowSec - WINDOW_DAYS * DAY}&until=${nowSec + DAY}`,
    pageToken,
  );
  const out: Record<string, Series> = {};
  for (const s of data.data ?? []) {
    const series: Series = out[s.period] ?? new Map();
    for (const v of s.values ?? []) {
      if (typeof v.value === "number" && Number.isFinite(v.value)) series.set(dayOf(v.end_time), v.value);
    }
    out[s.period] = series;
  }
  return out;
}

function isInvalidMetric(e: unknown): boolean {
  const info = parseGraphError(e);
  if (info.subcode === 33) return false; // "object does not exist / missing permissions"
  return info.code === 100 || /invalid metric|not a valid insights metric/i.test(info.message);
}

function isPermissionError(e: unknown): boolean {
  const info = parseGraphError(e);
  return info.kind === "permission" || (info.code === 100 && info.subcode === 33);
}

function isTokenError(e: unknown): boolean {
  const kind = parseGraphError(e).kind;
  return kind === "invalid" || kind === "expired";
}

function permissionError(message: string): Error {
  const err = new Error(message);
  (err as Error & { graph?: unknown }).graph = { code: 10, message };
  return err;
}

async function pageTokenFor(c: ReachCandidate, pageId: string): Promise<string> {
  if (c.kind === "page") {
    if (c.fbId === pageId) return c.token;
    throw permissionError("Page token này thuộc Trang khác");
  }
  const key = `${c.tokenId}:${pageId}`;
  const cached = pageTokens.get(key);
  if (cached) return cached;
  const page = await graphFetch<{ access_token?: string }>(`/${pageId}?fields=access_token`, c.token);
  if (!page.access_token) throw permissionError("Token không có quyền quản trị Trang này");
  pageTokens.set(key, page.access_token);
  return page.access_token;
}

// ---------------------------------------------------------------------------
// Turn the three series into the three ranges
// ---------------------------------------------------------------------------

function periodRange(period: Series | undefined, daily: Series | undefined, n: number, today: string): RangeReach {
  const days = [...(period?.keys() ?? [])].filter((d) => d <= today).sort();
  const last = days[days.length - 1];
  if (!period || !last) return { reach: null, prev: null, daily: [] };
  return {
    reach: period.get(last) ?? null,
    // Same-length window ending exactly n days earlier.
    prev: period.get(shiftDay(last, -n)) ?? null,
    daily: Array.from({ length: n }, (_, i) => {
      const date = shiftDay(last, i - n + 1);
      return { date, value: daily?.get(date) ?? null };
    }),
  };
}

export function buildRanges(series: Record<string, Series>, now: Date): Record<ReachRange, RangeReach> {
  const today = pacificDate.format(now);
  const day = series.day;
  // Facebook reports the running day as 0 (or not at all) until it has
  // processed it, so today's 0 is "not published yet", not a real zero.
  const todayValue = day?.get(today);
  const todayReach = todayValue ? todayValue : null;
  return {
    today: {
      reach: todayReach,
      prev: day?.get(shiftDay(today, -1)) ?? null,
      daily: [{ date: today, value: todayReach }],
      ...(todayReach === null ? { todayPending: true } : {}),
    },
    "7d": periodRange(series.week, day, 7, today),
    "28d": periodRange(series.days_28, day, 28, today),
  };
}

function emptyRanges(): Record<ReachRange, RangeReach> {
  return {
    today: { reach: null, prev: null, daily: [] },
    "7d": { reach: null, prev: null, daily: [] },
    "28d": { reach: null, prev: null, daily: [] },
  };
}

async function reachWithMetricFallback(
  pageId: string,
  pageToken: string,
  now: Date,
): Promise<Omit<ReachResult, "via">> {
  const remembered = reachMetric.get(pageId);
  const order = remembered
    ? [remembered, ...REACH_METRICS.filter((m) => m !== remembered)]
    : [...REACH_METRICS];
  for (const metric of order) {
    try {
      const series = await fetchAllPeriods(pageId, metric, pageToken, now);
      reachMetric.set(pageId, metric);
      return { metric, ranges: buildRanges(series, now) };
    } catch (e) {
      if (!isInvalidMetric(e)) throw e;
      if (metric === remembered) reachMetric.delete(pageId);
    }
  }
  return {
    metric: null,
    ranges: emptyRanges(),
    unsupported: true,
    reason:
      `Facebook không trả metric Reach nào cho Trang này (đã thử ${REACH_METRICS.join(", ")}). ` +
      "Token cần quyền read_insights và app phải được Meta duyệt Advanced Access.",
  };
}

// ---------------------------------------------------------------------------
// Public entry: token pool around the metric fallback
// ---------------------------------------------------------------------------

/**
 * Run `fn` with a page token from the candidate pool: rotates the starting
 * token per page, cools rate-limited tokens and moves on, drops tokens that
 * became invalid, and tries the next token on permission errors. Returns the
 * value + label of the token that served it, or `{ permissionError }` when
 * every usable token lacked permission. Throws CoolingError when every token
 * is cooling; rethrows other errors.
 */
export async function withPageToken<T>(
  pageId: string,
  candidates: ReachCandidate[],
  fn: (pageToken: string) => Promise<T>,
): Promise<{ value: T; via: string } | { permissionError: string }> {
  const nowMs = Date.now();
  const cooledUntil = (c: ReachCandidate) =>
    Math.max(cooling.get(`a:${c.tokenId}`) ?? 0, cooling.get(`p:${c.tokenId}:${pageId}`) ?? 0);
  const ready = candidates.filter((c) => cooledUntil(c) <= nowMs);
  if (ready.length === 0) {
    const soonest = Math.min(...candidates.map(cooledUntil));
    throw new CoolingError(Math.max(1, Math.round((soonest - nowMs) / 1000)));
  }
  const turn = rotation.get(pageId) ?? 0;
  rotation.set(pageId, turn + 1);
  const start = turn % ready.length;
  const order = [...ready.slice(start), ...ready.slice(0, start)];

  let lastErr: unknown = null;
  let permissionErr: unknown = null;
  let cooledAll = true;
  for (const c of order) {
    try {
      const token = await pageTokenFor(c, pageId);
      try {
        return { value: await fn(token), via: c.label };
      } catch (e) {
        // #1 / #2 = Graph's transient "unexpected error, please retry" —
        // seen live (2026-10); one retry usually succeeds.
        const code = parseGraphError(e).code;
        if (code !== 1 && code !== 2) throw e;
        return { value: await fn(token), via: c.label };
      }
    } catch (e) {
      lastErr = e;
      if (isAbuseError(e)) {
        const code = parseGraphError(e).code;
        const pageLevel = code === 32 || code === 368;
        cooling.set(pageLevel ? `p:${c.tokenId}:${pageId}` : `a:${c.tokenId}`, Date.now() + COOL_MS);
        continue;
      }
      cooledAll = false;
      if (isTokenError(e)) {
        pageTokens.delete(`${c.tokenId}:${pageId}`);
        continue;
      }
      if (isPermissionError(e)) {
        permissionErr = e;
        continue; // another token may have the permission
      }
      throw e;
    }
  }
  if (cooledAll) throw new CoolingError(COOL_MS / 1000);
  if (permissionErr) return { permissionError: parseGraphError(permissionErr).message };
  throw lastErr;
}

export async function fetchPageReach(
  pageId: string,
  candidates: ReachCandidate[],
  now: Date = new Date(),
): Promise<ReachResult> {
  const r = await withPageToken(pageId, candidates, (token) => reachWithMetricFallback(pageId, token, now));
  if ("value" in r) return { ...r.value, via: r.via };
  return {
    metric: null,
    via: null,
    ranges: emptyRanges(),
    unsupported: true,
    reason:
      "Thiếu quyền đọc Insights của Trang (read_insights / pages_read_engagement), " +
      `hoặc app chưa được Meta duyệt Advanced Access. Chi tiết: ${r.permissionError}`,
  };
}
