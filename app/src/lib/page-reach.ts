// Page Reach for the Insight screen.
//
// Pages are not stored in the DB (fanpage management was removed). They are
// listed live from Graph with each Facebook account's user token; a page
// managed by several accounts has several candidate tokens. Every Graph call
// for a page goes through `fetchPageReach()`, which:
//   - rotates the starting candidate per page (load-balances tokens),
//   - "cools" an account for COOL_MS after a rate-limit error and moves on to
//     the next candidate,
//   - tries reach metrics in order, skipping ones Graph rejects as invalid,
//     and remembers the working metric per page.
//
// State lives in module memory (per Worker isolate / Node process): it is a
// best-effort cache, losing it only costs a few extra Graph calls.
//
// Reach is a count of UNIQUE people, so 7d / 28d values are NEVER summed from
// daily values (that double-counts people seen on several days). We read the
// period value Graph computes itself: period=week for 7 days, period=days_28
// for 28 days, period=day for today. Daily bars use period=day values.

import { graphFetch, isAbuseError, parseGraphError } from "@/lib/facebook";

export type ReachRange = "today" | "7d" | "28d";

export const REACH_RANGES: ReachRange[] = ["today", "7d", "28d"];

// Tried in order. Meta deprecated many Page Insights metrics in 2025, so no
// single metric is assumed: page_impressions_unique was verified live on
// Graph v23 (Apr 2026); the other two are its documented replacements.
export const REACH_METRICS = [
  "page_impressions_unique", // Page reach
  "page_total_media_view_unique", // "Viewers" — newer replacement
  "page_posts_impressions_unique", // reach of the page's posts
] as const;

const RANGE_DAYS: Record<ReachRange, number> = { today: 1, "7d": 7, "28d": 28 };
const RANGE_PERIOD: Record<ReachRange, string> = {
  today: "day",
  "7d": "week",
  "28d": "days_28",
};

const COOL_MS = 5 * 60 * 1000;
const DAY = 86_400;

export interface ReachCandidate {
  accountId: number;
  label: string;
  userToken: string;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD (Pacific day the value belongs to)
  value: number | null;
}

export interface ReachResult {
  range: ReachRange;
  metric: string | null;
  reach: number | null;
  prev: number | null;
  daily: DailyPoint[];
  via: string | null;
  /** Today's number isn't published by Facebook yet. */
  todayPending?: boolean;
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

const pageTokens = new Map<string, string>(); // `${accountId}:${pageId}` → page token
// Cooled until (ms). Key "a:<accountId>" for app/user-level limits (#4, #17,
// #613 — every page of that account is affected) or "p:<accountId>:<pageId>"
// for page-level limits (#32, #368 — only that page's token).
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
export function rememberPageToken(accountId: number, pageId: string, token: string) {
  pageTokens.set(`${accountId}:${pageId}`, token);
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

interface InsightValues {
  data?: Array<{
    name: string;
    period: string;
    values?: Array<{ value: unknown; end_time: string }>;
  }>;
}

async function fetchValues(
  pageId: string,
  metric: string,
  period: string,
  sinceSec: number,
  untilSec: number,
  pageToken: string,
): Promise<Map<string, number>> {
  const data = await graphFetch<InsightValues>(
    `/${pageId}/insights?metric=${metric}&period=${period}&since=${sinceSec}&until=${untilSec}`,
    pageToken,
  );
  const out = new Map<string, number>();
  for (const series of data.data ?? []) {
    for (const v of series.values ?? []) {
      if (typeof v.value === "number" && Number.isFinite(v.value)) {
        out.set(dayOf(v.end_time), v.value);
      }
    }
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

async function pageTokenFor(c: ReachCandidate, pageId: string): Promise<string> {
  const key = `${c.accountId}:${pageId}`;
  const cached = pageTokens.get(key);
  if (cached) return cached;
  const page = await graphFetch<{ access_token?: string }>(
    `/${pageId}?fields=access_token`,
    c.userToken,
  );
  if (!page.access_token) {
    const err = new Error("Tài khoản không có quyền quản trị Trang này");
    (err as Error & { graph?: unknown }).graph = { code: 10, message: err.message };
    throw err;
  }
  pageTokens.set(key, page.access_token);
  return page.access_token;
}

// ---------------------------------------------------------------------------
// Reach for one page with one token
// ---------------------------------------------------------------------------

async function computeReach(
  pageId: string,
  metric: string,
  range: ReachRange,
  pageToken: string,
  now: Date,
): Promise<Omit<ReachResult, "via" | "metric">> {
  const n = RANGE_DAYS[range];
  const nowSec = Math.floor(now.getTime() / 1000);
  const until = nowSec + DAY; // include today's (partial) end_time
  const today = pacificDate.format(now);

  const daily = await fetchValues(pageId, metric, "day", nowSec - (n + 2) * DAY, until, pageToken);

  if (range === "today") {
    const reach = daily.get(today) ?? null;
    return {
      range,
      reach,
      prev: daily.get(shiftDay(today, -1)) ?? null,
      daily: [{ date: today, value: reach }],
      ...(reach === null ? { todayPending: true } : {}),
    };
  }

  const period = await fetchValues(
    pageId,
    metric,
    RANGE_PERIOD[range],
    nowSec - (n + 3) * DAY,
    until,
    pageToken,
  );
  const days = [...period.keys()].sort();
  const last = days[days.length - 1];
  if (!last) return { range, reach: null, prev: null, daily: [] };
  return {
    range,
    reach: period.get(last) ?? null,
    // Same-length window ending exactly n days earlier.
    prev: period.get(shiftDay(last, -n)) ?? null,
    daily: Array.from({ length: n }, (_, i) => {
      const date = shiftDay(last, i - n + 1);
      return { date, value: daily.get(date) ?? null };
    }),
  };
}

async function reachWithMetricFallback(
  pageId: string,
  range: ReachRange,
  pageToken: string,
  now: Date,
): Promise<Omit<ReachResult, "via">> {
  const remembered = reachMetric.get(pageId);
  const order = remembered
    ? [remembered, ...REACH_METRICS.filter((m) => m !== remembered)]
    : [...REACH_METRICS];
  for (const metric of order) {
    try {
      const r = await computeReach(pageId, metric, range, pageToken, now);
      reachMetric.set(pageId, metric);
      return { ...r, metric };
    } catch (e) {
      if (!isInvalidMetric(e)) throw e;
      if (metric === remembered) reachMetric.delete(pageId);
    }
  }
  return {
    range,
    metric: null,
    reach: null,
    prev: null,
    daily: [],
    unsupported: true,
    reason:
      `Facebook không trả metric Reach nào cho Trang này (đã thử ${REACH_METRICS.join(", ")}). ` +
      "Token cần quyền read_insights và app phải được Meta duyệt Advanced Access.",
  };
}

// ---------------------------------------------------------------------------
// Public entry: token pool around the metric fallback
// ---------------------------------------------------------------------------

export async function fetchPageReach(
  pageId: string,
  range: ReachRange,
  candidates: ReachCandidate[],
  now: Date = new Date(),
): Promise<ReachResult> {
  const nowMs = Date.now();
  const cooledUntil = (c: ReachCandidate) =>
    Math.max(cooling.get(`a:${c.accountId}`) ?? 0, cooling.get(`p:${c.accountId}:${pageId}`) ?? 0);
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
      const r = await reachWithMetricFallback(pageId, range, token, now);
      return { ...r, via: c.label };
    } catch (e) {
      lastErr = e;
      if (isAbuseError(e)) {
        const code = parseGraphError(e).code;
        const pageLevel = code === 32 || code === 368;
        cooling.set(pageLevel ? `p:${c.accountId}:${pageId}` : `a:${c.accountId}`, Date.now() + COOL_MS);
        continue;
      }
      cooledAll = false;
      if (isTokenError(e)) {
        pageTokens.delete(`${c.accountId}:${pageId}`);
        continue;
      }
      if (isPermissionError(e)) {
        permissionErr = e;
        continue; // another account may have the permission
      }
      throw e;
    }
  }
  if (cooledAll) throw new CoolingError(COOL_MS / 1000);
  if (permissionErr) {
    return {
      range,
      metric: null,
      reach: null,
      prev: null,
      daily: [],
      via: null,
      unsupported: true,
      reason:
        "Thiếu quyền đọc Insights của Trang (read_insights / pages_read_engagement), " +
        `hoặc app chưa được Meta duyệt Advanced Access. Chi tiết: ${parseGraphError(permissionErr).message}`,
    };
  }
  throw lastErr;
}
