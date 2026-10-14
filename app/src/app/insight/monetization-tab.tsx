"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// "Kiếm tiền" tab of Insight: per-page monetization progress read with the
// Insight tokens. Graph has no field for Content Monetization status or
// invitations (see lib/page-monetization.ts), so pages are classified from
// what IS readable — earnings > 0, followers, 60-day watch time — against
// thresholds the user sets, and each row links to Business Suite where the
// invitation itself is shown.

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

interface Monet {
  via: string | null;
  followers: number | null;
  earnings90: { micros: number; currency: string | null; days: number } | null;
  watchMinutes60: number | null;
  videoViews60: number | null;
  newFollowers28: number | null;
  missing: string[];
  unsupported?: boolean;
  reason?: string;
}

type RowState = { status: "loading" } | { status: "ok"; data: Monet } | { status: "error"; error: string; cooling?: boolean };

type Category = "earning" | "reached" | "near" | "below" | "error" | "loading";

const CATS: Array<{ key: Category; label: string; color: string; hint: string }> = [
  { key: "earning", label: "Đang kiếm tiền", color: "var(--good)", hint: "Có thu nhập Content Monetization trong 90 ngày" },
  { key: "reached", label: "Đạt ngưỡng", color: "var(--accent)", hint: "Đạt cả ngưỡng người theo dõi và phút xem — nên vào Business Suite xem lời mời" },
  { key: "near", label: "Gần đạt", color: "var(--warn)", hint: "Đạt ít nhất 50% cả hai ngưỡng" },
  { key: "below", label: "Chưa đạt", color: "var(--muted)", hint: "Dưới 50% một trong hai ngưỡng" },
  { key: "error", label: "Không đọc được", color: "var(--danger)", hint: "Thiếu quyền, token bị giới hạn hoặc lỗi Graph" },
];

const DEFAULT_THRESHOLDS = { followers: 10_000, minutes: 600_000 };
const CONCURRENCY = 6;
const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; data: Monet }>();

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

function Bar({ value, target, color }: { value: number | null; target: number; color: string }) {
  const ratio = value == null || target <= 0 ? 0 : Math.min(1, value / target);
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end" }}>
      <span className="insight-num" style={{ fontSize: 12 }}>
        {fmt(value)}
      </span>
      <span
        title={`${Math.round(ratio * 100)}% ngưỡng ${target.toLocaleString("vi-VN")}`}
        style={{ width: 84, height: 4, borderRadius: 2, background: "var(--bg-3)", overflow: "hidden" }}
      >
        <span style={{ display: "block", width: `${ratio * 100}%`, height: "100%", background: color }} />
      </span>
    </span>
  );
}

export function MonetizationTab({
  pages,
  groups,
  assignments,
  username,
}: {
  pages: Page[];
  groups: Group[];
  assignments: Record<string, number>;
  username: string | null;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [tick, setTick] = useState(0);
  const freshRef = useRef(false);
  const runRef = useRef(0);
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
  const [cat, setCat] = useState<Category | "all">("all");
  const [group, setGroup] = useState<"all" | "none" | number>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: "name" | "followers" | "minutes" | "earn" | "new"; dir: 1 | -1 }>({ key: "earn", dir: -1 });

  const storageKey = username ? `rmf_insight_monet_${username}` : null;
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      if (saved.thresholds?.followers > 0 && saved.thresholds?.minutes > 0) setThresholds(saved.thresholds);
    } catch {
      // storage unavailable — keep defaults
    }
  }, [storageKey]);
  function saveThresholds(t: typeof thresholds) {
    setThresholds(t);
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ thresholds: t }));
    } catch {
      // ignore
    }
  }

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
  const scopedKey = scoped.map((p) => p.id).join(",");

  // Load the pages in scope (≤ 6 in flight, 10-minute cache).
  useEffect(() => {
    if (scoped.length === 0) return;
    const run = ++runRef.current;
    const fresh = freshRef.current;
    freshRef.current = false;
    const now = Date.now();
    const queue: Page[] = [];
    const ready: Record<string, RowState> = {};
    for (const p of scoped) {
      const hit = cache.get(p.id);
      if (!fresh && hit && now - hit.at < CACHE_MS) ready[p.id] = { status: "ok", data: hit.data };
      else queue.push(p);
    }
    setRows((prev) => {
      const next = { ...prev, ...ready };
      for (const p of queue) next[p.id] = { status: "loading" };
      return next;
    });
    if (queue.length === 0) return setProgress(null);
    let done = 0;
    setProgress({ done: 0, total: queue.length });
    runPool(queue, CONCURRENCY, async (p) => {
      if (runRef.current !== run) return;
      let state: RowState;
      try {
        const res = await fetch(`/api/insight/monetization?pageId=${p.id}&tokens=${p.tokenIds.join(",")}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        if (res.ok && !data.error) {
          cache.set(p.id, { at: Date.now(), data });
          state = { status: "ok", data };
        } else state = { status: "error", error: data.error ?? `HTTP ${res.status}`, cooling: !!data.cooling };
      } catch (e) {
        state = { status: "error", error: e instanceof Error ? e.message : String(e) };
      }
      setRows((prev) => ({ ...prev, [p.id]: state }));
      if (runRef.current !== run) return;
      done++;
      setProgress({ done, total: queue.length });
    }).then(() => {
      if (runRef.current === run) setProgress(null);
    });
    // scopedKey stands in for scoped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedKey, tick]);

  function categorize(s: RowState | undefined): Category {
    if (!s || s.status === "loading") return "loading";
    if (s.status === "error" || s.data.unsupported) return "error";
    const d = s.data;
    if ((d.earnings90?.micros ?? 0) > 0) return "earning";
    const f = (d.followers ?? 0) / thresholds.followers;
    const m = (d.watchMinutes60 ?? 0) / thresholds.minutes;
    if (f >= 1 && m >= 1) return "reached";
    if (f >= 0.5 && m >= 0.5) return "near";
    return "below";
  }

  const all = scoped.map((p) => {
    const s = rows[p.id];
    return { page: p, state: s, data: s?.status === "ok" ? s.data : null, cat: categorize(s), group: groupOf(p.id) };
  });
  const counts: Record<string, number> = {};
  for (const r of all) counts[r.cat] = (counts[r.cat] ?? 0) + 1;

  const term = search.trim().toLowerCase();
  const list = all
    .filter((r) => (cat === "all" || r.cat === cat) && (!term || r.page.name.toLowerCase().includes(term) || r.page.id.includes(term)))
    .sort((a, b) => {
      const v = (r: (typeof all)[number]): number | string | null => {
        switch (sort.key) {
          case "name":
            return r.page.name;
          case "followers":
            return r.data?.followers ?? null;
          case "minutes":
            return r.data?.watchMinutes60 ?? null;
          case "earn":
            return r.data?.earnings90?.micros ?? null;
          case "new":
            return r.data?.newFollowers28 ?? null;
        }
      };
      const va = v(a);
      const vb = v(b);
      if (va == null && vb == null) return a.page.name.localeCompare(b.page.name, "vi");
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * sort.dir || (b.data?.followers ?? 0) - (a.data?.followers ?? 0);
      }
      return String(va).localeCompare(String(vb), "vi") * sort.dir;
    });

  function th(key: typeof sort.key, label: string) {
    const active = sort.key === key;
    return (
      <th
        className={key === "name" ? "" : "right"}
        style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
        onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 }))}
        aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
      >
        {label}
        {active ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  function exportCsv() {
    const esc = (v: string | number | null) => {
      const s = v == null ? "" : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ["Trang", "Page ID", "Nhóm", "Phân loại", "Người theo dõi", "Phút xem 60 ngày", "Lượt xem video 60 ngày", "Theo dõi mới 28 ngày", "Thu nhập 90 ngày", "Tiền tệ", "Token"];
    const lines = list.map((r) =>
      [
        r.page.name,
        r.page.id,
        r.group?.name ?? "",
        CATS.find((c) => c.key === r.cat)?.label ?? "Đang tải",
        r.data?.followers ?? null,
        r.data?.watchMinutes60 ?? null,
        r.data?.videoViews60 ?? null,
        r.data?.newFollowers28 ?? null,
        r.data?.earnings90 ? (r.data.earnings90.micros / 1_000_000).toFixed(2) : null,
        r.data?.earnings90?.currency ?? null,
        r.data?.via ?? null,
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
        Facebook <b style={{ color: "var(--ink-soft)" }}>không có API cho lời mời / trạng thái duyệt Content Monetization</b>. Trang được
        phân loại từ số liệu đọc được: có thu nhập 90 ngày → <b style={{ color: "var(--good)" }}>Đang kiếm tiền</b>; còn lại so với ngưỡng
        bên dưới (Meta không công bố ngưỡng cho Content Monetization — mặc định là ngưỡng In-stream cũ, sửa được). Bấm{" "}
        <b style={{ color: "var(--ink-soft)" }}>Kiếm tiền ↗</b> ở từng Trang để xem lời mời trong Business Suite.
      </div>

      <section className="section" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="section-label" style={{ marginRight: 4 }}>
            Ngưỡng
          </span>
          <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
            Người theo dõi ≥
            <input
              className="input insight-num"
              type="number"
              min={1}
              aria-label="Ngưỡng người theo dõi"
              value={thresholds.followers}
              onChange={(e) => saveThresholds({ ...thresholds, followers: Math.max(1, Number(e.target.value) || 1) })}
              style={{ width: 100, padding: "4px 8px", fontSize: 12 }}
            />
          </label>
          <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
            Phút xem 60 ngày ≥
            <input
              className="input insight-num"
              type="number"
              min={1}
              aria-label="Ngưỡng phút xem"
              value={thresholds.minutes}
              onChange={(e) => saveThresholds({ ...thresholds, minutes: Math.max(1, Number(e.target.value) || 1) })}
              style={{ width: 110, padding: "4px 8px", fontSize: 12 }}
            />
          </label>
          <button className="btn" style={{ padding: "3px 8px", fontSize: 10 }} onClick={() => saveThresholds(DEFAULT_THRESHOLDS)}>
            Mặc định
          </button>
          <span style={{ flex: 1 }} />
          <select
            className="input"
            aria-label="Lọc nhóm"
            value={String(group)}
            onChange={(e) => setGroup(e.target.value === "all" || e.target.value === "none" ? e.target.value : Number(e.target.value))}
            style={{ padding: "4px 8px", fontSize: 12, width: "auto", maxWidth: 240 }}
          >
            <option value="all">Tất cả nhóm ({pages.length})</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value="none">Chưa phân nhóm</option>
          </select>
        </div>
      </section>

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
          style={{ flex: "1 1 220px", maxWidth: 320 }}
        />
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
          {cat === "all" ? "Tất cả" : CATS.find((c) => c.key === cat)?.label} · {list.length} Trang
          {progress ? ` · Đang kiểm tra ${progress.done}/${progress.total} Trang…` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="btn"
          style={smallBtn}
          disabled={!!progress}
          onClick={() => {
            freshRef.current = true;
            setTick((t) => t + 1);
          }}
        >
          ↻ Kiểm tra lại
        </button>
        <button className="btn" style={smallBtn} onClick={exportCsv} disabled={list.length === 0}>
          Xuất CSV
        </button>
      </div>

      <div className="table-wrap insight-table-wrap">
        <table className="table insight-monet-table">
          <thead>
            <tr>
              {th("name", "Trang")}
              {th("followers", "Người theo dõi")}
              {th("minutes", "Phút xem 60 ngày")}
              <th className="right">Lượt xem 60 ngày</th>
              {th("new", "Theo dõi mới 28 ngày")}
              {th("earn", "Thu nhập 90 ngày")}
              <th>Phân loại</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const c = CATS.find((x) => x.key === r.cat);
              const title =
                r.state?.status === "error" ? r.state.error : r.data?.unsupported ? r.data.reason : c?.hint;
              return (
                <tr key={r.page.id}>
                  <td style={{ maxWidth: 240 }}>
                    <span style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                      {r.group && <span title={r.group.name} style={{ width: 8, height: 8, borderRadius: "50%", background: r.group.color, flex: "none" }} />}
                      <span style={{ minWidth: 0 }}>
                        <span className="insight-ellipsis" style={{ display: "block", maxWidth: 210, color: "var(--ink)" }} title={r.page.name}>
                          {r.page.name}
                        </span>
                        <span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>
                          {r.page.id}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="right">
                    <Bar value={r.data?.followers ?? null} target={thresholds.followers} color="var(--accent)" />
                  </td>
                  <td className="right">
                    <Bar value={r.data?.watchMinutes60 ?? null} target={thresholds.minutes} color="var(--accent)" />
                  </td>
                  <td className="right insight-num" style={{ fontSize: 12 }}>
                    {fmt(r.data?.videoViews60)}
                  </td>
                  <td className="right insight-num" style={{ fontSize: 12 }}>
                    {fmt(r.data?.newFollowers28)}
                  </td>
                  <td className="right insight-num" style={{ fontSize: 12, color: (r.data?.earnings90?.micros ?? 0) > 0 ? "var(--good)" : undefined }}>
                    {money(r.data?.earnings90 ?? null)}
                    {(r.data?.earnings90?.days ?? 0) > 0 && (
                      <div style={{ fontSize: 10, color: "var(--muted)" }}>{r.data!.earnings90!.days} ngày có tiền</div>
                    )}
                  </td>
                  <td>
                    {r.cat === "loading" ? (
                      <span className="pill">Đang kiểm tra…</span>
                    ) : (
                      <span className="pill" title={title} style={{ color: c?.color, borderColor: "currentColor" }}>
                        {c?.label}
                      </span>
                    )}
                  </td>
                  <td className="right">
                    <a
                      href={monetizationUrl(r.page.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="btn"
                      style={{ padding: "3px 8px", fontSize: 10, textDecoration: "none", whiteSpace: "nowrap" }}
                      title="Mở mục Kiếm tiền của Trang trong Meta Business Suite (xem lời mời)"
                    >
                      Kiếm tiền ↗
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
