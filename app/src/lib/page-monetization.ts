// Monetization check for the Insight screen — user/System User tokens only,
// through the same token pool as Reach (withPageToken).
//
// What Graph v23 actually exposes (probed live, 2026-10):
//   - content_monetization_earnings (daily, { currency, microAmount }) is
//     readable on EVERY page with VIEW_MONETIZATION_INSIGHTS — non-onboarded
//     pages just return 0. So earnings > 0 proves "đang kiếm tiền", but 0
//     can't tell "bật nhưng chưa có tiền" from "chưa bật".
//   - There is NO field/edge for Content Monetization onboarding status or
//     invitations (monetization_options, content_monetization_eligibility…
//     all fail #100), and Meta's docs list none. Invitations are only visible
//     in Professional Dashboard / Business Suite — the UI links there.
//   - Progress signals: followers_count, page_video_view_time (ms/day),
//     page_video_views, page_daily_follows_unique.
//
// One Page call + one insights call (all metrics, 90 days) per page.

import { graphFetch, parseGraphError } from "@/lib/facebook";
import { withPageToken, type ReachCandidate } from "@/lib/page-reach";

const DAY = 86_400;
const WINDOW_DAYS = 90; // Graph caps an insights range at ~93 days

const METRICS = [
  "content_monetization_earnings",
  "page_video_view_time",
  "page_video_views",
  "page_daily_follows_unique",
] as const;

export interface MonetizationResult {
  via: string | null;
  followers: number | null;
  /** Content Monetization earnings over the last 90 days. */
  earnings90: { micros: number; currency: string | null; days: number } | null;
  /** Video watch time over the last 60 days, in minutes. */
  watchMinutes60: number | null;
  videoViews60: number | null;
  newFollowers28: number | null;
  /** Metrics Graph refused for this page (shown as "—"). */
  missing: string[];
  unsupported?: boolean;
  reason?: string;
}

type Values = Array<{ value: unknown; end_time: string }>;

async function fetchSeries(pageId: string, pageToken: string, nowSec: number) {
  const qs = `period=day&since=${nowSec - WINDOW_DAYS * DAY}&until=${nowSec}`;
  const out: Record<string, Values> = {};
  const missing: string[] = [];
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
      try {
        const d = await graphFetch<{ data?: Array<{ name: string; values?: Values }> }>(
          `/${pageId}/insights?metric=${m}&${qs}`,
          pageToken,
        );
        out[m] = d.data?.[0]?.values ?? [];
      } catch (inner) {
        if (parseGraphError(inner).code !== 100) throw inner;
        missing.push(m);
      }
    }
  }
  for (const m of METRICS) if (!(m in out) && !missing.includes(m)) out[m] = [];
  return { series: out, missing };
}

function sumLast(values: Values | undefined, days: number, nowSec: number): number | null {
  if (!values) return null;
  const from = (nowSec - days * DAY) * 1000;
  return values.reduce(
    (a, v) => a + (new Date(v.end_time).getTime() > from && typeof v.value === "number" ? v.value : 0),
    0,
  );
}

export async function fetchPageMonetization(
  pageId: string,
  candidates: ReachCandidate[],
  now: Date = new Date(),
): Promise<MonetizationResult> {
  const nowSec = Math.floor(now.getTime() / 1000);
  const r = await withPageToken(pageId, candidates, async (token) => {
    const [page, { series, missing }] = await Promise.all([
      graphFetch<{ followers_count?: number; fan_count?: number }>(`/${pageId}?fields=followers_count,fan_count`, token),
      fetchSeries(pageId, token, nowSec),
    ]);
    return { page, series, missing };
  });

  if ("permissionError" in r) {
    return {
      via: null,
      followers: null,
      earnings90: null,
      watchMinutes60: null,
      videoViews60: null,
      newFollowers28: null,
      missing: [...METRICS],
      unsupported: true,
      reason:
        "Token thiếu quyền xem số liệu kiếm tiền của Trang (cần task VIEW_MONETIZATION_INSIGHTS / read_insights). " +
        `Chi tiết: ${r.permissionError}`,
    };
  }

  const { page, series, missing } = r.value;
  let earnings90: MonetizationResult["earnings90"] = null;
  if (!missing.includes("content_monetization_earnings")) {
    let micros = 0;
    let days = 0;
    let currency: string | null = null;
    for (const v of series.content_monetization_earnings ?? []) {
      const val = v.value as { microAmount?: number; currency?: string } | number | null;
      const m = typeof val === "number" ? Math.round(val * 1_000_000) : val?.microAmount ?? 0;
      if (val && typeof val === "object" && val.currency) currency = val.currency;
      if (m > 0) days++;
      micros += m;
    }
    earnings90 = { micros, currency, days };
  }
  const viewMs = missing.includes("page_video_view_time") ? null : sumLast(series.page_video_view_time, 60, nowSec);

  return {
    via: r.via,
    followers: page.followers_count ?? page.fan_count ?? null,
    earnings90,
    watchMinutes60: viewMs === null ? null : Math.round(viewMs / 60_000),
    videoViews60: missing.includes("page_video_views") ? null : sumLast(series.page_video_views, 60, nowSec),
    newFollowers28: missing.includes("page_daily_follows_unique")
      ? null
      : sumLast(series.page_daily_follows_unique, 28, nowSec),
    missing,
  };
}
