"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

interface FacebookRow {
  id: number;
  username: string;
  fbUserId: string | null;
  fbName: string | null;
  fbProfilePic: string | null;
  hasToken: boolean;
  tokenExpiresAt: number | null;
  note: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  groupId: number | null;
  groupName: string | null;
  groupColor: string | null;
  statusId: number | null;
  statusName: string | null;
  statusColor: string | null;
}

interface GroupRow {
  id: number;
  name: string;
  color: string;
  count: number;
}

interface StatusRow {
  id: number;
  name: string;
  color: string;
}

interface DetailResponse {
  id: number;
  username: string;
  password: string | null;
  email: string | null;
  twofa: string | null;
  emailPassword: string | null;
  token: string | null;
  hasToken: boolean;
  tokenExpiresAt: number | null;
  note: string | null;
  groupId: number | null;
  groupName: string | null;
  statusId: number | null;
  statusName: string | null;
}

interface CtxState {
  x: number;
  y: number;
  id: number;
  username: string;
  loading: boolean;
  detail: DetailResponse | null;
  error: string | null;
  browserLogin: "idle" | "loading";
  browserMessage: string | null;
  browserError: string | null;
}

interface EditState {
  id: number;
  loading: boolean;
  saving: boolean;
  error: string | null;
  username: string;
  password: string;
  email: string;
  twofa: string;
  emailPassword: string;
  token: string;
  note: string;
}

const PAGE_SIZE = 50;

export default function FacebookPage() {
  const [rows, setRows] = useState<FacebookRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [statusesList, setStatusesList] = useState<StatusRow[]>([]);
  const [groupFilter, setGroupFilter] = useState<"all" | "none" | number>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  // Context-menu positioning: measure actual rendered size and clamp to
  // viewport so the menu never overflows off-screen (e.g., when right-
  // clicking near bottom). `menuPos` is null until the layout effect runs;
  // initial paint uses raw click coords as a fallback.
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  const [ctxMenuPos, setCtxMenuPos] = useState<{ top: number; left: number } | null>(null);

  // Reset clamped pos when a different row is clicked — fall back to fresh
  // ctx.x/y for the first frame, then re-clamp in useLayoutEffect.
  useEffect(() => {
    setCtxMenuPos(null);
  }, [ctx?.id]);

  // Measure menu after render and adjust position so it stays in viewport.
  // Re-runs when content changes (loading → loaded grows the menu).
  useLayoutEffect(() => {
    if (!ctx || !ctxMenuRef.current) return;
    const el = ctxMenuRef.current;
    const m = el.getBoundingClientRect();
    const margin = 8;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    let top = ctx.y;
    let left = ctx.x;
    if (top + m.height + margin > vh) {
      top = Math.max(margin, vh - m.height - margin);
    }
    if (left + m.width + margin > vw) {
      left = Math.max(margin, vw - m.width - margin);
    }
    setCtxMenuPos((prev) => {
      if (prev && prev.top === top && prev.left === left) return prev;
      return { top, left };
    });
  }, [ctx, ctx?.loading, ctx?.detail, ctx?.error]);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      if (search) params.set("q", search);
      if (groupFilter !== "all") params.set("group", String(groupFilter));
      const res = await fetch(`/api/facebook/accounts?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [page, search, groupFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    Promise.all([
      fetch("/api/groups", { cache: "no-store" }),
      fetch("/api/statuses", { cache: "no-store" }),
    ])
      .then(async ([g, s]) => {
        const gd = await g.json();
        const sd = await s.json();
        setGroups(gd.groups ?? []);
        setStatusesList(sd.statuses ?? []);
      })
      .catch(() => {});
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filterChips = useMemo(
    () => [
      { key: "all" as const, label: "Tất cả", color: undefined },
      { key: "none" as const, label: "Chưa nhóm", color: undefined },
      ...groups.map((g) => ({ key: g.id, label: g.name, color: g.color })),
    ],
    [groups],
  );

  async function copyText(value: string, tag: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedLabel(tag);
      setTimeout(() => setCopiedLabel((t) => (t === tag ? null : t)), 1200);
    } catch {}
  }

  async function openCtxMenu(e: React.MouseEvent, row: FacebookRow) {
    e.preventDefault();
    setCtx({
      x: e.clientX,
      y: e.clientY,
      id: row.id,
      username: row.username,
      loading: true,
      detail: null,
      error: null,
      browserLogin: "idle",
      browserMessage: null,
      browserError: null,
    });
    try {
      const res = await fetch(`/api/facebook/accounts/${row.id}`, { cache: "no-store" });
      if (!res.ok) {
        setCtx((prev) =>
          prev && prev.id === row.id
            ? { ...prev, loading: false, error: "Lỗi tải" }
            : prev,
        );
        return;
      }
      const data = (await res.json()) as DetailResponse;
      setCtx((prev) =>
        prev && prev.id === row.id ? { ...prev, loading: false, detail: data } : prev,
      );
    } catch {
      setCtx((prev) =>
        prev && prev.id === row.id
          ? { ...prev, loading: false, error: "Lỗi mạng" }
          : prev,
      );
    }
  }

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [ctx]);

  async function deleteAccount(id: number, username: string) {
    if (!confirm(`Xóa @${username}? Không thể phục hồi.`)) return;
    await fetch(`/api/facebook/accounts/${id}`, { method: "DELETE" });
    setCtx(null);
    await load();
  }

  function toggleOne(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const allVisibleIds = rows.map((r) => r.id);
  const allSelected =
    allVisibleIds.length > 0 && allVisibleIds.every((id) => selected.has(id));
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allVisibleIds));
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (
      !confirm(
        `Xóa vĩnh viễn ${ids.length} tài khoản Facebook? Toàn bộ fanpage / posts / snapshots liên quan cũng bị xóa.`,
      )
    ) {
      return;
    }
    setBulkAction("delete");
    setBulkMessage("");
    try {
      const res = await fetch("/api/facebook/accounts/bulk-delete", {
        method: "POST",
        headers: { "X-Body": JSON.stringify({ ids }) },
      });
      const data = (await res.json()) as { deleted?: number; error?: string };
      if (!res.ok || data.error) {
        setBulkMessage(`⚠ ${data.error ?? `Lỗi ${res.status}`}`);
      } else {
        setBulkMessage(`Đã xóa ${data.deleted ?? 0} tài khoản`);
        setSelected(new Set());
        await load();
      }
    } catch (e) {
      setBulkMessage(`⚠ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBulkAction(null);
    }
  }

  async function bulkUpdate(field: string, value: number | null) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkAction(`update-${field}`);
    setBulkMessage("");
    try {
      const res = await fetch("/api/facebook/accounts/bulk-update", {
        method: "POST",
        headers: { "X-Body": JSON.stringify({ ids, [field]: value }) },
      });
      const data = (await res.json()) as { updated?: number; error?: string };
      if (!res.ok || data.error) {
        setBulkMessage(`⚠ ${data.error ?? `Lỗi ${res.status}`}`);
      } else {
        setBulkMessage(`Cập nhật ${data.updated ?? 0} tài khoản`);
        await load();
      }
    } catch (e) {
      setBulkMessage(`⚠ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBulkAction(null);
    }
  }

  async function bulkSyncPages() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkAction("sync");
    setBulkMessage("");
    try {
      const res = await fetch("/api/facebook/accounts/sync-pages", {
        method: "POST",
        headers: { "X-Body": JSON.stringify({ ids }) },
      });
      const data = (await res.json()) as {
        total?: number;
        success?: number;
        failed?: number;
        error?: string;
      };
      if (!res.ok || data.error) {
        setBulkMessage(`⚠ ${data.error ?? `Lỗi ${res.status}`}`);
      } else {
        setBulkMessage(
          `Sync fanpage: ${data.success ?? 0}/${data.total ?? 0} OK · ${data.failed ?? 0} lỗi`,
        );
        await load();
      }
    } catch (e) {
      setBulkMessage(`⚠ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBulkAction(null);
    }
  }

  async function bulkRefreshAvatar() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkAction("avatar");
    setBulkMessage("");
    try {
      const res = await fetch("/api/facebook/accounts/refresh-avatar", {
        method: "POST",
        headers: { "X-Body": JSON.stringify({ ids }) },
      });
      const data = (await res.json()) as {
        total?: number;
        okCount?: number;
        errCount?: number;
        skipCount?: number;
        error?: string;
      };
      if (!res.ok || data.error) {
        setBulkMessage(`⚠ ${data.error ?? `Lỗi ${res.status}`}`);
      } else {
        setBulkMessage(
          `Avatar: ${data.okCount ?? 0}/${data.total ?? 0} OK · ${data.errCount ?? 0} lỗi · ${data.skipCount ?? 0} bỏ qua`,
        );
        await load();
      }
    } catch (e) {
      setBulkMessage(`⚠ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBulkAction(null);
    }
  }

  async function openEdit(id: number) {
    setEdit({
      id,
      loading: true,
      saving: false,
      error: null,
      username: "",
      password: "",
      email: "",
      twofa: "",
      emailPassword: "",
      token: "",
      note: "",
    });
    try {
      const res = await fetch(`/api/facebook/accounts/${id}`, { cache: "no-store" });
      const data = (await res.json()) as DetailResponse;
      setEdit({
        id,
        loading: false,
        saving: false,
        error: null,
        username: data.username,
        password: data.password ?? "",
        email: data.email ?? "",
        twofa: data.twofa ?? "",
        emailPassword: data.emailPassword ?? "",
        token: data.token ?? "",
        note: data.note ?? "",
      });
    } catch (e) {
      setEdit((prev) =>
        prev ? { ...prev, loading: false, error: e instanceof Error ? e.message : "Lỗi" } : prev,
      );
    }
  }

  async function saveEdit() {
    if (!edit) return;
    setEdit({ ...edit, saving: true, error: null });
    const res = await fetch(`/api/facebook/accounts/${edit.id}`, {
      method: "PATCH",
      headers: { "X-Body": JSON.stringify({
        username: edit.username,
        password: edit.password,
        email: edit.email,
        twofa: edit.twofa,
        emailPassword: edit.emailPassword,
        token: edit.token,
        note: edit.note,
      }) },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Lỗi" }));
      setEdit({ ...edit, saving: false, error: err.error ?? "Lỗi lưu" });
      return;
    }
    setEdit(null);
    await load();
  }

  async function startBrowserLogin(id: number) {
    setCtx((prev) =>
      prev && prev.id === id
        ? { ...prev, browserLogin: "loading", browserMessage: null, browserError: null }
        : prev,
    );
    try {
      const res = await fetch(`/api/facebook/accounts/${id}/hotmail-login`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setCtx((prev) =>
          prev && prev.id === id
            ? {
                ...prev,
                browserLogin: "idle",
                browserMessage: data.message ?? "Đã mở Chromium",
                browserError: null,
              }
            : prev,
        );
      } else {
        setCtx((prev) =>
          prev && prev.id === id
            ? {
                ...prev,
                browserLogin: "idle",
                browserMessage: null,
                browserError: data.error ?? "Lỗi",
              }
            : prev,
        );
      }
    } catch (e) {
      setCtx((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              browserLogin: "idle",
              browserMessage: null,
              browserError: e instanceof Error ? e.message : String(e),
            }
          : prev,
      );
    }
  }

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <span className="eyebrow">Facebook</span>
          <h1 className="h1-serif">
            Tài khoản <em>Facebook</em>
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
            {total.toLocaleString()} tài khoản
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Link href="/fanpage" className="btn" style={{ padding: "6px 12px", fontSize: 10 }}>
            Fanpage
          </Link>
          <Link href="/groups" className="btn" style={{ padding: "6px 12px", fontSize: 10 }}>
            Nhóm
          </Link>
          <Link href="/statuses" className="btn" style={{ padding: "6px 12px", fontSize: 10 }}>
            Trạng thái
          </Link>
          <Link href="/countries" className="btn" style={{ padding: "6px 12px", fontSize: 10 }}>
            Quốc gia
          </Link>
          <Link href="/machines" className="btn" style={{ padding: "6px 12px", fontSize: 10 }}>
            Máy
          </Link>
          <Link href="/employees" className="btn" style={{ padding: "6px 12px", fontSize: 10 }}>
            Nhân viên
          </Link>
          <Link
            href="/facebook/import"
            className="btn btn-primary"
            style={{ padding: "6px 14px", fontSize: 11 }}
          >
            + Import
          </Link>
        </div>
      </header>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {filterChips.map((chip) => {
          const active = groupFilter === chip.key;
          return (
            <button
              key={String(chip.key)}
              onClick={() => setGroupFilter(chip.key)}
              className="pill"
              style={{
                padding: "4px 10px",
                fontSize: 11,
                border: active ? "1px solid var(--ink)" : "1px solid var(--line)",
                background: active ? "var(--ink)" : "transparent",
                color: active ? "var(--paper)" : "var(--ink)",
                borderRadius: 999,
                cursor: "pointer",
              }}
            >
              {chip.color && (
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: chip.color,
                    marginRight: 6,
                    verticalAlign: "middle",
                  }}
                />
              )}
              {chip.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <input
          type="search"
          placeholder="Tìm username / fb_name / note…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input"
          style={{ flex: 1, maxWidth: 360, padding: "6px 12px", fontSize: 12 }}
        />
        {selected.size > 0 && (
          <>
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--accent)", letterSpacing: "0.05em" }}
            >
              Đã chọn {selected.size}
            </span>
            <button
              onClick={bulkSyncPages}
              disabled={bulkAction !== null}
              className="btn"
              style={{ padding: "5px 10px", fontSize: 11 }}
              title="Tải lại fanpage từ Facebook cho các tài khoản đã chọn"
            >
              {bulkAction === "sync" ? "Đang sync…" : "↻ Sync Pages"}
            </button>
            <button
              onClick={bulkRefreshAvatar}
              disabled={bulkAction !== null}
              className="btn"
              style={{ padding: "5px 10px", fontSize: 11 }}
              title="Làm mới ảnh đại diện FB (URL CDN hết hạn sau vài ngày) — chỉ gọi /me?picture, không sync fanpage"
            >
              {bulkAction === "avatar" ? "Đang lấy…" : "↻ Lấy AVT"}
            </button>
            <select
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") return;
                bulkUpdate("groupId", v === "none" ? null : Number(v));
                e.currentTarget.value = "";
              }}
              disabled={bulkAction !== null}
              className="input"
              style={{ fontSize: 11, padding: "5px 8px" }}
            >
              <option value="">Gán nhóm…</option>
              <option value="none">— Bỏ nhóm —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <select
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") return;
                bulkUpdate("statusId", v === "none" ? null : Number(v));
                e.currentTarget.value = "";
              }}
              disabled={bulkAction !== null}
              className="input"
              style={{ fontSize: 11, padding: "5px 8px" }}
            >
              <option value="">Gán status…</option>
              <option value="none">— Bỏ status —</option>
              {statusesList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              onClick={bulkDelete}
              disabled={bulkAction !== null}
              className="btn"
              style={{
                padding: "5px 10px",
                fontSize: 11,
                color: "#e05b5b",
                borderColor: "#e05b5b",
              }}
              title="Xóa các tài khoản đã chọn"
            >
              {bulkAction === "delete" ? "Đang xóa…" : `Xóa (${selected.size})`}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              disabled={bulkAction !== null}
              className="btn"
              style={{ padding: "5px 10px", fontSize: 11 }}
            >
              Bỏ chọn
            </button>
          </>
        )}
        {selected.size === 0 && <div style={{ flex: 1 }} />}
        <button onClick={load} disabled={loading} className="btn" style={{ padding: "6px 12px", fontSize: 10 }}>
          Refresh
        </button>
      </div>
      {bulkMessage && (
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: bulkMessage.startsWith("⚠") ? "#e05b5b" : "var(--good)",
            marginBottom: 8,
            letterSpacing: "0.04em",
          }}
        >
          {bulkMessage}
        </div>
      )}

      <section className="section">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Chọn tất cả"
                  />
                </th>
                <th style={{ width: 40 }}>#</th>
                <th>Tài khoản</th>
                <th>Token</th>
                <th>Nhóm</th>
                <th>Trạng thái</th>
                <th>Note</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} style={{ padding: 56, textAlign: "center" }}>
                    <div className="section-label" style={{ marginBottom: 12 }}>
                      Trống
                    </div>
                    <Link href="/facebook/import" className="text-accent">
                      Import ngay →
                    </Link>
                  </td>
                </tr>
              )}
              {rows.map((r, idx) => (
                <tr
                  key={r.id}
                  onContextMenu={(e) => openCtxMenu(e, r)}
                  className={selected.has(r.id) ? "selected" : ""}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleOne(r.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Chọn @${r.username}`}
                    />
                  </td>
                  <td className="right">
                    <span className="mono-num text-muted">
                      {(page - 1) * PAGE_SIZE + idx + 1}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <div
                        style={{
                          position: "relative",
                          width: 32,
                          height: 32,
                          flexShrink: 0,
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            borderRadius: 999,
                            background: "var(--line)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 13,
                            color: "var(--muted)",
                            fontFamily: "var(--font-serif)",
                          }}
                        >
                          {(r.fbName ?? r.username ?? "?").charAt(0).toUpperCase()}
                        </div>
                        {r.fbProfilePic && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.fbProfilePic}
                            alt=""
                            width={32}
                            height={32}
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                            style={{
                              position: "absolute",
                              inset: 0,
                              borderRadius: 999,
                              objectFit: "cover",
                              border: "1px solid var(--line)",
                            }}
                          />
                        )}
                      </div>
                      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                        <span
                          style={{
                            fontFamily: "var(--font-serif)",
                            fontSize: 14,
                            color: "var(--ink)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={r.fbName ?? "—"}
                        >
                          {r.fbName ?? "—"}
                        </span>
                        <a
                          href={`https://www.facebook.com/${r.fbUserId ?? r.username}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Mở Facebook trong tab mới"
                          className="mono"
                          style={{
                            fontSize: 11,
                            color: "var(--muted)",
                            textDecoration: "none",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) =>
                            ((e.target as HTMLAnchorElement).style.color = "var(--accent)")
                          }
                          onMouseLeave={(e) =>
                            ((e.target as HTMLAnchorElement).style.color = "var(--muted)")
                          }
                        >
                          @{r.username}
                        </a>
                      </div>
                    </div>
                  </td>
                  <td>
                    {r.hasToken ? (
                      <span
                        className="mono"
                        style={{ fontSize: 10, color: "var(--accent)", letterSpacing: "0.08em" }}
                      >
                        ✓ có token
                      </span>
                    ) : (
                      <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>
                        —
                      </span>
                    )}
                  </td>
                  <td>
                    {r.groupName ? (
                      <span
                        className="badge"
                        style={{
                          background: r.groupColor ?? "var(--bg-1)",
                          color: "#fff",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 11,
                        }}
                      >
                        {r.groupName}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {r.statusName ? (
                      <span
                        className="badge"
                        style={{
                          background: r.statusColor ?? "var(--bg-1)",
                          color: "#fff",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 11,
                        }}
                      >
                        {r.statusName}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {r.note ?? "—"}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => openEdit(r.id)}
                      className="btn"
                      style={{ padding: "4px 10px", fontSize: 10 }}
                    >
                      Sửa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 14 }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn"
              style={{ padding: "4px 12px", fontSize: 10 }}
            >
              ←
            </button>
            <span
              className="mono"
              style={{
                padding: "4px 12px",
                fontSize: 11,
                color: "var(--muted)",
                alignSelf: "center",
              }}
            >
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="btn"
              style={{ padding: "4px 12px", fontSize: 10 }}
            >
              →
            </button>
          </div>
        )}
      </section>

      {ctx && (
        <div
          ref={ctxMenuRef}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: "fixed",
            top: ctxMenuPos?.top ?? ctx.y,
            left: ctxMenuPos?.left ?? ctx.x,
            // Constrain max-height to viewport so very tall menus scroll
            // internally instead of bleeding off-screen.
            maxHeight: "calc(100vh - 16px)",
            overflowY: "auto",
            zIndex: 1000,
            background: "var(--paper)",
            border: "1px solid var(--line-strong)",
            borderRadius: 6,
            minWidth: 220,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            padding: 4,
            fontSize: 12,
          }}
        >
          <div
            className="mono"
            style={{
              padding: "6px 10px 8px",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--muted)",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <a
              href={`https://www.facebook.com/${ctx.detail?.username ?? ctx.username}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              @{ctx.username} ↗
            </a>
          </div>
          {ctx.loading && <div style={{ padding: 10, color: "var(--muted)" }}>Đang tải…</div>}
          {ctx.error && <div style={{ padding: 10, color: "#e05b5b" }}>{ctx.error}</div>}
          {ctx.detail && (() => {
            const d = ctx.detail;
            const items: Array<{ label: string; value: string | null; tag: string }> = [
              { label: "Copy User", value: d.username, tag: "user" },
              { label: "Copy Pass", value: d.password, tag: "pass" },
              { label: "Copy Email", value: d.email, tag: "email" },
              { label: "Copy 2FA", value: d.twofa, tag: "2fa" },
              { label: "Copy Pass Email", value: d.emailPassword, tag: "pmail" },
              { label: "Copy Token", value: d.token, tag: "token" },
            ];
            return (
              <div>
                <button
                  onClick={() => {
                    const id = ctx.id;
                    setCtx(null);
                    openEdit(id);
                  }}
                  style={menuBtnStyle()}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-1)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span>Sửa thông tin…</span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>✎</span>
                </button>

                <div style={{ padding: "4px 4px 0" }}>
                  <button
                    disabled={ctx.browserLogin === "loading" || !d.email}
                    onClick={() => startBrowserLogin(ctx.id)}
                    title={d.email ? "Mở Chromium, auto-fill Hotmail" : "Chưa có email"}
                    style={menuBtnStyle(ctx.browserLogin === "loading" || !d.email)}
                  >
                    <span>
                      {ctx.browserLogin === "loading"
                        ? "Đang mở Chromium…"
                        : "Login Hotmail (Chromium)"}
                    </span>
                    <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>↗</span>
                  </button>
                  {ctx.browserMessage && (
                    <div style={{ padding: "0 10px 4px", fontSize: 11, color: "var(--accent)" }}>
                      {ctx.browserMessage}
                    </div>
                  )}
                  {ctx.browserError && (
                    <div style={{ padding: "0 10px 4px", fontSize: 11, color: "#e05b5b" }}>
                      {ctx.browserError}
                    </div>
                  )}
                </div>

                <div style={{ borderTop: "1px solid var(--line)", margin: "4px -4px" }} />
                {items.map((it) => {
                  const disabled = !it.value;
                  const copied = copiedLabel === `fb-${ctx.id}-${it.tag}`;
                  return (
                    <button
                      key={it.tag}
                      disabled={disabled}
                      onClick={() => it.value && copyText(it.value, `fb-${ctx.id}-${it.tag}`)}
                      style={menuBtnStyle(disabled)}
                      onMouseEnter={(e) => {
                        if (!disabled) e.currentTarget.style.background = "var(--bg-1)";
                      }}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <span>{it.label}</span>
                      <span
                        className="mono"
                        style={{
                          fontSize: 10,
                          color: copied ? "var(--accent)" : "var(--muted)",
                        }}
                      >
                        {copied ? "✓" : disabled ? "—" : ""}
                      </span>
                    </button>
                  );
                })}

                <div style={{ borderTop: "1px solid var(--line)", margin: "4px -4px" }} />
                <button
                  onClick={() => deleteAccount(ctx.id, ctx.username)}
                  style={{ ...menuBtnStyle(), color: "#e05b5b" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-1)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span>Xóa tài khoản</span>
                  <span className="mono" style={{ fontSize: 10 }}>✕</span>
                </button>
              </div>
            );
          })()}
        </div>
      )}

      {edit && (
        <div className="modal-overlay" onClick={() => setEdit(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ marginBottom: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Sửa tài khoản Facebook</div>
              <h2 className="h2-serif" style={{ fontSize: 24 }}>
                @{edit.username}
              </h2>
            </div>

            {edit.loading ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Đang tải…</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <LabeledInput
                  label="Username"
                  value={edit.username}
                  onChange={(v) => setEdit({ ...edit, username: v })}
                />
                <LabeledInput
                  label="Password"
                  value={edit.password}
                  onChange={(v) => setEdit({ ...edit, password: v })}
                />
                <LabeledInput
                  label="Email"
                  value={edit.email}
                  onChange={(v) => setEdit({ ...edit, email: v })}
                />
                <LabeledInput
                  label="2FA secret"
                  value={edit.twofa}
                  onChange={(v) => setEdit({ ...edit, twofa: v })}
                />
                <LabeledInput
                  label="Email password"
                  value={edit.emailPassword}
                  onChange={(v) => setEdit({ ...edit, emailPassword: v })}
                />
                <div>
                  <div className="section-label" style={{ marginBottom: 6 }}>
                    Token (FB user access token)
                  </div>
                  <textarea
                    className="input"
                    value={edit.token}
                    onChange={(e) => setEdit({ ...edit, token: e.target.value })}
                    placeholder="EAAG... (paste FB access token ở đây)"
                    rows={3}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      resize: "vertical",
                    }}
                  />
                </div>
                <div>
                  <div className="section-label" style={{ marginBottom: 6 }}>Note</div>
                  <textarea
                    className="input"
                    value={edit.note}
                    onChange={(e) => setEdit({ ...edit, note: e.target.value })}
                    rows={2}
                    style={{ width: "100%", padding: "8px 10px", fontSize: 12, resize: "vertical" }}
                  />
                </div>

                {edit.error && (
                  <div style={{ color: "#e05b5b", fontSize: 12 }}>{edit.error}</div>
                )}

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                  <button onClick={() => setEdit(null)} className="btn" disabled={edit.saving}>
                    Huỷ
                  </button>
                  <button onClick={saveEdit} className="btn btn-accent" disabled={edit.saving}>
                    {edit.saving ? "Đang lưu…" : "Lưu thay đổi"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function menuBtnStyle(disabled = false): React.CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    width: "100%",
    textAlign: "left",
    padding: "7px 10px",
    background: "transparent",
    border: 0,
    color: disabled ? "var(--muted)" : "var(--ink)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
    fontFamily: "var(--font-sans)",
    borderRadius: 4,
  };
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="section-label" style={{ marginBottom: 6 }}>{label}</div>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%" }}
      />
    </div>
  );
}

// Reference statuses so we don't have "declared but not used" warnings if future features want it.
void ((_: StatusRow[]) => {}) as unknown as (s: StatusRow[]) => void;
