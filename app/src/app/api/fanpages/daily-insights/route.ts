import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fanpages } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

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

/**
 * GET /api/fanpages/daily-insights?ids=1,2,3&metric=pageImpressionsUnique
 *   &days=365                        — last N days (truncates series end-aligned to today)
 *   &from=<epochSec>&to=<epochSec>   — explicit window (overrides `days` if both set)
 *
 * Reads `insights_json` for the given fanpages, extracts daily values for the
 * requested metric, and aggregates (sums) by day across all fanpages so the
 * reach dashboard can plot a real daily time series.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids") ?? "";
  const metric = url.searchParams.get("metric") ?? "pageImpressionsUnique";
  const days = Number(url.searchParams.get("days")) || 0;
  const fromSec = Number(url.searchParams.get("from")) || 0;
  const toSec = Number(url.searchParams.get("to")) || 0;

  const ids = idsParam
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) {
    return NextResponse.json({ series: [], rangeStart: 0, rangeEnd: 0, metric });
  }

  const fbMetric = METRIC_KEY[metric];
  if (!fbMetric) {
    return NextResponse.json(
      { error: `Metric không hỗ trợ: ${metric}` },
      { status: 400 },
    );
  }

  const rows = await db
    .select({
      id: fanpages.id,
      insightsJson: fanpages.insightsJson,
    })
    .from(fanpages)
    .where(inArray(fanpages.id, ids));

  // Aggregate per-day across fanpages PLUS a per-fanpage day map. The
  // per-fp breakdown lets the reach dashboard's Top widget rank fanpages
  // using the SAME data path (and therefore SAME numbers) as the KPI cards
  // — fixes a long-standing mismatch between header total and Top sum.
  const dayTotals = new Map<string, number>();
  const perFpDayMap = new Map<number, Map<string, number>>();
  for (const r of rows) {
    if (!r.insightsJson) continue;
    let parsed: FbInsights;
    try {
      parsed = JSON.parse(r.insightsJson) as FbInsights;
    } catch {
      continue;
    }
    const series = parsed[fbMetric];
    if (!Array.isArray(series) || series.length === 0) continue;
    const values = series[0]?.values ?? [];
    const fpDayMap = new Map<string, number>();
    for (const v of values) {
      if (!v?.end_time) continue;
      const num = valueAsNumber(v.value);
      dayTotals.set(v.end_time, (dayTotals.get(v.end_time) ?? 0) + num);
      fpDayMap.set(v.end_time, num);
    }
    perFpDayMap.set(r.id, fpDayMap);
  }

  // Build sorted aggregate series of {ts (epoch sec), value}.
  let series = Array.from(dayTotals.entries())
    .map(([endTime, value]) => ({
      ts: Math.floor(new Date(endTime).getTime() / 1000),
      value,
    }))
    .filter((p) => Number.isFinite(p.ts) && p.ts > 0)
    .sort((a, b) => a.ts - b.ts);

  // Same shape per fanpage.
  const perFp: Record<number, Array<{ ts: number; value: number }>> = {};
  for (const [fpId, dayMap] of perFpDayMap) {
    perFp[fpId] = Array.from(dayMap.entries())
      .map(([endTime, value]) => ({
        ts: Math.floor(new Date(endTime).getTime() / 1000),
        value,
      }))
      .filter((p) => Number.isFinite(p.ts) && p.ts > 0)
      .sort((a, b) => a.ts - b.ts);
  }

  // Filter aggregate AND per-fp series by the same window.
  function applyFilter<T extends { ts: number }>(arr: T[]): T[] {
    if (fromSec > 0 && toSec > 0) {
      return arr.filter((p) => p.ts >= fromSec && p.ts <= toSec);
    } else if (days > 0 && arr.length > 0) {
      const cutoff = Math.floor(Date.now() / 1000) - days * 86_400;
      return arr.filter((p) => p.ts >= cutoff);
    }
    return arr;
  }
  series = applyFilter(series);
  for (const fpId of Object.keys(perFp)) {
    perFp[Number(fpId)] = applyFilter(perFp[Number(fpId)]);
  }

  const rangeStart = series.length > 0 ? series[0].ts : 0;
  const rangeEnd = series.length > 0 ? series[series.length - 1].ts : 0;

  return NextResponse.json({ series, perFp, rangeStart, rangeEnd, metric });
}
