"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BarChart, Sparkline, ddmm, type DayPoint } from "./charts";

type Range = "today" | "7d" | "28d";

const RANGES: Array<{ key: Range; label: string }> = [
  { key: "today", label: "Hôm nay" },
  { key: "7d", label: "7 ngày" },
  { key: "28d", label: "28 ngày" },
];

interface Account {
  id: number;
  label: string;
  groupId: number | null;
}

interface Group {
  id: number;
  name: string;
  color: string;
}

interface Page {
  id: string;
  name: string;
  accountIds: number[];
  groupIds: number[];
}

interface Reach {
  range: Range;
  metric: string | null;
  reach: number | null;
  prev: number | null;
  daily: DayPoint[];
  via: string | null;
  todayPending?: boolean;
  unsupported?: boolean;
  reason?: string;
}

type RowState =
  | { status: "loading" }
  | { status: "ok"; data: Reach }
  | { status: "error"; error: string; cooling?: boolean };

type SortKey = "name" | "reach" | "change" | "metric" | "via" | "status";

const PAGE_CONCURRENCY = 6;
const ACCOUNT_CONCURRENCY = 4;
const CACHE_MS = 3 * 60_000;

// Client cache of reach answers (per page + range), 3 minutes. "Tải lại"
// bypasses it. Module-level so it survives navigating away and back.
const reachCache = new Map<string, { at: number; data: Reach }>();

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function getJson<T>(url: string): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    let data: T & { error?: string };
    try {
      data = text ? JSON.parse(text) : ({ error: `HTTP ${res.status} (không có nội dung)` } as T & { error?: string });
    } catch {
      data = { error: `HTTP ${res.status}: phản hồi không phải JSON` } as T & { error?: string };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: { error: `Lỗi kết nối: ${e instanceof Error ? e.message : String(e)}` } as T & { error?: string },
    };
  }
}

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("vi-VN"));

function pct(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

/** "+3.2%" / "−1.0%" / "0.0%" and its color; changes that round to 0 stay neutral. */
function changeView(p: number | null): { text: string; color: string } {
  if (p == null) return { text: "—", color: "var(--dim)" };
  if (Math.abs(p) < 0.05) return { text: "0.0%", color: "var(--muted)" };
  return p > 0
    ? { text: `+${p.toFixed(1)}%`, color: "var(--good)" }
    : { text: `−${Math.abs(p).toFixed(1)}%`, color: "var(--danger)" };
}

function statusOf(s: RowState | undefined): { label: string; tone: "ok" | "err" | "muted"; title?: string } {
  if (!s || s.status === "loading") return { label: "Đang tải…", tone: "muted" };
  if (s.status === "error") {
    return s.cooling
      ? { label: "Bị giới hạn", tone: "err", title: s.error }
      : { label: "Lỗi", tone: "err", title: s.error };
  }
  if (s.data.unsupported) return { label: "Không hỗ trợ", tone: "err", title: s.data.reason };
  if (s.data.todayPending) {
    return { label: "Chưa có số", tone: "muted", title: "Facebook chưa cập nhật số liệu hôm nay" };
  }
  return { label: "OK", tone: "ok" };
}

function PageAvatar({ page, color }: { page: Page; color: string | null }) {
  const [broken, setBroken] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", flex: "none" }}>
      {broken ? (
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "var(--bg-3)",
            color: "var(--muted)",
            fontSize: 11,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {page.name.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://graph.facebook.com/${page.id}/picture?type=square`}
          alt=""
          width={24}
          height={24}
          loading="lazy"
          onError={() => setBroken(true)}
          style={{ borderRadius: "50%", display: "block" }}
        />
      )}
      {color && (
        <span
          title="Màu nhóm"
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: color,
            border: "2px solid var(--paper)",
          }}
        />
      )}
    </span>
  );
}

export default function InsightPage() {
  const [username, setUsername] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [pagesProgress, setPagesProgress] = useState<{ done: number; total: number } | null>(null);
  const [accountErrors, setAccountErrors] = useState<Array<{ label: string; error: string }>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [scope, setScope] = useState<"all" | number>("all");
  const [selected, setSelected] = useState<Set<string> | null>(null); // null = all in scope
  const [range, setRange] = useState<Range>("7d");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "reach", dir: "desc" });
  const freshRef = useRef(false);
  const runRef = useRef(0);

  const storageKey = username ? `rmf_insight_${username}` : null;

  // --- bootstrap: user, accounts, then each account's pages -----------------
  useEffect(() => {
    let alive = true;
    (async () => {
      const me = await getJson<{ user: { username: string } | null }>("/api/auth/me");
      if (alive && me.data.user) setUsername(me.data.user.username);
      const acc = await getJson<{ accounts: Account[]; groups: Group[] }>("/api/insight/accounts");
      if (!alive) return;
      if (!acc.ok || acc.data.error) {
        setLoadError(acc.data.error ?? `Lỗi ${acc.status}`);
        setAccounts([]);
        return;
      }
      setAccounts(acc.data.accounts);
      setGroups(acc.data.groups);

      const byId = new Map<string, Page>();
      const errors: Array<{ label: string; error: string }> = [];
      let done = 0;
      setPagesProgress({ done: 0, total: acc.data.accounts.length });
      await runPool(acc.data.accounts, ACCOUNT_CONCURRENCY, async (a) => {
        const r = await getJson<{ pages: Array<{ id: string; name: string }> }>(
          `/api/insight/accounts/${a.id}/pages`,
        );
        if (r.ok && r.data.pages) {
          for (const p of r.data.pages) {
            const cur = byId.get(p.id) ?? { id: p.id, name: p.name, accountIds: [], groupIds: [] };
            if (!cur.accountIds.includes(a.id)) cur.accountIds.push(a.id);
            if (a.groupId != null && !cur.groupIds.includes(a.groupId)) cur.groupIds.push(a.groupId);
            byId.set(p.id, cur);
          }
        } else {
          errors.push({ label: a.label, error: r.data.error ?? `Lỗi ${r.status}` });
        }
        done++;
        if (alive) setPagesProgress({ done, total: acc.data.accounts.length });
      });
      if (!alive) return;
      setPages([...byId.values()].sort((x, y) => x.name.localeCompare(y.name, "vi")));
      setAccountErrors(errors);
      setPagesProgress(null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // --- remembered range, per user -------------------------------------------
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as { range?: Range };
      if (saved.range && RANGES.some((r) => r.key === saved.range)) setRange(saved.range);
    } catch {
      // storage unavailable — keep default
    }
  }, [storageKey]);

  function chooseRange(r: Range) {
    setRange(r);
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ range: r }));
    } catch {
      // ignore
    }
  }

  // --- scope + selection ----------------------------------------------------
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const scopeGroups = useMemo(
    () => groups.filter((g) => pages.some((p) => p.groupIds.includes(g.id))),
    [groups, pages],
  );
  const scopedPages = useMemo(
    () => (scope === "all" ? pages : pages.filter((p) => p.groupIds.includes(scope))),
    [pages, scope],
  );
  const chosenPages = useMemo(
    () => (selected ? scopedPages.filter((p) => selected.has(p.id)) : scopedPages),
    [scopedPages, selected],
  );
  const chosenKey = chosenPages.map((p) => p.id).join(",");

  // --- load reach (≤ 6 pages in flight) -------------------------------------
  useEffect(() => {
    if (chosenPages.length === 0) {
      setProgress(null);
      return;
    }
    const run = ++runRef.current;
    const fresh = freshRef.current;
    freshRef.current = false;
    const now = Date.now();
    const initial: Record<string, RowState> = {};
    const queue: Page[] = [];
    for (const p of chosenPages) {
      const hit = reachCache.get(`${p.id}:${range}`);
      if (!fresh && hit && now - hit.at < CACHE_MS) initial[p.id] = { status: "ok", data: hit.data };
      else {
        initial[p.id] = { status: "loading" };
        queue.push(p);
      }
    }
    setRows(initial);
    if (queue.length === 0) {
      setProgress(null);
      return;
    }
    let done = 0;
    setProgress({ done: 0, total: queue.length });
    runPool(queue, PAGE_CONCURRENCY, async (p) => {
      if (runRef.current !== run) return;
      const r = await getJson<Reach & { cooling?: boolean }>(
        `/api/insight/reach?pageId=${p.id}&range=${range}&accounts=${p.accountIds.join(",")}`,
      );
      if (runRef.current !== run) return;
      let state: RowState;
      if (r.ok && !r.data.error) {
        reachCache.set(`${p.id}:${range}`, { at: Date.now(), data: r.data });
        state = { status: "ok", data: r.data };
      } else {
        state = { status: "error", error: r.data.error ?? `Lỗi ${r.status}`, cooling: !!r.data.cooling };
      }
      done++;
      setRows((prev) => ({ ...prev, [p.id]: state }));
      setProgress({ done, total: queue.length });
    }).then(() => {
      if (runRef.current === run) setProgress(null);
    });
    // chosenKey stands in for chosenPages (stable string identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenKey, range, reloadTick]);

  function reload() {
    freshRef.current = true;
    setReloadTick((t) => t + 1);
  }

  // --- aggregates -----------------------------------------------------------
  const okRows = chosenPages
    .map((p) => ({ page: p, state: rows[p.id] }))
    .filter((r): r is { page: Page; state: { status: "ok"; data: Reach } } => r.state?.status === "ok");
  const withReach = okRows.filter((r) => r.state.data.reach != null);
  const total = withReach.reduce((a, r) => a + (r.state.data.reach ?? 0), 0);
  const both = withReach.filter((r) => r.state.data.prev != null);
  const totalChange = pct(
    both.reduce((a, r) => a + (r.state.data.reach ?? 0), 0),
    both.length ? both.reduce((a, r) => a + (r.state.data.prev ?? 0), 0) : null,
  );
  const top = withReach.reduce<(typeof withReach)[number] | null>(
    (best, r) => (!best || (r.state.data.reach ?? 0) > (best.state.data.reach ?? 0) ? r : best),
    null,
  );
  const pendingToday = range === "today" && okRows.some((r) => r.state.data.todayPending);

  const chartPoints = useMemo<DayPoint[]>(() => {
    if (range === "today") return [];
    const byDate = new Map<string, number | null>();
    for (const r of okRows) {
      for (const d of r.state.data.daily) {
        const cur = byDate.get(d.date);
        if (d.value == null) {
          if (!byDate.has(d.date)) byDate.set(d.date, null);
        } else byDate.set(d.date, (cur ?? 0) + d.value);
      }
    }
    const n = range === "7d" ? 7 : 28;
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-n)
      .map(([date, value]) => ({ date, value }));
    // okRows is derived from rows + chosenPages
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, chosenKey, range]);

  // --- table ----------------------------------------------------------------
  const tableRows = useMemo(() => {
    const list = chosenPages.map((p) => {
      const state = rows[p.id];
      const data = state?.status === "ok" ? state.data : null;
      return {
        page: p,
        state,
        data,
        reach: data?.reach ?? null,
        change: data ? pct(data.reach, data.prev) : null,
        status: statusOf(state),
      };
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (r: (typeof list)[number]): string | number | null => {
      switch (sort.key) {
        case "name":
          return r.page.name;
        case "reach":
          return r.reach;
        case "change":
          return r.change;
        case "metric":
          return r.data?.metric ?? null;
        case "via":
          return r.data?.via ?? null;
        case "status":
          return r.status.label;
      }
    };
    return list.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return a.page.name.localeCompare(b.page.name, "vi");
      if (va == null) return 1; // empty values always last
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "vi") * dir;
    });
  }, [chosenPages, rows, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" },
    );
  }

  function exportCsv() {
    const esc = (v: string | number | null) => {
      const s = v == null ? "" : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ["Trang", "Page ID", "Reach", "Kỳ trước", "Thay đổi %", "Metric", "Token phục vụ", "Trạng thái"];
    const lines = tableRows.map((r) =>
      [
        r.page.name,
        r.page.id,
        r.reach,
        r.data?.prev ?? null,
        r.change == null ? null : r.change.toFixed(1),
        r.data?.metric ?? null,
        r.data?.via ?? null,
        r.status.label,
      ]
        .map(esc)
        .join(","),
    );
    // BOM so Excel opens the UTF-8 file with Vietnamese intact.
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `insight-reach-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const scopeName = scope === "all" ? "Tất cả nhóm" : groupById.get(scope)?.name ?? "Nhóm";
  const loadingPages = accounts === null || pagesProgress !== null;

  // --- render ---------------------------------------------------------------
  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <span className="eyebrow">Facebook · Lượt tiếp cận</span>
          <h1 className="h1-serif">
            Insight <em>Reach</em>
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="chip" title="Nhóm đang làm việc">
            {scopeName} · {chosenPages.length}/{scopedPages.length} Trang
          </span>
          <div className="btn-group" role="tablist" aria-label="Chọn kỳ">
            {RANGES.map((r) => (
              <button
                key={r.key}
                role="tab"
                aria-selected={range === r.key}
                className={`btn-seg${range === r.key ? " active" : ""}`}
                onClick={() => chooseRange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {loadError && (
        <div className="card" style={{ marginBottom: 24, color: "var(--danger)" }}>
          {loadError}
        </div>
      )}

      {loadingPages ? (
        <div className="card mono" style={{ color: "var(--muted)", fontSize: 12 }}>
          {pagesProgress
            ? `Đang tải danh sách Trang ${pagesProgress.done}/${pagesProgress.total} tài khoản…`
            : "Đang tải…"}
        </div>
      ) : accounts && accounts.length === 0 ? (
        <div className="card" style={{ color: "var(--muted)", lineHeight: 1.6 }}>
          Chưa có tài khoản Facebook nào có token. Thêm token ở{" "}
          <Link href="/facebook" style={{ color: "var(--accent)" }}>
            Tài khoản Facebook
          </Link>{" "}
          để xem Reach các Trang mà tài khoản đó quản lý.
        </div>
      ) : (
        <>
          <section className="section">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="section-label" style={{ marginRight: 4 }}>
                Nhóm
              </span>
              <button
                className={`btn${scope === "all" ? " btn-primary" : ""}`}
                style={{ padding: "5px 10px", fontSize: 11 }}
                onClick={() => {
                  setScope("all");
                  setSelected(null);
                }}
              >
                Tất cả ({pages.length})
              </button>
              {scopeGroups.map((g) => (
                <button
                  key={g.id}
                  className={`btn${scope === g.id ? " btn-primary" : ""}`}
                  style={{ padding: "5px 10px", fontSize: 11, display: "inline-flex", gap: 6, alignItems: "center" }}
                  onClick={() => {
                    setScope(g.id);
                    setSelected(null);
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: g.color }} />
                  {g.name} ({pages.filter((p) => p.groupIds.includes(g.id)).length})
                </button>
              ))}
              <span style={{ flex: 1 }} />
              <PageMultiselect
                pages={scopedPages}
                groups={scopeGroups}
                selected={selected}
                onChange={setSelected}
              />
              <button className="btn" style={{ padding: "5px 10px", fontSize: 11 }} onClick={reload} disabled={!!progress}>
                ↻ Tải lại
              </button>
              <button
                className="btn"
                style={{ padding: "5px 10px", fontSize: 11 }}
                onClick={exportCsv}
                disabled={tableRows.length === 0}
              >
                Xuất CSV
              </button>
            </div>
            {accountErrors.length > 0 && (
              <details style={{ marginTop: 10, fontSize: 12, color: "var(--warn)" }}>
                <summary style={{ cursor: "pointer" }}>
                  {accountErrors.length} tài khoản không tải được danh sách Trang
                </summary>
                <ul style={{ margin: "6px 0 0 18px", color: "var(--muted)" }}>
                  {accountErrors.map((e) => (
                    <li key={e.label}>
                      <b style={{ color: "var(--ink-soft)" }}>{e.label}</b>: {e.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          {scopedPages.length === 0 ? (
            <div className="card" style={{ color: "var(--muted)" }}>
              {pages.length === 0
                ? "Các tài khoản Facebook chưa quản lý Trang nào (hoặc token thiếu quyền pages_show_list)."
                : "Nhóm này chưa có Trang nào."}
            </div>
          ) : chosenPages.length === 0 ? (
            <div className="card" style={{ color: "var(--muted)" }}>Chưa chọn Trang nào.</div>
          ) : (
            <>
              {progress && (
                <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
                  Đang tải {progress.done}/{progress.total} Trang…
                </div>
              )}

              <div className="kpi-grid insight-kpis">
                <div className="kpi">
                  <span className="kpi-label">Tổng reach</span>
                  <span className="kpi-num insight-num">{withReach.length ? fmt(total) : "—"}</span>
                  <span className="kpi-sub" style={{ textTransform: "none", letterSpacing: 0 }}>
                    {pendingToday && withReach.length === 0
                      ? "Facebook chưa cập nhật số liệu hôm nay"
                      : "Cộng các Trang — người xem nhiều Trang có thể bị tính nhiều lần"}
                  </span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">Trang có dữ liệu</span>
                  <span className="kpi-num insight-num">
                    {withReach.length}
                    <span style={{ color: "var(--muted)", fontSize: "0.6em" }}>/{chosenPages.length}</span>
                  </span>
                  <span className="kpi-sub" style={{ textTransform: "none", letterSpacing: 0 }}>
                    {pendingToday ? "Có Trang Facebook chưa cập nhật số hôm nay" : "Trang trả về số reach"}
                  </span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">Reach cao nhất</span>
                  <span className="kpi-num insight-num">{top ? fmt(top.state.data.reach) : "—"}</span>
                  <span
                    className="kpi-sub"
                    style={{ textTransform: "none", letterSpacing: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={top?.page.name}
                  >
                    {top?.page.name ?? "—"}
                  </span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">So với kỳ trước</span>
                  <span
                    className="kpi-num insight-num"
                    style={{ color: totalChange == null ? undefined : changeView(totalChange).color }}
                  >
                    {changeView(totalChange).text}
                  </span>
                  <span className="kpi-sub" style={{ textTransform: "none", letterSpacing: 0 }}>
                    {range === "today" ? "so với hôm qua" : `so với ${range === "7d" ? "7" : "28"} ngày liền trước`}
                  </span>
                </div>
              </div>

              {range !== "today" && (
                <section className="section">
                  <div className="section-head">
                    <div>
                      <h2 className="h2-serif">
                        Reach <em>theo ngày</em>
                      </h2>
                      <div className="section-label" style={{ marginTop: 4 }}>
                        Tổng reach trong ngày của các Trang đã chọn · ngày theo giờ Thái Bình Dương
                      </div>
                    </div>
                  </div>
                  <div className="card" style={{ padding: "16px 18px 10px" }}>
                    {chartPoints.some((p) => p.value != null) ? (
                      <BarChart points={chartPoints} />
                    ) : (
                      <div style={{ color: "var(--muted)", fontSize: 12, padding: "24px 0" }}>
                        {progress ? "Đang tải…" : "Chưa có số liệu theo ngày."}
                      </div>
                    )}
                  </div>
                </section>
              )}

              <section className="section">
                <div className="table-wrap">
                  <table className="table insight-table">
                    <thead>
                      <tr>
                        {(
                          [
                            ["name", "Trang", ""],
                            ["reach", "Reach", "right"],
                            ["change", "Thay đổi", "right"],
                            [null, "Xu hướng", ""],
                            ["metric", "Metric", ""],
                            ["via", "Token", ""],
                            ["status", "Trạng thái", ""],
                          ] as Array<[SortKey | null, string, string]>
                        ).map(([key, label, align]) => (
                          <th
                            key={label}
                            className={align}
                            onClick={key ? () => toggleSort(key) : undefined}
                            style={{ cursor: key ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}
                            aria-sort={
                              key && sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined
                            }
                          >
                            {label}
                            {key && sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((r) => {
                        const color = r.page.groupIds.length ? groupById.get(r.page.groupIds[0])?.color ?? null : null;
                        return (
                          <tr key={r.page.id}>
                            <td style={{ maxWidth: 260 }}>
                              <span style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                                <PageAvatar page={r.page} color={color} />
                                <span style={{ minWidth: 0 }}>
                                  <span
                                    style={{ display: "block", color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                                    title={r.page.name}
                                  >
                                    {r.page.name}
                                  </span>
                                  <span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>
                                    {r.page.id}
                                  </span>
                                </span>
                              </span>
                            </td>
                            <td className="right insight-num">
                              {r.data?.todayPending ? (
                                <span title="Facebook chưa cập nhật số liệu hôm nay" style={{ color: "var(--muted)" }}>
                                  —
                                </span>
                              ) : (
                                fmt(r.reach)
                              )}
                            </td>
                            <td
                              className="right insight-num"
                              style={{ color: changeView(r.change).color }}
                            >
                              {changeView(r.change).text}
                            </td>
                            <td>{r.data && range !== "today" ? <Sparkline points={r.data.daily} /> : <span style={{ color: "var(--dim)" }}>—</span>}</td>
                            <td className="mono insight-ellipsis" style={{ fontSize: 10, color: "var(--muted)" }} title={r.data?.metric ?? ""}>
                              {r.data?.metric ?? "—"}
                            </td>
                            <td className="insight-ellipsis" style={{ fontSize: 12, color: "var(--muted)" }} title={r.data?.via ?? ""}>
                              {r.data?.via ?? "—"}
                            </td>
                            <td>
                              <span className={`pill${r.status.tone === "ok" ? " ok" : r.status.tone === "err" ? " err" : ""}`} title={r.status.title}>
                                {r.status.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {range !== "today" && (
                  <div className="section-label" style={{ marginTop: 10 }}>
                    Reach {range === "7d" ? "7" : "28"} ngày là giá trị theo kỳ do Facebook tính (period=
                    {range === "7d" ? "week" : "days_28"}), không cộng dồn theo ngày — một người xem nhiều ngày chỉ
                    tính một lần. Điểm cuối: {chartPoints.length ? ddmm(chartPoints[chartPoints.length - 1].date) : "—"}.
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}

// Dropdown checklist of pages with search + quick-select by group.
function PageMultiselect({
  pages,
  groups,
  selected,
  onChange,
}: {
  pages: Page[];
  groups: Group[];
  selected: Set<string> | null;
  onChange: (s: Set<string> | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isOn = (id: string) => (selected ? selected.has(id) : true);
  const count = selected ? pages.filter((p) => selected.has(p.id)).length : pages.length;
  const term = q.trim().toLowerCase();
  const visible = term ? pages.filter((p) => p.name.toLowerCase().includes(term) || p.id.includes(term)) : pages;

  function toggle(id: string) {
    const next = new Set(selected ?? pages.map((p) => p.id));
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next.size === pages.length ? null : next);
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="btn" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Trang: {count}/{pages.length} ▾
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            width: 320,
            maxWidth: "calc(100vw - 32px)",
            background: "var(--paper)",
            border: "1px solid var(--line-strong)",
            borderRadius: 8,
            zIndex: 30,
            padding: 10,
          }}
        >
          <input
            className="input"
            placeholder="Tìm Trang theo tên hoặc ID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            style={{ width: "100%", marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <button className="btn" style={{ padding: "3px 8px", fontSize: 10 }} onClick={() => onChange(null)}>
              Chọn tất cả
            </button>
            <button className="btn" style={{ padding: "3px 8px", fontSize: 10 }} onClick={() => onChange(new Set())}>
              Bỏ chọn
            </button>
            {groups.map((g) => (
              <button
                key={g.id}
                className="btn"
                style={{ padding: "3px 8px", fontSize: 10, display: "inline-flex", gap: 5, alignItems: "center" }}
                title={`Chỉ chọn các Trang thuộc nhóm ${g.name}`}
                onClick={() => onChange(new Set(pages.filter((p) => p.groupIds.includes(g.id)).map((p) => p.id)))}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: g.color }} />
                {g.name}
              </button>
            ))}
          </div>
          <div style={{ maxHeight: 280, overflowY: "auto", borderTop: "1px solid var(--line)" }}>
            {visible.map((p) => (
              <label
                key={p.id}
                style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 2px", fontSize: 12, cursor: "pointer" }}
              >
                <input type="checkbox" checked={isOn(p.id)} onChange={() => toggle(p.id)} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
              </label>
            ))}
            {visible.length === 0 && (
              <div style={{ color: "var(--muted)", fontSize: 12, padding: 8 }}>Không có Trang khớp.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
