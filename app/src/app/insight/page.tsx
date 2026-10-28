"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { encodeBodyHeader } from "@/lib/req-body";
import { LineChart, Sparkline, ddmm, type DayPoint } from "./charts";
import { MonetizationTab } from "./monetization-tab";
import { ContentTab } from "./content-tab";

type Range = "today" | "7d" | "28d";
type Filter = "all" | "none" | number; // number = group id

const RANGES: Array<{ key: Range; label: string }> = [
  { key: "today", label: "Hôm nay" },
  { key: "7d", label: "7 ngày" },
  { key: "28d", label: "28 ngày" },
];

const GROUP_COLORS = ["#5e6ad2", "#3fb950", "#d29922", "#f85149", "#a371f7", "#39c5cf", "#db61a2", "#8a8a8a"];

interface Token {
  id: number;
  label: string;
  kind: "user" | "page";
  fbName: string | null;
  preview: string | null;
  lastError: string | null;
}

interface Group {
  id: number;
  name: string;
  color: string;
}

interface Page {
  id: string;
  name: string;
  tokenIds: number[];
}

interface RangeReach {
  reach: number | null;
  prev: number | null;
  daily: DayPoint[];
  todayPending?: boolean;
}

interface Reach {
  metric: string | null;
  via: string | null;
  ranges: Record<Range, RangeReach>;
  unsupported?: boolean;
  reason?: string;
}

type RowState =
  | { status: "loading" }
  | { status: "ok"; data: Reach; stale?: string }
  | { status: "error"; error: string; cooling?: boolean };

type SortKey = "name" | "group" | "reach" | "change" | "via" | "status";

const TOKEN_CONCURRENCY = 4;
// Graph Batch: 10 pages per request, 6 requests in flight — measured fastest
// live (54 pages ≈ 1.3 s). Graph allows ≤ 50 per batch.
const BATCH_SIZE = 10;
const BATCH_CONCURRENCY = 6;
// Saved results older than this are refreshed automatically.
const STALE_MS = 2 * 60 * 60_000;

interface PageList {
  pages: Array<{ id: string; name: string }>;
  fetchedAt: number; // unix seconds
}

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

type ApiResult<T> = { ok: boolean; status: number; data: T & { error?: string } };

async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      cache: "no-store",
      headers: init?.body !== undefined ? { "X-Body": encodeBodyHeader(init.body) } : undefined,
    });
    const text = await res.text();
    let data: T & { error?: string };
    try {
      data = text ? JSON.parse(text) : ({ error: `HTTP ${res.status} (không có nội dung)` } as T & { error?: string });
    } catch {
      data = { error: `HTTP ${res.status}: phản hồi không phải JSON` } as T & { error?: string };
    }
    return { ok: res.ok && !data.error, status: res.status, data };
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
  // Tiny previous periods make percentages absurd (+76193%) — show a ratio.
  if (p >= 1000) return { text: `×${Math.round(p / 100 + 1).toLocaleString("vi-VN")}`, color: "var(--good)" };
  return p > 0
    ? { text: `+${p.toFixed(1)}%`, color: "var(--good)" }
    : { text: `−${Math.abs(p).toFixed(1)}%`, color: "var(--danger)" };
}

function statusOf(s: RowState | undefined, range: Range): { label: string; tone: "ok" | "err" | "muted"; title?: string } {
  if (!s || s.status === "loading") return { label: "Đang tải…", tone: "muted" };
  if (s.status === "error") {
    return s.cooling ? { label: "Bị giới hạn", tone: "err", title: s.error } : { label: "Lỗi", tone: "err", title: s.error };
  }
  if (s.data.unsupported) return { label: "Không hỗ trợ", tone: "err", title: s.data.reason };
  if (s.stale) return { label: "Số cũ", tone: "muted", title: `Lần cập nhật gần nhất lỗi — đang hiện số đã lưu. ${s.stale}` };
  if (range === "today" && s.data.ranges.today.todayPending) {
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

const smallBtn = { padding: "5px 10px", fontSize: 11 } as const;

export default function InsightPage() {
  const [username, setUsername] = useState<string | null>(null);
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [pagesByToken, setPagesByToken] = useState<Record<number, PageList>>({});
  const [pagesProgress, setPagesProgress] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "err" | "warn"; text: string } | null>(null);

  const [range, setRange] = useState<Range>("7d");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [reachAt, setReachAt] = useState<Record<string, number>>({}); // page id → fetched (unix s)
  const [booted, setBooted] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "reach", dir: "desc" });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"reach" | "content" | "monet" | "tokens">("reach");
  const [showGroups, setShowGroups] = useState(false);
  const [pickerGroupId, setPickerGroupId] = useState<number | null>(null);
  const runRef = useRef(0);
  const loadingRef = useRef(false);
  const lastFullRef = useRef(0);
  const savedReachRef = useRef<Record<string, Reach>>({});
  // Latest groups for callbacks that run right after creating a group (their
  // render-time closure doesn't know the new group yet).
  const groupsRef = useRef<Group[]>([]);
  groupsRef.current = groups;

  const storageKey = username ? `rmf_insight_${username}` : null;
  const pagesByTokenRef = useRef(pagesByToken);
  pagesByTokenRef.current = pagesByToken;
  const reachAtRef = useRef(reachAt);
  reachAtRef.current = reachAt;
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;

  const tokenKey = (tokens ?? []).map((t) => t.id).join(",");
  // --- data loading ----------------------------------------------------------
  // On open: show the saved snapshots right away (no Graph call). Graph is
  // read only for pages that have no snapshot yet, when everything is older
  // than 2 hours (also re-checked every 5 minutes while the tab is open), or
  // when the user clicks "Load Insight". Reach goes through Graph Batch: 10
  // pages per request, 6 requests in flight.

  const pages = useMemo(() => {
    const byId = new Map<string, Page>();
    for (const t of tokens ?? []) {
      for (const p of pagesByToken[t.id]?.pages ?? []) {
        const cur = byId.get(p.id) ?? { id: p.id, name: p.name, tokenIds: [] };
        if (!cur.tokenIds.includes(t.id)) cur.tokenIds.push(t.id);
        byId.set(p.id, cur);
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }, [tokens, pagesByToken]);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const tokenPages = useMemo(() => {
    const out: Record<number, number> = {};
    for (const [id, v] of Object.entries(pagesByToken)) out[Number(id)] = v.pages.length;
    return out;
  }, [pagesByToken]);

  /** Read page lists from Graph for these tokens (and save them server-side). */
  async function refreshLists(list: Token[]): Promise<Record<number, PageList>> {
    const got: Record<number, PageList> = {};
    const errors: Record<number, string> = {};
    let done = 0;
    setPagesProgress({ done: 0, total: list.length });
    await runPool(list, TOKEN_CONCURRENCY, async (t) => {
      const r = await api<{ pages: Array<{ id: string; name: string }> }>(`/api/insight/tokens/${t.id}/pages`);
      if (r.ok) got[t.id] = { pages: r.data.pages, fetchedAt: Math.floor(Date.now() / 1000) };
      else errors[t.id] = r.data.error ?? `Lỗi ${r.status}`;
      setPagesProgress({ done: ++done, total: list.length });
    });
    setPagesByToken((prev) => ({ ...prev, ...got }));
    setTokens((prev) => prev?.map((t) => (t.id in errors ? { ...t, lastError: errors[t.id] } : t.id in got ? { ...t, lastError: null } : t)) ?? prev);
    setPagesProgress(null);
    return got;
  }

  /** Reach for these pages via /api/insight/reach-batch (saved server-side). */
  async function fetchReach(list: Page[]) {
    if (list.length === 0) return;
    const run = ++runRef.current;
    const chunks: Page[][] = [];
    for (let i = 0; i < list.length; i += BATCH_SIZE) chunks.push(list.slice(i, i + BATCH_SIZE));
    setRows((prev) => {
      const next = { ...prev };
      // Keep showing the old numbers while refreshing; only blank pages spin.
      for (const p of list) if (!next[p.id] || next[p.id].status !== "ok") next[p.id] = { status: "loading" };
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
      if (Object.keys(batch).length) setRows((prev) => ({ ...prev, ...batch }));
      if (Object.keys(at).length) setReachAt((prev) => ({ ...prev, ...at }));
      if (runRef.current === run) setProgress({ done, total: list.length });
    };
    await runPool(chunks, BATCH_CONCURRENCY, async (chunk) => {
      const r = await api<{ results: Record<string, Reach | { error: string; cooling?: boolean }> }>("/api/insight/reach-batch", {
        method: "POST",
        body: { pages: chunk.map((p) => ({ pageId: p.id, tokens: p.tokenIds })) },
      });
      const now = Math.floor(Date.now() / 1000);
      for (const p of chunk) {
        const item = r.ok ? r.data.results?.[p.id] : undefined;
        if (item && !("error" in item)) {
          pending[p.id] = { status: "ok", data: item };
          pendingAt[p.id] = now;
          savedReachRef.current[p.id] = item;
        } else {
          const error = item && "error" in item ? item.error : r.data.error ?? `Lỗi ${r.status}`;
          const cooling = !!(item && "error" in item && item.cooling);
          // A failed refresh keeps the last good numbers.
          pending[p.id] = { status: "error", error, cooling };
        }
      }
      done += chunk.length;
      if (!timer) timer = setTimeout(flush, 150);
    });
    if (timer) clearTimeout(timer);
    flush();
    // Failures of a refresh should not wipe saved numbers: put them back.
    setRows((prev) => {
      const next = { ...prev };
      for (const p of list) {
        const s = next[p.id];
        const saved = savedReachRef.current[p.id];
        if (s?.status === "error" && saved) next[p.id] = { status: "ok", data: saved, stale: s.error } as RowState;
      }
      return next;
    });
    if (runRef.current === run) setProgress(null);
  }

  /** "Load Insight": page lists + reach for every page, from Graph. */
  async function loadAll() {
    const tokens = tokensRef.current;
    if (loadingRef.current || !tokens?.length) return;
    loadingRef.current = true;
    setLoadingAll(true);
    try {
      const got = await refreshLists(tokens);
      const fresh = { ...pagesByTokenRef.current, ...got };
      const byId = new Map<string, Page>();
      for (const t of tokens) {
        for (const p of fresh[t.id]?.pages ?? []) {
          const cur = byId.get(p.id) ?? { id: p.id, name: p.name, tokenIds: [] };
          if (!cur.tokenIds.includes(t.id)) cur.tokenIds.push(t.id);
          byId.set(p.id, cur);
        }
      }
      await fetchReach([...byId.values()]);
      lastFullRef.current = Date.now();
    } finally {
      loadingRef.current = false;
      setLoadingAll(false);
    }
  }

  // Bootstrap: user, tokens, groups and every saved snapshot in parallel.
  useEffect(() => {
    (async () => {
      const [me, t, g, sp, sr] = await Promise.all([
        api<{ user: { username: string } | null }>("/api/auth/me"),
        api<{ tokens: Token[] }>("/api/insight/tokens"),
        api<{ groups: Group[]; assignments: Record<string, number> }>("/api/insight/groups"),
        api<{ items: Record<string, { data: Array<{ id: string; name: string }>; fetchedAt: number }> }>("/api/insight/snapshots?kind=pages"),
        api<{ items: Record<string, { data: Reach; fetchedAt: number }> }>("/api/insight/snapshots?kind=reach"),
      ]);
      if (me.data.user) setUsername(me.data.user.username);
      if (!t.ok) setNotice({ tone: "err", text: t.data.error ?? "Không tải được token" });
      if (g.ok) {
        setGroups(g.data.groups);
        setAssignments(g.data.assignments);
      }
      const lists: Record<number, PageList> = {};
      for (const [key, v] of Object.entries(sp.data.items ?? {})) {
        const id = Number(key.replace(/^t:/, ""));
        if (Number.isInteger(id)) lists[id] = { pages: v.data, fetchedAt: v.fetchedAt };
      }
      const savedRows: Record<string, RowState> = {};
      const at: Record<string, number> = {};
      for (const [pid, v] of Object.entries(sr.data.items ?? {})) {
        savedRows[pid] = { status: "ok", data: v.data };
        at[pid] = v.fetchedAt;
        savedReachRef.current[pid] = v.data;
      }
      setPagesByToken(lists);
      setRows(savedRows);
      setReachAt(at);
      setTokens(t.data.tokens ?? []);
      if ((t.data.tokens ?? []).length === 0) setTab("tokens");
      setBooted(true);
    })();
  }, []);

  // After boot: fetch only what's missing; full refresh when stale (> 2 h).
  useEffect(() => {
    if (!booted || !tokens) return;
    (async () => {
      const missingLists = tokens.filter((t) => !pagesByTokenRef.current[t.id]);
      if (missingLists.length) await refreshLists(missingLists);
      if (isStale()) return loadAll();
      const missing = pagesRef.current.filter((p) => !reachAtRef.current[p.id]);
      if (missing.length) await fetchReach(missing);
    })();
    // Runs when the token set changes (boot, token added/removed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, tokenKey]);

  // Auto-refresh every 2 hours while the page is open.
  useEffect(() => {
    if (!booted) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && isStale()) loadAll();
    }, 5 * 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, tokenKey]);

  /** Oldest saved reach (or page list) older than 2 hours → refresh. */
  function isStale(): boolean {
    if (Date.now() - lastFullRef.current < STALE_MS) return false;
    const times = [
      ...Object.values(reachAtRef.current),
      ...Object.values(pagesByTokenRef.current).map((v) => v.fetchedAt),
    ];
    if (times.length === 0) return false;
    return Date.now() / 1000 - Math.min(...times) > STALE_MS / 1000;
  }

  // --- remembered range + group filter, per user -----------------------------
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as { range?: Range; filter?: Filter };
      if (saved.range && RANGES.some((r) => r.key === saved.range)) setRange(saved.range);
      if (saved.filter !== undefined) setFilter(saved.filter);
    } catch {
      // storage unavailable — keep defaults
    }
  }, [storageKey]);

  function remember(patch: { range?: Range; filter?: Filter }) {
    if (!storageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      localStorage.setItem(storageKey, JSON.stringify({ ...saved, ...patch }));
    } catch {
      // ignore
    }
  }
  function chooseRange(r: Range) {
    setRange(r);
    remember({ range: r });
  }
  function chooseFilter(f: Filter) {
    setFilter(f);
    setChecked(new Set());
    remember({ filter: f });
  }

  // A remembered group that no longer exists falls back to "all".
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const effectiveFilter: Filter = typeof filter === "number" && !groupById.has(filter) && groups.length > 0 ? "all" : filter;

  const counts = useMemo(() => {
    const byGroup: Record<number, number> = {};
    let none = 0;
    for (const p of pages) {
      const gid = assignments[p.id];
      if (gid && groupById.has(gid)) byGroup[gid] = (byGroup[gid] ?? 0) + 1;
      else none++;
    }
    return { byGroup, none };
  }, [pages, assignments, groupById]);

  const visiblePages = useMemo(() => {
    const term = search.trim().toLowerCase();
    return pages.filter((p) => {
      const gid = assignments[p.id];
      const inGroup = gid !== undefined && groupById.has(gid);
      if (effectiveFilter === "none" && inGroup) return false;
      if (typeof effectiveFilter === "number" && gid !== effectiveFilter) return false;
      return !term || p.name.toLowerCase().includes(term) || p.id.includes(term);
    });
  }, [pages, assignments, groupById, effectiveFilter, search]);

  // --- tokens ---------------------------------------------------------------
  async function addToken(raw: string, label: string): Promise<boolean> {
    const r = await api<{ token: Token; warning: string | null; replaced: boolean }>("/api/insight/tokens", {
      method: "POST",
      body: { token: raw, label },
    });
    if (!r.ok) {
      setNotice({ tone: "err", text: r.data.error ?? "Không lưu được token" });
      return false;
    }
    const t = r.data.token;
    setTokens((prev) => [t, ...(prev ?? []).filter((x) => x.id !== t.id)]);
    if (r.data.replaced) void refreshLists([t]);
    setNotice(
      r.data.warning
        ? { tone: "warn", text: `Đã lưu token “${t.label}”. ${r.data.warning}` }
        : { tone: "ok", text: `${r.data.replaced ? "Đã cập nhật" : "Đã thêm"} token “${t.label}” (${t.kind === "page" ? "Page token" : "User token"}).` },
    );
    return true;
  }

  async function deleteToken(t: Token) {
    if (!confirm(`Xóa token “${t.label}”? Các Trang chỉ đọc được qua token này sẽ biến mất khỏi Insight.`)) return;
    const r = await api(`/api/insight/tokens/${t.id}`, { method: "DELETE" });
    if (!r.ok) return setNotice({ tone: "err", text: r.data.error ?? "Không xóa được token" });
    setTokens((prev) => prev?.filter((x) => x.id !== t.id) ?? prev);
    setPagesByToken((prev) => {
      const next = { ...prev };
      delete next[t.id];
      return next;
    });
    setNotice({ tone: "ok", text: `Đã xóa token “${t.label}”.` });
  }

  async function renameToken(t: Token, label: string) {
    const r = await api(`/api/insight/tokens/${t.id}`, { method: "PATCH", body: { label } });
    if (!r.ok) return setNotice({ tone: "err", text: r.data.error ?? "Không đổi được tên token" });
    const shown = label.trim() || t.fbName || `Token #${t.id}`;
    setTokens((prev) => prev?.map((x) => (x.id === t.id ? { ...x, label: shown } : x)) ?? prev);
  }

  // --- groups ---------------------------------------------------------------
  async function createGroup(name: string, color: string): Promise<Group | null> {
    const r = await api<{ group: Group }>("/api/insight/groups", { method: "POST", body: { name, color } });
    if (!r.ok) {
      setNotice({ tone: "err", text: r.data.error ?? "Không tạo được nhóm" });
      return null;
    }
    const next = [...groupsRef.current, r.data.group].sort((a, b) => a.name.localeCompare(b.name, "vi"));
    groupsRef.current = next;
    setGroups(next);
    return r.data.group;
  }

  async function updateGroup(id: number, patch: { name?: string; color?: string }) {
    const r = await api<{ group: Group }>(`/api/insight/groups/${id}`, { method: "PATCH", body: patch });
    if (!r.ok) return setNotice({ tone: "err", text: r.data.error ?? "Không sửa được nhóm" });
    setGroups((prev) => prev.map((g) => (g.id === id ? r.data.group : g)));
  }

  async function deleteGroup(g: Group) {
    const n = counts.byGroup[g.id] ?? 0;
    if (!confirm(`Xóa nhóm “${g.name}”?${n ? ` ${n} Trang trong nhóm sẽ về “Chưa phân nhóm”.` : ""}`)) return;
    const r = await api(`/api/insight/groups/${g.id}`, { method: "DELETE" });
    if (!r.ok) return setNotice({ tone: "err", text: r.data.error ?? "Không xóa được nhóm" });
    setGroups((prev) => prev.filter((x) => x.id !== g.id));
    setAssignments((prev) => Object.fromEntries(Object.entries(prev).filter(([, gid]) => gid !== g.id)));
    if (filter === g.id) chooseFilter("all");
  }

  async function assign(pageIds: string[], groupId: number | null) {
    if (pageIds.length === 0) return;
    const before = assignments;
    setAssignments((prev) => {
      const next = { ...prev };
      for (const id of pageIds) {
        if (groupId === null) delete next[id];
        else next[id] = groupId;
      }
      return next;
    });
    const r = await api("/api/insight/assign", { method: "POST", body: { pageIds, groupId } });
    if (!r.ok) {
      setAssignments(before);
      setNotice({ tone: "err", text: r.data.error ?? "Không gán được nhóm" });
      return;
    }
    const g = groupId === null ? null : groupsRef.current.find((x) => x.id === groupId);
    setNotice({ tone: "ok", text: `Đã chuyển ${pageIds.length} Trang vào ${g ? `nhóm “${g.name}”` : "“Chưa phân nhóm”"}.` });
  }

  // --- aggregates for the chosen range ---------------------------------------
  const okRows = visiblePages.flatMap((p) => {
    const s = rows[p.id];
    return s?.status === "ok" && !s.data.unsupported ? [{ page: p, data: s.data, r: s.data.ranges[range] }] : [];
  });
  const withReach = okRows.filter((x) => x.r.reach != null);
  const total = withReach.reduce((a, x) => a + (x.r.reach ?? 0), 0);
  const both = withReach.filter((x) => x.r.prev != null);
  const totalChange = pct(
    both.reduce((a, x) => a + (x.r.reach ?? 0), 0),
    both.length ? both.reduce((a, x) => a + (x.r.prev ?? 0), 0) : null,
  );
  const top = withReach.reduce<(typeof withReach)[number] | null>(
    (best, x) => (!best || (x.r.reach ?? 0) > (best.r.reach ?? 0) ? x : best),
    null,
  );
  const pendingToday = range === "today" && okRows.some((x) => x.r.todayPending);

  const chartPoints: DayPoint[] = (() => {
    if (range === "today") return [];
    const byDate = new Map<string, number | null>();
    for (const x of okRows) {
      for (const d of x.r.daily) {
        if (d.value == null) {
          if (!byDate.has(d.date)) byDate.set(d.date, null);
        } else byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.value);
      }
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(range === "7d" ? -7 : -28)
      .map(([date, value]) => ({ date, value }));
  })();

  // --- table ----------------------------------------------------------------
  const tableRows = useMemo(() => {
    const list = visiblePages.map((p) => {
      const state = rows[p.id];
      const data = state?.status === "ok" ? state.data : null;
      const r = data && !data.unsupported ? data.ranges[range] : null;
      return {
        page: p,
        group: (() => {
          const gid = assignments[p.id];
          return gid ? groupById.get(gid) ?? null : null;
        })(),
        data,
        r,
        reach: r?.reach ?? null,
        change: r ? pct(r.reach, r.prev) : null,
        status: statusOf(state, range),
      };
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (x: (typeof list)[number]): string | number | null => {
      switch (sort.key) {
        case "name":
          return x.page.name;
        case "group":
          return x.group?.name ?? null;
        case "reach":
          return x.reach;
        case "change":
          return x.change;
        case "via":
          return x.data?.via ?? null;
        case "status":
          return x.status.label;
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
  }, [visiblePages, rows, range, sort, assignments, groupById]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" || key === "group" ? "asc" : "desc" },
    );
  }

  const allChecked = tableRows.length > 0 && tableRows.every((x) => checked.has(x.page.id));
  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(tableRows.map((x) => x.page.id)));
  }
  function toggleOne(id: string) {
    setChecked((prev) => {
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
    const head = ["Trang", "Page ID", "Nhóm", "Reach", "Kỳ trước", "Thay đổi %", "Metric", "Token", "Trạng thái"];
    const lines = tableRows.map((x) =>
      [
        x.page.name,
        x.page.id,
        x.group?.name ?? "",
        x.reach,
        x.r?.prev ?? null,
        x.change == null ? null : x.change.toFixed(1),
        x.data?.metric ?? null,
        x.data?.via ?? null,
        x.status.label,
      ]
        .map(esc)
        .join(","),
    );
    // BOM so Excel opens the UTF-8 file with Vietnamese intact.
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `insight-reach-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const visibleTimes = visiblePages.map((p) => reachAt[p.id]).filter((t): t is number => !!t);
  const oldest = visibleTimes.length ? Math.min(...visibleTimes) : null;
  const updatedLabel = oldest
    ? `Cập nhật ${new Date(oldest * 1000).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}`
    : "Chưa tải số liệu";

  // Reach of each group (sum of its pages) vs the previous period — shown in
  // the group manager with a rating. Only pages with both numbers count.
  const groupStats = useMemo(() => {
    const out: Record<number, GroupStat> = {};
    for (const g of groups) {
      const ids = pages.filter((p) => assignments[p.id] === g.id).map((p) => p.id);
      const acc = { r7: 0, p7: 0, r28: 0, p28: 0, n: 0 };
      for (const id of ids) {
        const st = rows[id];
        if (st?.status !== "ok" || st.data.unsupported) continue;
        const w = st.data.ranges["7d"];
        const m = st.data.ranges["28d"];
        if (w.reach != null && w.prev != null) {
          acc.r7 += w.reach;
          acc.p7 += w.prev;
          acc.n++;
        }
        if (m.reach != null && m.prev != null) {
          acc.r28 += m.reach;
          acc.p28 += m.prev;
        }
      }
      out[g.id] = { reach7: acc.r7, change7: pct(acc.r7, acc.p7), reach28: acc.r28, change28: pct(acc.r28, acc.p28), pagesWithData: acc.n };
    }
    return out;
  }, [groups, pages, assignments, rows]);

  const filterName =
    effectiveFilter === "all" ? "Tất cả" : effectiveFilter === "none" ? "Chưa phân nhóm" : groupById.get(effectiveFilter)?.name ?? "Nhóm";
  const rangeDays = range === "7d" ? 7 : 28;

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
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0, maxWidth: "100%" }}>
          <div className="btn-group insight-tabs" role="tablist" aria-label="Chọn tab">
            <button role="tab" aria-selected={tab === "reach"} className={`btn-seg${tab === "reach" ? " active" : ""}`} onClick={() => setTab("reach")}>
              Reach
            </button>
            <button role="tab" aria-selected={tab === "content"} className={`btn-seg${tab === "content" ? " active" : ""}`} onClick={() => setTab("content")}>
              Nội dung
            </button>
            <button role="tab" aria-selected={tab === "monet"} className={`btn-seg${tab === "monet" ? " active" : ""}`} onClick={() => setTab("monet")}>
              Kiếm tiền
            </button>
            <button role="tab" aria-selected={tab === "tokens"} className={`btn-seg${tab === "tokens" ? " active" : ""}`} onClick={() => setTab("tokens")}>
              Quản lý token ({tokens?.length ?? 0})
            </button>
          </div>
          {tab === "reach" && <div className="btn-group" role="tablist" aria-label="Chọn kỳ">
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
          </div>}
        </div>
      </header>

      {notice && (
        <div
          role="status"
          className="card"
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            fontSize: 12,
            display: "flex",
            gap: 12,
            alignItems: "center",
            color: notice.tone === "err" ? "var(--danger)" : notice.tone === "warn" ? "var(--warn)" : "var(--good)",
          }}
        >
          <span style={{ flex: 1 }}>{notice.text}</span>
          <button className="btn" style={{ padding: "2px 8px", fontSize: 10 }} onClick={() => setNotice(null)} aria-label="Đóng">
            ✕
          </button>
        </div>
      )}

      {tab === "tokens" ? (
        tokens && (
          <TokenManager
            tokens={tokens}
            pages={pages}
            loadingPages={pagesProgress}
            groups={groups}
            assignments={assignments}
            onAdd={addToken}
            onDelete={deleteToken}
            onRename={renameToken}
            onAssign={assign}
            onCreateGroup={createGroup}
            onReloadPages={() => tokens && refreshLists(tokens)}
          />
        )
      ) : tab === "content" ? (
        tokens === null || !booted || (pagesProgress && pages.length === 0) ? (
          <div className="card mono" style={{ color: "var(--muted)", fontSize: 12 }}>Đang tải…</div>
        ) : (
          <ContentTab pages={pages} groups={groups} assignments={assignments} username={username} />
        )
      ) : tab === "monet" ? (
        tokens === null || !booted || (pagesProgress && pages.length === 0) ? (
          <div className="card mono" style={{ color: "var(--muted)", fontSize: 12 }}>
            {pagesProgress ? `Đang tải danh sách Trang ${pagesProgress.done}/${pagesProgress.total} token…` : "Đang tải…"}
          </div>
        ) : (
          <MonetizationTab pages={pages} groups={groups} assignments={assignments} username={username} />
        )
      ) : tokens === null || !booted || (pagesProgress && pages.length === 0) ? (
        <div className="card mono" style={{ color: "var(--muted)", fontSize: 12 }}>
          {pagesProgress ? `Đang tải danh sách Trang ${pagesProgress.done}/${pagesProgress.total} token…` : "Đang tải…"}
        </div>
      ) : tokens.length === 0 ? (
        <div className="card" style={{ color: "var(--muted)", lineHeight: 1.6 }}>
          Chưa có token. Mở tab{" "}
          <button className="btn" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => setTab("tokens")}>
            Quản lý token
          </button>{" "}
          để nhập System User Token / User Token.
        </div>
      ) : pages.length === 0 ? (
        <div className="card" style={{ color: "var(--muted)" }}>
          Token chưa đọc được Trang nào (cần quyền pages_show_list). Xem lỗi ở tab Quản lý token.
        </div>
      ) : (
        <>
          {/* Group filter */}
          <section className="section" style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="section-label" style={{ marginRight: 4 }}>
                Nhóm
              </span>
              <FilterChip active={effectiveFilter === "all"} onClick={() => chooseFilter("all")} label={`Tất cả (${pages.length})`} />
              {groups.map((g) => (
                <FilterChip
                  key={g.id}
                  active={effectiveFilter === g.id}
                  onClick={() => chooseFilter(g.id)}
                  label={`${g.name} (${counts.byGroup[g.id] ?? 0})`}
                  color={g.color}
                />
              ))}
              <FilterChip
                active={effectiveFilter === "none"}
                onClick={() => chooseFilter("none")}
                label={`Chưa phân nhóm (${counts.none})`}
                color="var(--dim)"
              />
              <button className="btn" style={smallBtn} onClick={() => setShowGroups((v) => !v)} aria-expanded={showGroups}>
                {showGroups ? "Đóng quản lý nhóm" : "＋ / ✎ Nhóm"}
              </button>
            </div>
            {showGroups && (
              <GroupManager groups={groups} counts={counts.byGroup} pages={pages} assignments={assignments} stats={groupStats} onCreate={createGroup} onUpdate={updateGroup} onDelete={deleteGroup} onAssign={assign} />
            )}
          </section>

          {/* Toolbar */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <input
              className="input"
              placeholder="Tìm Trang theo tên hoặc ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: "1 1 220px", maxWidth: 340 }}
            />
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
              {filterName} · {visiblePages.length} Trang
              {progress ? ` · Đang tải ${progress.done}/${progress.total} Trang…` : ""}
            </span>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }} title="Tự động cập nhật khi số liệu cũ hơn 2 giờ">
              {updatedLabel}
            </span>
            <button className="btn btn-primary" style={smallBtn} onClick={() => loadAll()} disabled={loadingAll}>
              {loadingAll ? (progress ? `Đang tải ${progress.done}/${progress.total}…` : "Đang tải…") : "⟳ Load Insight"}
            </button>
            {typeof effectiveFilter === "number" && (
              <button className="btn btn-primary" style={smallBtn} onClick={() => setPickerGroupId(effectiveFilter)}>
                ＋ Thêm Trang vào nhóm
              </button>
            )}
            <button className="btn" style={smallBtn} onClick={exportCsv} disabled={tableRows.length === 0}>
              Xuất CSV
            </button>
          </div>

          {visiblePages.length === 0 ? (
            <div className="card" style={{ color: "var(--muted)", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span>
                {search ? "Không có Trang khớp từ khóa." : effectiveFilter === "none" ? "Mọi Trang đều đã được phân nhóm." : "Nhóm này chưa có Trang nào."}
              </span>
              {typeof effectiveFilter === "number" && !search && (
                <button className="btn btn-primary" style={smallBtn} onClick={() => setPickerGroupId(effectiveFilter)}>
                  ＋ Thêm Trang vào nhóm này
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="kpi-grid insight-kpis">
                <div className="kpi">
                  <span className="kpi-label">Tổng reach</span>
                  <span className="kpi-num insight-num">{withReach.length ? fmt(total) : "—"}</span>
                  <span className="kpi-sub insight-sub">
                    {pendingToday && withReach.length === 0
                      ? "Facebook chưa cập nhật số liệu hôm nay"
                      : "Cộng các Trang — người xem nhiều Trang có thể bị tính nhiều lần"}
                  </span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">Trang có dữ liệu</span>
                  <span className="kpi-num insight-num">
                    {withReach.length}
                    <span style={{ color: "var(--muted)", fontSize: "0.6em" }}>/{visiblePages.length}</span>
                  </span>
                  <span className="kpi-sub insight-sub">
                    {pendingToday ? "Có Trang Facebook chưa cập nhật số hôm nay" : "Trang trả về số reach"}
                  </span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">Reach cao nhất</span>
                  <span className="kpi-num insight-num">{top ? fmt(top.r.reach) : "—"}</span>
                  <span className="kpi-sub insight-sub insight-ellipsis" style={{ maxWidth: "100%" }} title={top?.page.name}>
                    {top?.page.name ?? "—"}
                  </span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">So với kỳ trước</span>
                  <span className="kpi-num insight-num" style={{ color: totalChange == null ? undefined : changeView(totalChange).color }}>
                    {changeView(totalChange).text}
                  </span>
                  <span className="kpi-sub insight-sub">
                    {range === "today" ? "so với hôm qua" : `so với ${rangeDays} ngày liền trước`}
                  </span>
                </div>
              </div>

              {range !== "today" && (
                <div className="card insight-chart">
                  <div className="insight-chart-head">
                    <span className="kpi-label">Reach theo ngày</span>
                    <span className="section-label">{filterName} · giờ Thái Bình Dương</span>
                  </div>
                  {chartPoints.some((p) => p.value != null) ? (
                    <LineChart points={chartPoints} />
                  ) : (
                    <div style={{ color: "var(--muted)", fontSize: 12, padding: "12px 0" }}>
                      {progress ? "Đang tải…" : "Chưa có số liệu theo ngày."}
                    </div>
                  )}
                </div>
              )}

              {checked.size > 0 && (
                <div className="card insight-bulk">
                  <span className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>
                    Đã chọn {checked.size} Trang
                  </span>
                  <GroupSelect
                    groups={groups}
                    value={undefined}
                    placeholder="Chuyển vào nhóm…"
                    onChange={async (gid) => {
                      await assign([...checked], gid);
                      setChecked(new Set());
                    }}
                    onCreate={createGroup}
                  />
                  <button className="btn" style={smallBtn} onClick={() => setChecked(new Set())}>
                    Bỏ chọn
                  </button>
                </div>
              )}

              <section className="section">
                <div className="table-wrap insight-table-wrap">
                  <table className="table insight-table">
                    <thead>
                      <tr>
                        <th style={{ width: 28 }}>
                          <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Chọn tất cả Trang" />
                        </th>
                        {(
                          [
                            ["name", "Trang", ""],
                            ["group", "Nhóm", ""],
                            ["reach", "Reach", "right"],
                            ["change", "Thay đổi", "right"],
                            [null, "Xu hướng", ""],
                            ["via", "Token", ""],
                            ["status", "Trạng thái", ""],
                          ] as Array<[SortKey | null, string, string]>
                        ).map(([key, label, align]) => (
                          <th
                            key={label}
                            className={align}
                            onClick={key ? () => toggleSort(key) : undefined}
                            style={{ cursor: key ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}
                            aria-sort={key && sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                          >
                            {label}
                            {key && sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((x) => {
                        const ch = changeView(x.change);
                        return (
                          <tr key={x.page.id} className={checked.has(x.page.id) ? "selected" : ""}>
                            <td>
                              <input
                                type="checkbox"
                                checked={checked.has(x.page.id)}
                                onChange={() => toggleOne(x.page.id)}
                                aria-label={`Chọn ${x.page.name}`}
                              />
                            </td>
                            <td style={{ maxWidth: 240 }}>
                              <span style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                                <PageAvatar page={x.page} color={x.group?.color ?? null} />
                                <span style={{ minWidth: 0 }}>
                                  <a
                                    href={`https://facebook.com/${x.page.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="insight-ellipsis"
                                    style={{ display: "block", maxWidth: 190, color: "var(--ink)", textDecoration: "none" }}
                                    title={x.page.name}
                                  >
                                    {x.page.name}
                                  </a>
                                  <span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>
                                    {x.page.id}
                                  </span>
                                </span>
                              </span>
                            </td>
                            <td>
                              <GroupSelect
                                groups={groups}
                                value={x.group?.id ?? null}
                                onChange={(gid) => assign([x.page.id], gid)}
                                onCreate={createGroup}
                                compact
                              />
                            </td>
                            <td className="right insight-num">
                              {range === "today" && x.r?.todayPending ? (
                                <span title="Facebook chưa cập nhật số liệu hôm nay" style={{ color: "var(--muted)" }}>
                                  —
                                </span>
                              ) : (
                                fmt(x.reach)
                              )}
                            </td>
                            <td className="right insight-num" style={{ color: ch.color }}>
                              {ch.text}
                            </td>
                            <td>
                              {x.r && range !== "today" ? <Sparkline points={x.r.daily} /> : <span style={{ color: "var(--dim)" }}>—</span>}
                            </td>
                            <td className="insight-ellipsis" style={{ fontSize: 12, color: "var(--muted)", maxWidth: 120 }} title={x.data ? `${x.data.via ?? ""} · ${x.data.metric ?? ""}` : ""}>
                              {x.data?.via ?? "—"}
                            </td>
                            <td>
                              <span className={`pill${x.status.tone === "ok" ? " ok" : x.status.tone === "err" ? " err" : ""}`} title={x.status.title}>
                                {x.status.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {range !== "today" && (
                  <div className="section-label" style={{ marginTop: 10, lineHeight: 1.6 }}>
                    Reach {rangeDays} ngày là giá trị theo kỳ do Facebook tính (period={range === "7d" ? "week" : "days_28"}), không
                    cộng dồn theo ngày — một người xem nhiều ngày chỉ tính một lần. Điểm cuối:{" "}
                    {chartPoints.length ? ddmm(chartPoints[chartPoints.length - 1].date) : "—"}.
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
      {pickerGroupId !== null && groupById.has(pickerGroupId) && (
        <PagePicker
          title={`Thêm Trang vào nhóm “${groupById.get(pickerGroupId)!.name}”`}
          pages={pages}
          groups={groups}
          assignments={assignments}
          excludeGroupId={pickerGroupId}
          confirmLabel={(n) => `Thêm ${n} Trang`}
          onConfirm={(ids) => assign(ids, pickerGroupId)}
          onClose={() => setPickerGroupId(null)}
        />
      )}
    </>
  );
}

function FilterChip({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color?: string }) {
  return (
    <button
      className={`btn${active ? " btn-primary" : ""}`}
      style={{ ...smallBtn, display: "inline-flex", gap: 6, alignItems: "center" }}
      onClick={onClick}
      aria-pressed={active}
    >
      {color && <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />}
      {label}
    </button>
  );
}

// <select> of groups for one page or a bulk selection; last option creates a group.
function GroupSelect({
  groups,
  value,
  onChange,
  onCreate,
  placeholder,
  compact,
}: {
  groups: Group[];
  value: number | null | undefined; // undefined = no current value (bulk)
  onChange: (groupId: number | null) => void;
  onCreate: (name: string, color: string) => Promise<Group | null>;
  placeholder?: string;
  compact?: boolean;
}) {
  return (
    <select
      className="input"
      value={value === undefined ? "" : value === null ? "none" : String(value)}
      style={compact ? { padding: "3px 6px", fontSize: 11, width: 140 } : { padding: "4px 8px", fontSize: 12 }}
      onChange={async (e) => {
        const v = e.target.value;
        if (v === "") return;
        if (v === "new") {
          const name = prompt("Tên nhóm mới:")?.trim();
          if (!name) return;
          const g = await onCreate(name, GROUP_COLORS[groups.length % GROUP_COLORS.length]);
          if (g) onChange(g.id);
          return;
        }
        onChange(v === "none" ? null : Number(v));
      }}
    >
      {value === undefined && <option value="">{placeholder ?? "Chọn nhóm…"}</option>}
      <option value="none">Chưa phân nhóm</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
      <option value="new">＋ Nhóm mới…</option>
    </select>
  );
}

// Modal checklist of pages: search, "only ungrouped" toggle, select-all of
// what's shown. Shows each page's current group (choosing it moves the page).
function PagePicker({
  title,
  pages,
  groups,
  assignments,
  excludeGroupId,
  initial,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  pages: Page[];
  groups: Group[];
  assignments: Record<string, number>;
  /** Hide pages already in this group (adding to an existing group). */
  excludeGroupId?: number;
  initial?: string[];
  confirmLabel: (n: number) => string;
  onConfirm: (pageIds: string[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [onlyUngrouped, setOnlyUngrouped] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set(initial ?? []));
  const [busy, setBusy] = useState(false);
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const groupOf = (id: string) => (assignments[id] ? groupById.get(assignments[id]) ?? null : null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const term = q.trim().toLowerCase();
  const candidates = pages
    .filter((p) => excludeGroupId === undefined || assignments[p.id] !== excludeGroupId)
    // Ungrouped pages first — they are what you usually want to file.
    .sort((a, b) => Number(!!groupOf(a.id)) - Number(!!groupOf(b.id)) || a.name.localeCompare(b.name, "vi"));
  const shown = candidates.filter(
    (p) => (!onlyUngrouped || !groupOf(p.id)) && (!term || p.name.toLowerCase().includes(term) || p.id.includes(term)),
  );
  const allShownOn = shown.length > 0 && shown.every((p) => sel.has(p.id));

  function toggle(id: string) {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleShown() {
    setSel((prev) => {
      const next = new Set(prev);
      for (const p of shown) {
        if (allShownOn) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal insight-picker"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560, width: "92%", display: "flex", flexDirection: "column", maxHeight: "86vh" }}
      >
        <h2 className="h2-serif" style={{ fontSize: 18, marginBottom: 12 }}>
          {title}
        </h2>
        <input
          className="input"
          placeholder="Tìm Trang theo tên hoặc ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          style={{ width: "100%", marginBottom: 8 }}
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8, fontSize: 12 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={allShownOn} onChange={toggleShown} />
            Chọn tất cả ({shown.length})
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", color: "var(--muted)" }}>
            <input type="checkbox" checked={onlyUngrouped} onChange={(e) => setOnlyUngrouped(e.target.checked)} />
            Chỉ Trang chưa phân nhóm
          </label>
        </div>
        <div style={{ flex: 1, minHeight: 120, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
          {shown.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: "var(--muted)" }}>
              {candidates.length === 0 ? "Không còn Trang nào để thêm." : "Không có Trang khớp."}
            </div>
          ) : (
            shown.map((p) => {
              const g = groupOf(p.id);
              return (
                <label
                  key={p.id}
                  className="insight-picker-row"
                  style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 10px", cursor: "pointer", borderBottom: "1px solid var(--line)" }}
                >
                  <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Chọn ${p.name}`} />
                  <PageAvatar page={p} color={g?.color ?? null} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="insight-ellipsis" style={{ display: "block", maxWidth: "100%", fontSize: 13, color: "var(--ink)" }}>
                      {p.name}
                    </span>
                    <span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>
                      {p.id}
                    </span>
                  </span>
                  {g && (
                    <span className="chip" title="Chọn Trang này sẽ chuyển nó sang nhóm mới" style={{ display: "inline-flex", gap: 5, alignItems: "center", flex: "none" }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: g.color }} />
                      {g.name}
                    </span>
                  )}
                </label>
              );
            })
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--accent)", flex: 1 }}>
            Đã chọn {sel.size} Trang
          </span>
          <button className="btn" style={smallBtn} onClick={onClose}>
            Hủy
          </button>
          <button
            className="btn btn-primary"
            style={smallBtn}
            disabled={busy || (sel.size === 0 && !initial)}
            onClick={async () => {
              setBusy(true);
              await onConfirm([...sel]);
              setBusy(false);
              onClose();
            }}
          >
            {busy ? "Đang lưu…" : confirmLabel(sel.size)}
          </button>
        </div>
      </div>
    </div>
  );
}

interface GroupStat {
  reach7: number;
  change7: number | null;
  reach28: number;
  change28: number | null;
  pagesWithData: number;
}

/** Group performance from reach: ≥ +10% Tốt, ≤ −10% Giảm, else Ổn định. */
function groupRating(change: number | null): { label: string; color: string } {
  if (change == null) return { label: "Chưa đủ dữ liệu", color: "var(--muted)" };
  if (change >= 10) return { label: "Tốt", color: "var(--good)" };
  if (change <= -10) return { label: "Giảm", color: "var(--danger)" };
  return { label: "Ổn định", color: "var(--warn)" };
}

function GroupStatChips({ stat }: { stat: GroupStat | undefined }) {
  if (!stat || stat.pagesWithData === 0) {
    return <span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>chưa có số reach</span>;
  }
  const r = groupRating(stat.change7);
  // Same formatting as the rest of Insight: near-zero changes are neutral.
  const ch = (v: number | null) => changeView(v).text;
  const col = (v: number | null) => changeView(v).color;
  return (
    <span className="insight-group-stats" title={`Tổng reach các Trang trong nhóm so với kỳ trước (${stat.pagesWithData} Trang có số). Đánh giá theo 7 ngày: ≥ +10% Tốt, ≤ −10% Giảm.`}>
      <span className="mono">
        7N {stat.reach7.toLocaleString("vi-VN")} <b style={{ color: col(stat.change7) }}>{ch(stat.change7)}</b>
      </span>
      <span className="mono">
        28N <b style={{ color: col(stat.change28) }}>{ch(stat.change28)}</b>
      </span>
      <span className="pill" style={{ color: r.color, borderColor: "currentColor" }}>
        {r.label}
      </span>
    </span>
  );
}

function GroupManager({
  groups,
  counts,
  pages,
  assignments,
  stats,
  onCreate,
  onUpdate,
  onDelete,
  onAssign,
}: {
  groups: Group[];
  counts: Record<number, number>;
  pages: Page[];
  assignments: Record<string, number>;
  stats: Record<number, GroupStat>;
  onCreate: (name: string, color: string) => Promise<Group | null>;
  onUpdate: (id: number, patch: { name?: string; color?: string }) => void;
  onDelete: (g: Group) => void;
  onAssign: (pageIds: string[], groupId: number | null) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(GROUP_COLORS[groups.length % GROUP_COLORS.length]);
  const [busy, setBusy] = useState(false);
  const [newPages, setNewPages] = useState<string[]>([]); // pages for the group being created
  const [picker, setPicker] = useState<"new" | number | null>(null); // "new" or group id
  const [openGroup, setOpenGroup] = useState<number | null>(null); // group whose members are listed
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const pickerGroup = typeof picker === "number" ? groups.find((g) => g.id === picker) : null;

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    const g = await onCreate(name.trim(), color);
    if (g && newPages.length) await onAssign(newPages, g.id);
    setBusy(false);
    if (g) {
      setName("");
      setNewPages([]);
      setColor(GROUP_COLORS[(groups.length + 1) % GROUP_COLORS.length]);
    }
  }

  return (
    <div className="card" style={{ marginTop: 12, padding: 14 }}>
      <form
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input
          className="input"
          placeholder="Tên nhóm mới…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          style={{ flex: "1 1 180px", maxWidth: 260 }}
        />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="Màu nhóm"
          style={{ width: 34, height: 30, border: 0, background: "transparent", padding: 0 }}
        />
        <button type="button" className="btn" style={smallBtn} onClick={() => setPicker("new")}>
          {newPages.length ? `Đã chọn ${newPages.length} Trang ✎` : "＋ Chọn Trang"}
        </button>
        <button className="btn btn-primary" style={smallBtn} disabled={!name.trim() || busy}>
          {busy ? "Đang tạo…" : newPages.length ? `Tạo nhóm + gán ${newPages.length} Trang` : "Tạo nhóm"}
        </button>
      </form>

      {groups.length > 0 && (
        <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
          {groups.map((g) => {
            const n = counts[g.id] ?? 0;
            const members = openGroup === g.id
              ? Object.entries(assignments)
                  .filter(([, gid]) => gid === g.id)
                  .map(([pid]) => pageById.get(pid))
                  .filter((p): p is Page => !!p)
                  .sort((a, b) => a.name.localeCompare(b.name, "vi"))
              : [];
            return (
              <div key={g.id} className="insight-group-row">
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="color"
                    defaultValue={g.color}
                    aria-label={`Màu nhóm ${g.name}`}
                    onBlur={(e) => e.target.value !== g.color && onUpdate(g.id, { color: e.target.value })}
                    style={{ width: 28, height: 26, border: 0, background: "transparent", padding: 0 }}
                  />
                  <input
                    className="input"
                    defaultValue={g.name}
                    maxLength={60}
                    aria-label="Tên nhóm"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== g.name) onUpdate(g.id, { name: v });
                      else e.target.value = g.name;
                    }}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    style={{ flex: "1 1 160px", maxWidth: 260, padding: "4px 8px", fontSize: 12 }}
                  />
                  <button
                    className="btn"
                    style={{ padding: "3px 8px", fontSize: 11 }}
                    onClick={() => setOpenGroup(openGroup === g.id ? null : g.id)}
                    aria-expanded={openGroup === g.id}
                    disabled={n === 0}
                    title={n === 0 ? "Nhóm chưa có Trang" : "Xem / bỏ Trang trong nhóm"}
                  >
                    {n} Trang {n > 0 ? (openGroup === g.id ? "▴" : "▾") : ""}
                  </button>
                  <GroupStatChips stat={stats[g.id]} />
                  <button className="btn btn-primary" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setPicker(g.id)}>
                    ＋ Thêm Trang
                  </button>
                  <button className="btn btn-danger" style={{ padding: "3px 8px", fontSize: 10 }} onClick={() => onDelete(g)}>
                    Xóa
                  </button>
                </div>
                {openGroup === g.id && members.length > 0 && (
                  <div style={{ margin: "8px 0 4px 36px", border: "1px solid var(--line)", borderRadius: 8, maxHeight: 240, overflowY: "auto" }}>
                    {members.map((p) => (
                      <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 10px", borderBottom: "1px solid var(--line)" }}>
                        <PageAvatar page={p} color={g.color} />
                        <span className="insight-ellipsis" style={{ flex: 1, maxWidth: "100%", fontSize: 12 }} title={p.name}>
                          {p.name}
                        </span>
                        <button className="btn" style={{ padding: "2px 8px", fontSize: 10 }} onClick={() => onAssign([p.id], null)}>
                          Bỏ khỏi nhóm
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {picker === "new" && (
        <PagePicker
          title={`Chọn Trang cho nhóm mới${name.trim() ? ` “${name.trim()}”` : ""}`}
          pages={pages}
          groups={groups}
          assignments={assignments}
          initial={newPages}
          confirmLabel={(n) => `Xong (${n} Trang)`}
          onConfirm={(ids) => setNewPages(ids)}
          onClose={() => setPicker(null)}
        />
      )}
      {pickerGroup && (
        <PagePicker
          title={`Thêm Trang vào nhóm “${pickerGroup.name}”`}
          pages={pages}
          groups={groups}
          assignments={assignments}
          excludeGroupId={pickerGroup.id}
          confirmLabel={(n) => `Thêm ${n} Trang`}
          onConfirm={(ids) => onAssign(ids, pickerGroup.id)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

// "Quản lý token" tab: paste System User / User / Page tokens and see, per
// token, the pages it reads — with group assignment right there.
function TokenManager({
  tokens,
  pages,
  loadingPages,
  groups,
  assignments,
  onAdd,
  onDelete,
  onRename,
  onAssign,
  onCreateGroup,
  onReloadPages,
}: {
  tokens: Token[];
  pages: Page[];
  loadingPages: { done: number; total: number } | null;
  groups: Group[];
  assignments: Record<string, number>;
  onAdd: (raw: string, label: string) => Promise<boolean>;
  onDelete: (t: Token) => void;
  onRename: (t: Token, label: string) => void;
  onAssign: (pageIds: string[], groupId: number | null) => Promise<void>;
  onCreateGroup: (name: string, color: string) => Promise<Group | null>;
  onReloadPages: () => void;
}) {
  const [raw, setRaw] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState("");
  const groupById = new Map(groups.map((g) => [g.id, g]));

  function toggle(id: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <section className="card" style={{ marginBottom: 20 }}>
        <h2 className="h2-serif" style={{ fontSize: 18, marginBottom: 6 }}>
          Thêm <em>token</em>
        </h2>
        <div className="section-label" style={{ marginBottom: 12, lineHeight: 1.6 }}>
          Dán <b>System User Token</b> (Business Manager) hoặc User Access Token — đọc mọi Trang mà user đó quản lý — hoặc
          một Page Token. Cần quyền pages_show_list + read_insights. Token được kiểm tra với Facebook rồi lưu mã hóa; dán
          lại token mới của cùng user sẽ thay token cũ.
        </div>
        <form
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!raw.trim() || busy) return;
            setBusy(true);
            const ok = await onAdd(raw.trim(), label.trim());
            setBusy(false);
            if (ok) {
              setRaw("");
              setLabel("");
            }
          }}
        >
          <input
            className="input mono"
            placeholder="EAA… (System User Token / User Token / Page Token)"
            aria-label="Token"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            style={{ flex: "3 1 280px", fontSize: 12 }}
          />
          <input
            className="input"
            placeholder="Tên gợi nhớ (tùy chọn)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={{ flex: "1 1 150px" }}
          />
          <button className="btn btn-primary" style={smallBtn} disabled={!raw.trim() || busy}>
            {busy ? "Đang kiểm tra…" : "Thêm token"}
          </button>
        </form>
      </section>

      {tokens.length > 0 && (
        <section className="section">
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <h2 className="h2-serif" style={{ fontSize: 18 }}>
              User <em>&amp; Trang</em>
            </h2>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
              {tokens.length} token · {pages.length} Trang
              {loadingPages ? ` · đang đọc ${loadingPages.done}/${loadingPages.total}…` : ""}
            </span>
            <span style={{ flex: 1 }} />
            <input
              className="input"
              placeholder="Lọc Trang…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ maxWidth: 220, padding: "4px 8px", fontSize: 12 }}
            />
            <button className="btn" style={smallBtn} onClick={() => setOpen(new Set(tokens.map((t) => t.id)))}>
              Mở hết
            </button>
            <button className="btn" style={smallBtn} onClick={onReloadPages} disabled={!!loadingPages}>
              ↻ Đọc lại Trang
            </button>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {tokens.map((t) => {
              const term = filter.trim().toLowerCase();
              const own = pages.filter((p) => p.tokenIds.includes(t.id));
              const shown = term ? own.filter((p) => p.name.toLowerCase().includes(term) || p.id.includes(term)) : own;
              const isOpen = open.has(t.id) || (!!term && shown.length > 0);
              return (
                <div key={t.id} className="card insight-token-card" style={{ padding: 0, overflow: "hidden" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "12px 14px", flexWrap: "wrap" }}>
                    <button
                      className="btn"
                      style={{ padding: "2px 8px", fontSize: 11 }}
                      onClick={() => toggle(t.id)}
                      aria-expanded={isOpen}
                      aria-label={isOpen ? "Thu gọn" : "Mở danh sách Trang"}
                    >
                      {isOpen ? "▾" : "▸"}
                    </button>
                    <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                      <input
                        className="input"
                        defaultValue={t.label}
                        aria-label="Tên token"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== t.label) onRename(t, v);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        style={{ padding: "3px 8px", fontSize: 13, fontWeight: 600, maxWidth: 280, width: "100%" }}
                      />
                      <div className="mono" style={{ fontSize: 10, color: "var(--dim)", marginTop: 3 }}>
                        {t.fbName && t.fbName !== t.label ? `${t.fbName} · ` : ""}
                        {t.preview}
                      </div>
                    </div>
                    <span className="chip">{t.kind === "page" ? "Page token" : "User token"}</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {own.length} Trang
                    </span>
                    <button className="btn btn-danger" style={{ padding: "3px 8px", fontSize: 10 }} onClick={() => onDelete(t)}>
                      Xóa
                    </button>
                  </div>
                  {t.lastError && (
                    <div style={{ padding: "0 14px 10px 50px", fontSize: 11, color: "var(--danger)" }}>{t.lastError}</div>
                  )}
                  {isOpen && (
                    <div style={{ borderTop: "1px solid var(--line)", maxHeight: 360, overflowY: "auto" }}>
                      {shown.length === 0 ? (
                        <div style={{ padding: 14, fontSize: 12, color: "var(--muted)" }}>
                          {own.length === 0 ? "Token này chưa đọc được Trang nào." : "Không có Trang khớp."}
                        </div>
                      ) : (
                        <table className="table">
                          <tbody>
                            {shown.map((p) => {
                              const g = assignments[p.id] ? groupById.get(assignments[p.id]) ?? null : null;
                              return (
                                <tr key={p.id}>
                                  <td style={{ width: 36 }}>
                                    <PageAvatar page={p} color={g?.color ?? null} />
                                  </td>
                                  <td>
                                    <div className="insight-ellipsis" style={{ maxWidth: 320, color: "var(--ink)" }} title={p.name}>
                                      {p.name}
                                    </div>
                                    <div className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>
                                      {p.id}
                                      {p.tokenIds.length > 1 ? ` · đọc được qua ${p.tokenIds.length} token` : ""}
                                    </div>
                                  </td>
                                  <td className="right">
                                    <GroupSelect
                                      groups={groups}
                                      value={g?.id ?? null}
                                      onChange={(gid) => onAssign([p.id], gid)}
                                      onCreate={onCreateGroup}
                                      compact
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
