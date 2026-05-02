"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface EmployeeRow {
  id: number;
  name: string;
  color: string;
  note: string | null;
  sortOrder: number;
  count: number;
  createdAt: string;
}

const PRESET_COLORS = [
  "#b86a3f",
  "#2f6bb0",
  "#2d5a3d",
  "#7a4e9c",
  "#c23e6f",
  "#b88c3a",
  "#5e6ad2",
  "#7a766a",
];

export default function EmployeesPage() {
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [formNote, setFormNote] = useState("");
  const [formColor, setFormColor] = useState(PRESET_COLORS[0]);
  const [formOrder, setFormOrder] = useState<number>(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/employees", { cache: "no-store" });
      const data = (await res.json()) as { employees: EmployeeRow[] };
      setRows(data.employees);
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
    setFormNote("");
    setFormColor(PRESET_COLORS[0]);
    setFormOrder(0);
  }

  function startEdit(e: EmployeeRow) {
    setEditingId(e.id);
    setFormName(e.name);
    setFormNote(e.note ?? "");
    setFormColor(e.color);
    setFormOrder(e.sortOrder);
  }

  async function submit() {
    const name = formName.trim();
    if (!name) {
      alert("Tên nhân viên không được trống");
      return;
    }
    const payload = {
      name,
      note: formNote.trim() || null,
      color: formColor,
      sortOrder: formOrder,
    };
    const res =
      editingId == null
        ? await fetch("/api/employees", {
            method: "POST",
            headers: { "X-Body": JSON.stringify(payload) },
          })
        : await fetch(`/api/employees/${editingId}`, {
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

  async function deleteEmployee(id: number, count: number) {
    const msg =
      count > 0
        ? `Xóa nhân viên này? ${count} tài khoản đang gán sẽ về "Chưa đặt".`
        : "Xóa nhân viên này?";
    if (!confirm(msg)) return;
    await fetch(`/api/employees/${id}`, { method: "DELETE" });
    if (editingId === id) resetForm();
    await load();
  }

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <span className="eyebrow">Nhân viên phụ trách</span>
          <h1 className="h1-serif">
            Quản lý <em>nhân viên</em>
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
                  Tạo <em>nhân viên mới</em>
                </>
              ) : (
                <>
                  Cập nhật <em>nhân viên</em>
                </>
              )}
            </h2>
            <div className="section-label" style={{ marginTop: 4 }}>
              Đặt tên, ghi chú, màu và thứ tự hiển thị
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.3fr 1.3fr 0.6fr 1fr",
            gap: 16,
          }}
        >
          <div>
            <div className="section-label" style={{ marginBottom: 6 }}>
              Tên nhân viên
            </div>
            <input
              className="input"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Ví dụ: Nam, Linh, NV01…"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <div className="section-label" style={{ marginBottom: 6 }}>
              Ghi chú
            </div>
            <input
              className="input"
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              placeholder="Chức vụ, liên hệ…"
              style={{ width: "100%" }}
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
            {editingId == null ? "Tạo nhân viên" : "Lưu thay đổi"}
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
              Danh sách <em>nhân viên</em>
            </h2>
            <div className="section-label" style={{ marginTop: 4 }}>
              {rows.length === 0
                ? "Chưa có nhân viên nào"
                : `${rows.length} nhân viên · ${rows.reduce((s, r) => s + r.count, 0)} tài khoản đã gán`}
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
                <th>Ghi chú</th>
                <th className="right" style={{ width: 80 }}>
                  Thứ tự
                </th>
                <th className="right">Tài khoản</th>
                <th style={{ width: 160 }}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} style={{ padding: 56, textAlign: "center" }}>
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
                      Tạo nhân viên đầu tiên ở form phía trên
                    </div>
                  </td>
                </tr>
              )}
              {rows.map((e) => (
                <tr key={e.id} className={editingId === e.id ? "selected" : ""}>
                  <td>
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 999,
                        background: e.color,
                        display: "inline-block",
                        border: "1px solid var(--line)",
                      }}
                    />
                  </td>
                  <td>
                    <span style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>
                      {e.name}
                    </span>
                  </td>
                  <td>
                    {e.note ? (
                      <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{e.note}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="right">
                    <span className="mono-num text-muted">{e.sortOrder}</span>
                  </td>
                  <td className="right">
                    <span className="mono-num">{e.count}</span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => startEdit(e)}
                        className="btn"
                        style={{ padding: "6px 12px", fontSize: 10 }}
                      >
                        Sửa
                      </button>
                      <button
                        onClick={() => deleteEmployee(e.id, e.count)}
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
