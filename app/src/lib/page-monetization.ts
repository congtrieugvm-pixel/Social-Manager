// Monetization check for the Insight screen — user/System User tokens only,
// through the same token pool as Reach (withPageToken).
//
// Mirrors Meta's "Kiếm tiền từ nội dung — Tiêu chí của danh sách chờ"
// checklist (Professional Dashboard, 2026-10), criterion by criterion, with
// what Graph v23 exposes (probed live):
//   ✓ readable  — ≥ 3 reels in 90 days       (/video_reels, by created_time)
//               — ≥ 10,000 followers          (followers_count)
//               — Page exists ≥ 30 days       (a published post older than 30
//                                               days; Page has no created_time)
//               — ≥ 150,000 unique views / 28 days
//                                             (page_total_media_view_unique,
//                                              period=days_28)
//   ~ estimate  — eligible country            (Meta checks where the PERSON
//                                               lives; we only see the Page's
//                                               address)
//   ✗ unreadable — age ≥ 18, and the invitation itself (no field or edge for
//                  Content Monetization status/invites; monetization_options
//                  etc. fail #100).
// Plus content_monetization_earnings (90 days): > 0 proves "đang kiếm tiền";
// Graph returns 0 for non-onboarded pages too, so 0 proves nothing.

import { graphFetch, parseGraphError } from "@/lib/facebook";
import { withPageToken, type ReachCandidate } from "@/lib/page-reach";

const DAY = 86_400;
const WINDOW_DAYS = 90; // Graph caps an insights range at ~93 days
const REEL_PAGES_MAX = 3; // ≤ 300 reels scanned — plenty to count "≥ 3 in 90 days"

const METRICS = [
  "content_monetization_earnings",
  // All revenue sources except bonuses; a bare number (Meta: different
  // scale from content_monetization_earnings) — shown for reference.
  "monetization_approximate_earnings",
  "page_video_view_time",
  "page_video_views",
  "page_daily_follows_unique",
] as const;

// Meta's waitlist thresholds as shown in Professional Dashboard.
export const CRITERIA_TARGETS = { reels90: 3, followers: 10_000, pageAgeDays: 30, views28: 150_000 } as const;

export type CriterionKey = "reels" | "country" | "followers" | "pageAge" | "views" | "age18";

export interface Criterion {
  key: CriterionKey;
  label: string;
  /** true / false = measured; null = can't be read through the API. */
  met: boolean | null;
  value: string | null;
  note?: string;
}

export interface MonetizationResult {
  via: string | null;
  followers: number | null;
  reels90: number | null;
  views28: number | null;
  pageOlderThan30: boolean | null;
  country: string | null;
  criteria: Criterion[];
  /** Measurable criteria met, out of `measurable`. */
  met: number;
  measurable: number;
  /** Content Monetization earnings over the last 90 days. */
  earnings90: { micros: number; currency: string | null; days: number } | null;
  /** content_monetization_earnings per Pacific day (90 days, incl. today). */
  earningsDaily: Array<{ date: string; micros: number }> | null;
  earningsCurrency: string | null;
  /** monetization_approximate_earnings per Pacific day (bare number). */
  approxDaily: Array<{ date: string; value: number }> | null;
  watchMinutes60: number | null;
  newFollowers28: number | null;
  /** Data points Graph refused for this page (shown as "—"). */
  missing: string[];
  unsupported?: boolean;
  reason?: string;
}

type Values = Array<{ value: unknown; end_time: string }>;

/** Run a Graph read; on #100 (field/metric not available) record it as missing. */
async function optional<T>(name: string, missing: string[], fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (parseGraphError(e).code !== 100) throw e;
    missing.push(name);
    return null;
  }
}

async function fetchSeries(pageId: string, pageToken: string, nowSec: number, missing: string[]) {
  const qs = `period=day&since=${nowSec - WINDOW_DAYS * DAY}&until=${nowSec + DAY}`;
  const out: Record<string, Values> = {};
  try {
    const d = await graphFetch<{ data?: Array<{ name: string; values?: Values }> }>(
      `/${pageId}/insights?metric=${METRICS.join(",")}&${qs}`,
      pageToken,
    );
    for (const s of d.data ?? []) out[s.name] = s.values ?? [];
  } catch (e) {
    // One invalid metric fails the whole batch (#100) — retry one by one so
    // the rest still show.
    if (parseGraphError(e).code !== 100) throw e;
    for (const m of METRICS) {
      const d = await optional(m, missing, () =>
        graphFetch<{ data?: Array<{ name: string; values?: Values }> }>(`/${pageId}/insights?metric=${m}&${qs}`, pageToken),
      );
      if (d) out[m] = d.data?.[0]?.values ?? [];
    }
  }
  for (const m of METRICS) if (!(m in out) && !missing.includes(m)) out[m] = [];
  return out;
}

async function countReels90(pageId: string, pageToken: string, nowSec: number): Promise<number> {
  const from = (nowSec - 90 * DAY) * 1000;
  let count = 0;
  let path: string | null = `/${pageId}/video_reels?fields=created_time&limit=100`;
  for (let i = 0; path && i < REEL_PAGES_MAX; i++) {
    const d: { data?: Array<{ created_time?: string }>; paging?: { next?: string } } = await graphFetch(path, pageToken);
    let reachedOld = false;
    for (const r of d.data ?? []) {
      const t = r.created_time ? new Date(r.created_time).getTime() : 0;
      if (t >= from) count++;
      else reachedOld = true;
    }
    if (reachedOld || count >= 100 || !d.paging?.next) break;
    const u = new URL(d.paging.next);
    u.searchParams.delete("access_token");
    path = `${u.pathname.replace(/^\/v\d+\.\d+/, "")}${u.search}`;
  }
  return count;
}

// Insights end_time = midnight Pacific at the END of the day the value covers.
const pacificDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function dayOf(endTime: string): string {
  return pacificDate.format(new Date(new Date(endTime).getTime() - 12 * 3600_000));
}

function sumLast(values: Values | undefined, days: number, nowSec: number): number | null {
  if (!values) return null;
  const from = (nowSec - days * DAY) * 1000;
  return values.reduce(
    (a, v) => a + (new Date(v.end_time).getTime() > from && typeof v.value === "number" ? v.value : 0),
    0,
  );
}

const n = (v: number) => v.toLocaleString("vi-VN");

function buildCriteria(d: {
  reels90: number | null;
  followers: number | null;
  pageOlderThan30: boolean | null;
  views28: number | null;
  country: string | null;
}): Criterion[] {
  const T = CRITERIA_TARGETS;
  return [
    {
      key: "reels",
      label: `Đăng tối thiểu ${T.reels90} thước phim trong 90 ngày qua`,
      met: d.reels90 === null ? null : d.reels90 >= T.reels90,
      value: d.reels90 === null ? null : `${n(d.reels90)} thước phim`,
    },
    {
      key: "country",
      label: "Cư trú tại quốc gia đủ điều kiện",
      met: null,
      value: d.country,
      note: d.country
        ? `Địa chỉ Trang: ${d.country}. Meta xét nơi cư trú của bạn — tự kiểm tra trong Business Suite.`
        : "Meta xét nơi cư trú của bạn — không đọc được qua API.",
    },
    {
      key: "followers",
      label: `Có tối thiểu ${n(T.followers)} người theo dõi`,
      met: d.followers === null ? null : d.followers >= T.followers,
      value: d.followers === null ? null : `${n(d.followers)} / ${n(T.followers)}`,
    },
    {
      key: "pageAge",
      label: `Có Trang hoặc trang cá nhân đã tồn tại được ít nhất ${T.pageAgeDays} ngày`,
      met: d.pageOlderThan30,
      value: d.pageOlderThan30 === null ? null : d.pageOlderThan30 ? "Có bài đăng cũ hơn 30 ngày" : "Chưa có bài đăng cũ hơn 30 ngày",
      note: "Suy ra từ bài đăng cũ nhất (API không có ngày tạo Trang).",
    },
    {
      key: "views",
      label: `Nhận được tối thiểu ${n(T.views28)} riêng biệt lượt xem trong 28 ngày qua`,
      met: d.views28 === null ? null : d.views28 >= T.views28,
      value: d.views28 === null ? null : `${n(d.views28)} / ${n(T.views28)}`,
    },
    {
      key: "age18",
      label: "Phải tối thiểu 18 tuổi",
      met: null,
      value: null,
      note: "Tuổi của bạn — không đọc được qua API, tự kiểm tra.",
    },
  ];
}

export async function fetchPageMonetization(
  pageId: string,
  candidates: ReachCandidate[],
  now: Date = new Date(),
): Promise<MonetizationResult> {
  const nowSec = Math.floor(now.getTime() / 1000);
  const r = await withPageToken(pageId, candidates, async (token) => {
    const missing: string[] = [];
    const [page, series, views, reels90, oldPost] = await Promise.all([
      graphFetch<{ followers_count?: number; fan_count?: number; location?: { country?: string } }>(
        `/${pageId}?fields=followers_count,fan_count,location`,
        token,
      ),
      fetchSeries(pageId, token, nowSec, missing),
      optional("page_total_media_view_unique", missing, () =>
        graphFetch<{ data?: Array<{ values?: Values }> }>(
          `/${pageId}/insights?metric=page_total_media_view_unique&period=days_28&since=${nowSec - 3 * DAY}&until=${nowSec}`,
          token,
        ),
      ),
      optional("video_reels", missing, () => countReels90(pageId, token, nowSec)),
      optional("published_posts", missing, () =>
        graphFetch<{ data?: unknown[] }>(
          `/${pageId}/published_posts?fields=created_time&until=${nowSec - CRITERIA_TARGETS.pageAgeDays * DAY}&limit=1`,
          token,
        ),
      ),
    ]);
    return { page, series, views, reels90, oldPost, missing };
  });

  if ("permissionError" in r) {
    const criteria = buildCriteria({ reels90: null, followers: null, pageOlderThan30: null, views28: null, country: null });
    return {
      via: null,
      followers: null,
      reels90: null,
      views28: null,
      pageOlderThan30: null,
      country: null,
      criteria,
      met: 0,
      measurable: 4,
      earnings90: null,
      earningsDaily: null,
      earningsCurrency: null,
      approxDaily: null,
      watchMinutes60: null,
      newFollowers28: null,
      missing: [...METRICS],
      unsupported: true,
      reason:
        "Token thiếu quyền xem số liệu kiếm tiền của Trang (cần task VIEW_MONETIZATION_INSIGHTS / read_insights). " +
        `Chi tiết: ${r.permissionError}`,
    };
  }

  const { page, series, views, reels90, oldPost, missing } = r.value;
  let earnings90: MonetizationResult["earnings90"] = null;
  let earningsDaily: MonetizationResult["earningsDaily"] = null;
  let currency: string | null = null;
  if (!missing.includes("content_monetization_earnings")) {
    let micros = 0;
    let days = 0;
    const byDay = new Map<string, number>();
    for (const v of series.content_monetization_earnings ?? []) {
      const val = v.value as { microAmount?: number; currency?: string } | number | null;
      const m = typeof val === "number" ? Math.round(val * 1_000_000) : val?.microAmount ?? 0;
      if (val && typeof val === "object" && val.currency) currency = val.currency;
      if (m > 0) days++;
      micros += m;
      byDay.set(dayOf(v.end_time), m);
    }
    earnings90 = { micros, currency, days };
    earningsDaily = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, micros]) => ({ date, micros }));
  }
  let approxDaily: MonetizationResult["approxDaily"] = null;
  if (!missing.includes("monetization_approximate_earnings")) {
    const byDay = new Map<string, number>();
    for (const v of series.monetization_approximate_earnings ?? []) {
      if (typeof v.value === "number") byDay.set(dayOf(v.end_time), v.value);
    }
    approxDaily = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
  }
  const viewMs = missing.includes("page_video_view_time") ? null : sumLast(series.page_video_view_time, 60, nowSec);
  const views28Raw = views?.data?.[0]?.values?.filter((v) => typeof v.value === "number").at(-1)?.value;

  const data = {
    followers: page.followers_count ?? page.fan_count ?? null,
    reels90,
    views28: typeof views28Raw === "number" ? views28Raw : null,
    pageOlderThan30: oldPost ? (oldPost.data?.length ?? 0) > 0 : null,
    country: page.location?.country ?? null,
  };
  const criteria = buildCriteria(data);
  const measured = criteria.filter((c) => ["reels", "followers", "pageAge", "views"].includes(c.key));

  return {
    via: r.via,
    ...data,
    criteria,
    met: measured.filter((c) => c.met === true).length,
    measurable: measured.length,
    earnings90,
    earningsDaily,
    earningsCurrency: currency,
    approxDaily,
    watchMinutes60: viewMs === null ? null : Math.round(viewMs / 60_000),
    newFollowers28: missing.includes("page_daily_follows_unique") ? null : sumLast(series.page_daily_follows_unique, 28, nowSec),
    missing,
  };
}
