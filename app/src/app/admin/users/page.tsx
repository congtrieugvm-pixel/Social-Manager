"use client";

import { useCallback, useEffect, useState } from "react";

interface UserRow {
  id: number;
  username: string;
  role: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

interface MeResp {
  user: { id: number; username: string; role: string } | null;
}

function fmtDate(unixSec: number): string {
  if (!unixSec) return "—";
  const d = new Date(unixSec * 1000);
  return d.toLocaleString("vi-VN");
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [meId, setMeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Add user form
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Per-row pending state for password reset / role change / delete
  const [rowBusy, setRowBusy] = useState<Record<number, string | null>>({});
  const [rowError, setRowError] = useState<Record<number, string | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setGlobalError(null);
    try {
      const [meRes, usersRes] = await Promise.all([
        fetch("/api/auth/me", { cache: "no-store" }),
        fetch("/api/admin/users", { cache: "no-store" }),
      ]);
      const me = (await meRes.json()) as MeResp;
      setMeId(me.user?.id ?? null);
      if (!usersRes.ok) {
        const data = (await usersRes.json().catch(() => ({}))) as {
          error?: string;
        };
        setGlobalError(data.error ?? `Lỗi ${usersRes.status}`);
        return;
      }
      const data = (await usersRes.json()) as { users: UserRow[] };
      setUsers(data.users);
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createOne(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "X-Body": JSON.stringify({
            username: newUsername.trim(),
            password: newPassword,
            role: newRole,
          }),
        },
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setCreateError(data.error ?? `Lỗi ${res.status}`);
        return;
      }
      setNewUsername("");
      setNewPassword("");
      setNewRole("user");
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function patchUser(id: number, patch: Record<string, unknown>, busyTag: string) {
    setRowBusy((b) => ({ ...b, [id]: busyTag }));
    setRowError((b) => ({ ...b, [id]: null }));
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "X-Body": JSON.stringify(patch) },
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setRowError((b) => ({
          ...b,
          [id]: data.error ?? `Lỗi ${res.status}`,
        }));
        return false;
      }
      await load();
      return true;
    } catch (err) {
      setRowError((b) => ({
        ...b,
        [id]: err instanceof Error ? err.message : String(err),
      }));
      return false;
    } finally {
      setRowBusy((b) => ({ ...b, [id]: null }));
    }
  }

  async function toggleActive(u: UserRow) {
    await patchUser(u.id, { isActive: !u.isActive }, "active");
  }

  async function changeRole(u: UserRow, role: "admin" | "user") {
    if (u.role === role) return;
    await patchUser(u.id, { role }, "role");
  }

  async function resetPassword(u: UserRow) {
    const next = window.prompt(
      `Đặt mật khẩu mới cho @${u.username} (tối thiểu 6 ký tự):`,
      "",
    );
    if (next == null) return;
    if (next.length < 6) {
      setRowError((b) => ({ ...b, [u.id]: "Mật khẩu tối thiểu 6 ký tự" }));
      return;
    }
    const ok = await patchUser(u.id, { password: next }, "pwd");
    if (ok) {
      window.alert(`Đã đổi mật khẩu cho @${u.username}. Mọi phiên cũ đã bị huỷ.`);
    }
  }

  async function removeUser(u: UserRow) {
    if (!window.confirm(`Xoá user @${u.username}? Không thể phục hồi.`)) return;
    setRowBusy((b) => ({ ...b, [u.id]: "delete" }));
    setRowError((b) => ({ ...b, [u.id]: null }));
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setRowError((b) => ({
          ...b,
          [u.id]: data.error ?? `Lỗi ${res.status}`,
        }));
        return;
      }
      await load();
    } catch (err) {
      setRowError((b) => ({
        ...b,
        [u.id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setRowBusy((b) => ({ ...b, [u.id]: null }));
    }
  }

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <span className="eyebrow">Admin</span>
          <h1 className="h1-serif">
            Quản lý <em>User</em>
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
            {users.length} user
          </span>
        </div>
        <button onClick={load} disabled={loading} className="btn">
          {loading ? "Đang tải…" : "Refresh"}
        </button>
      </header>

      {globalError && (
        <div
          className="mono"
          style={{
            color: "#e05b5b",
            fontSize: 12,
            marginBottom: 12,
            letterSpacing: "0.04em",
          }}
        >
          ⚠ {globalError}
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="h2-serif">
              Thêm <em>user</em>
            </h2>
            <div className="section-label" style={{ marginTop: 4 }}>
              Tạo tài khoản mới (admin được toàn quyền, user là quyền thường)
            </div>
          </div>
        </div>
        <form
          onSubmit={createOne}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 160px auto",
            gap: 10,
            alignItems: "end",
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="section-label">Username</span>
            <input
              className="input"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              spellCheck={false}
              placeholder="3-32 ký tự"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="section-label">Password</span>
            <input
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Tối thiểu 6 ký tự"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="section-label">Role</span>
            <select
              className="input"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "admin" | "user")}
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={
              creating || !newUsername.trim() || newPassword.length < 6
            }
            className="btn btn-accent"
          >
            {creating ? "Đang tạo…" : "+ Thêm"}
          </button>
        </form>
        {createError && (
          <div
            className="mono"
            style={{
              color: "#e05b5b",
              fontSize: 11,
              marginTop: 8,
              letterSpacing: "0.04em",
            }}
          >
            ⚠ {createError}
          </div>
        )}
      </section>

      <section className="section">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 50 }}>#</th>
                <th>Username</th>
                <th style={{ width: 120 }}>Role</th>
                <th style={{ width: 110 }}>Trạng thái</th>
                <th style={{ width: 170 }}>Tạo lúc</th>
                <th style={{ width: 320 }}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} style={{ padding: 56, textAlign: "center" }}>
                    <span className="text-muted">Chưa có user nào</span>
                  </td>
                </tr>
              )}
              {users.map((u, idx) => {
                const isMe = meId === u.id;
                const busy = rowBusy[u.id] ?? null;
                const err = rowError[u.id] ?? null;
                return (
                  <tr key={u.id}>
                    <td className="right">
                      <span className="mono-num text-muted">{idx + 1}</span>
                    </td>
                    <td>
                      <span
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontSize: 15,
                        }}
                      >
                        @{u.username}
                      </span>
                      {isMe && (
                        <span
                          className="mono"
                          style={{
                            marginLeft: 8,
                            fontSize: 9,
                            letterSpacing: "0.12em",
                            color: "var(--accent)",
                          }}
                        >
                          BẠN
                        </span>
                      )}
                    </td>
                    <td>
                      <select
                        value={u.role}
                        disabled={busy !== null}
                        onChange={(e) =>
                          changeRole(u, e.target.value as "admin" | "user")
                        }
                        className="input"
                        style={{ padding: "3px 6px", fontSize: 11 }}
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td>
                      <button
                        onClick={() => toggleActive(u)}
                        disabled={busy !== null}
                        className="btn"
                        style={{
                          padding: "3px 8px",
                          fontSize: 10,
                          color: u.isActive ? "var(--good)" : "#e05b5b",
                          borderColor: u.isActive ? "var(--good)" : "#e05b5b",
                        }}
                      >
                        {u.isActive ? "● Active" : "○ Khoá"}
                      </button>
                    </td>
                    <td>
                      <span
                        className="mono"
                        style={{ fontSize: 10, color: "var(--muted)" }}
                      >
                        {fmtDate(u.createdAt)}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          onClick={() => resetPassword(u)}
                          disabled={busy !== null}
                          className="btn"
                          style={{ padding: "3px 8px", fontSize: 10 }}
                          title="Đặt mật khẩu mới + xoá mọi phiên cũ"
                        >
                          {busy === "pwd" ? "…" : "Đổi pass"}
                        </button>
                        <button
                          onClick={() => removeUser(u)}
                          disabled={busy !== null || isMe}
                          className="btn"
                          style={{
                            padding: "3px 8px",
                            fontSize: 10,
                            color: "#e05b5b",
                            borderColor: "#e05b5b",
                          }}
                          title={isMe ? "Không thể tự xoá" : "Xoá user"}
                        >
                          {busy === "delete" ? "…" : "Xoá"}
                        </button>
                        {err && (
                          <span
                            className="mono"
                            style={{
                              fontSize: 10,
                              color: "#e05b5b",
                              flexBasis: "100%",
                            }}
                          >
                            ⚠ {err}
                          </span>
                        )}
                      </div>
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
