"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { encodeBodyHeader } from "@/lib/req-body";

// "Nội dung" tab of Insight: the latest 25 posts of every page (lifetime
// reach / views + engagement), filterable by group, and a per-group content
// performance table — average reach per post vs the previous period of the
// same length. Saved snapshots show instantly; Graph is read for pages
// without one, when older than 2 hours, or on "Load nội dung".

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

interface Post {
  id: string;
  message: string | null;
  createdTime: string;
  permalink: string | null;
  picture: string | null;
  type: string | null;
  reactions: number;
  comments: number;
  shares: number;
  reach: number | null;
  views: number | null;
}

type PageState = { status: "loading" } | { status: "ok"; posts: Post[] } | { status: "error"; error: string };

type Period = 7 | 30 | 90;
type Kind = "all" | "video" | "photo" | "text";
type SortKey = "new" | "reach" | "views" | "engage";

const PERIODS: Period[] = [7, 30, 90];
const KINDS: Array<{ key: Kind; label: string }> = [
  { key: "all", label: "Mọi loại" },
  { key: "video", label: "Video / Reels" },
  { key: "photo", label: "Ảnh" },
  { key: "text", label: "Chữ / Link" },
];
const BATCH_SIZE = 5; // pages per request (25 posts each)
const CONCURRENCY = 6;
const STALE_MS = 2 * 60 * 60_000;
const PAGE_LIST = 200; // posts rendered at once ("Hiện thêm" for more)
const smallBtn = { padding: "5px 10px", fontSize: 11 } as const;
const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("vi-VN"));

function kindOf(t: string | null): Exclude<Kind, "all"> {
  if (!t) return "text";
  if (/video|reel/i.test(t)) return "video";
  if (/photo/i.test(t)) return "photo";
  return "text";
}

const engage = (p: Post) => p.reactions + p.comments + p.shares;

function pct(cur: number, prev: number): number | null {
  return prev > 0 ? ((cur - prev) / prev) * 100 : null;
}

/** Rating of a group's content: average reach per post vs previous period. */
function rating(change: number | null, prevPosts: number): { label: string; color: string; hint: string } {
  if (change == null || prevPosts < 3) return { label: "Chưa đủ dữ liệu", color: "var(--muted)", hint: "Kỳ trước có dưới 3 bài để so sánh" };
  if (change >= 10) return { label: "Tốt", color: "var(--good)", hint: "Reach trung bình mỗi bài tăng ≥ 10% so với kỳ trước" };
  if (change <= -10) return { label: "Giảm", color: "var(--danger)", hint: "Reach trung bình mỗi bài giảm ≥ 10% so với kỳ trước" };
  return { label: "Ổn định", color: "var(--warn)", hint: "Reach trung bình mỗi bài thay đổi dưới 10%" };
}

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

export function ContentTab({
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
  const prefKey = username ? `rmf_insight_content_${username}` : null;
  const saved = (() => {
    try {
      return prefKey ? JSON.parse(localStorage.getItem(prefKey) ?? "{}") : {};
    } catch {
      return {};
    }
  })() as { period?: Period; group?: "all" | "none" | number };
  const [state, setState] = useState<Record<string, PageState>>({});
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [booted, setBooted] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [period, setPeriod] = useState<Period>(saved.period && PERIODS.includes(saved.period) ? saved.period : 30);
  const [group, setGroup] = useState<"all" | "none" | number>(saved.group ?? "all");
  const [kind, setKind] = useState<Kind>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("new");
  const [limit, setLimit] = useState(PAGE_LIST);
  const savedAtRef = useRef(savedAt);
  savedAtRef.current = savedAt;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const loadingRef = useRef(false);
  const lastFullRef = useRef(0);

  function remember(patch: { period?: Period; group?: "all" | "none" | number }) {
    try {
      if (prefKey) localStorage.setItem(prefKey, JSON.stringify({ period, group, ...patch }));
    } catch {
      // ignore
    }
  }

  async function fetchPosts(list: Page[]) {
    if (list.length === 0 || loadingRef.current) return;
    loadingRef.current = true;
    const chunks: Page[][] = [];
    for (let i = 0; i < list.length; i += BATCH_SIZE) chunks.push(list.slice(i, i + BATCH_SIZE));
    setState((prev) => {
      const next = { ...prev };
      for (const p of list) if (next[p.id]?.status !== "ok") next[p.id] = { status: "loading" };
      return next;
    });
    let done = 0;
    setProgress({ done: 0, total: list.length });
    const pending: Record<string, PageState> = {};
    const pendingAt: Record<string, number> = {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const batch = { ...pending };
      const at = { ...pendingAt };
      for (const k of Object.keys(pending)) delete pending[k];
      for (const k of Object.keys(pendingAt)) delete pendingAt[k];
      if (Object.keys(batch).length) {
        setState((prev) => {
          const next = { ...prev };
          // A failed refresh keeps the last good posts.
          for (const [k, v] of Object.entries(batch)) if (!(v.status === "error" && prev[k]?.status === "ok")) next[k] = v;
          return next;
        });
      }
      if (Object.keys(at).length) setSavedAt((prev) => ({ ...prev, ...at }));
      setProgress({ done, total: list.length });
    };
    try {
      await runPool(chunks, CONCURRENCY, async (chunk) => {
        let results: Record<string, { posts: Post[] } | { error: string }> = {};
        let fail = "";
        try {
          const res = await fetch("/api/insight/posts-batch", {
            method: "POST",
            cache: "no-store",
            headers: { "X-Body": encodeBodyHeader({ pages: chunk.map((p) => ({ pageId: p.id, tokens: p.tokenIds })) }) },
          });
          const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          if (res.ok && data.results) results = data.results;
          else fail = data.error ?? `HTTP ${res.status}`;
        } catch (e) {
          fail = e instanceof Error ? e.message : String(e);
        }
        const now = Math.floor(Date.now() / 1000);
        for (const p of chunk) {
          const r = results[p.id];
          if (r && "posts" in r) {
            pending[p.id] = { status: "ok", posts: r.posts };
            pendingAt[p.id] = now;
          } else pending[p.id] = { status: "error", error: (r && "error" in r ? r.error : fail) || "Lỗi" };
        }
        done += chunk.length;
        if (!timer) timer = setTimeout(flush, 150);
      });
    } finally {
      if (timer) clearTimeout(timer);
      flush();
      setProgress(null);
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
    await fetchPosts(pagesRef.current);
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/insight/snapshots?kind=posts", { cache: "no-store" });
        const data = (await res.json()) as { items?: Record<string, { data: { posts: Post[] }; fetchedAt: number }> };
        const st: Record<string, PageState> = {};
        const at: Record<string, number> = {};
        for (const [pid, v] of Object.entries(data.items ?? {})) {
          st[pid] = { status: "ok", posts: v.data.posts ?? [] };
          at[pid] = v.fetchedAt;
        }
        setState(st);
        setSavedAt(at);
      } catch {
        // nothing saved yet
      }
      setBooted(true);
    })();
  }, []);

  const pagesKey = pages.map((p) => p.id).join(",");
  useEffect(() => {
    if (!booted || pages.length === 0) return;
    if (isStale()) {
      loadAll();
      return;
    }
    fetchPosts(pages.filter((p) => !savedAtRef.current[p.id]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, pagesKey]);

  useEffect(() => {
    if (!booted) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && isStale()) loadAll();
    }, 5 * 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted]);

  // ---------------------------------------------------------------------------
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const pageById = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);
  const groupOfPage = (pid: string) => (assignments[pid] && groupById.has(assignments[pid]) ? assignments[pid] : null);
  const inGroup = (pid: string, g: "all" | "none" | number) =>
    g === "all" ? true : g === "none" ? groupOfPage(pid) === null : groupOfPage(pid) === g;

  const nowMs = Date.now();
  const curFrom = nowMs - period * 86_400_000;
  const prevFrom = nowMs - 2 * period * 86_400_000;

  /** Posts of a set of pages in [from, to). Previous window counts only pages
   * whose 25 latest posts reach back far enough (complete coverage). */
  function windowStats(pageIds: string[], from: number, to: number, needCoverage: boolean) {
    let posts = 0;
    let reach = 0;
    let withReach = 0;
    let eng = 0;
    for (const pid of pageIds) {
      const s = state[pid];
      if (s?.status !== "ok") continue;
      if (needCoverage) {
        const oldest = s.posts.length ? Math.min(...s.posts.map((p) => Date.parse(p.createdTime))) : Infinity;
        if (s.posts.length >= 25 && oldest > from) continue; // window not fully covered
      }
      for (const p of s.posts) {
        const t = Date.parse(p.createdTime);
        if (t < from || t >= to || (kind !== "all" && kindOf(p.type) !== kind)) continue;
        posts++;
        eng += engage(p);
        if (p.reach != null) {
          reach += p.reach;
          withReach++;
        }
      }
    }
    return { posts, reach, avgReach: withReach ? reach / withReach : 0, avgEngage: posts ? eng / posts : 0 };
  }

  const scopedIds = pages.filter((p) => inGroup(p.id, group)).map((p) => p.id);
  const cur = windowStats(scopedIds, curFrom, nowMs + 1, false);
  const prev = windowStats(scopedIds, prevFrom, curFrom, true);
  const change = pct(cur.avgReach, prev.avgReach);

  const groupRows = [
    ...groups.map((g) => ({ key: String(g.id), name: g.name, color: g.color, ids: pages.filter((p) => groupOfPage(p.id) === g.id).map((p) => p.id) })),
    { key: "none", name: "Chưa phân nhóm", color: "var(--dim)", ids: pages.filter((p) => groupOfPage(p.id) === null).map((p) => p.id) },
  ]
    .filter((r) => r.ids.length > 0)
    .map((r) => {
      const c = windowStats(r.ids, curFrom, nowMs + 1, false);
      const pv = windowStats(r.ids, prevFrom, curFrom, true);
      const ch = pct(c.avgReach, pv.avgReach);
      return { ...r, cur: c, prev: pv, change: ch, rate: rating(ch, pv.posts) };
    });

  const term = search.trim().toLowerCase();
  const posts = useMemo(() => {
    const out: Array<Post & { pageId: string }> = [];
    for (const pid of scopedIds) {
      const s = state[pid];
      if (s?.status !== "ok") continue;
      for (const p of s.posts) {
        const t = Date.parse(p.createdTime);
        if (t < curFrom) continue;
        if (kind !== "all" && kindOf(p.type) !== kind) continue;
        if (term && !(p.message ?? "").toLowerCase().includes(term) && !(pageById.get(pid)?.name ?? "").toLowerCase().includes(term)) continue;
        out.push({ ...p, pageId: pid });
      }
    }
    const val = (p: Post) =>
      sort === "new" ? Date.parse(p.createdTime) : sort === "reach" ? p.reach ?? -1 : sort === "views" ? p.views ?? -1 : engage(p);
    return out.sort((a, b) => val(b) - val(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, scopedIds.join(","), curFrom, kind, term, sort]);

  const loaded = scopedIds.filter((id) => state[id]?.status === "ok").length;
  const errors = scopedIds.filter((id) => state[id]?.status === "error").length;
  const times = scopedIds.map((id) => savedAt[id]).filter((t): t is number => !!t);
  const updated = times.length
    ? new Date(Math.min(...times) * 1000).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })
    : null;
  const changeColor = change == null ? undefined : change >= 0 ? "var(--good)" : "var(--danger)";

  if (pages.length === 0) {
    return <div className="card" style={{ color: "var(--muted)" }}>Chưa có Trang nào — thêm token ở tab Quản lý token.</div>;
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select
          className="input"
          aria-label="Xem theo nhóm"
          value={String(group)}
          onChange={(e) => {
            const v = e.target.value === "all" || e.target.value === "none" ? e.target.value : Number(e.target.value);
            setGroup(v);
            setLimit(PAGE_LIST);
            remember({ group: v });
          }}
          style={{ padding: "4px 8px", fontSize: 12, width: "auto", maxWidth: 220 }}
        >
          <option value="all">Tất cả nhóm ({pages.length} Trang)</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value="none">Chưa phân nhóm</option>
        </select>
        <div className="btn-group" role="tablist" aria-label="Khoảng thời gian">
          {PERIODS.map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={period === p}
              className={`btn-seg${period === p ? " active" : ""}`}
              onClick={() => {
                setPeriod(p);
                remember({ period: p });
              }}
            >
              {p} ngày
            </button>
          ))}
        </div>
        <select className="input" aria-label="Loại bài" value={kind} onChange={(e) => setKind(e.target.value as Kind)} style={{ padding: "4px 8px", fontSize: 12, width: "auto" }}>
          {KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
        <input className="input" placeholder="Tìm theo nội dung / tên Trang…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: "1 1 180px", maxWidth: 260 }} />
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }} title="Tự động cập nhật khi số liệu cũ hơn 2 giờ">
          {updated ? `Cập nhật ${updated}` : "Chưa tải"}
        </span>
        <button className="btn btn-primary" style={smallBtn} onClick={() => loadAll()} disabled={!!progress}>
          {progress ? `Đang tải ${progress.done}/${progress.total}…` : "⟳ Load nội dung"}
        </button>
      </div>

      <div className="kpi-grid insight-kpis">
        <div className="kpi">
          <span className="kpi-label">Bài viết {period} ngày</span>
          <span className="kpi-num insight-num">{fmt(cur.posts)}</span>
          <span className="kpi-sub insight-sub">
            {loaded}/{scopedIds.length} Trang đã tải{errors ? ` · ${errors} lỗi` : ""} · 25 bài gần nhất / Trang
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Tổng reach các bài</span>
          <span className="kpi-num insight-num">{fmt(cur.reach)}</span>
          <span className="kpi-sub insight-sub">Người xem riêng biệt, cộng các bài</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Reach TB / bài</span>
          <span className="kpi-num insight-num">{fmt(Math.round(cur.avgReach))}</span>
          <span className="kpi-sub insight-sub" style={{ color: changeColor }}>
            {change == null ? "Chưa đủ dữ liệu kỳ trước" : `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(1)}% so với ${period} ngày trước`}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Tương tác TB / bài</span>
          <span className="kpi-num insight-num">{fmt(Math.round(cur.avgEngage))}</span>
          <span className="kpi-sub insight-sub">Cảm xúc + bình luận + chia sẻ</span>
        </div>
      </div>

      {group === "all" && groupRows.length > 0 && (
        <section className="section" style={{ marginBottom: 16 }}>
          <div className="section-label" style={{ marginBottom: 8 }}>
            Hiệu suất nội dung theo nhóm — reach trung bình mỗi bài {period} ngày qua so với {period} ngày trước đó
          </div>
          <div className="table-wrap">
            <table className="table insight-content-groups">
              <thead>
                <tr>
                  <th>Nhóm</th>
                  <th className="right">Trang</th>
                  <th className="right">Bài</th>
                  <th className="right">Reach TB / bài</th>
                  <th className="right">Kỳ trước</th>
                  <th className="right">Thay đổi</th>
                  <th className="right">Tương tác TB</th>
                  <th>Đánh giá</th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map((r) => (
                  <tr key={r.key} style={{ cursor: r.key === "none" ? "default" : "pointer" }} onClick={() => r.key !== "none" && setGroup(Number(r.key))}>
                    <td>
                      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: r.color }} />
                        {r.name}
                      </span>
                    </td>
                    <td className="right insight-num">{r.ids.length}</td>
                    <td className="right insight-num">{fmt(r.cur.posts)}</td>
                    <td className="right insight-num">{fmt(Math.round(r.cur.avgReach))}</td>
                    <td className="right insight-num" style={{ color: "var(--muted)" }}>
                      {r.prev.posts ? fmt(Math.round(r.prev.avgReach)) : "—"}
                    </td>
                    <td className="right insight-num" style={{ color: r.change == null ? "var(--dim)" : r.change >= 0 ? "var(--good)" : "var(--danger)" }}>
                      {r.change == null ? "—" : `${r.change >= 0 ? "+" : "−"}${Math.abs(r.change).toFixed(1)}%`}
                    </td>
                    <td className="right insight-num">{fmt(Math.round(r.cur.avgEngage))}</td>
                    <td>
                      <span className="pill" title={r.rate.hint} style={{ color: r.rate.color, borderColor: "currentColor" }}>
                        {r.rate.label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <span className="section-label">{posts.length} bài</span>
        <span style={{ flex: 1 }} />
        <span className="section-label">Sắp xếp</span>
        <div className="btn-group" role="tablist" aria-label="Sắp xếp bài">
          {(
            [
              ["new", "Mới nhất"],
              ["reach", "Reach"],
              ["views", "Lượt xem"],
              ["engage", "Tương tác"],
            ] as Array<[SortKey, string]>
          ).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={sort === k} className={`btn-seg${sort === k ? " active" : ""}`} onClick={() => setSort(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap insight-table-wrap">
        <table className="table insight-posts">
          <thead>
            <tr>
              <th style={{ width: 64 }} />
              <th>Bài viết</th>
              <th className="right">Reach</th>
              <th className="right">Lượt xem</th>
              <th className="right">Cảm xúc</th>
              <th className="right">Bình luận</th>
              <th className="right">Chia sẻ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {posts.slice(0, limit).map((p) => {
              const pg = pageById.get(p.pageId);
              const gid = groupOfPage(p.pageId);
              const g = gid ? groupById.get(gid) : null;
              return (
                <tr key={p.id}>
                  <td>
                    {p.picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.picture} alt="" width={56} height={56} loading="lazy" style={{ objectFit: "cover", borderRadius: 6, display: "block", background: "var(--bg-3)" }} />
                    ) : (
                      <div style={{ width: 56, height: 56, borderRadius: 6, background: "var(--bg-3)" }} />
                    )}
                  </td>
                  <td style={{ maxWidth: 420 }}>
                    <div className="insight-post-msg" title={p.message ?? ""}>
                      {p.message || <span style={{ color: "var(--dim)" }}>(không có chữ)</span>}
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {g && <span style={{ width: 7, height: 7, borderRadius: "50%", background: g.color }} title={g.name} />}
                      <span>{pg?.name ?? p.pageId}</span>
                      <span>·</span>
                      <span>{new Date(p.createdTime).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                      <span>·</span>
                      <span>{KINDS.find((k) => k.key === kindOf(p.type))?.label}</span>
                    </div>
                  </td>
                  <td className="right insight-num">{fmt(p.reach)}</td>
                  <td className="right insight-num">{fmt(p.views)}</td>
                  <td className="right insight-num">{fmt(p.reactions)}</td>
                  <td className="right insight-num">{fmt(p.comments)}</td>
                  <td className="right insight-num">{fmt(p.shares)}</td>
                  <td className="right">
                    {p.permalink && (
                      <a href={p.permalink} target="_blank" rel="noreferrer" className="btn" style={{ padding: "3px 8px", fontSize: 10, textDecoration: "none" }}>
                        Mở ↗
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {posts.length === 0 && (
          <div style={{ padding: 18, color: "var(--muted)", fontSize: 12 }}>
            {progress ? "Đang tải bài viết…" : `Không có bài nào trong ${period} ngày qua.`}
          </div>
        )}
      </div>
      {posts.length > limit && (
        <div style={{ textAlign: "center", marginTop: 10 }}>
          <button className="btn" style={smallBtn} onClick={() => setLimit((l) => l + PAGE_LIST)}>
            Hiện thêm ({posts.length - limit} bài)
          </button>
        </div>
      )}
    </>
  );
}
