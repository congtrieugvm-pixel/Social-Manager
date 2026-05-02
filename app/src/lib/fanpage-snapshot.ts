import { db } from "@/lib/db";
import { fanpageSnapshots } from "@/lib/db/schema";
import type { FbPageInsights } from "@/lib/facebook";

function sumSeries(insights: FbPageInsights, metric: string): number | null {
  const series = insights[metric];
  if (!series || series.length === 0) return null;
  const values = series[0].values ?? [];
  if (values.length === 0) return null;
  let total = 0;
  let seen = 0;
  for (const v of values) {
    if (typeof v.value === "number") {
      total += v.value;
      seen++;
    } else if (v.value && typeof v.value === "object") {
      total += Object.values(v.value).reduce((s, n) => s + (n ?? 0), 0);
      seen++;
    }
  }
  return seen > 0 ? total : null;
}

// Prefer the first metric that returns a value. Tolerates Graph renames.
function sumAny(
  insights: FbPageInsights,
  metrics: readonly string[],
): number | null {
  for (const m of metrics) {
    const v = sumSeries(insights, m);
    if (v !== null) return v;
  }
  return null;
}

// Latest non-null value of a daily series — used for "current state" snapshots
// of metrics that Graph reports per-day (e.g. `page_follows`).
function latestSeries(insights: FbPageInsights, metric: string): number | null {
  const series = insights[metric];
  if (!series || series.length === 0) return null;
  const values = series[0].values ?? [];
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i].value;
    if (typeof v === "number") return v;
    if (v && typeof v === "object") {
      return Object.values(v).reduce((s, n) => s + (n ?? 0), 0);
    }
  }
  return null;
}

export async function recordFanpageSnapshot(
  fanpageId: number,
  insights: FbPageInsights,
  meta: {
    fanCount?: number | null;
    followersCount?: number | null;
    rangeStart?: number | null;
    rangeEnd?: number | null;
  } = {},
): Promise<void> {
  await db.insert(fanpageSnapshots).values({
    fanpageId,
    takenAt: new Date(),
    // Graph deprecated `page_fans` (Nov 15, 2025). Use Page.fan_count field
    // fetched during /me/accounts sync; no insights fallback available.
    fanCount: meta.fanCount ?? null,
    // Fallback to `page_follows` latest daily value when Page node omitted it.
    followersCount: meta.followersCount ?? latestSeries(insights, "page_follows"),
    // `page_impressions` (total) was deprecated Nov 15, 2025. Its promised
    // replacement `views` is not yet live. Leave total-impressions null until
    // Meta ships it; reach below is what the UI actually charts.
    pageImpressions: sumAny(insights, ["page_media_view"]),
    pageImpressionsUnique: sumSeries(insights, "page_impressions_unique"),
    pageEngagements: sumSeries(insights, "page_post_engagements"),
    pageViews: sumSeries(insights, "page_views_total"),
    pageVideoViews: sumSeries(insights, "page_video_views"),
    rangeStart: meta.rangeStart ?? null,
    rangeEnd: meta.rangeEnd ?? null,
  });
}
