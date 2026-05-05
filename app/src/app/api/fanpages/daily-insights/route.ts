import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fanpages } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getOwnerId } from "@/lib/scope";

export const runtime = "nodejs";

// Maps client-side metric keys to the FB Graph metric name stored in
// `fanpages.insights_json`. Mirrors the METRIC_DEFS in the reach page.
const METRIC_KEY: Record<string, string> = {
  pageImpressionsUnique: "page_impressions_unique",
  pageImpressions: "page_impressions",
  pageEngagements: "page_post_engagements",
  pageViews: "page_views_total",
  pageVideoViews: "page_video_views",
};

interface FbInsightSeries {
  period: string;
  values: Array<{ value: number | Record<string, number>; end_time: string }>;
}

type FbInsights = Record<string, FbInsightSeries[]>;

function valueAsNumber(v: number | Record<string, number>): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    let s = 0;
    for (const k of Object.keys(v)) s += v[k] ?? 0;
    return s;
  }
  return 0;
}

interface MetricBucket {
  series: Array<{ ts: number; value: number }>;
  perFp: Record<number, Array<{ ts: number; value: number }>>;
}

/**
 * GET /api/fanpages/daily-insights?ids=1,2,3
 *
 *   Single metric (legacy):
 *     &metric=pageImpressionsUnique
 *
 *   Multi metric (preferred — one D1 read + one JSON.parse pass per
 *   fanpage covers all five metrics, vs the old 5× cost):
 *     &metrics=pageImpressionsUnique,pageImpressions,pageEngagements,pageViews,pageVideoViews
 *
 *   Optional time-window filter:
 *     &days=365
 *     &from=<epochSec>&to=<epochSec>     (overrides `days` when both set)
 *
 * Reads `insights_json` for the given fanpages ONCE, extracts daily values
 * for every requested metric in a single pass, and aggregates (sums) by day
 * across all fanpages.
 *
 * Response shape:
 *   - With `metrics` (plural): `{ byMetric: Record<metricKey, MetricBucket>, ... }`
 *   - With `metric` (singular): legacy `{ series, perFp, ... }` flat shape
 *   so old client builds keep working until they refresh.
 */
export async function GET(req: Request) {
  const ownerId = await getOwnerId();
  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids") ?? "";
  const metricsParam = url.searchParams.get("metrics");
  const metricParam = url.searchParams.get("metric");
  const days = Number(url.searchParams.get("days")) || 0;
  const fromSec = Number(url.searchParams.get("from")) || 0;
  const toSec = Number(url.searchParams.get("to")) || 0;

  const ids = idsParam
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  // Resolve which metrics the caller asked for. Plural takes precedence;
  // singular is the legacy path. Default to reach if neither is set.
  const requestedMetrics: string[] = metricsParam
    ? metricsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : metricParam
      ? [metricParam]
      : ["pageImpressionsUnique"];

  const validPairs = requestedMetrics
    .map((key) => ({ key, fb: METRIC_KEY[key] }))
    .filter((p): p is { key: string; fb: string } => Boolean(p.fb));

  if (validPairs.length === 0) {
    return NextResponse.json(
      { error: `Metric không hỗ trợ: ${requestedMetrics.join(",")}` },
      { status: 400 },
    );
  }

  if (ids.length === 0) {
    return shapeEmpty(metricsParam, requestedMetrics);
  }

  const rows = await db
    .select({
      id: fanpages.id,
      insightsJson: fanpages.insightsJson,
    })
    .from(fanpages)
    .where(and(eq(fanpages.ownerUserId, ownerId), inArray(fanpages.id, ids)));

  // Single-pass extraction: parse each insights_json once, walk every
  // requested metric series in the same iteration. Old code re-read +
  // re-parsed the same rows once per metric → 5x the parse work for the
  // 5-metric reach dashboard. With ~100 fanpages × ~200KB insights_json,
  // that's ~10MB extra parse work per dashboard load that this collapses.
  type Buckets = {
    dayTotals: Map<string, number>;
    perFpDayMap: Map<number, Map<string, number>>;
  };
  const buckets = new Map<string, Buckets>();
  for (const { key } of validPairs) {
    buckets.set(key, { dayTotals: new Map(), perFpDayMap: new Map() });
  }

  for (const r of rows) {
    if (!r.insightsJson) continue;
    let parsed: FbInsights;
    try {
      parsed = JSON.parse(r.insightsJson) as FbInsights;
    } catch {
      continue;
    }
    for (const { key, fb } of validPairs) {
      const series = parsed[fb];
      if (!Array.isArray(series) || series.length === 0) continue;
      const values = series[0]?.values ?? [];
      const bucket = buckets.get(key)!;
      const fpDayMap = new Map<string, number>();
      for (const v of values) {
        if (!v?.end_time) continue;
        const num = valueAsNumber(v.value);
        bucket.dayTotals.set(
          v.end_time,
          (bucket.dayTotals.get(v.end_time) ?? 0) + num,
        );
        fpDayMap.set(v.end_time, num);
      }
      bucket.perFpDayMap.set(r.id, fpDayMap);
    }
  }

  // Helper: ISO end_time → epoch sec, sorted, finite-only.
  const toSeries = (
    m: Map<string, number>,
  ): Array<{ ts: number; value: number }> =>
    Array.from(m.entries())
      .map(([endTime, value]) => ({
        ts: Math.floor(new Date(endTime).getTime() / 1000),
        value,
      }))
      .filter((p) => Number.isFinite(p.ts) && p.ts > 0)
      .sort((a, b) => a.ts - b.ts);

  // Apply optional time-window filter to a series. The new client paths
  // skip these params (it filters client-side once the full window is in
  // hand, which makes range slider changes free). Legacy calls still
  // honour `days`/`from`/`to`.
  const cutoff = days > 0 ? Math.floor(Date.now() / 1000) - days * 86_400 : 0;
  const applyWindow = <T extends { ts: number }>(arr: T[]): T[] => {
    if (fromSec > 0 && toSec > 0) {
      return arr.filter((p) => p.ts >= fromSec && p.ts <= toSec);
    }
    if (cutoff > 0) {
      return arr.filter((p) => p.ts >= cutoff);
    }
    return arr;
  };

  const byMetric: Record<string, MetricBucket> = {};
  let earliest = 0;
  let latest = 0;
  for (const { key } of validPairs) {
    const bucket = buckets.get(key)!;
    const series = applyWindow(toSeries(bucket.dayTotals));
    const perFp: Record<number, Array<{ ts: number; value: number }>> = {};
    for (const [fpId, dayMap] of bucket.perFpDayMap) {
      perFp[fpId] = applyWindow(toSeries(dayMap));
    }
    byMetric[key] = { series, perFp };
    if (series.length > 0) {
      if (!earliest || series[0].ts < earliest) earliest = series[0].ts;
      if (!latest || series[series.length - 1].ts > latest)
        latest = series[series.length - 1].ts;
    }
  }

  // Plural response shape — preferred. Carries every requested metric.
  if (metricsParam) {
    return NextResponse.json({
      byMetric,
      metrics: requestedMetrics,
      rangeStart: earliest,
      rangeEnd: latest,
    });
  }

  // Singular legacy shape — keeps any not-yet-refreshed client builds
  // working through the deploy window. Drop after a couple of days.
  const onlyKey = validPairs[0].key;
  const only = byMetric[onlyKey];
  return NextResponse.json({
    series: only.series,
    perFp: only.perFp,
    metric: onlyKey,
    rangeStart: earliest,
    rangeEnd: latest,
  });
}

function shapeEmpty(
  metricsParam: string | null,
  requestedMetrics: string[],
): Response {
  if (metricsParam) {
    const byMetric: Record<string, MetricBucket> = {};
    for (const m of requestedMetrics) byMetric[m] = { series: [], perFp: {} };
    return NextResponse.json({
      byMetric,
      metrics: requestedMetrics,
      rangeStart: 0,
      rangeEnd: 0,
    });
  }
  return NextResponse.json({
    series: [],
    perFp: {},
    metric: requestedMetrics[0] ?? "pageImpressionsUnique",
    rangeStart: 0,
    rangeEnd: 0,
  });
}
