"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface StatusRow {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
  count: number;
  createdAt: string;
}

const PRESET_COLORS = [
  "#2d5a3d",
  "#2f6bb0",
  "#b88c3a",
  "#d94a1f",
  "#7a4e9c",
  "#c23e6f",
  "#6b7a44",
  "#1a1915",
];

export default function StatusesPage() {
  const [rows, setRows] = useState<StatusRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState(PRESET_COLORS[0]);
  const [formOrder, setFormOrder] = useState<number>(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/statuses", { cache: "no-store" });
      const data = (await res.json()) as { statuses: StatusRow[] };
      setRows(data.statuses);
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
    setFormOrder(0);
  }

  function startEdit(s: StatusRow) {
    setEditingId(s.id);
    setFormName(s.name);
    setFormColor(s.color);
    setFormOrder(s.sortOrder);
  }

  async function submit() {
    const name = formName.trim();
    if (!name) {
      alert("Tên trạng thái không được trống");
      return;
    }
    const payload = { name, color: formColor, sortOrder: formOrder };
    const res =
      editingId == null
        ? await fetch("/api/statuses", {
            method: "POST",
            headers: { "X-Body": JSON.stringify(payload) },
          })
        : await fetch(`/api/statuses/${editingId}`, {
            method: "PATCH",
            headers: { "X-Body": JSON.stringify(payload) },
          });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Lỗi" }));
      alert(err.error ?? "Lỗi");
      return;
    }
    resetForm();
    await load();
  }

  async function deleteStatus(id: number, count: number) {
    const msg =
      count > 0
        ? `Xóa trạng thái này? ${count} tài khoản đang dùng sẽ về "Chưa đặt".`
        : "Xóa trạng thái này?";
    if (!confirm(msg)) return;
    await fetch(`/api/statuses/${id}`, { method: "DELETE" });
    if (editingId === id) resetForm();
    await load();
  }

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <span className="eyebrow">Tình trạng tài khoản</span>
          <h1 className="h1-serif">
            Quản lý <em>trạng thái</em>
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
                  Tạo <em>trạng thái mới</em>
                </>
              ) : (
                <>
                  Cập nhật <em>trạng thái</em>
                </>
              )}
            </h2>
            <div className="section-label" style={{ marginTop: 4 }}>
              Đặt tên, chọn màu và thứ tự hiển thị
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr",
            gap: 16,
          }}
        >
          <div>
            <div className="section-label" style={{ marginBottom: 6 }}>
              Tên trạng thái
            </div>
            <input
              className="input"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Ví dụ: BKT, TKT, ĐANG BUILD…"
              style={{
                width: "100%",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            />
          </div>
          <div>
            <div className="section-label" style={{ marginBottom: 6 }}>
              Thứ tự
            </div>
            <input
              type="number"
              className="input"
              value={formOrder}
              onChange={(e) => setFormOrder(Number(e.target.value) || 0)}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <div className="section-label" style={{ marginBottom: 6 }}>
              Màu
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFormColor(c)}
                  aria-label={`Chọn màu ${c}`}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    background: c,
                    border:
                      formColor === c
                        ? "3px solid var(--ink)"
                        : "1px solid var(--line)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
              ))}
              <input
                type="color"
                value={formColor}
                onChange={(e) => setFormColor(e.target.value)}
                style={{
                  width: 28,
                  height: 24,
                  border: "1px solid var(--line)",
                  background: "transparent",
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={submit} className="btn btn-accent">
            {editingId == null ? "Tạo trạng thái" : "Lưu thay đổi"}
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
              Danh sách <em>trạng thái</em>
            </h2>
            <div className="section-label" style={{ marginTop: 4 }}>
              {rows.length === 0
                ? "Chưa có trạng thái nào"
                : `${rows.length} trạng thái · ${rows.reduce((s, r) => s + r.count, 0)} tài khoản đã gán`}
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
                <th className="right" style={{ width: 80 }}>Thứ tự</th>
                <th className="right">Tài khoản</th>
                <th style={{ width: 160 }}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
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
                      Tạo trạng thái đầu tiên ở form phía trên
                    </div>
                  </td>
                </tr>
              )}
              {rows.map((s) => (
                <tr key={s.id} className={editingId === s.id ? "selected" : ""}>
                  <td>
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 999,
                        background: s.color,
                        display: "inline-block",
                        border: "1px solid var(--line)",
                      }}
                    />
                  </td>
                  <td>
                    <span
                      className="mono"
                      style={{
                        fontSize: 13,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: s.color,
                        fontWeight: 600,
                      }}
                    >
                      {s.name}
                    </span>
                  </td>
                  <td className="right">
                    <span className="mono-num text-muted">{s.sortOrder}</span>
                  </td>
                  <td className="right">
                    <span className="mono-num">{s.count}</span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => startEdit(s)}
                        className="btn"
                        style={{ padding: "6px 12px", fontSize: 10 }}
                      >
                        Sửa
                      </button>
                      <button
                        onClick={() => deleteStatus(s.id, s.count)}
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
