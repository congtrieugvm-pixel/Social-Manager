"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";

// "Kiếm tiền" tab of Insight: Meta's "Kiếm tiền từ nội dung — Tiêu chí của
// danh sách chờ" checklist for every page, read with the Insight tokens (see
// lib/page-monetization.ts for what each criterion maps to). Country and age
// can't be read through the API, and neither can the invitation itself —
// each row links to Business Suite for that.

interface Page {
  id: string;
  name: string;
  tokenIds: number[];
}

interface Group {
  id: number;
  name: string;
  color: string;
}

type CriterionKey = "reels" | "country" | "followers" | "pageAge" | "views" | "age18";

interface Criterion {
  key: CriterionKey;
  label: string;
  met: boolean | null;
  value: string | null;
  note?: string;
}

interface Monet {
  via: string | null;
  followers: number | null;
  reels90: number | null;
  views28: number | null;
  pageOlderThan30: boolean | null;
  country: string | null;
  criteria: Criterion[];
  met: number;
  measurable: number;
  earnings90: { micros: number; currency: string | null; days: number } | null;
  watchMinutes60: number | null;
  newFollowers28: number | null;
  missing: string[];
  unsupported?: boolean;
  reason?: string;
}

type RowState = { status: "loading" } | { status: "ok"; data: Monet } | { status: "error"; error: string; cooling?: boolean };

type Category = "earning" | "full" | "miss1" | "miss2" | "error" | "loading";

const CATS: Array<{ key: Category; label: string; color: string; hint: string }> = [
  { key: "earning", label: "Đang kiếm tiền", color: "var(--good)", hint: "Có thu nhập Kiếm tiền từ nội dung trong 90 ngày" },
  { key: "full", label: "Đủ 4/4 tiêu chí", color: "var(--accent)", hint: "Đạt cả 4 tiêu chí đo được của danh sách chờ — vào Business Suite xem lời mời" },
  { key: "miss1", label: "Thiếu 1 tiêu chí", color: "var(--warn)", hint: "Đạt 3/4 tiêu chí đo được" },
  { key: "miss2", label: "Thiếu 2+ tiêu chí", color: "var(--muted)", hint: "Đạt 2/4 tiêu chí trở xuống" },
  { key: "error", label: "Không đọc được", color: "var(--danger)", hint: "Thiếu quyền, token bị giới hạn hoặc lỗi Graph" },
];

const MISSING_FILTERS: Array<{ key: CriterionKey; label: string }> = [
  { key: "followers", label: "Thiếu người theo dõi" },
  { key: "views", label: "Thiếu lượt xem 28 ngày" },
  { key: "reels", label: "Thiếu thước phim 90 ngày" },
  { key: "pageAge", label: "Trang chưa đủ 30 ngày" },
];

const TARGET = { followers: 10_000, views28: 150_000, reels90: 3 };
const CONCURRENCY = 8;
// Saved results older than this are refreshed automatically.
const STALE_MS = 2 * 60 * 60_000;

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("vi-VN"));
const smallBtn = { padding: "5px 10px", fontSize: 11 } as const;

function money(e: Monet["earnings90"]): string {
  if (!e) return "—";
  const v = e.micros / 1_000_000;
  return `${v.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${e.currency ?? "USD"}`;
}

/** Business Suite monetization page for one Page (where invitations show). */
function monetizationUrl(pageId: string) {
  return `https://business.facebook.com/latest/monetization?asset_id=${pageId}`;
}

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/** ✓ / ✗ / ? mark in the waitlist style. */
function Mark({ met }: { met: boolean | null }) {
  if (met === true) return <span className="monet-mark ok" aria-label="Đạt">✓</span>;
  if (met === false) return <span className="monet-mark no" aria-label="Chưa đạt">✗</span>;
  return <span className="monet-mark unk" aria-label="Không đọc được">?</span>;
}

function Bar({ value, target }: { value: number | null; target: number }) {
  const ratio = value == null ? 0 : Math.min(1, value / target);
  const met = value != null && value >= target;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 3, alignItems: "flex-end" }}>
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <span className="insight-num" style={{ fontSize: 12 }}>
          {fmt(value)}
        </span>
        {value != null && <Mark met={met} />}
      </span>
      <span
        title={`${Math.round(ratio * 100)}% của ${target.toLocaleString("vi-VN")}`}
        style={{ width: 84, height: 4, borderRadius: 2, background: "var(--bg-3)", overflow: "hidden" }}
      >
        <span style={{ display: "block", width: `${ratio * 100}%`, height: "100%", background: met ? "var(--good)" : "var(--accent)" }} />
      </span>
    </span>
  );
}

/** The expanded row: Meta's "Kiếm tiền từ nội dung" waitlist card. */
function WaitlistCard({ page, data }: { page: Page; data: Monet }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="monet-card">
      <div className="monet-card-head">
        <div className="monet-card-icon" aria-hidden>
          <span />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="monet-card-title">Kiếm tiền từ nội dung</div>
          <div className="monet-card-text">
            {(data.earnings90?.micros ?? 0) > 0
              ? `Trang đang có thu nhập: ${money(data.earnings90)} trong 90 ngày (${data.earnings90!.days} ngày có tiền).`
              : "Chương trình này hiện chỉ dành cho người được mời. Việc đáp ứng tiêu chí của danh sách chờ không đảm bảo quyền tham gia chương trình."}
          </div>
          <button className="monet-card-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            Tiêu chí của danh sách chờ {open ? "▼" : "▶"}
          </button>
          {open && (
            <ul className="monet-criteria">
              {data.criteria.map((c) => (
                <li key={c.key}>
                  <Mark met={c.met} />
                  <span>
                    <span className={c.met === false ? "monet-crit-label miss" : "monet-crit-label"}>{c.label}</span>
                    {c.value && <span className="monet-crit-value"> — {c.value}</span>}
                    {c.met === null && c.note && <span className="monet-crit-note">{c.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="monet-card-side">
          <div>{(data.earnings90?.micros ?? 0) > 0 ? "Đang kiếm tiền" : "Chỉ dành cho người được mời"}</div>
          <a href={monetizationUrl(page.id)} target="_blank" rel="noreferrer" className="btn" style={{ ...smallBtn, textDecoration: "none", marginTop: 8 }}>
            Xem lời mời trong Business Suite ↗
          </a>
        </div>
      </div>
    </div>
  );
}

export function MonetizationTab({
  pages,
  groups,
  assignments,
}: {
  pages: Page[];
  groups: Group[];
  assignments: Record<string, number>;
  username?: string | null;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [savedAt, setSavedAt] = useState<Record<string, number>>({}); // page id → fetched (unix s)
  const [booted, setBooted] = useState(false);
  const savedAtRef = useRef(savedAt);
  savedAtRef.current = savedAt;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const loadingRef = useRef(false);
  const lastFullRef = useRef(0);
  const runRef = useRef(0);
  const [cat, setCat] = useState<Category | "all">("all");
  const [missingKey, setMissingKey] = useState<CriterionKey | "">("");
  const [group, setGroup] = useState<"all" | "none" | number>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: "name" | "met" | "followers" | "views" | "reels" | "earn"; dir: 1 | -1 }>({ key: "met", dir: -1 });

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const groupOf = (id: string) => (assignments[id] ? groupById.get(assignments[id]) ?? null : null);
  const scoped = useMemo(
    () =>
      pages.filter((p) => {
        const gid = assignments[p.id];
        const inGroup = gid !== undefined && groupById.has(gid);
        if (group === "none") return !inGroup;
        if (typeof group === "number") return gid === group;
        return true;
      }),
    [pages, assignments, groupById, group],
  );

  // Saved results show instantly (no Graph call). Graph is read for pages
  // without a snapshot, when results are older than 2 hours (re-checked every
  // 5 minutes while open), or on "Load kiếm tiền". Answers are saved server-side.
  async function fetchMonet(list: Page[]) {
    if (list.length === 0 || loadingRef.current) return;
    loadingRef.current = true;
    const run = ++runRef.current;
    setRows((prev) => {
      const next = { ...prev };
      for (const p of list) if (next[p.id]?.status !== "ok") next[p.id] = { status: "loading" };
      return next;
    });
    let done = 0;
    setProgress({ done: 0, total: list.length });
    const pending: Record<string, RowState> = {};
    const pendingAt: Record<string, number> = {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const batch = { ...pending };
      const at = { ...pendingAt };
      for (const k of Object.keys(pending)) delete pending[k];
      for (const k of Object.keys(pendingAt)) delete pendingAt[k];
      // A failed refresh keeps the last good numbers.
      if (Object.keys(batch).length) {
        setRows((prev) => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(batch)) if (!(v.status === "error" && prev[k]?.status === "ok")) next[k] = v;
          return next;
        });
      }
      if (Object.keys(at).length) setSavedAt((prev) => ({ ...prev, ...at }));
      if (runRef.current === run) setProgress({ done, total: list.length });
    };
    try {
      await runPool(list, CONCURRENCY, async (p) => {
        let state: RowState;
        try {
          const res = await fetch(`/api/insight/monetization?pageId=${p.id}&tokens=${p.tokenIds.join(",")}`, { cache: "no-store" });
          const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          if (res.ok && !data.error) {
            state = { status: "ok", data };
            pendingAt[p.id] = Math.floor(Date.now() / 1000);
          } else state = { status: "error", error: data.error ?? `HTTP ${res.status}`, cooling: !!data.cooling };
        } catch (e) {
          state = { status: "error", error: e instanceof Error ? e.message : String(e) };
        }
        // Buffer results and repaint at most every 150 ms (smooth on phones).
        pending[p.id] = state;
        done++;
        if (!timer) timer = setTimeout(flush, 150);
      });
    } finally {
      if (timer) clearTimeout(timer);
      flush();
      if (runRef.current === run) setProgress(null);
      loadingRef.current = false;
    }
  }

  function isStale(): boolean {
    if (Date.now() - lastFullRef.current < STALE_MS) return false;
    const times = Object.values(savedAtRef.current);
    return times.length > 0 && Date.now() / 1000 - Math.min(...times) > STALE_MS / 1000;
  }

  async function loadAll() {
    lastFullRef.current = Date.now();
    await fetchMonet(pagesRef.current);
  }

  // Saved snapshots first.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/insight/snapshots?kind=monet", { cache: "no-store" });
        const data = (await res.json()) as { items?: Record<string, { data: Monet; fetchedAt: number }> };
        const saved: Record<string, RowState> = {};
        const at: Record<string, number> = {};
        for (const [pid, v] of Object.entries(data.items ?? {})) {
          saved[pid] = { status: "ok", data: v.data };
          at[pid] = v.fetchedAt;
        }
        setRows(saved);
        setSavedAt(at);
      } catch {
        // no snapshots — everything will be fetched
      }
      setBooted(true);
    })();
  }, []);

  // Then only what's missing, or everything when stale.
  const pagesKey = pages.map((p) => p.id).join(",");
  useEffect(() => {
    if (!booted || pages.length === 0) return;
    if (isStale()) {
      loadAll();
      return;
    }
    fetchMonet(pages.filter((p) => !savedAtRef.current[p.id]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, pagesKey]);

  // Auto-refresh every 2 hours while open.
  useEffect(() => {
    if (!booted) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && isStale()) loadAll();
    }, 5 * 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted]);


  function categorize(s: RowState | undefined): Category {
    if (!s || s.status === "loading") return "loading";
    if (s.status === "error" || s.data.unsupported) return "error";
    if ((s.data.earnings90?.micros ?? 0) > 0) return "earning";
    const missingCount = s.data.measurable - s.data.met;
    if (missingCount <= 0) return "full";
    if (missingCount === 1) return "miss1";
    return "miss2";
  }

  const all = scoped.map((p) => {
    const s = rows[p.id];
    return { page: p, state: s, data: s?.status === "ok" ? s.data : null, cat: categorize(s), group: groupOf(p.id) };
  });
  const counts: Record<string, number> = {};
  for (const r of all) counts[r.cat] = (counts[r.cat] ?? 0) + 1;
  const missingCounts: Record<string, number> = {};
  for (const r of all) for (const c of r.data?.criteria ?? []) if (c.met === false) missingCounts[c.key] = (missingCounts[c.key] ?? 0) + 1;

  const term = search.trim().toLowerCase();
  const list = all
    .filter(
      (r) =>
        (cat === "all" || r.cat === cat) &&
        (!missingKey || r.data?.criteria.some((c) => c.key === missingKey && c.met === false)) &&
        (!term || r.page.name.toLowerCase().includes(term) || r.page.id.includes(term)),
    )
    .sort((a, b) => {
      const v = (r: (typeof all)[number]): number | string | null => {
        switch (sort.key) {
          case "name":
            return r.page.name;
          case "met":
            return r.data && !r.data.unsupported ? r.data.met * 1e12 + (r.data.views28 ?? 0) : null;
          case "followers":
            return r.data?.followers ?? null;
          case "views":
            return r.data?.views28 ?? null;
          case "reels":
            return r.data?.reels90 ?? null;
          case "earn":
            return r.data?.earnings90?.micros ?? null;
        }
      };
      const va = v(a);
      const vb = v(b);
      if (va == null && vb == null) return a.page.name.localeCompare(b.page.name, "vi");
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sort.dir;
      return String(va).localeCompare(String(vb), "vi") * sort.dir;
    });

  function th(key: typeof sort.key, label: string, right = true) {
    const active = sort.key === key;
    return (
      <th
        className={right ? "right" : ""}
        style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
        onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 }))}
        aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
      >
        {label}
        {active ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportCsv() {
    const esc = (v: string | number | null) => {
      const s = v == null ? "" : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const yn = (m: boolean | null | undefined) => (m === true ? "Đạt" : m === false ? "Chưa đạt" : "Tự kiểm tra");
    const crit = (r: (typeof all)[number], k: CriterionKey) => yn(r.data?.criteria.find((c) => c.key === k)?.met);
    const head = [
      "Trang", "Page ID", "Nhóm", "Phân loại", "Đạt tiêu chí", "Thước phim 90 ngày", "TC thước phim", "Người theo dõi", "TC người theo dõi",
      "Lượt xem riêng biệt 28 ngày", "TC lượt xem", "TC Trang ≥30 ngày", "Quốc gia (địa chỉ Trang)", "Thu nhập 90 ngày", "Tiền tệ",
    ];
    const lines = list.map((r) =>
      [
        r.page.name,
        r.page.id,
        r.group?.name ?? "",
        CATS.find((c) => c.key === r.cat)?.label ?? "Đang tải",
        r.data && !r.data.unsupported ? `${r.data.met}/${r.data.measurable}` : null,
        r.data?.reels90 ?? null,
        crit(r, "reels"),
        r.data?.followers ?? null,
        crit(r, "followers"),
        r.data?.views28 ?? null,
        crit(r, "views"),
        crit(r, "pageAge"),
        r.data?.country ?? null,
        r.data?.earnings90 ? (r.data.earnings90.micros / 1_000_000).toFixed(2) : null,
        r.data?.earnings90?.currency ?? null,
      ]
        .map(esc)
        .join(","),
    );
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `insight-kiem-tien-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  if (pages.length === 0) {
    return (
      <div className="card" style={{ color: "var(--muted)" }}>
        Chưa có Trang nào — thêm token ở tab Quản lý token.
      </div>
    );
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 16, padding: "12px 14px", fontSize: 12, lineHeight: 1.6, color: "var(--muted)" }}>
        Kiểm tra theo <b style={{ color: "var(--ink-soft)" }}>Tiêu chí của danh sách chờ “Kiếm tiền từ nội dung”</b> của Meta. 4 tiêu chí đọc
        được qua API (thước phim, người theo dõi, Trang ≥30 ngày, lượt xem 28 ngày); <b style={{ color: "var(--ink-soft)" }}>quốc gia cư trú, tuổi
        và lời mời</b> không có trong API — bấm vào Trang để xem chi tiết, hoặc nút <b style={{ color: "var(--ink-soft)" }}>Kiếm tiền ↗</b> để mở
        Business Suite.
      </div>

      <div className="kpi-grid insight-monet-kpis">
        {CATS.map((c) => (
          <button
            key={c.key}
            className={`kpi insight-monet-kpi${cat === c.key ? " active" : ""}`}
            onClick={() => setCat(cat === c.key ? "all" : c.key)}
            aria-pressed={cat === c.key}
            title={c.hint}
          >
            <span className="kpi-label">
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.color }} />
              {c.label}
            </span>
            <span className="kpi-num insight-num">{counts[c.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input
          className="input"
          placeholder="Tìm Trang theo tên hoặc ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: "1 1 200px", maxWidth: 280 }}
        />
        <select
          className="input"
          aria-label="Lọc tiêu chí còn thiếu"
          value={missingKey}
          onChange={(e) => setMissingKey(e.target.value as CriterionKey | "")}
          style={{ padding: "4px 8px", fontSize: 12, width: "auto" }}
        >
          <option value="">Mọi tiêu chí</option>
          {MISSING_FILTERS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label} ({missingCounts[f.key] ?? 0})
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Lọc nhóm"
          value={String(group)}
          onChange={(e) => setGroup(e.target.value === "all" || e.target.value === "none" ? e.target.value : Number(e.target.value))}
          style={{ padding: "4px 8px", fontSize: 12, width: "auto", maxWidth: 200 }}
        >
          <option value="all">Tất cả nhóm ({pages.length})</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value="none">Chưa phân nhóm</option>
        </select>
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
          {list.length} Trang{progress ? ` · Đang kiểm tra ${progress.done}/${progress.total}…` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="btn"
          style={smallBtn}
          disabled={!!progress}
          onClick={() => loadAll()}
          title="Đọc lại số liệu kiếm tiền của mọi Trang từ Facebook (tự động khi số liệu cũ hơn 2 giờ)"
        >
          {progress ? `Đang tải ${progress.done}/${progress.total}…` : "⟳ Load kiếm tiền"}
        </button>
        <button className="btn" style={smallBtn} onClick={exportCsv} disabled={list.length === 0}>
          Xuất CSV
        </button>
      </div>

      <div className="table-wrap insight-table-wrap">
        <table className="table insight-monet-table">
          <thead>
            <tr>
              <th style={{ width: 26 }} />
              {th("name", "Trang", false)}
              {th("met", "Đạt")}
              {th("reels", "Thước phim 90 ngày")}
              {th("followers", "Người theo dõi")}
              {th("views", "Lượt xem 28 ngày")}
              <th className="right" style={{ whiteSpace: "nowrap" }}>
                Trang ≥30 ngày
              </th>
              {th("earn", "Thu nhập 90 ngày")}
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const c = CATS.find((x) => x.key === r.cat);
              const isOpen = expanded.has(r.page.id);
              const canOpen = !!r.data && !r.data.unsupported;
              const title = r.state?.status === "error" ? r.state.error : r.data?.unsupported ? r.data.reason : c?.hint;
              return (
                <Fragment key={r.page.id}>
                  <tr className={`monet-row${isOpen ? " selected" : ""}`} onClick={() => canOpen && toggleRow(r.page.id)} style={{ cursor: canOpen ? "pointer" : "default" }}>
                    <td style={{ color: "var(--muted)", fontSize: 11 }}>{canOpen ? (isOpen ? "▾" : "▸") : ""}</td>
                    <td style={{ maxWidth: 230 }}>
                      <span style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                        {r.group && <span title={r.group.name} style={{ width: 8, height: 8, borderRadius: "50%", background: r.group.color, flex: "none" }} />}
                        <span style={{ minWidth: 0 }}>
                          <span className="insight-ellipsis" style={{ display: "block", maxWidth: 200, color: "var(--ink)" }} title={r.page.name}>
                            {r.page.name}
                          </span>
                          <span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>
                            {r.page.id}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="right">
                      {r.cat === "loading" ? (
                        <span className="pill">Đang kiểm tra…</span>
                      ) : r.cat === "error" ? (
                        <span className="pill" title={title} style={{ color: c?.color, borderColor: "currentColor" }}>
                          {c?.label}
                        </span>
                      ) : (
                        <span title={c?.hint} style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                          <span className="insight-num" style={{ fontSize: 13, color: c?.color, fontWeight: 600 }}>
                            {r.data!.met}/{r.data!.measurable}
                          </span>
                          <span style={{ fontSize: 10, color: c?.color, whiteSpace: "nowrap" }}>{c?.label}</span>
                        </span>
                      )}
                    </td>
                    <td className="right">
                      {r.data?.reels90 != null ? (
                        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <span className="insight-num" style={{ fontSize: 12 }}>
                            {fmt(r.data.reels90)}
                            <span style={{ color: "var(--dim)" }}>/{TARGET.reels90}</span>
                          </span>
                          <Mark met={r.data.reels90 >= TARGET.reels90} />
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="right">{r.data ? <Bar value={r.data.followers} target={TARGET.followers} /> : "—"}</td>
                    <td className="right">{r.data ? <Bar value={r.data.views28} target={TARGET.views28} /> : "—"}</td>
                    <td className="right">{r.data && r.data.pageOlderThan30 !== null ? <Mark met={r.data.pageOlderThan30} /> : "—"}</td>
                    <td className="right insight-num" style={{ fontSize: 12, color: (r.data?.earnings90?.micros ?? 0) > 0 ? "var(--good)" : undefined }}>
                      {money(r.data?.earnings90 ?? null)}
                    </td>
                    <td className="right">
                      <a
                        href={monetizationUrl(r.page.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn"
                        onClick={(e) => e.stopPropagation()}
                        style={{ padding: "3px 8px", fontSize: 10, textDecoration: "none", whiteSpace: "nowrap" }}
                        title="Mở mục Kiếm tiền của Trang trong Meta Business Suite (xem lời mời)"
                      >
                        Kiếm tiền ↗
                      </a>
                    </td>
                  </tr>
                  {isOpen && r.data && (
                    <tr className="monet-detail">
                      <td colSpan={9}>
                        <WaitlistCard page={r.page} data={r.data} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
