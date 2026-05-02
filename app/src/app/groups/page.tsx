"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface GroupRow {
  id: number;
  name: string;
  color: string;
  description: string | null;
  count: number;
  createdAt: string;
}

const PRESET_COLORS = [
  "#d94a1f",
  "#2d5a3d",
  "#b88c3a",
  "#1a1915",
  "#7a4e9c",
  "#2f6bb0",
  "#c23e6f",
  "#6b7a44",
];

export default function GroupsPage() {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState(PRESET_COLORS[0]);
  const [formDesc, setFormDesc] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/groups", { cache: "no-store" });
      const data = (await res.json()) as { groups: GroupRow[] };
      setGroups(data.groups);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setEditingId(null);
    setFormName("");
    setFormColor(PRESET_COLORS[0]);
    setFormDesc("");
  }

  function startEdit(g: GroupRow) {
    setEditingId(g.id);
    setFormName(g.name);
    setFormColor(g.color);
    setFormDesc(g.description ?? "");
  }

  async function submit() {
    const name = formName.trim();
    if (!name) {
      alert("Tên nhóm không được trống");
      return;
    }
    const payload = { name, color: formColor, description: formDesc.trim() };
    const res =
      editingId == null
        ? await fetch("/api/groups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/groups/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Lỗi" }));
      alert(err.error ?? "Lỗi");
      return;
    }
    resetForm();
    await load();
  }

  async function deleteGroup(id: number, count: number) {
    const msg =
      count > 0
        ? `Xóa nhóm này? ${count} tài khoản sẽ chuyển về "không nhóm".`
        : "Xóa nhóm này?";
    if (!confirm(msg)) return;
    await fetch(`/api/groups/${id}`, { method: "DELETE" });
    if (editingId === id) resetForm();
    await load();
  }

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <span className="eyebrow">Phân loại tài khoản</span>
          <h1 className="h1-serif">
            Quản lý <em>nhóm</em>
          </h1>
        </div>
        <Link href="/" className="btn">
          ← Danh sách
        </Link>
      </header>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="h2-serif">
              {editingId == null ? (
                <>
                  Tạo <em>nhóm mới</em>
                </>
              ) : (
                <>
                  Cập nhật <em>nhóm</em>
                </>
              )}
            </h2>
            <div className="section-label" style={{ marginTop: 4 }}>
              Đặt tên, chọn màu đại diện và mô tả ngắn
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <div>
            <div className="section-label" style={{ marginBottom: 6 }}>
              Tên nhóm
            </div>
            <input
              className="input"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Ví dụ: Tài khoản VN, Tài khoản US…"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <div className="section-label" style={{ marginBottom: 6 }}>
              Màu
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFormColor(c)}
                  aria-label={`Chọn màu ${c}`}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    background: c,
                    border:
                      formColor === c
                        ? "3px solid var(--ink)"
                        : "1px solid var(--line)",
                    cursor: "pointer",
                  }}
                />
              ))}
              <input
                type="color"
                value={formColor}
                onChange={(e) => setFormColor(e.target.value)}
                style={{
                  width: 32,
                  height: 28,
                  border: "1px solid var(--line)",
                  background: "transparent",
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="section-label" style={{ marginBottom: 6 }}>
            Mô tả (tuỳ chọn)
          </div>
          <input
            className="input"
            value={formDesc}
            onChange={(e) => setFormDesc(e.target.value)}
            placeholder="Mục đích / ghi chú nhóm này"
            style={{ width: "100%" }}
          />
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={submit} className="btn btn-accent">
            {editingId == null ? "Tạo nhóm" : "Lưu thay đổi"}
          </button>
          {editingId != null && (
            <button onClick={resetForm} className="btn">
              Huỷ
            </button>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="h2-serif">
              Danh sách <em>nhóm</em>
            </h2>
            <div className="section-label" style={{ marginTop: 4 }}>
              {groups.length === 0
                ? "Chưa có nhóm nào"
                : `${groups.length} nhóm · ${groups.reduce((s, g) => s + g.count, 0)} tài khoản đã phân`}
            </div>
          </div>
          <button onClick={load} disabled={loading} className="btn">
            Refresh
          </button>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 50 }}>Màu</th>
                <th>Tên</th>
                <th>Mô tả</th>
                <th className="right">Tài khoản</th>
                <th style={{ width: 160 }}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} style={{ padding: 56, textAlign: "center" }}>
                    <div className="section-label" style={{ marginBottom: 12 }}>
                      Trống
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontSize: 18,
                        fontStyle: "italic",
                        color: "var(--muted)",
                      }}
                    >
                      Tạo nhóm đầu tiên ở form phía trên
                    </div>
                  </td>
                </tr>
              )}
              {groups.map((g) => (
                <tr key={g.id} className={editingId === g.id ? "selected" : ""}>
                  <td>
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 999,
                        background: g.color,
                        display: "inline-block",
                        border: "1px solid var(--line)",
                      }}
                    />
                  </td>
                  <td>
                    <span
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontSize: 16,
                        color: "var(--ink)",
                      }}
                    >
                      {g.name}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>
                      {g.description || "—"}
                    </span>
                  </td>
                  <td className="right">
                    <span className="mono-num">{g.count}</span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => startEdit(g)}
                        className="btn"
                        style={{ padding: "6px 12px", fontSize: 10 }}
                      >
                        Sửa
                      </button>
                      <button
                        onClick={() => deleteGroup(g.id, g.count)}
                        className="btn btn-danger"
                        style={{ padding: "6px 12px", fontSize: 10 }}
                      >
                        Xóa
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
