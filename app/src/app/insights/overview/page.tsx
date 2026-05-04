"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { safeJson } from "@/lib/req-body";

// Chunk size for bulk fanpage POSTs. Workers Paid (30s CPU + 1000
// subrequests). Each page = ~10–13 FB Graph subrequests; 15 pages × 13 =
// 195 subrequests + ~15s wall-clock — comfortably under both caps.
const BULK_FP_CHUNK = 15;

interface OverviewRow {
  id: number;
  name: string;
  pictureUrl: string | null;
  link: string | null;
  username: string | null;
  category: string | null;
  hasPageToken: boolean;
  insightGroupId: number | null;
  groupName: string | null;
  groupColor: string | null;
  ownerFbName: string | null;
  ownerUsername: string | null;
  fanCount: number | null;
  followersCount: number | null;
  fanDelta7d: number | null;
  followerDelta7d: number | null;
  lastSyncedAt: number | null;
  lastSyncError: string | null;
  pageReach28d: number | null;
  postCount: number;
  postsWithReach: number;
  totalReach: number;
  totalImpressions: number;
  totalEngaged: number;
  totalClicks: number;
  totalReactions: number;
  totalComments: number;
  totalShares: number;
}

interface GroupRow {
  id: number;
  name: string;
  color: string;
  count: number;
}

type SortKey =
  | "name"
  | "group"
  | "fans"
  | "fanDelta"
  | "pageReach28d"
  | "totalReach"
  | "totalImpressions"
  | "totalEngaged"
  | "postCount"
  | "lastSync";

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("vi-VN");
}
function fmtDelta(n: number | null): { text: string; color: string } {
  if (n == null) return { text: "—", color: "var(--muted)" };
  if (n === 0) return { text: "0", color: "var(--muted)" };
  if (n > 0) return { text: `+${n.toLocaleString("vi-VN")}`, color: "var(--good, #2d8a4e)" };
  return { text: n.toLocaleString("vi-VN"), color: "var(--accent)" };
}
function fmtTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function InsightsOverviewPage() {
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<"all" | "unassigned" | number>("all");
  const [sortKey, setSortKey] = useState<SortKey>("totalReach");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [oRes, gRes] = await Promise.all([
        fetch("/api/insights/overview", { cache: "no-store" }),
        fetch("/api/insight-groups", { cache: "no-store" }),
      ]);
      const o = await safeJson<{ rows?: OverviewRow[] }>(oRes);
      const g = await safeJson<{ groups?: GroupRow[] }>(gRes);
      setRows(o.rows ?? []);
      setGroups(g.groups ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let arr = rows;
    if (groupFilter === "unassigned") arr = arr.filter((r) => r.insightGroupId == null);
    else if (typeof groupFilter === "number")
      arr = arr.filter((r) => r.insightGroupId === groupFilter);

    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.username ?? "").toLowerCase().includes(q) ||
          (r.category ?? "").toLowerCase().includes(q) ||
          (r.groupName ?? "").toLowerCase().includes(q),
      );
    }

    const sign = sortDir === "asc" ? 1 : -1;
    const sorted = [...arr].sort((a, b) => {
      const getVal = (r: OverviewRow): number | string => {
        switch (sortKey) {
          case "name":
            return r.name.toLowerCase();
          case "group":
            return (r.groupName ?? "zzz").toLowerCase();
          case "fans":
            return r.fanCount ?? -1;
          case "fanDelta":
            return r.fanDelta7d ?? 0;
          case "pageReach28d":
            return r.pageReach28d ?? -1;
          case "totalReach":
            return r.totalReach;
          case "totalImpressions":
            return r.totalImpressions;
          case "totalEngaged":
            return r.totalEngaged;
          case "postCount":
            return r.postCount;
          case "lastSync":
            return r.lastSyncedAt ?? 0;
        }
      };
      const va = getVal(a);
      const vb = getVal(b);
      if (typeof va === "string" && typeof vb === "string") {
        return sign * va.localeCompare(vb);
      }
      return sign * ((va as number) - (vb as number));
    });
    return sorted;
  }, [rows, search, groupFilter, sortKey, sortDir]);

  const sigma = useMemo(() => {
    return {
      fans: filtered.reduce((s, r) => s + (r.fanCount ?? 0), 0),
      followers: filtered.reduce((s, r) => s + (r.followersCount ?? 0), 0),
      fanDelta: filtered.reduce((s, r) => s + (r.fanDelta7d ?? 0), 0),
      pageReach28d: filtered.reduce((s, r) => s + (r.pageReach28d ?? 0), 0),
      totalReach: filtered.reduce((s, r) => s + r.totalReach, 0),
      totalImpr: filtered.reduce((s, r) => s + r.totalImpressions, 0),
      totalEng: filtered.reduce((s, r) => s + r.totalEngaged, 0),
      postCount: filtered.reduce((s, r) => s + r.postCount, 0),
    };
  }, [filtered]);

  async function syncAllInsights() {
    const ids = filtered.filter((r) => r.hasPageToken).map((r) => r.id);
    if (ids.length === 0) return;
    setBusy(true);
    setMessage("");
    setError("");
    let okCount = 0;
    let errCount = 0;
    let skipCount = 0;
    let firstError: string | null = null;
    try {
      // Chunked sequential — single request over all ids exceeds CF Workers
      // ~30s wall-clock when N is large (FB Graph API call per page).
      for (let i = 0; i < ids.length; i += BULK_FP_CHUNK) {
        const chunk = ids.slice(i, i + BULK_FP_CHUNK);
        const res = await fetch("/api/fanpages/insights/batch", {
          method: "POST",
          headers: { "X-Body": JSON.stringify({ ids: chunk }) },
        });
        const data = await safeJson<{
          okCount?: number;
          errCount?: number;
          skipCount?: number;
          error?: string;
        }>(res);
        if (!res.ok || data.error) {
          if (!firstError) firstError = data.error ?? `Lỗi ${res.status}`;
          errCount += chunk.length;
          continue;
        }
        okCount += data.okCount ?? 0;
        errCount += data.errCount ?? 0;
        skipCount += data.skipCount ?? 0;
        setMessage(
          `Insight trang: ${Math.min(i + chunk.length, ids.length)}/${ids.length} · ${okCount} OK · ${errCount} lỗi`,
        );
      }
      if (firstError) setError(firstError);
      setMessage(
        `Insight trang: ${okCount} OK · ${errCount} lỗi · ${skipCount} skip`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function syncAllPostReach() {
    const ids = filtered.filter((r) => r.hasPageToken && r.postCount > 0).map((r) => r.id);
    if (ids.length === 0) return;
    setBusy(true);
    setMessage("");
    setError("");
    let ok = 0;
    let err = 0;
    let skip = 0;
    let total = 0;
    try {
      for (const id of ids) {
        const res = await fetch("/api/posts/insights/batch", {
          method: "POST",
          headers: { "X-Body": JSON.stringify({ fanpageId: id }) },
        });
        const data = await safeJson<{
          total?: number;
          okCount?: number;
          errCount?: number;
          skipCount?: number;
        }>(res);
        ok += data.okCount ?? 0;
        err += data.errCount ?? 0;
        skip += data.skipCount ?? 0;
        total += data.total ?? 0;
        setMessage(`Reach posts: ${ok}/${total} OK · ${err} lỗi`);
      }
      setMessage(`Reach posts: ${ok}/${total} OK · ${err} lỗi · ${skip} bỏ qua`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function setSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  const unassignedCount = rows.filter((r) => r.insightGroupId == null).length;

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <span className="eyebrow">Facebook · Insights · Tổng</span>
          <h1 className="h1-serif">
            Bảng quản lý <em>Insight tổng</em>
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
            {filtered.length}/{rows.length} fanpage · {sigma.postCount.toLocaleString("vi-VN")} post
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Link href="/insights" className="btn" style={{ padding: "6px 12px", fontSize: 10 }}>
            ← Chi tiết
          </Link>
          <Link href="/fanpage" className="btn" style={{ padding: "6px 12px", fontSize: 10 }}>
            Danh sách fanpage
          </Link>
          <button
            onClick={load}
            disabled={loading}
            className="btn"
            style={{ padding: "6px 12px", fontSize: 10 }}
          >
            {loading ? "Đang tải…" : "↻ Reload"}
          </button>
        </div>
      </header>

      <section className="section" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Chip
            active={groupFilter === "all"}
            onClick={() => setGroupFilter("all")}
            label={`Tất cả · ${rows.length}`}
          />
          <Chip
            active={groupFilter === "unassigned"}
            onClick={() => setGroupFilter("unassigned")}
            label={`Chưa gán · ${unassignedCount}`}
            color="#7a766a"
          />
          {groups.map((g) => (
            <Chip
              key={g.id}
              active={groupFilter === g.id}
              onClick={() => setGroupFilter(g.id)}
              label={`${g.name} · ${g.count}`}
              color={g.color}
            />
          ))}
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            padding: "10px 14px",
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "var(--bg-warm)",
          }}
        >
          <input
            className="input"
            placeholder="Tìm tên, username, category, nhóm…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 220, padding: "6px 10px", fontSize: 12 }}
          />
          <button
            onClick={syncAllInsights}
            disabled={busy}
            className="btn"
            style={{ padding: "6px 12px", fontSize: 11 }}
          >
            {busy ? "Đang tải…" : `↻ Insight ${filtered.filter((r) => r.hasPageToken).length} trang`}
          </button>
          <button
            onClick={syncAllPostReach}
            disabled={busy}
            className="btn btn-accent"
            style={{ padding: "6px 12px", fontSize: 11 }}
          >
            {busy ? "Đang tải…" : "Reach all posts"}
          </button>
        </div>

        {message && (
          <div className="mono" style={{ fontSize: 11, color: "var(--good)" }}>
            {message}
          </div>
        )}
        {error && (
          <div className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>
            ⚠ {error}
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 10,
            padding: "12px 14px",
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "var(--bg-warm)",
          }}
        >
          <Kv label="Σ Likes" value={fmtNum(sigma.fans)} />
          <Kv label="Σ Followers" value={fmtNum(sigma.followers)} />
          <Kv
            label="Σ ΔLikes 7d"
            value={fmtDelta(sigma.fanDelta).text}
            color={fmtDelta(sigma.fanDelta).color}
          />
          <Kv label="Σ Reach trang 28d" value={fmtNum(sigma.pageReach28d)} />
          <Kv label="Σ Reach posts" value={fmtNum(sigma.totalReach)} />
          <Kv label="Σ Impressions" value={fmtNum(sigma.totalImpr)} />
          <Kv label="Σ Engaged" value={fmtNum(sigma.totalEng)} />
          <Kv label="Σ Posts" value={fmtNum(sigma.postCount)} />
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <TH active={sortKey === "name"} dir={sortDir} onClick={() => setSort("name")}>
                  Fanpage
                </TH>
                <TH active={sortKey === "group"} dir={sortDir} onClick={() => setSort("group")} w={100}>
                  Nhóm
                </TH>
                <TH active={sortKey === "fans"} dir={sortDir} onClick={() => setSort("fans")} w={90}>
                  Likes
                </TH>
                <TH active={sortKey === "fanDelta"} dir={sortDir} onClick={() => setSort("fanDelta")} w={80}>
                  Δ 7d
                </TH>
                <TH
                  active={sortKey === "pageReach28d"}
                  dir={sortDir}
                  onClick={() => setSort("pageReach28d")}
                  w={100}
                >
                  Reach 28d
                </TH>
                <TH
                  active={sortKey === "totalReach"}
                  dir={sortDir}
                  onClick={() => setSort("totalReach")}
                  w={100}
                >
                  Σ Reach
                </TH>
                <TH
                  active={sortKey === "totalImpressions"}
                  dir={sortDir}
                  onClick={() => setSort("totalImpressions")}
                  w={100}
                >
                  Σ Impr
                </TH>
                <TH
                  active={sortKey === "totalEngaged"}
                  dir={sortDir}
                  onClick={() => setSort("totalEngaged")}
                  w={90}
                >
                  Σ Eng
                </TH>
                <TH
                  active={sortKey === "postCount"}
                  dir={sortDir}
                  onClick={() => setSort("postCount")}
                  w={80}
                >
                  Posts
                </TH>
                <TH
                  active={sortKey === "lastSync"}
                  dir={sortDir}
                  onClick={() => setSort("lastSync")}
                  w={120}
                >
                  Sync
                </TH>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                    Không có fanpage phù hợp
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const delta = fmtDelta(r.fanDelta7d);
                const pageLink =
                  r.link ||
                  (r.username ? `https://facebook.com/${r.username}` : null);
                return (
                  <tr key={r.id}>
                    <td>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                        {r.pictureUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.pictureUrl}
                            alt=""
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 4,
                              objectFit: "cover",
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <div style={{ minWidth: 0 }}>
                          {pageLink ? (
                            <a
                              href={pageLink}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: "var(--ink)",
                                textDecoration: "none",
                                display: "block",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                maxWidth: 260,
                              }}
                              title={r.name}
                            >
                              {r.name} ↗
                            </a>
                          ) : (
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: "var(--ink)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                maxWidth: 260,
                              }}
                            >
                              {r.name}
                            </div>
                          )}
                          <div className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>
                            {r.username ? `@${r.username} · ` : ""}
                            {r.category ?? "—"}
                            {!r.hasPageToken && " · ⚠ no token"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {r.groupName ? (
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: r.groupColor ?? "#5e6ad2",
                            color: "#fff",
                            fontSize: 10,
                            letterSpacing: "0.04em",
                          }}
                        >
                          {r.groupName}
                        </span>
                      ) : (
                        <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>
                          —
                        </span>
                      )}
                    </td>
                    <td><span className="mono-num">{fmtNum(r.fanCount)}</span></td>
                    <td>
                      <span className="mono-num" style={{ color: delta.color, fontWeight: 600 }}>
                        {delta.text}
                      </span>
                    </td>
                    <td><span className="mono-num">{fmtNum(r.pageReach28d)}</span></td>
                    <td>
                      <span
                        className="mono-num"
                        style={{
                          fontWeight: 600,
                          color: r.totalReach > 0 ? "var(--ink)" : "var(--muted)",
                        }}
                      >
                        {fmtNum(r.totalReach)}
                      </span>
                    </td>
                    <td><span className="mono-num">{fmtNum(r.totalImpressions)}</span></td>
                    <td><span className="mono-num">{fmtNum(r.totalEngaged)}</span></td>
                    <td>
                      <span className="mono-num">
                        {r.postsWithReach}/{r.postCount}
                      </span>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>
                        {fmtTime(r.lastSyncedAt)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Kv({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
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
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: color ?? "var(--ink)" }}>{value}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="mono"
      style={{
        padding: "4px 10px",
        fontSize: 10,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        borderRadius: 999,
        border: active ? `1px solid ${color ?? "var(--ink)"}` : "1px solid var(--line)",
        background: active ? color ?? "var(--ink)" : "transparent",
        color: active ? "#fff" : "var(--ink)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function TH({
  children,
  active,
  dir,
  onClick,
  w,
}: {
  children: React.ReactNode;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  w?: number;
}) {
  return (
    <th
      onClick={onClick}
      style={{
        width: w,
        cursor: "pointer",
        userSelect: "none",
        color: active ? "var(--ink)" : undefined,
      }}
    >
      {children}
      {active && (
        <span style={{ marginLeft: 4, fontSize: 9 }}>{dir === "asc" ? "▲" : "▼"}</span>
      )}
    </th>
  );
}
