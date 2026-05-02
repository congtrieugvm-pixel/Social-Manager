"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ALL_PRESET,
  DateRangePicker,
  DEFAULT_PRESETS,
  type DateRangeValue,
} from "@/app/_components/date-range-picker";

interface FanpageRow {
  id: number;
  insightGroupId: number | null;
  pageId: string;
  name: string;
  pictureUrl: string | null;
  link: string | null;
  username: string | null;
  category: string | null;
  fanCount: number | null;
  followersCount: number | null;
  hasPageToken: boolean;
  lastSyncedAt: number | null;
}

interface PostRow {
  id: number;
  fanpageId: number;
  postId: string;
  message: string | null;
  story: string | null;
  permalinkUrl: string | null;
  fullPictureUrl: string | null;
  statusType: string | null;
  createdTime: number | null;
  reactionsTotal: number | null;
  commentsTotal: number | null;
  sharesTotal: number | null;
  impressions: number | null;
  impressionsUnique: number | null;
  reach: number | null;
  engagedUsers: number | null;
  clicks: number | null;
  videoViews: number | null;
  adBreakEarnings: number | null;     // micro-units of currency
  adBreakCurrency: string | null;
  earningsUpdatedAt: number | null;
  earningsError: string | null;
  lastInsightsAt: number | null;
  lastInsightsError: string | null;
}

interface GroupRow {
  id: number;
  name: string;
  color: string;
  count: number;
}

interface TokenAlternative {
  fanpageId: number;
  accountId: number;
  accountUsername: string;
  accountFbName: string | null;
}
interface TokenAlternativesBlock {
  failedFanpageId: number;
  pageId: string;
  failedAccountUsername: string | null;
  alternatives: TokenAlternative[];
}
interface BatchResponse {
  ok?: boolean;
  total?: number;
  okCount?: number;
  errCount?: number;
  skipCount?: number;
  error?: string;
  results?: Array<{ ok: boolean; error?: string }>;
  abused?: boolean;
  abuseFanpageId?: number | null;
  tokenAlternatives?: TokenAlternativesBlock;
  hint?: string;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("vi-VN");
}

function fmtTime(ts: number | string | null): string {
  if (ts == null || ts === "") return "—";
  const d =
    typeof ts === "number"
      ? new Date(ts * 1000)
      : /^\d+$/.test(String(ts))
        ? new Date(Number(ts) * 1000)
        : new Date(String(ts));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(s: string | null, n: number): string {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export default function ContentPage() {
  const [fanpages, setFanpages] = useState<FanpageRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [activeGroupFilter, setActiveGroupFilter] = useState<
    "all" | "unassigned" | number
  >("all");
  const [postsByFp, setPostsByFp] = useState<Record<number, PostRow[]>>({});
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [busy, setBusy] = useState<string>("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [syncMax, setSyncMax] = useState(50);
  const [selectedPostIds, setSelectedPostIds] = useState<Set<number>>(new Set());
  const [pickN, setPickN] = useState<number>(10);
  const headerCheckRef = useRef<HTMLInputElement>(null);
  // Date range filter for the post table. Default = "Tất cả" (5y back → today)
  // so every cached post shows up to the current day, per requirement.
  // When an insight call hits an FB abuse-block on a fanpage's token AND
  // sibling fanpages exist (same FB page, different managing account), the
  // backend returns alternatives. We show a modal letting the user pick one;
  // confirming retries the failed batch with `tokenOverrides`.
  const [tokenPrompt, setTokenPrompt] = useState<{
    block: TokenAlternativesBlock;
    retry: (overrideFpId: number) => Promise<void>;
    fanpageName: string;
  } | null>(null);

  const [dateRange, setDateRange] = useState<DateRangeValue>(() => {
    const today = new Date();
    const start = new Date(today.getFullYear() - 5, today.getMonth(), today.getDate());
    const toISO = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { from: toISO(start), to: toISO(today), presetLabel: "Tất cả" };
  });
  const datePresets = useMemo(() => [ALL_PRESET, ...DEFAULT_PRESETS], []);

  const loadFanpages = useCallback(async () => {
    const res = await fetch("/api/fanpages", { cache: "no-store" });
    const data = (await res.json()) as { rows: FanpageRow[] };
    const arr = data.rows ?? [];
    setFanpages(arr);
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<number>();
      for (const id of prev) if (arr.some((r) => r.id === id)) next.add(id);
      return next;
    });
  }, []);

  const loadGroups = useCallback(async () => {
    const res = await fetch("/api/insight-groups", { cache: "no-store" });
    const data = (await res.json()) as { groups: GroupRow[] };
    setGroups(data.groups ?? []);
  }, []);

  const loadPostsFor = useCallback(async (ids: number[]) => {
    if (ids.length === 0) {
      setPostsByFp({});
      return;
    }
    setLoadingPosts(true);
    try {
      const map: Record<number, PostRow[]> = {};
      await Promise.all(
        ids.map(async (fpId) => {
          const res = await fetch(`/api/fanpages/${fpId}/posts`, { cache: "no-store" });
          const data = (await res.json()) as { rows: PostRow[] };
          map[fpId] = data.rows ?? [];
        }),
      );
      setPostsByFp(map);
    } finally {
      setLoadingPosts(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadFanpages();
      if (cancelled) return;
      await loadGroups();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadFanpages, loadGroups]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = Array.from(selectedIds);
      await loadPostsFor(ids);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedIds, loadPostsFor]);

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
        (f.username ?? "").toLowerCase().includes(q) ||
        (f.category ?? "").toLowerCase().includes(q),
    );
  }, [fanpages, search, activeGroupFilter]);

  const selected = useMemo(
    () => fanpages.filter((f) => selectedIds.has(f.id)),
    [fanpages, selectedIds],
  );

  const allPosts = useMemo(() => {
    const out: PostRow[] = [];
    for (const fp of selected) {
      const arr = postsByFp[fp.id] ?? [];
      out.push(...arr);
    }
    return out;
  }, [selected, postsByFp]);

  // Apply the date-range filter to allPosts. createdTime is epoch seconds;
  // dateRange.from/.to are local YYYY-MM-DD ISO strings — anchor at start of
  // day for `from` and end of day for `to` so the boundary days are inclusive.
  const dateFilteredPosts = useMemo(() => {
    if (!dateRange.from || !dateRange.to) return allPosts;
    const fromSec = Math.floor(
      new Date(dateRange.from + "T00:00:00").getTime() / 1000,
    );
    const toSec = Math.floor(
      new Date(dateRange.to + "T23:59:59").getTime() / 1000,
    );
    if (!Number.isFinite(fromSec) || !Number.isFinite(toSec)) return allPosts;
    return allPosts.filter((p) => {
      if (p.createdTime == null) return false;
      return p.createdTime >= fromSec && p.createdTime <= toSec;
    });
  }, [allPosts, dateRange]);

  const sortedPosts = useMemo(
    () =>
      [...dateFilteredPosts].sort(
        (a, b) => (b.createdTime ?? 0) - (a.createdTime ?? 0),
      ),
    [dateFilteredPosts],
  );

  // Drop selected post ids that disappeared from the visible list (e.g. user
  // deselected the parent fanpage). Don't auto-select on list change.
  useEffect(() => {
    setSelectedPostIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(sortedPosts.map((p) => p.id));
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [sortedPosts]);

  // Indeterminate header checkbox: tri-state when partial.
  useEffect(() => {
    if (!headerCheckRef.current) return;
    const total = sortedPosts.length;
    const sel = selectedPostIds.size;
    headerCheckRef.current.indeterminate = sel > 0 && sel < total;
  }, [selectedPostIds, sortedPosts]);

  function togglePost(id: number) {
    setSelectedPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedPostIds((prev) => {
      const total = sortedPosts.length;
      if (total === 0) return prev;
      // If everything visible is already selected, clear; otherwise select all.
      if (prev.size >= total && sortedPosts.every((p) => prev.has(p.id))) {
        return new Set();
      }
      return new Set(sortedPosts.map((p) => p.id));
    });
  }

  function selectFirstN(n: number) {
    const k = Math.max(0, Math.min(n, sortedPosts.length));
    setSelectedPostIds(new Set(sortedPosts.slice(0, k).map((p) => p.id)));
  }

  function clearPostSelection() {
    setSelectedPostIds(new Set());
  }

  function toggle(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * One-click "Get Insight Post" — does BOTH:
   *   1. Sync posts list from FB for the selected fanpages (creates rows
   *      in fanpage_posts if new, updates message/permalink/etc.).
   *   2. Fetch insights (reach, impressions, engaged, video views) AND
   *      ad break earnings for every post.
   * After this finishes, every column on the table is populated for the
   * selected fanpages — no separate "Tải bài" + "Reach tất cả" steps needed.
   */
  async function getInsightPosts() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBusy("insight-all");
    setMessage("");
    setError("");
    const nameById = new Map<number, string>(
      fanpages.filter((f) => ids.includes(f.id)).map((f) => [f.id, f.name]),
    );
    const pushSample = (samples: string[], msg: string) => {
      if (samples.length < 3 && !samples.includes(msg)) samples.push(msg);
    };
    const errorSamples: string[] = [];
    const failedSyncIds = new Set<number>();
    let abuseHint: string | null = null;
    let postsFound = 0;
    let postsInserted = 0;
    let postsUpdated = 0;
    let okIns = 0;
    let errIns = 0;
    let skipIns = 0;
    let totalIns = 0;
    try {
      // Step 1: pull post lists for each selected fanpage.
      for (const id of ids) {
        const res = await fetch(`/api/fanpages/${id}/posts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ max: syncMax }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          found?: number;
          inserted?: number;
          updated?: number;
          error?: string;
        };
        if (res.ok) {
          postsFound += data.found ?? 0;
          postsInserted += data.inserted ?? 0;
          postsUpdated += data.updated ?? 0;
        } else {
          failedSyncIds.add(id);
          if (data.error) {
            pushSample(errorSamples, `${nameById.get(id) ?? id}: ${data.error}`);
          }
        }
      }

      // Step 2: fetch insights + earnings for all posts of those fanpages.
      // The batch route fetches both fetchPostInsights and
      // fetchPostVideoEarnings in parallel (set in earlier change), so this
      // single call populates all the columns the table renders.
      for (const id of ids) {
        if (failedSyncIds.has(id)) continue;
        const res = await fetch("/api/posts/insights/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fanpageId: id }),
        });
        const data = (await res.json()) as BatchResponse;
        if (res.ok) {
          okIns += data.okCount ?? 0;
          errIns += data.errCount ?? 0;
          skipIns += data.skipCount ?? 0;
          totalIns += data.total ?? 0;
          for (const r of data.results ?? []) {
            if (!r.ok && r.error) {
              pushSample(errorSamples, `${nameById.get(id) ?? id}: ${r.error}`);
            }
          }
          // Abuse + alternative tokens → prompt user. Break the outer loop so
          // we don't pile on more failed calls for other fanpages while the
          // user decides which token to retry with.
          if (
            data.abused &&
            data.tokenAlternatives &&
            data.tokenAlternatives.alternatives.length > 0
          ) {
            const block = data.tokenAlternatives;
            const failedFpName = nameById.get(id) ?? `#${id}`;
            setTokenPrompt({
              block,
              fanpageName: failedFpName,
              retry: async (overrideFpId: number) => {
                setTokenPrompt(null);
                // Retry just this fanpage's batch with the chosen override —
                // posts of OTHER fanpages already succeeded in this loop.
                setBusy("insight-all");
                try {
                  const r2 = await fetch("/api/posts/insights/batch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      fanpageId: id,
                      tokenOverrides: { [String(id)]: overrideFpId },
                    }),
                  });
                  const d2 = (await r2.json()) as BatchResponse;
                  setMessage(
                    `Retry ${failedFpName}: ${d2.okCount ?? 0}/${d2.total ?? 0} OK · ${d2.errCount ?? 0} lỗi`,
                  );
                  await loadPostsFor(ids);
                } finally {
                  setBusy("");
                }
              },
            });
            break;
          }
          if (data.abused && data.hint) {
            abuseHint = data.hint;
            break;
          }
        } else if (data.error) {
          pushSample(errorSamples, `${nameById.get(id) ?? id}: ${data.error}`);
        }
      }

      setMessage(
        `Tải ${postsFound} bài (thêm ${postsInserted} · cập nhật ${postsUpdated}) · ` +
          `Insights ${okIns}/${totalIns} OK · ${errIns} lỗi · ${skipIns} bỏ qua`,
      );
      if (abuseHint) {
        setError(abuseHint);
      } else if (errorSamples.length > 0) {
        setError(`Graph lỗi: ${errorSamples.join(" | ")}`);
      }
      await loadPostsFor(ids);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  /**
   * Fetch insights for an explicit list of post-row ids. Single batch call —
   * backend already supports `ids[]`. No pre-sync from FB (user is insighting
   * posts already in the table).
   *
   * `tokenOverrides` lets the abuse-retry flow reuse a sibling fanpage's
   * token when the original got rate-limited.
   */
  async function getInsightSelectedPosts(
    tokenOverrides?: Record<string, number>,
  ) {
    const ids = Array.from(selectedPostIds);
    if (ids.length === 0) return;
    setBusy("insight-selected");
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/posts/insights/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, tokenOverrides }),
      });
      const data = (await res.json()) as BatchResponse;
      if (!res.ok) {
        setError(data.error ?? `Lỗi ${res.status}`);
        return;
      }
      setMessage(
        `Insights ${data.okCount ?? 0}/${data.total ?? 0} OK · ${data.errCount ?? 0} lỗi · ${data.skipCount ?? 0} bỏ qua`,
      );
      // Abuse + sibling-token candidates → prompt user to retry with one.
      if (
        data.abused &&
        data.tokenAlternatives &&
        data.tokenAlternatives.alternatives.length > 0
      ) {
        const block = data.tokenAlternatives;
        const failedFpName =
          fanpages.find((f) => f.id === block.failedFanpageId)?.name ?? `#${block.failedFanpageId}`;
        setTokenPrompt({
          block,
          fanpageName: failedFpName,
          retry: async (overrideFpId: number) => {
            setTokenPrompt(null);
            await getInsightSelectedPosts({
              ...(tokenOverrides ?? {}),
              [String(block.failedFanpageId)]: overrideFpId,
            });
          },
        });
      } else if (data.abused && data.hint) {
        setError(data.hint);
      } else {
        const samples: string[] = [];
        for (const r of data.results ?? []) {
          if (!r.ok && r.error && samples.length < 3 && !samples.includes(r.error)) {
            samples.push(r.error);
          }
        }
        if (samples.length > 0) setError(`Graph lỗi: ${samples.join(" | ")}`);
      }
      await loadPostsFor(Array.from(selectedIds));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function fetchReachOne(postRowId: number) {
    setBusy(`post-${postRowId}`);
    setError("");
    try {
      const res = await fetch(`/api/posts/${postRowId}/insights`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? `Lỗi ${res.status}`);
      } else {
        await loadPostsFor(Array.from(selectedIds));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      {tokenPrompt && (
        <TokenPromptModal
          fanpageName={tokenPrompt.fanpageName}
          block={tokenPrompt.block}
          onPick={tokenPrompt.retry}
          onCancel={() => setTokenPrompt(null)}
        />
      )}
      <header className="page-header">
        <div className="page-header-left">
          <span className="eyebrow">Facebook · Nội dung</span>
          <h1 className="h1-serif">
            Nội dung <em>bài viết</em>
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
            {selectedIds.size}/{fanpages.length} fanpage · {allPosts.length} bài
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Link
            href="/insights/reach"
            className="btn"
            style={{ padding: "6px 12px", fontSize: 10 }}
          >
            Reach Dashboard
          </Link>
          <Link
            href="/fanpage"
            className="btn"
            style={{ padding: "6px 12px", fontSize: 10 }}
          >
            ← Danh sách fanpage
          </Link>
        </div>
      </header>

      {(message || error) && (
        <div style={{ marginBottom: 10 }}>
          {message && (
            <div
              className="mono"
              style={{ fontSize: 11, color: "var(--good, #2d8a4e)", letterSpacing: "0.04em" }}
            >
              {message}
            </div>
          )}
          {error && (
            <div
              className="mono"
              style={{ fontSize: 11, color: "var(--accent)", letterSpacing: "0.04em" }}
            >
              ⚠ {error}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14 }}>
        {/* Fanpage sidebar */}
        <aside
          style={{
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: 10,
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
            style={{ width: "100%", padding: "6px 10px", fontSize: 12, marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
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
              marginBottom: 6,
            }}
          >
            <button
              onClick={() => setSelectedIds(new Set(filteredFanpages.map((f) => f.id)))}
              className="btn"
              style={{ padding: "2px 6px", fontSize: 9 }}
            >
              + {filteredFanpages.length}
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="btn"
              style={{ padding: "2px 6px", fontSize: 9 }}
            >
              Bỏ chọn
            </button>
          </div>
          <div style={{ maxHeight: 540, overflowY: "auto" }}>
            {filteredFanpages.map((f) => {
              const on = selectedIds.has(f.id);
              const g = groups.find((x) => x.id === f.insightGroupId);
              return (
                <label
                  key={f.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 6px",
                    borderRadius: 4,
                    cursor: "pointer",
                    background: on ? "var(--accent-soft, rgba(94,106,210,0.08))" : "transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(f.id)}
                    style={{ margin: 0 }}
                  />
                  {f.pictureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={f.pictureUrl}
                      alt=""
                      width={20}
                      height={20}
                      style={{ borderRadius: 4, objectFit: "cover" }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        background: "var(--line)",
                      }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 11,
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
                          fontSize: 8,
                          color: g.color,
                          letterSpacing: "0.04em",
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

        {/* Main — posts table */}
        <main>
          <section className="section" style={{ marginBottom: 0 }}>
            <div className="section-head" style={{ flexWrap: "wrap", gap: 8 }}>
              <div>
                <h2 className="h2-serif">
                  Bài viết <em>của fanpage đã chọn</em>
                </h2>
                <div className="section-label" style={{ marginTop: 4 }}>
                  {allPosts.length === 0
                    ? loadingPosts
                      ? "Đang tải…"
                      : "Chưa có bài — bấm Tải N bài để lấy từ Facebook"
                    : sortedPosts.length === allPosts.length
                      ? `${allPosts.length} bài từ ${selected.length} fanpage`
                      : `${sortedPosts.length}/${allPosts.length} bài (đã lọc theo ngày) · ${selected.length} fanpage`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <DateRangePicker
                  value={dateRange}
                  onChange={setDateRange}
                  presets={datePresets}
                />
                <label
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--muted)",
                    letterSpacing: "0.06em",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  Max
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={syncMax}
                    onChange={(e) => setSyncMax(Math.max(1, Number(e.target.value) || 50))}
                    className="input"
                    style={{ width: 60, padding: "3px 6px", fontSize: 11 }}
                  />
                </label>
                <button
                  onClick={getInsightPosts}
                  disabled={busy !== "" || selectedIds.size === 0}
                  className="btn btn-accent"
                  style={{ padding: "6px 14px", fontSize: 12 }}
                  title={`Tải ${syncMax} bài mới + lấy đầy đủ insights/earnings cho mọi cột`}
                >
                  {busy === "insight-all"
                    ? "Đang lấy insights…"
                    : `⟳ Get Insight Post (${syncMax})`}
                </button>
              </div>
            </div>

            {sortedPosts.length > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                  margin: "8px 0 6px",
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--muted)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  {selectedPostIds.size}/{sortedPosts.length} bài chọn
                </span>
                <label
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--muted)",
                    letterSpacing: "0.06em",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  Chọn N bài đầu
                  <input
                    type="number"
                    min={1}
                    max={sortedPosts.length}
                    value={pickN}
                    onChange={(e) => setPickN(Math.max(1, Number(e.target.value) || 1))}
                    className="input"
                    style={{ width: 60, padding: "3px 6px", fontSize: 11 }}
                  />
                </label>
                <button
                  onClick={() => selectFirstN(pickN)}
                  disabled={sortedPosts.length === 0}
                  className="btn"
                  style={{ padding: "4px 10px", fontSize: 11 }}
                >
                  Áp dụng
                </button>
                <button
                  onClick={clearPostSelection}
                  disabled={selectedPostIds.size === 0}
                  className="btn"
                  style={{ padding: "4px 10px", fontSize: 11 }}
                >
                  Bỏ chọn
                </button>
                <button
                  onClick={() => getInsightSelectedPosts()}
                  disabled={busy !== "" || selectedPostIds.size === 0}
                  className="btn btn-accent"
                  style={{ padding: "5px 12px", fontSize: 11 }}
                  title="Lấy insights cho các bài đã tick"
                >
                  {busy === "insight-selected"
                    ? "Đang lấy…"
                    : `⟳ Get Insight bài đã chọn (${selectedPostIds.size})`}
                </button>
              </div>
            )}

            {sortedPosts.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input
                          ref={headerCheckRef}
                          type="checkbox"
                          checked={
                            sortedPosts.length > 0 &&
                            selectedPostIds.size >= sortedPosts.length &&
                            sortedPosts.every((p) => selectedPostIds.has(p.id))
                          }
                          onChange={toggleAllVisible}
                          aria-label="Chọn tất cả bài hiển thị"
                        />
                      </th>
                      <th style={{ width: 44 }}>#</th>
                      <th style={{ width: 180 }}>Fanpage</th>
                      <th>Bài viết</th>
                      <th style={{ width: 110 }}>Ngày</th>
                      <th style={{ width: 80 }}>Reach</th>
                      <th style={{ width: 90 }}>Impressions</th>
                      <th style={{ width: 70 }}>Engaged</th>
                      <th style={{ width: 90 }}>Video views</th>
                      <th style={{ width: 110 }} title="Approximate Content Monetization Earnings">
                        Doanh thu
                      </th>
                      <th style={{ width: 90 }}>Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPosts.map((p, i) => {
                      const fp = fanpages.find((f) => f.id === p.fanpageId);
                      return (
                        <tr key={p.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedPostIds.has(p.id)}
                              onChange={() => togglePost(p.id)}
                              aria-label={`Chọn bài #${i + 1}`}
                            />
                          </td>
                          <td>
                            <span className="mono-num text-muted">#{i + 1}</span>
                          </td>
                          <td>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                minWidth: 0,
                              }}
                            >
                              {fp?.pictureUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={fp.pictureUrl}
                                  alt=""
                                  width={28}
                                  height={28}
                                  style={{
                                    borderRadius: 999,
                                    objectFit: "cover",
                                    border: "1px solid var(--line)",
                                    flexShrink: 0,
                                  }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 999,
                                    background: "var(--line)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 11,
                                    color: "var(--muted)",
                                    fontFamily: "var(--font-serif)",
                                    flexShrink: 0,
                                  }}
                                >
                                  {(fp?.name ?? "?").charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: "var(--ink)",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                  title={fp?.name ?? ""}
                                >
                                  {fp?.name ?? "—"}
                                </div>
                                {fp?.username && (
                                  <div
                                    className="mono"
                                    style={{
                                      fontSize: 9,
                                      color: "var(--muted)",
                                      letterSpacing: "0.04em",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    @{fp.username}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td>
                            <div
                              style={{
                                display: "flex",
                                gap: 8,
                                alignItems: "flex-start",
                                minWidth: 0,
                              }}
                            >
                              {p.fullPictureUrl && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={p.fullPictureUrl}
                                  alt=""
                                  style={{
                                    width: 48,
                                    height: 48,
                                    objectFit: "cover",
                                    borderRadius: 4,
                                    flexShrink: 0,
                                  }}
                                />
                              )}
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div
                                  style={{
                                    fontSize: 12,
                                    lineHeight: 1.4,
                                    maxHeight: 36,
                                    overflow: "hidden",
                                    display: "-webkit-box",
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: "vertical",
                                    wordBreak: "break-word",
                                  }}
                                  title={p.message ?? p.story ?? ""}
                                >
                                  {truncate(p.message ?? p.story, 90)}
                                </div>
                                <div
                                  style={{
                                    display: "flex",
                                    gap: 6,
                                    marginTop: 2,
                                    alignItems: "center",
                                  }}
                                >
                                  {p.statusType && (
                                    <span
                                      className="mono"
                                      style={{
                                        fontSize: 9,
                                        color: "var(--muted)",
                                        letterSpacing: "0.08em",
                                        textTransform: "uppercase",
                                      }}
                                    >
                                      {p.statusType}
                                    </span>
                                  )}
                                  {p.permalinkUrl && (
                                    <a
                                      href={p.permalinkUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mono"
                                      style={{
                                        fontSize: 10,
                                        color: "var(--accent)",
                                        letterSpacing: "0.06em",
                                      }}
                                    >
                                      Mở ↗
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>
                              {fmtTime(p.createdTime)}
                            </span>
                          </td>
                          <td>
                            <span
                              className="mono-num"
                              style={{
                                fontWeight: 600,
                                color: p.reach != null ? "var(--ink)" : "var(--muted)",
                              }}
                            >
                              {fmtNum(p.reach)}
                            </span>
                          </td>
                          <td>
                            <span className="mono-num">{fmtNum(p.impressions)}</span>
                          </td>
                          <td>
                            <span className="mono-num">{fmtNum(p.engagedUsers)}</span>
                          </td>
                          <td>
                            <span
                              className="mono-num"
                              style={{
                                color: p.videoViews != null ? "var(--ink)" : "var(--muted)",
                              }}
                            >
                              {fmtNum(p.videoViews)}
                            </span>
                          </td>
                          <td>
                            {(() => {
                              const micros = p.adBreakEarnings;
                              if (micros == null) {
                                return (
                                  <span
                                    className="mono"
                                    style={{ fontSize: 10, color: "var(--muted)" }}
                                    title={p.earningsError ?? "Chưa cập nhật"}
                                  >
                                    {p.earningsError ? "—" : "—"}
                                  </span>
                                );
                              }
                              const amount = micros / 1_000_000;
                              const sym =
                                p.adBreakCurrency === "USD" || !p.adBreakCurrency
                                  ? "$"
                                  : "";
                              const label =
                                amount === 0
                                  ? `${sym}0.00`
                                  : amount < 0.01
                                    ? `${sym}<0.01`
                                    : `${sym}${amount.toLocaleString("en-US", {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      })}`;
                              return (
                                <span
                                  className="mono-num"
                                  style={{
                                    color:
                                      amount > 0 ? "var(--good, #2d8a4e)" : "var(--muted)",
                                    fontWeight: amount > 0 ? 600 : 400,
                                  }}
                                  title={
                                    p.earningsUpdatedAt
                                      ? `cập nhật: ${fmtTime(p.earningsUpdatedAt)}`
                                      : "—"
                                  }
                                >
                                  {label}
                                </span>
                              );
                            })()}
                          </td>
                          <td>
                            <button
                              onClick={() => fetchReachOne(p.id)}
                              disabled={busy !== ""}
                              className="btn"
                              style={{ padding: "3px 8px", fontSize: 10 }}
                              title={
                                p.lastInsightsError
                                  ? p.lastInsightsError
                                  : `Lần cuối: ${fmtTime(p.lastInsightsAt)}`
                              }
                            >
                              {busy === `post-${p.id}` ? "…" : "Reach"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>
      </div>
    </>
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
        padding: "3px 8px",
        fontSize: 10,
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

function TokenPromptModal({
  fanpageName,
  block,
  onPick,
  onCancel,
}: {
  fanpageName: string;
  block: TokenAlternativesBlock;
  onPick: (overrideFpId: number) => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--paper)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: 20,
          maxWidth: 480,
          width: "100%",
          boxShadow: "0 16px 40px rgba(0,0,0,0.32)",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 700,
            color: "var(--ink)",
          }}
        >
          Token đang bị FB giới hạn
        </h3>
        <p style={{ margin: "10px 0 4px", fontSize: 13, color: "var(--ink)", lineHeight: 1.5 }}>
          Token của tài khoản{" "}
          <strong>{block.failedAccountUsername ?? "—"}</strong> dùng cho fanpage{" "}
          <strong>{fanpageName}</strong> đang bị Facebook chặn (abuse / rate
          limit).
        </p>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--muted)" }}>
          Fanpage này còn được quản lý bởi {block.alternatives.length} tài khoản
          khác. Dùng thử token của tài khoản nào?
        </p>

        <ul
          style={{
            margin: "0 0 16px",
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {block.alternatives.map((alt) => (
            <li key={alt.fanpageId}>
              <button
                onClick={() => onPick(alt.fanpageId)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  background: "var(--bg)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                  color: "var(--ink)",
                }}
              >
                <span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    @{alt.accountUsername}
                  </span>
                  {alt.accountFbName && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 11,
                        color: "var(--muted)",
                      }}
                    >
                      · {alt.accountFbName}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 11, color: "var(--accent, #1877f2)" }}>
                  Dùng token này →
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              padding: "7px 16px",
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
        </div>
      </div>
    </div>
  );
}
