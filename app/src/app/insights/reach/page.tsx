"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { safeJson } from "@/lib/req-body";

// Chunk size for bulk fanpage POSTs. CF Workers limit wall-clock (~30s),
// subrequest count (~50 free / ~1000 paid), AND CPU per invocation (the
// last one bit us when we tried Promise.all with chunk=3 — Worker hit
// Error 1102). Two pages per chunk processed SEQUENTIALLY in the route
// keeps memory + CPU spread out: per chunk ≈ 2 × ~13 subrequests = 26,
// well under the free cap with retry headroom. Halves the network
// round-trips vs chunk=1 without stressing the Worker.
const BULK_FP_CHUNK = 2;

// Pages whose `lastSyncedAt` is within this window are skipped during a
// bulk reach sync — the existing DB row already has fresh data. Solves
// the "Tất cả tab re-checks pages already synced from group syncs"
// issue: those pages reuse cached insights_json instead of an FB call.
const SKIP_FRESH_WINDOW_SEC = 30 * 60; // 30 minutes

// Chunk size for the daily-insights GET. The endpoint reads
// `insights_json` for every requested fanpage and JSON.parses each.
// Each row is ~50–200KB; 100 rows in one call ≈ 10MB of parsing, which
// can blow past the CF Workers free-plan 10ms CPU per invocation cap and
// return empty (the symptom: "Tất cả tab shows 0, groups show data" —
// groups stay under the threshold). 20 ids/chunk keeps each invocation
// at ≤4MB of parse work, well within the limit.
const DAILY_INSIGHTS_CHUNK = 20;

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
  // /api/fanpages serializes the drizzle Date as ISO string; older callers
  // expected epoch seconds. `lastSyncedSec()` accepts both.
  lastSyncedAt: number | string | null;
  lastSyncError: string | null;
  // Stringified FbPageInsights map. The skip-fresh filter checks this is
  // non-empty so a previous sync that errored (lastSyncError set, but the
  // route still bumps lastSyncedAt to "now") doesn't get permanently
  // skipped on subsequent clicks.
  insightsJson: string | null;
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

// `lastSyncedAt` is `integer("…", { mode: "timestamp" })` in drizzle. The
// /api/fanpages route serializes the Date as an ISO string, while
// /api/insights/overview pre-converts to epoch seconds — historic
// inconsistency. Accept either form so the skip-fresh filter is robust
// regardless of which endpoint hydrated the row.
function lastSyncedSec(ts: number | string | null | undefined): number | null {
  if (ts == null || ts === "") return null;
  if (typeof ts === "number") return Number.isFinite(ts) ? ts : null;
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

// ── Date helpers for the range picker ────────────────────────────
function toISO(d: Date): string {
  // Local-tz YYYY-MM-DD (avoids tz shift from .toISOString()).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}
function startOfWeek(d: Date): Date {
  // Monday-anchored (matches VN convention even though calendar shows CN/T2-T7).
  const x = startOfDay(d);
  const day = x.getDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(x, offset);
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}
function fmtVnDay(d: Date): string {
  return `${d.getDate()} Tháng ${d.getMonth() + 1}, ${d.getFullYear()}`;
}
function fmtRange(fromIso: string, toIso: string): string {
  if (!fromIso || !toIso) return "—";
  return `${fmtVnDay(parseISO(fromIso))} – ${fmtVnDay(parseISO(toIso))}`;
}

interface PickerPreset {
  key: string;
  label: string;
  compute(): { from: Date; to: Date };
}
const RANGE_PRESETS: readonly PickerPreset[] = [
  {
    key: "yesterday",
    label: "Hôm qua",
    compute() {
      const y = addDays(startOfDay(new Date()), -1);
      return { from: y, to: y };
    },
  },
  {
    key: "last7",
    label: "7 ngày qua",
    compute() {
      const t = startOfDay(new Date());
      return { from: addDays(t, -6), to: t };
    },
  },
  {
    key: "last28",
    label: "28 ngày qua",
    compute() {
      const t = startOfDay(new Date());
      return { from: addDays(t, -27), to: t };
    },
  },
  {
    key: "last90",
    label: "90 ngày qua",
    compute() {
      const t = startOfDay(new Date());
      return { from: addDays(t, -89), to: t };
    },
  },
  {
    key: "thisWeek",
    label: "Tuần này",
    compute() {
      const t = startOfDay(new Date());
      return { from: startOfWeek(t), to: t };
    },
  },
  {
    key: "thisMonth",
    label: "Tháng này",
    compute() {
      const t = startOfDay(new Date());
      return { from: startOfMonth(t), to: t };
    },
  },
  {
    key: "thisYear",
    label: "Năm nay",
    compute() {
      const t = startOfDay(new Date());
      return { from: startOfYear(t), to: t };
    },
  },
  {
    key: "lastWeek",
    label: "Tuần trước",
    compute() {
      const w = startOfWeek(new Date());
      return { from: addDays(w, -7), to: addDays(w, -1) };
    },
  },
  {
    key: "lastMonth",
    label: "Tháng trước",
    compute() {
      const m = startOfMonth(new Date());
      return { from: addMonths(m, -1), to: addDays(m, -1) };
    },
  },
];
const PRESETS_BY_KEY: Record<string, PickerPreset> = Object.fromEntries(
  RANGE_PRESETS.map((p) => [p.key, p]),
);

export default function ReachDashboard() {
  const [fanpages, setFanpages] = useState<FanpageRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [activeGroupFilter, setActiveGroupFilter] = useState<
    "all" | "unassigned" | number
  >("all");
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [activeMetric, setActiveMetric] = useState<Metric>("pageImpressionsUnique");
  // Default range = last 28 days (matches FB Insights "monthly" convention).
  // rangeMode kept as legacy state (used by snapshots query path) but the new
  // picker always sets rangeMode="custom" + explicit customFrom/customTo.
  const [rangeMode, setRangeMode] = useState<RangeMode>("custom");
  const [customFrom, setCustomFrom] = useState(daysAgoISO(27));
  const [customTo, setCustomTo] = useState(todayISO());
  // Tracks which preset (if any) the current range came from — used as the
  // dropdown trigger label. Cleared to `null` when user picks dates manually
  // on the calendar (label falls back to "Tùy chọn").
  const [presetLabel, setPresetLabel] = useState<string | null>("28 ngày qua");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState<Date | null>(null);
  const [draftTo, setDraftTo] = useState<Date | null>(null);
  const [draftPresetKey, setDraftPresetKey] = useState<string | null>(null);
  // Anchor month for the LEFT calendar pane (right pane = anchor + 1 month).
  const [calAnchor, setCalAnchor] = useState<Date>(() =>
    startOfMonth(addMonths(new Date(), -1)),
  );
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState("");
  const [loadingSnap, setLoadingSnap] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Mirror of `syncing` for early-return guards inside async functions and
  // setTimeout closures. React state reads in closures are stale (the boolean
  // captured at scheduling time, not when the timer fires), so two auto-fired
  // syncs can race and double-hit FB Graph API. The ref reflects the latest
  // value synchronously and dedupes concurrent invocations.
  const syncingRef = useRef(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncErr, setSyncErr] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [earningsExpanded, setEarningsExpanded] = useState(false);
  // Real daily series (from /api/fanpages/daily-insights). Keyed by metric.
  // Series is filtered to the user-selected window — sums to the period total
  // shown on each KPI card.
  const [dailySeries, setDailySeries] = useState<Record<Metric, { t: number; v: number }[]>>({
    pageImpressionsUnique: [],
    pageImpressions: [],
    pageEngagements: [],
    pageViews: [],
    pageVideoViews: [],
  });
  // Sum of the prior equivalent-length window (e.g. for "30 ngày", days
  // 60→30 ago). Drives the delta/% on KPI cards. Filled by the same effect
  // that loads `dailySeries` (single fetch covers 2× window).
  const [prevTotals, setPrevTotals] = useState<Record<Metric, number>>({
    pageImpressionsUnique: 0,
    pageImpressions: 0,
    pageEngagements: 0,
    pageViews: 0,
    pageVideoViews: 0,
  });
  const [loadingDaily, setLoadingDaily] = useState(false);
  // Per-fanpage daily breakdown for REACH only. Lets the Top fanpage widget
  // rank fanpages using the same data path as the KPI cards (sum equals).
  const [reachPerFp, setReachPerFp] = useState<Record<number, { t: number; v: number }[]>>({});

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

  // ── Range-picker controls ──────────────────────────────────────
  function openPicker() {
    // Seed draft from current applied state.
    setDraftFrom(parseISO(customFrom));
    setDraftTo(parseISO(customTo));
    setDraftPresetKey(presetLabel ? RANGE_PRESETS.find((p) => p.label === presetLabel)?.key ?? null : null);
    // Cap anchor so the RIGHT pane never displays a fully-future month.
    // Right pane = anchor + 1; max allowed right pane = current month → max
    // anchor = current month - 1.
    const cap = startOfMonth(addMonths(new Date(), -1));
    const fromMonth = startOfMonth(parseISO(customFrom));
    const anchor = fromMonth.getTime() < cap.getTime() ? fromMonth : cap;
    setCalAnchor(anchor);
    setPickerOpen(true);
  }
  function closePicker() {
    setPickerOpen(false);
  }
  function applyDraft() {
    if (!draftFrom || !draftTo) return;
    const [a, b] =
      draftFrom.getTime() <= draftTo.getTime()
        ? [draftFrom, draftTo]
        : [draftTo, draftFrom];
    setCustomFrom(toISO(a));
    setCustomTo(toISO(b));
    setRangeMode("custom");
    setPresetLabel(draftPresetKey ? PRESETS_BY_KEY[draftPresetKey]?.label ?? null : null);
    setPickerOpen(false);
  }
  function pickPreset(key: string) {
    const p = PRESETS_BY_KEY[key];
    if (!p) return;
    const { from, to } = p.compute();
    setDraftFrom(from);
    setDraftTo(to);
    setDraftPresetKey(key);
    // Re-anchor so the LEFT pane contains the start of the picked range,
    // capped so the RIGHT pane never displays a fully-future month.
    const cap = startOfMonth(addMonths(new Date(), -1));
    const fromMonth = startOfMonth(from);
    setCalAnchor(fromMonth.getTime() < cap.getTime() ? fromMonth : cap);
  }
  function pickCalDay(d: Date) {
    if (!draftFrom || (draftFrom && draftTo)) {
      // Start a new selection.
      setDraftFrom(d);
      setDraftTo(null);
      setDraftPresetKey(null);
    } else {
      // Second click — set the other endpoint.
      setDraftTo(d);
      setDraftPresetKey(null);
    }
  }
  // Click-outside closes the picker without applying.
  useEffect(() => {
    if (!pickerOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!pickerRef.current) return;
      if (!pickerRef.current.contains(e.target as Node)) closePicker();
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [pickerOpen]);

  const triggerLabel = useMemo(() => {
    const range = fmtRange(customFrom, customTo);
    return presetLabel ? `${presetLabel}: ${range}` : range;
  }, [presetLabel, customFrom, customTo]);

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
      const d1 = await safeJson<{ rows?: FanpageRow[] }>(r1);
      setFanpages(d1.rows ?? []);
      const r2 = await fetch("/api/insight-groups", { cache: "no-store" });
      const d2 = await safeJson<{ groups?: GroupRow[] }>(r2);
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
        const d = await safeJson<{ rows?: SnapshotRow[] }>(res);
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
          // Also reset the per-fanpage reach map; otherwise the Top widget
          // shows stale rows from the previous selection after Bỏ chọn.
          setReachPerFp({});
        }
        return;
      }
      setLoadingDaily(true);
      try {
        // Compute display-window days. Custom range translates to the
        // explicit span; preset modes pass directly.
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
        // Fetch 2× the window so we can split into [prev, current] and
        // compute period-over-period delta on the KPI cards.
        const fetchDays = displayDays > 0 ? displayDays * 2 : 0;
        const cutoffSec = Math.floor(Date.now() / 1000) - displayDays * 86_400;
        const metrics: Metric[] = [
          "pageImpressionsUnique",
          "pageImpressions",
          "pageEngagements",
          "pageViews",
          "pageVideoViews",
        ];
        let reachPerFpCurr: Record<number, { t: number; v: number }[]> = {};

        // Chunk the daily-insights call to keep each Worker's JSON-parse
        // work bounded (see DAILY_INSIGHTS_CHUNK comment). For each metric
        // we fire chunks SEQUENTIALLY (not Promise.all) — the 5 metrics
        // already run in parallel via the outer Promise.all, so we get
        // ≤5 concurrent fetches at any moment. Going parallel within a
        // metric would multiply that to 5×N concurrent and risk pushing
        // CF infrastructure into 1102 territory like fd7a3d7 did.
        const fetchOneMetric = async (
          m: Metric,
        ): Promise<
          [
            Metric,
            { t: number; v: number }[],
            number,
            Record<number, { t: number; v: number }[]>,
          ]
        > => {
          const dayTotalsAll = new Map<number, number>();
          const allFpDay: Record<number, Map<number, number>> = {};
          for (let i = 0; i < ids.length; i += DAILY_INSIGHTS_CHUNK) {
            const chunkIds = ids.slice(i, i + DAILY_INSIGHTS_CHUNK);
            const params = new URLSearchParams({
              ids: chunkIds.join(","),
              metric: m,
              days: String(fetchDays),
            });
            const res = await fetch(`/api/fanpages/daily-insights?${params}`, {
              cache: "no-store",
            });
            if (!res.ok) continue;
            const d = await safeJson<{
              series?: Array<{ ts: number; value: number }>;
              perFp?: Record<number, Array<{ ts: number; value: number }>>;
            }>(res);
            // Aggregate aggregate-series across chunks: sum by ts.
            for (const p of d.series ?? []) {
              dayTotalsAll.set(
                p.ts,
                (dayTotalsAll.get(p.ts) ?? 0) + p.value,
              );
            }
            // Aggregate per-fanpage series. Each chunk only returns
            // perFp for ITS fanpages, so we build up a per-fp Map.
            for (const [fpIdStr, arr] of Object.entries(d.perFp ?? {})) {
              const fpId = Number(fpIdStr);
              let fpMap = allFpDay[fpId];
              if (!fpMap) {
                fpMap = new Map<number, number>();
                allFpDay[fpId] = fpMap;
              }
              for (const p of arr) {
                fpMap.set(p.ts, (fpMap.get(p.ts) ?? 0) + p.value);
              }
            }
          }
          const all = Array.from(dayTotalsAll, ([t, v]) => ({ t, v })).sort(
            (a, b) => a.t - b.t,
          );
          const curr = all.filter((p) => p.t >= cutoffSec);
          const prev = all.filter((p) => p.t < cutoffSec);
          const prevSum = prev.reduce((s, p) => s + p.v, 0);
          const perFpCurr: Record<number, { t: number; v: number }[]> = {};
          for (const [fpIdStr, fpMap] of Object.entries(allFpDay)) {
            const fpId = Number(fpIdStr);
            perFpCurr[fpId] = Array.from(fpMap, ([t, v]) => ({ t, v }))
              .filter((p) => p.t >= cutoffSec)
              .sort((a, b) => a.t - b.t);
          }
          return [m, curr, prevSum, perFpCurr];
        };
        const results = await Promise.all(metrics.map(fetchOneMetric));
        if (!cancelled) {
          const nextSeries: Record<Metric, { t: number; v: number }[]> = {
            pageImpressionsUnique: [],
            pageImpressions: [],
            pageEngagements: [],
            pageViews: [],
            pageVideoViews: [],
          };
          const nextPrev: Record<Metric, number> = {
            pageImpressionsUnique: 0,
            pageImpressions: 0,
            pageEngagements: 0,
            pageViews: 0,
            pageVideoViews: 0,
          };
          for (const [m, s, prevSum, perFpCurr] of results) {
            nextSeries[m] = s;
            nextPrev[m] = prevSum;
            if (m === "pageImpressionsUnique") reachPerFpCurr = perFpCurr;
          }
          setDailySeries(nextSeries);
          setPrevTotals(nextPrev);
          setReachPerFp(reachPerFpCurr);
        }
      } finally {
        if (!cancelled) setLoadingDaily(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedIds, rangeMode, customFrom, customTo, refreshKey]);

  // No auto-fired FB syncs on this page. Earlier revisions auto-fetched
  // earnings (and briefly reach) when selection or range changed; the user
  // explicitly disabled that — heavy FB calls must be opt-in via the manual
  // buttons "⟳ Cập nhật reach" and "$ Check doanh thu". The chart and KPI
  // cards still update from existing DB data when selection changes, via
  // the daily-insights and snapshots effects above (those are pure DB
  // reads — no FB API, no subrequest cost).

  /**
   * Lighter button: only fetches earnings (no reach insights). Useful when
   * the user only cares about doanh thu and doesn't want to wait for the
   * full reach sync. Uses the picker's current range so the displayed
   * earnings number reflects the dates the user chose.
   */
  async function syncEarningsOnly() {
    if (syncingRef.current) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncMsg("");
    setSyncErr("");
    // Aggregated counters across all chunks. Chunking is required because
    // CF Workers ~30s wall-clock can't process 30+ pages × FB Graph calls
    // in a single request — empty body crashes `await res.json()`.
    let total = 0;
    let okCount = 0;
    let errCount = 0;
    let skipCount = 0;
    let monetizedCount = 0;
    let totalMicros = 0;
    let missingScopeCnt = 0;
    let notMonetCnt = 0;
    const errSamples: string[] = [];
    let firstChunkError: string | null = null;
    try {
      for (let i = 0; i < ids.length; i += BULK_FP_CHUNK) {
        const chunk = ids.slice(i, i + BULK_FP_CHUNK);
        const res = await fetch("/api/fanpages/sync-earnings", {
          method: "POST",
          headers: { "X-Body": JSON.stringify({ ids: chunk, ...rangeBody }) },
        });
        const data = await safeJson<{
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
        }>(res);
        if (!res.ok || data.error) {
          if (!firstChunkError) firstChunkError = data.error ?? `Lỗi ${res.status}`;
          errCount += chunk.length;
          continue;
        }
        total += data.total ?? 0;
        okCount += data.okCount ?? 0;
        errCount += data.errCount ?? 0;
        skipCount += data.skipCount ?? 0;
        monetizedCount += data.monetizedCount ?? 0;
        totalMicros += data.totalMicros ?? 0;
        for (const r of data.results ?? []) {
          if (r.status === "missing_scope") missingScopeCnt++;
          else if (r.status === "not_monetized") notMonetCnt++;
          if (!r.ok && r.error && errSamples.length < 2 && !errSamples.includes(r.error)) {
            errSamples.push(r.error);
          }
        }
        // Progressive status during long syncs.
        setSyncMsg(
          `Doanh thu: ${Math.min(i + chunk.length, ids.length)}/${ids.length} page · ${okCount} OK · ${errCount} lỗi`,
        );
      }
      if (firstChunkError) setSyncErr(firstChunkError);
      const moneSum =
        monetizedCount > 0
          ? ` · 💰 ${fmtUsd(totalMicros)} từ ${monetizedCount} page`
          : "";
      const breakdown: string[] = [];
      if (missingScopeCnt > 0) breakdown.push(`${missingScopeCnt} thiếu quyền`);
      if (notMonetCnt > 0) breakdown.push(`${notMonetCnt} chưa BKT`);
      const breakdownStr = breakdown.length > 0 ? ` · ${breakdown.join(" · ")}` : "";
      setSyncMsg(
        `Doanh thu: ${okCount}/${total} OK · ${errCount} lỗi · ${skipCount} skip${moneSum}${breakdownStr}`,
      );
      if (errCount > 0 && errSamples.length > 0 && !firstChunkError) {
        setSyncErr(`Graph: ${errSamples.join(" | ")}`);
      }
      // Reload fanpage rows so fresh earnings show in the KPI card.
      const r1 = await fetch("/api/fanpages", { cache: "no-store" });
      const d1 = await safeJson<{ rows?: FanpageRow[] }>(r1);
      setFanpages(d1.rows ?? []);
      // Auto-open the breakdown panel so user sees what changed
      if (monetizedCount > 0 || missingScopeCnt > 0) {
        setEarningsExpanded(true);
      }
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : String(e));
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }

  async function syncPageInsights() {
    if (syncingRef.current) return;
    const allIds = Array.from(selectedIds);
    if (allIds.length === 0) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncMsg("");
    setSyncErr("");
    // Pulls the last 365 days of page insights. The library chunks the FB
    // call into 90-day windows internally so the date span is FB-safe;
    // chunking on the CLIENT (BULK_FP_CHUNK) keeps each CF Worker
    // invocation under the ~30s wall-clock. Earnings sync follows the
    // user-selected picker range (no daily breakdown).
    //
    // Chunked sequential, not parallel: running insights/batch + sync-earnings
    // simultaneously over many pages doubles CF Workers subrequest pressure,
    // and parallel-on-all-ids was the trigger for empty-body crashes.
    const SYNC_DAYS = 365;
    // Skip-fresh filter: skip a page only when ALL three conditions hold:
    //   1. lastSyncedAt within 30 min
    //   2. lastSyncError == null  (the previous sync actually succeeded —
    //      the route's error path also bumps lastSyncedAt, so a recency-
    //      only check would lock failed pages out of retry for 30 min)
    //   3. insightsJson is non-empty  (the previous sync produced data;
    //      a successful FB call with no metrics still leaves us with "{}"
    //      and the KPI cards would render 0 if we kept skipping)
    // Pages that errored or have empty data fall through and re-sync. This
    // is the fix for "Tất cả tab shows 0 reach but groups show data" —
    // some all-tab pages had lastSyncedAt from a stale prior failure.
    const nowSec = Math.floor(Date.now() / 1000);
    const fpById = new Map(fanpages.map((f) => [f.id, f]));
    const ids: number[] = [];
    let freshSkippedCount = 0;
    for (const id of allIds) {
      const fp = fpById.get(id);
      const lastSec = lastSyncedSec(fp?.lastSyncedAt ?? null);
      const recent = lastSec != null && nowSec - lastSec < SKIP_FRESH_WINDOW_SEC;
      // Explicit `== null` (not `!fp?.lastSyncError`) so an unexpected
      // empty-string value isn't mistaken for "succeeded".
      const lastSucceeded = fp?.lastSyncError == null;
      const hasData =
        !!fp?.insightsJson && fp.insightsJson !== "{}" && fp.insightsJson !== "";
      if (recent && lastSucceeded && hasData) {
        freshSkippedCount++;
        continue;
      }
      ids.push(id);
    }
    if (ids.length === 0) {
      setSyncMsg(
        `Tất cả ${allIds.length} page đã sync gần đây (≤30 phút) — dùng dữ liệu hiện có`,
      );
      // Force chart re-read in case UI is showing stale state.
      setRefreshKey((k) => k + 1);
      syncingRef.current = false;
      setSyncing(false);
      return;
    }
    let okCount = 0;
    let errCount = 0;
    let skipCount = 0;
    let monetizedCount = 0;
    let totalMicros = 0;
    let firstError: string | null = null;
    const errs: string[] = [];
    try {
      // Step 1: page insights, chunked.
      for (let i = 0; i < ids.length; i += BULK_FP_CHUNK) {
        const chunk = ids.slice(i, i + BULK_FP_CHUNK);
        const res = await fetch("/api/fanpages/insights/batch", {
          method: "POST",
          headers: { "X-Body": JSON.stringify({ ids: chunk, days: SYNC_DAYS }) },
        });
        const data = await safeJson<{
          okCount?: number;
          errCount?: number;
          skipCount?: number;
          error?: string;
          results?: Array<{ ok: boolean; error?: string; name?: string }>;
        }>(res);
        if (!res.ok || data.error) {
          if (!firstError) firstError = data.error ?? `Lỗi ${res.status}`;
          errCount += chunk.length;
          continue;
        }
        okCount += data.okCount ?? 0;
        errCount += data.errCount ?? 0;
        skipCount += data.skipCount ?? 0;
        for (const r of data.results ?? []) {
          if (!r.ok && r.error && errs.length < 2 && !errs.includes(r.error)) {
            errs.push(r.error);
          }
        }
        const freshNote =
          freshSkippedCount > 0
            ? ` (bỏ qua ${freshSkippedCount} đã sync gần đây)`
            : "";
        setSyncMsg(
          `Insight: ${Math.min(i + chunk.length, ids.length)}/${ids.length} page · ${okCount} OK · ${errCount} lỗi${freshNote}`,
        );
      }
      // Step 2: earnings, chunked. Failures here don't block the insights
      // success message — earnings often has missing-scope errors per page.
      for (let i = 0; i < ids.length; i += BULK_FP_CHUNK) {
        const chunk = ids.slice(i, i + BULK_FP_CHUNK);
        const res = await fetch("/api/fanpages/sync-earnings", {
          method: "POST",
          headers: { "X-Body": JSON.stringify({ ids: chunk, ...rangeBody }) },
        });
        const data = await safeJson<{
          monetizedCount?: number;
          totalMicros?: number;
          error?: string;
        }>(res);
        if (data.error) continue;
        monetizedCount += data.monetizedCount ?? 0;
        totalMicros += data.totalMicros ?? 0;
      }
      if (firstError) setSyncErr(firstError);
      const monetSummary =
        monetizedCount > 0
          ? ` · 💰 ${fmtUsd(totalMicros)} từ ${monetizedCount} page`
          : "";
      const freshSummary =
        freshSkippedCount > 0
          ? ` · ${freshSkippedCount} dùng dữ liệu cũ (≤30 phút)`
          : "";
      setSyncMsg(
        `Cập nhật: ${okCount} OK · ${errCount} lỗi · ${skipCount} skip${freshSummary}${monetSummary}`,
      );
      if (errCount > 0 && errs.length > 0 && !firstError) {
        setSyncErr(`Graph: ${errs.join(" | ")}`);
      }
      // Brief delay before re-reading. CF D1 has eventual consistency for
      // read replicas — without this, the immediate GET /api/fanpages can
      // hit a replica that hasn't yet seen the writes from /insights/batch,
      // returning stale (empty) insightsJson and rendering the KPI cards
      // as 0 even though the sync succeeded. 800ms covers the typical D1
      // cross-region propagation window. This was the second contributing
      // cause of "KPI=0 after sync" alongside the skip-fresh issue above.
      await new Promise((r) => setTimeout(r, 800));
      const r1 = await fetch("/api/fanpages", { cache: "no-store" });
      const d1 = await safeJson<{ rows?: FanpageRow[] }>(r1);
      setFanpages(d1.rows ?? []);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : String(e));
    } finally {
      syncingRef.current = false;
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

  // Period-aware stats for the KPI cards. `total` = sum of daily values
  // inside the user-selected window; `delta` = change vs the prior
  // equivalent-length window. Replaces the snapshot-based latest-value
  // total on the cards (which didn't change when the user picked a
  // different range).
  const periodStats = useMemo(() => {
    const out: Record<Metric, { total: number; delta: number; deltaPct: number | null }> = {
      pageImpressionsUnique: { total: 0, delta: 0, deltaPct: null },
      pageImpressions: { total: 0, delta: 0, deltaPct: null },
      pageEngagements: { total: 0, delta: 0, deltaPct: null },
      pageViews: { total: 0, delta: 0, deltaPct: null },
      pageVideoViews: { total: 0, delta: 0, deltaPct: null },
    };
    for (const m of Object.keys(out) as Metric[]) {
      const total = dailySeries[m].reduce((s, p) => s + p.v, 0);
      const prev = prevTotals[m];
      const delta = total - prev;
      const deltaPct = prev > 0 ? (delta / prev) * 100 : null;
      out[m] = { total, delta, deltaPct };
    }
    return out;
  }, [dailySeries, prevTotals]);

  // "Top page reach · Tháng này" — values are SUM of the per-day reach for
  // each fanpage in the picker window. Same data path as KPI cards
  // (`dailySeries[pageImpressionsUnique]`), so sum(top.value) === KPI Reach
  // total exactly. Locked to reach metric regardless of activeMetric tab.
  const topFanpages = useMemo(() => {
    const rows: {
      id: number;
      name: string;
      value: number;
      pictureUrl: string | null;
      link: string;
    }[] = [];
    for (const [fpIdStr, daily] of Object.entries(reachPerFp)) {
      const fpId = Number(fpIdStr);
      if (!selectedIds.has(fpId)) continue;
      const sum = daily.reduce((s, p) => s + p.v, 0);
      if (sum <= 0) continue;
      const fp = fanpages.find((f) => f.id === fpId);
      if (!fp) continue;
      const link =
        fp.link ||
        (fp.username
          ? `https://facebook.com/${fp.username}`
          : `https://facebook.com/${fp.pageId}`);
      rows.push({
        id: fpId,
        name: fp.name,
        value: sum,
        pictureUrl: fp.pictureUrl,
        link,
      });
    }
    rows.sort((a, b) => b.value - a.value);
    return rows;
  }, [reachPerFp, selectedIds, fanpages]);

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
            {syncing ? "Đang cập nhật…" : `⟳ Cập nhật reach`}
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

          {/* Bulk assign group — applies to all currently-selected fanpages.
              Fires PATCH /api/fanpages/:id with insightGroupId per row. The
              fanpages list is reloaded so the inline ● badge updates without
              a full page refresh. */}
          {selectedIds.size > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 10,
                padding: "6px 8px",
                border: "1px dashed var(--line)",
                borderRadius: 6,
                background: "var(--bg)",
              }}
            >
              <span
                className="mono"
                style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.06em" }}
              >
                Gán {selectedIds.size} →
              </span>
              <select
                value=""
                onChange={async (e) => {
                  const v = e.target.value;
                  if (!v) return;
                  e.target.value = ""; // reset for next pick
                  const targetId = v === "none" ? null : Number(v);
                  const ids = Array.from(selectedIds);
                  setSyncing(true);
                  setSyncMsg("");
                  setSyncErr("");
                  try {
                    let okCount = 0;
                    let errCount = 0;
                    for (const id of ids) {
                      const r = await fetch(`/api/fanpages/${id}`, {
                        method: "PATCH",
                        headers: { "X-Body": JSON.stringify({ insightGroupId: targetId }) },
                      });
                      if (r.ok) okCount++;
                      else errCount++;
                    }
                    setSyncMsg(
                      `Gán nhóm: ${okCount}/${ids.length} OK${errCount ? ` · ${errCount} lỗi` : ""}`,
                    );
                    // Reload fanpages so the ● badge + group filter counts refresh.
                    const r1 = await fetch("/api/fanpages", { cache: "no-store" });
                    const d1 = await safeJson<{ rows?: FanpageRow[] }>(r1);
                    setFanpages(d1.rows ?? []);
                    const r2 = await fetch("/api/insight-groups", { cache: "no-store" });
                    const d2 = await safeJson<{ groups?: GroupRow[] }>(r2);
                    setGroups(d2.groups ?? []);
                  } catch (err) {
                    setSyncErr(err instanceof Error ? err.message : String(err));
                  } finally {
                    setSyncing(false);
                  }
                }}
                disabled={syncing}
                style={{
                  flex: 1,
                  padding: "4px 6px",
                  fontSize: 11,
                  fontFamily: "inherit",
                  background: "var(--paper)",
                  border: "1px solid var(--line)",
                  borderRadius: 4,
                  color: "var(--ink)",
                  cursor: syncing ? "wait" : "pointer",
                }}
              >
                <option value="">— Chọn nhóm —</option>
                <option value="none">Chưa nhóm (bỏ gán)</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          )}
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
              const s = periodStats[m];
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
                  opacity: syncing ? 0.55 : 1,
                  transition: "opacity 0.18s ease",
                }}
                title={syncing ? "Đang đồng bộ doanh thu cho range đã chọn…" : undefined}
              >
                {fmtUsd(earningsStats.totalMicros)}
                {syncing && (
                  <span
                    className="mono"
                    style={{
                      marginLeft: 6,
                      fontSize: 10,
                      color: "var(--muted)",
                      fontWeight: 400,
                    }}
                  >
                    ↻
                  </span>
                )}
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

          {/* Range selector — dropdown trigger + popover (FB-style) */}
          <div
            ref={pickerRef}
            style={{
              position: "relative",
              marginBottom: 10,
              display: "inline-block",
            }}
          >
            <button
              onClick={() => (pickerOpen ? closePicker() : openPicker())}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 14px",
                border: "1px solid var(--line)",
                borderRadius: 8,
                background: "var(--bg)",
                color: "var(--ink)",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 500,
              }}
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
            >
              <span aria-hidden>📅</span>
              <span>{triggerLabel}</span>
              <span style={{ color: "var(--muted)", fontSize: 10 }}>▼</span>
            </button>
            {pickerOpen && (
              <DateRangePopover
                draftFrom={draftFrom}
                draftTo={draftTo}
                draftPresetKey={draftPresetKey}
                calAnchor={calAnchor}
                setCalAnchor={setCalAnchor}
                onPickPreset={pickPreset}
                onPickDay={pickCalDay}
                onCancel={closePicker}
                onApply={applyDraft}
              />
            )}
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
                Top page reach · Tháng này
              </div>
              {topFanpages.length === 0 && (
                <div className="mono" style={{ fontSize: 10, color: "var(--muted)", padding: 12 }}>
                  Chưa có dữ liệu
                </div>
              )}
              {topFanpages.map((fp, i) => {
                // Percentage relative to the locked reach metric total (not
                // active.total which follows whatever tab the user picked).
                const reachTotal = metricStats.pageImpressionsUnique.total;
                const pct = reachTotal > 0 ? (fp.value / reachTotal) * 100 : 0;
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
                          background: METRIC_DEFS.pageImpressionsUnique.color,
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

// ────────────────────────────────────────────────────────────────
// Date range picker (popover with preset list + 2-month calendar)
// ────────────────────────────────────────────────────────────────

const VN_DOW = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;

function DateRangePopover({
  draftFrom,
  draftTo,
  draftPresetKey,
  calAnchor,
  setCalAnchor,
  onPickPreset,
  onPickDay,
  onCancel,
  onApply,
}: {
  draftFrom: Date | null;
  draftTo: Date | null;
  draftPresetKey: string | null;
  calAnchor: Date;
  setCalAnchor: (d: Date) => void;
  onPickPreset: (key: string) => void;
  onPickDay: (d: Date) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const leftMonth = calAnchor;
  const rightMonth = addMonths(calAnchor, 1);
  const today = startOfDay(new Date());
  const canApply = !!(draftFrom && draftTo);
  const fromIsBeforeTo =
    draftFrom && draftTo && draftFrom.getTime() <= draftTo.getTime();
  const [normFrom, normTo] = fromIsBeforeTo
    ? [draftFrom, draftTo]
    : draftFrom && draftTo
      ? [draftTo, draftFrom]
      : [draftFrom, draftTo];

  return (
    <div
      role="dialog"
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        zIndex: 50,
        display: "grid",
        gridTemplateColumns: "180px 1fr",
        gap: 0,
        background: "var(--paper)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.16)",
        minWidth: 640,
      }}
    >
      {/* Preset list (left column) */}
      <ul
        style={{
          margin: 0,
          padding: "8px 4px",
          listStyle: "none",
          borderRight: "1px solid var(--line)",
        }}
      >
        {RANGE_PRESETS.map((p) => {
          const on = draftPresetKey === p.key;
          return (
            <li key={p.key}>
              <button
                onClick={() => onPickPreset(p.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "7px 10px",
                  background: on ? "rgba(94,106,210,0.10)" : "transparent",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  color: "var(--ink)",
                  fontFamily: "inherit",
                  fontSize: 12,
                  textAlign: "left",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 999,
                    border: on ? "4px solid var(--accent, #1877f2)" : "1px solid var(--line)",
                    background: on ? "var(--paper)" : "transparent",
                    flexShrink: 0,
                  }}
                />
                {p.label}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Calendars (right column) */}
      <div style={{ padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <CalendarPane
            month={leftMonth}
            from={normFrom}
            to={normTo}
            maxDate={today}
            onPick={onPickDay}
            onPrev={() => setCalAnchor(addMonths(calAnchor, -1))}
            onNext={null}
            showPrev
            showNext={false}
          />
          <CalendarPane
            month={rightMonth}
            from={normFrom}
            to={normTo}
            maxDate={today}
            onPick={onPickDay}
            onPrev={null}
            onNext={() => setCalAnchor(addMonths(calAnchor, 1))}
            showPrev={false}
            showNext
          />
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 14,
            paddingTop: 10,
            borderTop: "1px solid var(--line)",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--ink)" }}>
            {normFrom && normTo
              ? `${fmtVnDay(normFrom)} - ${fmtVnDay(normTo)}`
              : normFrom
                ? `${fmtVnDay(normFrom)} - chọn ngày kết thúc…`
                : "Chọn ngày bắt đầu…"}
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={onCancel}
            style={{
              padding: "6px 14px",
              border: "1px solid var(--line)",
              borderRadius: 6,
              background: "transparent",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12,
              color: "var(--ink)",
            }}
          >
            Hủy
          </button>
          <button
            onClick={onApply}
            disabled={!canApply}
            style={{
              padding: "6px 16px",
              border: "1px solid var(--accent, #1877f2)",
              borderRadius: 6,
              background: canApply ? "var(--accent, #1877f2)" : "var(--line)",
              color: canApply ? "var(--paper, #fff)" : "var(--muted)",
              cursor: canApply ? "pointer" : "not-allowed",
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Cập nhật
          </button>
        </div>
      </div>
    </div>
  );
}

function CalendarPane({
  month,
  from,
  to,
  maxDate,
  onPick,
  onPrev,
  onNext,
  showPrev,
  showNext,
}: {
  month: Date;
  from: Date | null;
  to: Date | null;
  /** Cells strictly after this date render as disabled (cannot select future). */
  maxDate: Date;
  onPick: (d: Date) => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  showPrev: boolean;
  showNext: boolean;
}) {
  // Build the day grid for the given month. Leading days (before the 1st)
  // and trailing days (after month-end, padding to a full week row) render
  // as empty placeholders — caller asked NOT to bleed adjacent months.
  const first = startOfMonth(month);
  const lead = first.getDay(); // 0..6 (Sun-first)
  const last = endOfMonth(month);
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++)
    cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  const fromMs = from ? from.getTime() : null;
  const toMs = to ? to.getTime() : null;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <button
          onClick={() => onPrev?.()}
          disabled={!showPrev || !onPrev}
          style={{
            visibility: showPrev ? "visible" : "hidden",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 16,
            color: "var(--ink)",
            padding: 4,
          }}
          aria-label="Tháng trước"
        >
          ‹
        </button>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
          Tháng {month.getMonth() + 1} {month.getFullYear()}
        </div>
        <button
          onClick={() => onNext?.()}
          disabled={!showNext || !onNext}
          style={{
            visibility: showNext ? "visible" : "hidden",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 16,
            color: "var(--ink)",
            padding: 4,
          }}
          aria-label="Tháng sau"
        >
          ›
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 2,
          fontSize: 11,
        }}
      >
        {VN_DOW.map((d) => (
          <div
            key={d}
            style={{
              textAlign: "center",
              color: "var(--muted)",
              padding: "4px 0",
              fontWeight: 600,
            }}
          >
            {d}
          </div>
        ))}
        {cells.map((c, i) => {
          if (!c) return <div key={i} />;
          const ms = startOfDay(c).getTime();
          const isFuture = ms > maxDate.getTime();
          const isStart = fromMs === ms;
          const isEnd = toMs === ms;
          const inRange =
            fromMs !== null && toMs !== null && ms > fromMs && ms < toMs;
          const isEdge = isStart || isEnd;
          return (
            <button
              key={i}
              onClick={() => !isFuture && onPick(startOfDay(c))}
              disabled={isFuture}
              aria-disabled={isFuture}
              title={isFuture ? "Không thể xem ngày tương lai" : undefined}
              style={{
                padding: "6px 0",
                border: "none",
                borderRadius: isEdge
                  ? isStart && isEnd
                    ? 6
                    : isStart
                      ? "6px 0 0 6px"
                      : "0 6px 6px 0"
                  : 0,
                background: isEdge
                  ? "var(--accent, #1877f2)"
                  : inRange
                    ? "rgba(24,119,242,0.16)"
                    : "transparent",
                color: isFuture
                  ? "var(--muted)"
                  : isEdge
                    ? "#fff"
                    : "var(--ink)",
                cursor: isFuture ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                fontSize: 11,
                fontWeight: isEdge ? 700 : 400,
                // Future cells stay readable (muted ink) but visually
                // dimmed so user can still see which dates exist; cell
                // becomes clickable as soon as the day arrives.
                opacity: isFuture ? 0.55 : 1,
              }}
            >
              {c.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
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
