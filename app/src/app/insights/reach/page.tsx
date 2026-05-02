"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface FanpageRow {
  id: number;
  insightGroupId: number | null;
  pageId: string;
  name: string;
  pictureUrl: string | null;
  link: string | null;
  username: string | null;
  fanCount: number | null;
  followersCount: number | null;
  lastSyncedAt: number | null;
  // Monetization
  monetizationStatus: string | null;
  earningsValue: number | null;     // micro-units
  earningsCurrency: string | null;
  earningsUpdatedAt: number | null;
  earningsBreakdownJson: string | null;
}

interface EarningsSourceRow {
  source:
    | "total"
    | "in_stream_ads"
    | "subscriptions"
    | "live"
    | "reels_bonus"
    | "photos_bonus"
    | "stories_bonus"
    | "text_bonus"
    | "extra_bonus";
  micros: number;
  available: boolean;
  error: string | null;
}

const EARNINGS_SOURCE_LABELS: Record<EarningsSourceRow["source"], string> = {
  total: "Total Approximate Earnings",
  in_stream_ads: "Quảng cáo trong video",
  subscriptions: "Đăng ký fan",
  live: "Phát trực tiếp",
  reels_bonus: "Reels",
  photos_bonus: "Photos",
  stories_bonus: "Stories",
  text_bonus: "Text",
  extra_bonus: "Extra bonus",
};

function fmtUsd(micros: number | null | undefined): string {
  if (!micros) return "$0.00";
  const amount = micros / 1_000_000;
  if (amount > 0 && amount < 0.01) return "$<0.01";
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface GroupRow {
  id: number;
  name: string;
  color: string;
  count: number;
}

interface SnapshotRow {
  id: number;
  fanpageId: number;
  takenAt: number;
  pageImpressions: number | null;
  pageImpressionsUnique: number | null;
  pageEngagements: number | null;
  pageViews: number | null;
  pageVideoViews: number | null;
  rangeStart: number | null;
  rangeEnd: number | null;
}

type Metric =
  | "pageImpressionsUnique"
  | "pageImpressions"
  | "pageEngagements"
  | "pageViews"
  | "pageVideoViews";

type RangeMode = 7 | 30 | 90 | "custom";

const METRIC_DEFS: Record<Metric, { title: string; subtitle: string; color: string }> = {
  pageImpressionsUnique: { title: "Reach", subtitle: "Người tiếp cận (unique)", color: "#2f6bb0" },
  pageImpressions: { title: "Impressions", subtitle: "Lượt hiển thị", color: "#5e6ad2" },
  pageEngagements: { title: "Engagements", subtitle: "Tương tác", color: "#d94a1f" },
  pageViews: { title: "Page views", subtitle: "Lượt xem trang", color: "#2d8a4e" },
  pageVideoViews: { title: "Video views", subtitle: "Lượt xem video", color: "#b88c3a" },
};

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 10_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 10_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString("vi-VN");
}

function fmtFullNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("vi-VN");
}

function fmtDate(sec: number): string {
  const d = new Date(sec * 1000);
  return d.toLocaleDateString("vi-VN", { day: "numeric", month: "long" });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

export default function ReachDashboard() {
  const [fanpages, setFanpages] = useState<FanpageRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [activeGroupFilter, setActiveGroupFilter] = useState<
    "all" | "unassigned" | number
  >("all");
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [activeMetric, setActiveMetric] = useState<Metric>("pageImpressionsUnique");
  const [rangeMode, setRangeMode] = useState<RangeMode>(30);
  const [customFrom, setCustomFrom] = useState(daysAgoISO(30));
  const [customTo, setCustomTo] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [loadingSnap, setLoadingSnap] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncErr, setSyncErr] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [earningsExpanded, setEarningsExpanded] = useState(false);
  // Real daily series (from /api/fanpages/daily-insights). Keyed by metric.
  const [dailySeries, setDailySeries] = useState<Record<Metric, { t: number; v: number }[]>>({
    pageImpressionsUnique: [],
    pageImpressions: [],
    pageEngagements: [],
    pageViews: [],
    pageVideoViews: [],
  });
  const [loadingDaily, setLoadingDaily] = useState(false);

  const rangeBody = useMemo<{ days?: number; from?: number; to?: number }>(() => {
    if (rangeMode === "custom") {
      if (!customFrom || !customTo) return { days: 30 };
      const f = Math.floor(new Date(customFrom + "T00:00:00").getTime() / 1000);
      const t = Math.floor(new Date(customTo + "T23:59:59").getTime() / 1000);
      if (!Number.isFinite(f) || !Number.isFinite(t) || t < f) return { days: 30 };
      return { from: f, to: t };
    }
    return { days: rangeMode };
  }, [rangeMode, customFrom, customTo]);

  const rangeQs = useMemo(() => {
    if (rangeBody.from && rangeBody.to) return `from=${rangeBody.from}&to=${rangeBody.to}`;
    return `days=${rangeBody.days ?? 30}`;
  }, [rangeBody]);

  const rangeLabel = useMemo(() => {
    if (rangeMode === "custom") {
      if (!customFrom || !customTo) return "Tùy chọn";
      const f = new Date(customFrom).toLocaleDateString("vi-VN", { day: "numeric", month: "long" });
      const t = new Date(customTo).toLocaleDateString("vi-VN", { day: "numeric", month: "long" });
      return `${f} – ${t}`;
    }
    return `${rangeMode} ngày gần nhất`;
  }, [rangeMode, customFrom, customTo]);

  useEffect(() => {
    (async () => {
      const r1 = await fetch("/api/fanpages", { cache: "no-store" });
      const d1 = (await r1.json()) as { rows: FanpageRow[] };
      setFanpages(d1.rows ?? []);
      const r2 = await fetch("/api/insight-groups", { cache: "no-store" });
      const d2 = (await r2.json()) as { groups: GroupRow[] };
      setGroups(d2.groups ?? []);
    })();
  }, []);

  useEffect(() => {
    const ids = Array.from(selectedIds);
    let cancelled = false;
    (async () => {
      if (ids.length === 0) {
        if (!cancelled) setSnapshots([]);
        return;
      }
      setLoadingSnap(true);
      try {
        const res = await fetch(
          `/api/fanpages/snapshots?ids=${ids.join(",")}&${rangeQs}`,
          { cache: "no-store" },
        );
        const d = (await res.json()) as { rows: SnapshotRow[] };
        if (!cancelled) setSnapshots(d.rows ?? []);
      } finally {
        if (!cancelled) setLoadingSnap(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedIds, rangeQs, refreshKey]);

  // Fetch daily series from insightsJson per fanpage. This is what the chart
  // plots — actual day-by-day values from FB, not snapshot recording times.
  // Truncates to the selected display window (rangeMode/custom).
  useEffect(() => {
    const ids = Array.from(selectedIds);
    let cancelled = false;
    (async () => {
      if (ids.length === 0) {
        if (!cancelled) {
          setDailySeries({
            pageImpressionsUnique: [],
            pageImpressions: [],
            pageEngagements: [],
            pageViews: [],
            pageVideoViews: [],
          });
        }
        return;
      }
      setLoadingDaily(true);
      try {
        // Compute display-window days. Custom range translates to the
        // explicit span; preset modes pass directly. We re-fetch each metric
        // separately because the endpoint returns one metric per call (FB
        // metric keys differ between endpoints).
        let displayDays = 0;
        if (rangeMode === "custom" && customFrom && customTo) {
          const f = Math.floor(new Date(customFrom + "T00:00:00").getTime() / 1000);
          const t = Math.floor(new Date(customTo + "T23:59:59").getTime() / 1000);
          if (Number.isFinite(f) && Number.isFinite(t) && t > f) {
            displayDays = Math.max(1, Math.ceil((t - f) / 86_400));
          }
        } else if (typeof rangeMode === "number") {
          displayDays = rangeMode;
        }
        const metrics: Metric[] = [
          "pageImpressionsUnique",
          "pageImpressions",
          "pageEngagements",
          "pageViews",
          "pageVideoViews",
        ];
        const results = await Promise.all(
          metrics.map(async (m): Promise<[Metric, { t: number; v: number }[]]> => {
            const params = new URLSearchParams({
              ids: ids.join(","),
              metric: m,
              days: String(displayDays),
            });
            const res = await fetch(`/api/fanpages/daily-insights?${params}`, {
              cache: "no-store",
            });
            if (!res.ok) return [m, []];
            const d = (await res.json()) as {
              series?: Array<{ ts: number; value: number }>;
            };
            const series = (d.series ?? []).map((p) => ({ t: p.ts, v: p.value }));
            return [m, series];
          }),
        );
        if (!cancelled) {
          const next: Record<Metric, { t: number; v: number }[]> = {
            pageImpressionsUnique: [],
            pageImpressions: [],
            pageEngagements: [],
            pageViews: [],
            pageVideoViews: [],
          };
          for (const [m, s] of results) next[m] = s;
          setDailySeries(next);
        }
      } finally {
        if (!cancelled) setLoadingDaily(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedIds, rangeMode, customFrom, customTo, refreshKey]);

  /**
   * Lighter button: only fetches earnings (no reach insights). Useful when
   * the user only cares about doanh thu and doesn't want to wait for the
   * full reach sync (which can be slow with many pages).
   */
  async function syncEarningsOnly() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setSyncing(true);
    setSyncMsg("");
    setSyncErr("");
    try {
      const res = await fetch("/api/fanpages/sync-earnings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, days: 365 }),
      });
      const data = (await res.json()) as {
        total?: number;
        okCount?: number;
        errCount?: number;
        skipCount?: number;
        monetizedCount?: number;
        totalMicros?: number;
        error?: string;
        results?: Array<{
          ok: boolean;
          status?: string;
          error?: string;
          name?: string;
        }>;
      };
      if (!res.ok || data.error) {
        setSyncErr(data.error ?? `Lỗi ${res.status}`);
      } else {
        const moneSum =
          data.monetizedCount && data.monetizedCount > 0
            ? ` · 💰 ${fmtUsd(data.totalMicros ?? 0)} từ ${data.monetizedCount} page`
            : "";
        // Bucket per-page outcomes for a richer summary.
        let missingScopeCnt = 0;
        let notMonetCnt = 0;
        const errSamples: string[] = [];
        for (const r of data.results ?? []) {
          if (r.status === "missing_scope") missingScopeCnt++;
          else if (r.status === "not_monetized") notMonetCnt++;
          if (!r.ok && r.error && errSamples.length < 2 && !errSamples.includes(r.error)) {
            errSamples.push(r.error);
          }
        }
        const breakdown: string[] = [];
        if (missingScopeCnt > 0) breakdown.push(`${missingScopeCnt} thiếu quyền`);
        if (notMonetCnt > 0) breakdown.push(`${notMonetCnt} chưa BKT`);
        const breakdownStr = breakdown.length > 0 ? ` · ${breakdown.join(" · ")}` : "";
        setSyncMsg(
          `Doanh thu: ${data.okCount ?? 0}/${data.total ?? 0} OK · ${data.errCount ?? 0} lỗi · ${data.skipCount ?? 0} skip${moneSum}${breakdownStr}`,
        );
        if ((data.errCount ?? 0) > 0 && errSamples.length > 0) {
          setSyncErr(`Graph: ${errSamples.join(" | ")}`);
        }
        // Reload fanpage rows so fresh earnings show in the KPI card.
        const r1 = await fetch("/api/fanpages", { cache: "no-store" });
        const d1 = (await r1.json()) as { rows: FanpageRow[] };
        setFanpages(d1.rows ?? []);
        // Auto-open the breakdown panel so user sees what changed
        if ((data.monetizedCount ?? 0) > 0 || missingScopeCnt > 0) {
          setEarningsExpanded(true);
        }
      }
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function syncPageInsights() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setSyncing(true);
    setSyncMsg("");
    setSyncErr("");
    try {
      // Sync always pulls the last 365 days (library chunks >93d windows).
      // The display range selector (7/30/90/custom) only filters what the
      // chart shows — the underlying snapshot covers a full year.
      const SYNC_DAYS = 365;
      const [insightsRes, earningsRes] = await Promise.all([
        fetch("/api/fanpages/insights/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, days: SYNC_DAYS }),
        }),
        fetch("/api/fanpages/sync-earnings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, days: SYNC_DAYS }),
        }),
      ]);
      const data = (await insightsRes.json()) as {
        okCount?: number;
        errCount?: number;
        skipCount?: number;
        error?: string;
        results?: Array<{ ok: boolean; error?: string; name?: string }>;
      };
      const earningsData = (await earningsRes.json().catch(() => ({}))) as {
        monetizedCount?: number;
        totalMicros?: number;
        error?: string;
      };
      if (!insightsRes.ok || data.error) {
        setSyncErr(data.error ?? `Lỗi ${insightsRes.status}`);
      } else {
        const monetSummary =
          earningsData.monetizedCount && earningsData.monetizedCount > 0
            ? ` · 💰 ${fmtUsd(earningsData.totalMicros)} từ ${earningsData.monetizedCount} page`
            : "";
        setSyncMsg(
          `Cập nhật: ${data.okCount ?? 0} OK · ${data.errCount ?? 0} lỗi · ${data.skipCount ?? 0} skip${monetSummary}`,
        );
        const errs: string[] = [];
        for (const r of data.results ?? []) {
          if (!r.ok && r.error && errs.length < 2 && !errs.includes(r.error)) {
            errs.push(r.error);
          }
        }
        if ((data.errCount ?? 0) > 0 && errs.length > 0) {
          setSyncErr(`Graph: ${errs.join(" | ")}`);
        }
        // Reload fanpage rows so fresh earnings show in the KPI card.
        const r1 = await fetch("/api/fanpages", { cache: "no-store" });
        const d1 = (await r1.json()) as { rows: FanpageRow[] };
        setFanpages(d1.rows ?? []);
        setRefreshKey((k) => k + 1);
      }
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  const filteredFanpages = useMemo(() => {
    let arr = fanpages;
    if (activeGroupFilter === "unassigned") {
      arr = arr.filter((f) => f.insightGroupId == null);
    } else if (typeof activeGroupFilter === "number") {
      arr = arr.filter((f) => f.insightGroupId === activeGroupFilter);
    }
    const q = search.trim().toLowerCase();
    if (!q) return arr;
    return arr.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.username ?? "").toLowerCase().includes(q),
    );
  }, [fanpages, activeGroupFilter, search]);

  // Per-metric aggregate: running total across selected fanpages over time.
  // Same latest-known-value algorithm as /insights.
  const metricStats = useMemo(() => {
    const out: Record<
      Metric,
      {
        total: number;
        delta: number;
        deltaPct: number | null;
        seriesTotal: { t: number; v: number }[];
        perFpLatest: Map<number, number>;
      }
    > = {
      pageImpressionsUnique: empty(),
      pageImpressions: empty(),
      pageEngagements: empty(),
      pageViews: empty(),
      pageVideoViews: empty(),
    };
    for (const m of Object.keys(METRIC_DEFS) as Metric[]) {
      const events: { t: number; fpId: number; v: number }[] = [];
      for (const s of snapshots) {
        if (!selectedIds.has(s.fanpageId)) continue;
        const v = s[m];
        if (v == null) continue;
        const t = Number(s.takenAt);
        if (!Number.isFinite(t)) continue;
        events.push({ t, fpId: s.fanpageId, v });
      }
      events.sort((a, b) => a.t - b.t);
      const last = new Map<number, number>();
      const series: { t: number; v: number }[] = [];
      for (const e of events) {
        last.set(e.fpId, e.v);
        let sum = 0;
        for (const val of last.values()) sum += val;
        series.push({ t: e.t, v: sum });
      }
      const total = series.length > 0 ? series[series.length - 1].v : 0;
      const delta = series.length >= 2 ? total - series[0].v : 0;
      const first = series.length >= 2 ? series[0].v : 0;
      const deltaPct = first > 0 ? (delta / first) * 100 : null;
      out[m] = { total, delta, deltaPct, seriesTotal: series, perFpLatest: new Map(last) };
    }
    return out;
  }, [snapshots, selectedIds]);

  const topFanpages = useMemo(() => {
    const latest = metricStats[activeMetric].perFpLatest;
    const rows: { id: number; name: string; value: number; pictureUrl: string | null; link: string }[] = [];
    for (const [fpId, v] of latest) {
      const fp = fanpages.find((f) => f.id === fpId);
      if (!fp) continue;
      const link =
        fp.link ||
        (fp.username
          ? `https://facebook.com/${fp.username}`
          : `https://facebook.com/${fp.pageId}`);
      rows.push({ id: fpId, name: fp.name, value: v, pictureUrl: fp.pictureUrl, link });
    }
    rows.sort((a, b) => b.value - a.value);
    return rows;
  }, [metricStats, activeMetric, fanpages]);

  const active = metricStats[activeMetric];

  // Earnings summary across selected fanpages. Aggregate stored breakdown
  // JSON so the click-expand panel shows per-source totals + status counts.
  const earningsStats = useMemo(() => {
    const ids = selectedIds;
    let totalMicros = 0;
    let monetizedCount = 0;
    let eligibleCount = 0;
    let notMonetizedCount = 0;
    let missingScopeCount = 0;
    let unknownCount = 0;
    let neverSyncedCount = 0;
    let updatedAt: number | null = null;
    const sourceTotals = new Map<EarningsSourceRow["source"], number>();
    const sourceAvail = new Map<EarningsSourceRow["source"], boolean>();
    const sourceErrors = new Map<EarningsSourceRow["source"], string | null>();
    for (const f of fanpages) {
      if (!ids.has(f.id)) continue;
      totalMicros += f.earningsValue ?? 0;
      switch (f.monetizationStatus) {
        case "monetized": monetizedCount++; break;
        case "eligible": eligibleCount++; break;
        case "not_monetized": notMonetizedCount++; break;
        case "missing_scope": missingScopeCount++; break;
        case "unknown": unknownCount++; break;
        default: neverSyncedCount++; break;
      }
      if (f.earningsUpdatedAt && (updatedAt == null || f.earningsUpdatedAt > updatedAt)) {
        updatedAt = f.earningsUpdatedAt;
      }
      if (f.earningsBreakdownJson) {
        try {
          const parsed = JSON.parse(f.earningsBreakdownJson) as EarningsSourceRow[];
          for (const s of parsed) {
            sourceTotals.set(s.source, (sourceTotals.get(s.source) ?? 0) + (s.micros ?? 0));
            if (s.available) sourceAvail.set(s.source, true);
            else if (!sourceAvail.has(s.source)) sourceAvail.set(s.source, false);
            if (s.error && !sourceErrors.has(s.source)) {
              sourceErrors.set(s.source, s.error);
            }
          }
        } catch {
          // ignore malformed JSON
        }
      }
    }
    return {
      totalMicros,
      monetizedCount,
      eligibleCount,
      notMonetizedCount,
      missingScopeCount,
      unknownCount,
      neverSyncedCount,
      updatedAt,
      sourceTotals,
      sourceAvail,
      sourceErrors,
    };
  }, [fanpages, selectedIds]);

  // Detect stale snapshot: if the latest snapshot was taken with a
  // different window (rangeStart/rangeEnd span), the shown totals
  // don't reflect the currently selected time range. Prompt a re-sync.
  const snapshotWindowMismatch = useMemo(() => {
    if (snapshots.length === 0) return false;
    // Compute expected window (seconds) for the active selection
    let expectedSec: number;
    if (rangeMode === "custom") {
      if (!customFrom || !customTo) return false;
      const f = Math.floor(new Date(customFrom + "T00:00:00").getTime() / 1000);
      const t = Math.floor(new Date(customTo + "T23:59:59").getTime() / 1000);
      if (!Number.isFinite(f) || !Number.isFinite(t) || t < f) return false;
      expectedSec = t - f;
    } else {
      expectedSec = rangeMode * 86_400;
    }
    // Check the latest snapshot per selected fanpage
    const latestByFp = new Map<number, SnapshotRow>();
    for (const s of snapshots) {
      if (!selectedIds.has(s.fanpageId)) continue;
      const prev = latestByFp.get(s.fanpageId);
      if (!prev || s.takenAt > prev.takenAt) latestByFp.set(s.fanpageId, s);
    }
    if (latestByFp.size === 0) return false;
    for (const s of latestByFp.values()) {
      if (s.rangeStart == null || s.rangeEnd == null) return true;
      const span = s.rangeEnd - s.rangeStart;
      // Sync now always pulls 365 days — only warn when the snapshot window
      // is SHORTER than what the user is viewing (data missing). A wider
      // snapshot is fine; the chart filters down to the selected range.
      if (span < expectedSec - 43_200) return true;
    }
    return false;
  }, [snapshots, selectedIds, rangeMode, customFrom, customTo]);

  function toggle(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <span className="eyebrow">Insights</span>
          <h1 className="h1-serif">
            Tổng quan về <em>Reach</em>
          </h1>
          <span
            className="mono"
            style={{
              marginLeft: 12,
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            {selectedIds.size}/{fanpages.length} fanpage · {rangeLabel}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            onClick={syncPageInsights}
            disabled={syncing || selectedIds.size === 0}
            className="btn btn-accent"
            style={{ padding: "6px 12px", fontSize: 11 }}
            title={`Gọi Graph API cho ${selectedIds.size} fanpage — luôn pull 365 ngày, hiển thị filter theo ${rangeLabel}`}
          >
            {syncing ? "Đang cập nhật…" : `⟳ Cập nhật reach · 365d`}
          </button>
          <button
            onClick={syncEarningsOnly}
            disabled={syncing || selectedIds.size === 0}
            className="btn"
            style={{
              padding: "6px 12px",
              fontSize: 11,
              borderColor: "#2d8a4e",
              color: "#2d8a4e",
            }}
            title={`Chỉ kiểm tra doanh thu cho ${selectedIds.size} fanpage đã chọn (nhanh hơn — bỏ qua reach sync). Pull 365 ngày qua content_monetization_earnings.`}
          >
            {syncing ? "…" : `$ Check doanh thu (${selectedIds.size})`}
          </button>
          <Link href="/insights" className="btn" style={{ padding: "6px 12px", fontSize: 11 }}>
            ← Quản Lý Insight
          </Link>
          <Link
            href="/insights/overview"
            className="btn"
            style={{ padding: "6px 12px", fontSize: 11 }}
          >
            Bảng tổng
          </Link>
        </div>
      </header>

      {snapshotWindowMismatch && !syncing && (
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--accent)",
            letterSpacing: "0.04em",
            marginBottom: 10,
            padding: "6px 10px",
            border: "1px dashed var(--accent)",
            borderRadius: 6,
            background: "var(--accent-soft, rgba(94,106,210,0.06))",
          }}
        >
          ⚠ Snapshot hiện tại dùng cửa sổ khác với lựa chọn ({rangeLabel}). Bấm
          “⟳ Cập nhật reach” để lấy dữ liệu khớp khoảng thời gian.
        </div>
      )}

      {(syncMsg || syncErr) && (
        <div style={{ marginBottom: 10 }}>
          {syncMsg && (
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--good, #2d8a4e)",
                letterSpacing: "0.04em",
              }}
            >
              {syncMsg}
            </div>
          )}
          {syncErr && (
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--accent)",
                letterSpacing: "0.04em",
              }}
            >
              ⚠ {syncErr}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 14 }}>
        {/* Sidebar */}
        <aside
          style={{
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: 14,
            background: "var(--bg)",
            height: "fit-content",
            position: "sticky",
            top: 12,
          }}
        >
          <input
            type="search"
            className="input"
            placeholder="Tìm fanpage…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", fontSize: 13, marginBottom: 10 }}
          />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            <FilterChip
              label={`Tất cả · ${fanpages.length}`}
              active={activeGroupFilter === "all"}
              onClick={() => setActiveGroupFilter("all")}
            />
            <FilterChip
              label={`Chưa nhóm · ${fanpages.filter((f) => f.insightGroupId == null).length}`}
              active={activeGroupFilter === "unassigned"}
              onClick={() => setActiveGroupFilter("unassigned")}
            />
            {groups.map((g) => (
              <FilterChip
                key={g.id}
                label={`${g.name} · ${g.count}`}
                color={g.color}
                active={activeGroupFilter === g.id}
                onClick={() => setActiveGroupFilter(g.id)}
              />
            ))}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <button
              onClick={() => setSelectedIds(new Set(filteredFanpages.map((f) => f.id)))}
              className="btn"
              style={{ padding: "5px 10px", fontSize: 11, flex: 1 }}
            >
              Chọn tất cả ({filteredFanpages.length})
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="btn"
              style={{ padding: "5px 10px", fontSize: 11, flex: 1 }}
            >
              Bỏ chọn
            </button>
          </div>
          <div style={{ maxHeight: "calc(100vh - 240px)", minHeight: 320, overflowY: "auto" }}>
            {filteredFanpages.map((f) => {
              const on = selectedIds.has(f.id);
              const g = groups.find((x) => x.id === f.insightGroupId);
              return (
                <label
                  key={f.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: on ? "var(--accent-soft, rgba(94,106,210,0.08))" : "transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(f.id)}
                    style={{ margin: 0, width: 15, height: 15 }}
                  />
                  {f.pictureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={f.pictureUrl}
                      alt=""
                      width={28}
                      height={28}
                      style={{ borderRadius: 5, objectFit: "cover", flexShrink: 0 }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 5,
                        background: "var(--line)",
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--ink)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {f.name}
                    </div>
                    {g && (
                      <div
                        className="mono"
                        style={{
                          fontSize: 10,
                          color: g.color,
                          letterSpacing: "0.04em",
                          marginTop: 2,
                        }}
                      >
                        ● {g.name}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </aside>

        {/* Main */}
        <main>
          {/* KPI cards row — compact */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 8,
              marginBottom: 12,
            }}
          >
            {(Object.keys(METRIC_DEFS) as Metric[]).map((m) => {
              const s = metricStats[m];
              const on = activeMetric === m;
              const def = METRIC_DEFS[m];
              return (
                <button
                  key={m}
                  onClick={() => setActiveMetric(m)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: on ? `2px solid ${def.color}` : "1px solid var(--line)",
                    background: on
                      ? "var(--accent-soft, rgba(94,106,210,0.06))"
                      : "var(--bg)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    transition: "border-color 0.12s ease, background 0.12s ease",
                  }}
                  title={def.subtitle}
                >
                  <div
                    className="mono"
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: on ? def.color : "var(--muted)",
                      fontWeight: 600,
                    }}
                  >
                    {def.title}
                  </div>
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: "var(--ink)",
                      lineHeight: 1.05,
                      fontVariantNumeric: "tabular-nums",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {fmtNum(s.total)}
                  </div>
                  <DeltaBadge delta={s.delta} deltaPct={s.deltaPct} />
                </button>
              );
            })}
            {/* Earnings card — separate from snapshot metrics. Click → toggles breakdown panel. */}
            <button
              onClick={() => setEarningsExpanded((v) => !v)}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 8,
                border: earningsExpanded
                  ? "2px solid #2d8a4e"
                  : "1px solid var(--line)",
                background: earningsExpanded
                  ? "rgba(45,138,78,0.08)"
                  : "var(--bg)",
                cursor: "pointer",
                fontFamily: "inherit",
                display: "flex",
                flexDirection: "column",
                gap: 3,
                transition: "border-color 0.12s ease, background 0.12s ease",
              }}
              title="Click để xem chi tiết doanh thu theo nguồn"
            >
              <div
                className="mono"
                style={{
                  fontSize: 9,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: earningsExpanded ? "#2d8a4e" : "var(--muted)",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span>Doanh thu</span>
                <span style={{ opacity: 0.6 }}>ⓘ</span>
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: "var(--ink)",
                  lineHeight: 1.05,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "-0.01em",
                }}
              >
                {fmtUsd(earningsStats.totalMicros)}
              </div>
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  color:
                    earningsStats.monetizedCount > 0
                      ? "#2d8a4e"
                      : earningsStats.missingScopeCount > 0
                        ? "var(--accent)"
                        : "var(--muted)",
                  marginTop: 2,
                }}
              >
                {earningsStats.monetizedCount > 0
                  ? `${earningsStats.monetizedCount} page kiếm tiền${
                      earningsStats.missingScopeCount > 0
                        ? ` · ${earningsStats.missingScopeCount} thiếu quyền`
                        : ""
                    }`
                  : earningsStats.missingScopeCount > 0
                    ? `⚠ ${earningsStats.missingScopeCount} page thiếu quyền insights`
                    : earningsStats.notMonetizedCount > 0
                      ? `${earningsStats.notMonetizedCount} chưa bật kiếm tiền`
                      : "— click xem chi tiết"}
              </span>
            </button>
          </div>

          {/* Earnings breakdown panel — shown when the earnings card is clicked. */}
          {earningsExpanded && (
            <div
              style={{
                marginBottom: 12,
                padding: "14px 16px",
                border: "1px solid var(--line)",
                borderRadius: 8,
                background: "var(--bg)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  marginBottom: 12,
                  gap: 12,
                }}
              >
                <div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                      marginBottom: 4,
                    }}
                  >
                    Chi tiết doanh thu
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink)" }}>
                    {selectedIds.size} fanpage đã chọn ·{" "}
                    {earningsStats.updatedAt
                      ? `cập nhật ${new Date(
                          earningsStats.updatedAt * 1000,
                        ).toLocaleString("vi-VN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          day: "2-digit",
                          month: "2-digit",
                        })}`
                      : "chưa cập nhật — bấm \"Cập nhật reach\""}
                  </div>
                </div>
                <button
                  onClick={() => setEarningsExpanded(false)}
                  className="btn"
                  style={{ padding: "5px 10px", fontSize: 11 }}
                >
                  ✕ Đóng
                </button>
              </div>
              {/* Status counts: shows user how many pages fall in each state */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  marginBottom: 12,
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.04em",
                }}
              >
                {earningsStats.monetizedCount > 0 && (
                  <span style={{ color: "#2d8a4e", fontWeight: 600 }}>
                    ✓ {earningsStats.monetizedCount} kiếm tiền
                  </span>
                )}
                {earningsStats.eligibleCount > 0 && (
                  <span style={{ color: "var(--muted)" }}>
                    ○ {earningsStats.eligibleCount} đủ điều kiện
                  </span>
                )}
                {earningsStats.notMonetizedCount > 0 && (
                  <span style={{ color: "var(--muted)" }}>
                    ✗ {earningsStats.notMonetizedCount} chưa bật
                  </span>
                )}
                {earningsStats.missingScopeCount > 0 && (
                  <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                    ⚠ {earningsStats.missingScopeCount} thiếu quyền insights
                  </span>
                )}
                {earningsStats.unknownCount > 0 && (
                  <span style={{ color: "var(--muted)" }}>
                    ? {earningsStats.unknownCount} sync lỗi
                  </span>
                )}
                {earningsStats.neverSyncedCount > 0 && (
                  <span style={{ color: "var(--muted)" }}>
                    — {earningsStats.neverSyncedCount} chưa sync
                  </span>
                )}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    padding: "10px 12px",
                    border: "2px solid #2d8a4e",
                    borderRadius: 8,
                    background: "rgba(45,138,78,0.06)",
                  }}
                >
                  <div
                    className="mono"
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "#2d8a4e",
                      fontWeight: 600,
                      marginBottom: 4,
                    }}
                  >
                    Total
                  </div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: "var(--ink)",
                      lineHeight: 1.05,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmtUsd(earningsStats.totalMicros)}
                  </div>
                </div>
                {(
                  Object.keys(EARNINGS_SOURCE_LABELS) as Array<EarningsSourceRow["source"]>
                )
                  .filter((src) => src !== "total")
                  .map((src) => {
                  const micros = earningsStats.sourceTotals.get(src) ?? 0;
                  const available = earningsStats.sourceAvail.get(src) ?? false;
                  const error = earningsStats.sourceErrors.get(src);
                  // As of v23 only the consolidated "total" metric is fetchable.
                  // All sub-source tiles are kept for visual continuity but show
                  // as unsupported.
                  const supported = false;
                  return (
                    <div
                      key={src}
                      style={{
                        padding: "10px 12px",
                        border: "1px solid var(--line)",
                        borderRadius: 8,
                        background: "var(--bg)",
                        opacity: !supported ? 0.55 : 1,
                      }}
                      title={
                        !supported
                          ? "FB không expose chỉ số này qua Graph API (creator bonus program)"
                          : error ?? undefined
                      }
                    >
                      <div
                        className="mono"
                        style={{
                          fontSize: 9,
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          color: "var(--muted)",
                          fontWeight: 600,
                          marginBottom: 4,
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span>{EARNINGS_SOURCE_LABELS[src]}</span>
                        <span style={{ opacity: 0.6 }}>ⓘ</span>
                      </div>
                      <div
                        style={{
                          fontSize: 20,
                          fontWeight: 700,
                          color: supported ? "var(--ink)" : "var(--muted)",
                          lineHeight: 1.05,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {!supported ? "—" : fmtUsd(micros)}
                      </div>
                      {!supported && (
                        <div
                          style={{
                            fontSize: 9,
                            color: "var(--muted)",
                            marginTop: 2,
                          }}
                        >
                          không hỗ trợ
                        </div>
                      )}
                      {supported && !available && error && (
                        <div
                          style={{
                            fontSize: 9,
                            color: "var(--accent)",
                            marginTop: 2,
                          }}
                          title={error}
                        >
                          ⚠ FB từ chối
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                  marginTop: 10,
                  fontStyle: "italic",
                  lineHeight: 1.5,
                }}
              >
                Số tổng dùng metric
                <code style={{ margin: "0 4px", fontFamily: "var(--font-mono)", fontSize: 10 }}>
                  monetization_approximate_earnings
                </code>
                — chính là số "Approximate earnings" hiển thị trong Meta Business Suite.
                Từ Graph API v23 (5/2025), Facebook <strong>không còn expose breakdown</strong>
                theo nguồn (in-stream ads / Reels / subscriptions / live / bonuses) qua API nữa
                — chi tiết chỉ xem được ở Creator Studio / Business Suite.
              </div>
            </div>
          )}

          {/* Range selector */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 10,
              padding: "8px 12px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg)",
            }}
          >
            <span
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--muted)",
              }}
            >
              Thời gian
            </span>
            {([7, 30, 90] as const).map((n) => {
              const on = rangeMode === n;
              return (
                <button
                  key={n}
                  onClick={() => setRangeMode(n)}
                  className="pill"
                  style={{
                    padding: "4px 12px",
                    fontSize: 11,
                    borderRadius: 999,
                    border: on ? "1px solid var(--ink)" : "1px solid var(--line)",
                    background: on ? "var(--ink)" : "transparent",
                    color: on ? "var(--paper)" : "var(--ink)",
                    cursor: "pointer",
                  }}
                >
                  {n} ngày
                </button>
              );
            })}
            <button
              onClick={() => setRangeMode("custom")}
              className="pill"
              style={{
                padding: "4px 12px",
                fontSize: 11,
                borderRadius: 999,
                border: rangeMode === "custom" ? "1px solid var(--ink)" : "1px solid var(--line)",
                background: rangeMode === "custom" ? "var(--ink)" : "transparent",
                color: rangeMode === "custom" ? "var(--paper)" : "var(--ink)",
                cursor: "pointer",
              }}
            >
              Tùy chọn
            </button>
            {rangeMode === "custom" && (
              <>
                <input
                  type="date"
                  className="input"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  style={{ padding: "3px 8px", fontSize: 11 }}
                />
                <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>
                  →
                </span>
                <input
                  type="date"
                  className="input"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => setCustomTo(e.target.value)}
                  style={{ padding: "3px 8px", fontSize: 11 }}
                />
              </>
            )}
            <span style={{ flex: 1 }} />
            <span
              className="mono"
              style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.06em" }}
            >
              {rangeLabel}
            </span>
          </div>

          {/* Chart + breakdown */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 280px",
              gap: 14,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: "14px 16px",
                background: "var(--bg)",
                minHeight: 360,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                <div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                    }}
                  >
                    Số liệu chia nhỏ về {METRIC_DEFS[activeMetric].title}
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                    {rangeLabel}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{ fontSize: 20, fontWeight: 600, color: "var(--muted)", lineHeight: 1.1 }}
                  >
                    {fmtFullNum(active.total)}
                  </div>
                </div>
              </div>
              <ChartCanvas
                series={dailySeries[activeMetric]}
                color={METRIC_DEFS[activeMetric].color}
                loading={loadingDaily || loadingSnap}
              />
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  color: "var(--muted)",
                  letterSpacing: "0.06em",
                  marginTop: 8,
                }}
              >
                ● {METRIC_DEFS[activeMetric].title} tổng ({selectedIds.size} fanpage) ·{" "}
                {dailySeries[activeMetric].length} ngày
              </div>
            </div>

            {/* Breakdown side panel */}
            <aside
              style={{
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: "14px 14px",
                background: "var(--bg)",
                height: "fit-content",
              }}
            >
              <div
                className="mono"
                style={{
                  fontSize: 9,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                  marginBottom: 10,
                }}
              >
                Top fanpage · {METRIC_DEFS[activeMetric].title}
              </div>
              {topFanpages.length === 0 && (
                <div className="mono" style={{ fontSize: 10, color: "var(--muted)", padding: 12 }}>
                  Chưa có dữ liệu
                </div>
              )}
              {topFanpages.map((fp, i) => {
                const pct = active.total > 0 ? (fp.value / active.total) * 100 : 0;
                return (
                  <div
                    key={fp.id}
                    style={{
                      padding: "8px 0",
                      borderBottom:
                        i < topFanpages.length - 1 ? "1px solid var(--line)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {fp.pictureUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={fp.pictureUrl}
                          alt=""
                          width={24}
                          height={24}
                          style={{ borderRadius: 4, objectFit: "cover" }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 4,
                            background: "var(--line)",
                          }}
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <a
                          href={fp.link}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "var(--ink)",
                            textDecoration: "none",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            display: "block",
                          }}
                          title={fp.name}
                        >
                          {fp.name}
                        </a>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--ink)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {fmtNum(fp.value)}
                      </div>
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        height: 3,
                        background: "var(--line)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, pct)}%`,
                          height: "100%",
                          background: METRIC_DEFS[activeMetric].color,
                        }}
                      />
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 9, color: "var(--muted)", marginTop: 2 }}
                    >
                      {pct.toFixed(1)}%
                    </div>
                  </div>
                );
              })}
            </aside>
          </div>
        </main>
      </div>
    </>
  );
}

function empty() {
  return {
    total: 0,
    delta: 0,
    deltaPct: null,
    seriesTotal: [],
    perFpLatest: new Map<number, number>(),
  };
}

function FilterChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="pill"
      style={{
        padding: "5px 10px",
        fontSize: 11,
        borderRadius: 999,
        border: active ? "1px solid var(--ink)" : "1px solid var(--line)",
        background: active ? "var(--ink)" : "transparent",
        color: active ? "var(--paper)" : "var(--ink)",
        cursor: "pointer",
      }}
    >
      {color && (
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: 999,
            background: color,
            marginRight: 4,
            verticalAlign: "middle",
          }}
        />
      )}
      {label}
    </button>
  );
}

function DeltaBadge({
  delta,
  deltaPct,
  large,
}: {
  delta: number;
  deltaPct: number | null;
  large?: boolean;
}) {
  if (delta === 0 && (deltaPct == null || deltaPct === 0)) {
    return (
      <span
        className="mono"
        style={{ fontSize: large ? 11 : 10, color: "var(--muted)", marginTop: 2 }}
      >
        — không đổi
      </span>
    );
  }
  const up = delta >= 0;
  const color = up ? "#2d8a4e" : "#d94a1f";
  return (
    <div
      className="mono"
      style={{
        fontSize: large ? 11 : 10,
        color,
        marginTop: 2,
        letterSpacing: "0.04em",
      }}
    >
      {up ? "↑" : "↓"} {fmtFullNum(Math.abs(delta))}
      {deltaPct != null && <> · {Math.abs(deltaPct).toFixed(1)}%</>}
    </div>
  );
}

function ChartCanvas({
  series,
  color,
  loading,
}: {
  series: { t: number; v: number }[];
  color: string;
  loading: boolean;
}) {
  const W = 820;
  const H = 220;
  const PAD = { l: 52, r: 12, t: 10, b: 36 };

  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const hasData = series.length > 0;
  if (!hasData) {
    return (
      <div
        className="mono"
        style={{
          fontSize: 11,
          color: "var(--muted)",
          padding: 40,
          textAlign: "center",
          border: "1px dashed var(--line)",
          borderRadius: 8,
        }}
      >
        {loading
          ? "Đang tải dữ liệu…"
          : "Chưa có dữ liệu — chọn fanpage rồi bấm \"⟳ Cập nhật reach\" ở đầu trang"}
      </div>
    );
  }

  const minT = series[0].t;
  const maxT = series[series.length - 1].t;
  const minV = Math.min(0, Math.min(...series.map((p) => p.v)));
  const maxV = Math.max(...series.map((p) => p.v));
  const vSpan = maxV === minV ? 1 : maxV - minV;
  const tSpan = maxT === minT ? 1 : maxT - minT;

  const x = (t: number) => PAD.l + ((t - minT) / tSpan) * innerW;
  const y = (v: number) => PAD.t + innerH - ((v - minV) / vSpan) * innerH;

  const totalPath = series
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`)
    .join(" ");

  const areaPath =
    series.length > 1
      ? `${totalPath} L ${x(series[series.length - 1].t).toFixed(1)} ${y(minV).toFixed(1)} L ${x(series[0].t).toFixed(1)} ${y(minV).toFixed(1)} Z`
      : "";

  // Locate the data point closest to the cursor's X position.
  const onMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement | null)?.getBoundingClientRect();
    if (!rect) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    const px = ratio * W;
    if (px < PAD.l || px > PAD.l + innerW) {
      setHoverIdx(null);
      return;
    }
    const t = minT + ((px - PAD.l) / innerW) * tSpan;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < series.length; i++) {
      const d = Math.abs(series[i].t - t);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    setHoverIdx(bestIdx);
  };
  const onMouseLeave = () => setHoverIdx(null);

  const hoverPt = hoverIdx != null ? series[hoverIdx] : null;
  // 5 evenly-distributed X ticks, snapped to actual data points so the labels
  // always reflect a real day (no synthetic interpolated dates).
  const tickIndices: number[] = [];
  const tickCount = Math.min(5, series.length);
  for (let i = 0; i < tickCount; i++) {
    const ratio = tickCount === 1 ? 0 : i / (tickCount - 1);
    tickIndices.push(Math.round(ratio * (series.length - 1)));
  }

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        <linearGradient id="area-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* Y grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const vv = minV + vSpan * (1 - f);
        const yy = PAD.t + f * innerH;
        return (
          <g key={f}>
            <line
              x1={PAD.l}
              x2={PAD.l + innerW}
              y1={yy}
              y2={yy}
              stroke="var(--line)"
              strokeWidth={1}
              strokeDasharray={f === 1 ? "" : "2 3"}
            />
            <text
              x={PAD.l - 6}
              y={yy + 3}
              textAnchor="end"
              fontSize={10}
              fill="var(--muted)"
              fontFamily="var(--font-mono)"
            >
              {fmtNum(vv)}
            </text>
          </g>
        );
      })}
      {/* X ticks (snapped to real data days) */}
      {tickIndices.map((idx, i) => {
        const p = series[idx];
        const xx = x(p.t);
        return (
          <text
            key={i}
            x={xx}
            y={PAD.t + innerH + 18}
            textAnchor="middle"
            fontSize={10}
            fill="var(--muted)"
            fontFamily="var(--font-mono)"
          >
            {fmtDate(p.t)}
          </text>
        );
      })}
      {/* Area under line */}
      {areaPath && <path d={areaPath} fill="url(#area-grad)" />}
      {/* Total line */}
      <path
        d={totalPath}
        fill="none"
        stroke={color}
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
      {/* Data point dots */}
      {series.map((p, i) => (
        <circle
          key={i}
          cx={x(p.t)}
          cy={y(p.v)}
          r={hoverIdx === i ? 4.5 : 2.4}
          fill={color}
          stroke={hoverIdx === i ? "var(--bg)" : "none"}
          strokeWidth={hoverIdx === i ? 2 : 0}
        />
      ))}
      {/* Hover guide line + tooltip */}
      {hoverPt && (
        <>
          <line
            x1={x(hoverPt.t)}
            x2={x(hoverPt.t)}
            y1={PAD.t}
            y2={PAD.t + innerH}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.5}
          />
          {/* Date label below x-axis */}
          <g>
            <rect
              x={Math.max(PAD.l, Math.min(PAD.l + innerW - 110, x(hoverPt.t) - 55))}
              y={H - 24}
              width={110}
              height={20}
              rx={4}
              fill={color}
              opacity={0.95}
            />
            <text
              x={Math.max(PAD.l + 55, Math.min(PAD.l + innerW - 55, x(hoverPt.t)))}
              y={H - 10}
              textAnchor="middle"
              fontSize={10}
              fill="#fff"
              fontFamily="var(--font-mono)"
              fontWeight={600}
            >
              {fmtDate(hoverPt.t)} · {fmtFullNum(hoverPt.v)}
            </text>
          </g>
        </>
      )}
      {/* Transparent overlay for mouse tracking */}
      <rect
        x={PAD.l}
        y={PAD.t}
        width={innerW}
        height={innerH}
        fill="transparent"
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        style={{ cursor: "crosshair" }}
      />
    </svg>
  );
}
