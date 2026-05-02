"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface CountryRow {
  id: number;
  name: string;
  code: string | null;
  color: string;
  sortOrder: number;
  count: number;
  createdAt: string;
}

const PRESET_COLORS = [
  "#d94a1f",
  "#2f6bb0",
  "#7a4e9c",
  "#2d5a3d",
  "#c23e6f",
  "#b88c3a",
  "#5e6ad2",
  "#7a766a",
];

export default function CountriesPage() {
  const [rows, setRows] = useState<CountryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formColor, setFormColor] = useState(PRESET_COLORS[0]);
  const [formOrder, setFormOrder] = useState<number>(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/countries", { cache: "no-store" });
      const data = (await res.json()) as { countries: CountryRow[] };
      setRows(data.countries);
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
    setFormCode("");
    setFormColor(PRESET_COLORS[0]);
    setFormOrder(0);
  }

  function startEdit(c: CountryRow) {
    setEditingId(c.id);
    setFormName(c.name);
    setFormCode(c.code ?? "");
    setFormColor(c.color);
    setFormOrder(c.sortOrder);
  }

  async function submit() {
    const name = formName.trim();
    if (!name) {
      alert("Tên quốc gia không được trống");
      return;
    }
    const payload = {
      name,
      code: formCode.trim() || null,
      color: formColor,
      sortOrder: formOrder,
    };
    const res =
      editingId == null
        ? await fetch("/api/countries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/countries/${editingId}`, {
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

  async function deleteCountry(id: number, count: number) {
    const msg =
      count > 0
        ? `Xóa quốc gia này? ${count} tài khoản đang gán sẽ về "Chưa đặt".`
        : "Xóa quốc gia này?";
    if (!confirm(msg)) return;
    await fetch(`/api/countries/${id}`, { method: "DELETE" });
    if (editingId === id) resetForm();
    await load();
  }

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <span className="eyebrow">Quốc gia tài khoản</span>
          <h1 className="h1-serif">
            Quản lý <em>quốc gia</em>
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
                  Tạo <em>quốc gia mới</em>
                </>
              ) : (
                <>
                  Cập nhật <em>quốc gia</em>
                </>
              )}
            </h2>
            <div className="section-label" style={{ marginTop: 4 }}>
              Đặt tên, mã, màu và thứ tự hiển thị
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 0.7fr 0.7fr 1fr",
            gap: 16,
          }}
        >
          <div>
            <div className="section-label" style={{ marginBottom: 6 }}>
              Tên quốc gia
            </div>
            <input
              className="input"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Ví dụ: Việt Nam, Hoa Kỳ…"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <div className="section-label" style={{ marginBottom: 6 }}>
              Mã
            </div>
            <input
              className="input"
              value={formCode}
              onChange={(e) => setFormCode(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="VN"
              style={{
                width: "100%",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.08em",
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
            {editingId == null ? "Tạo quốc gia" : "Lưu thay đổi"}
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
              Danh sách <em>quốc gia</em>
            </h2>
            <div className="section-label" style={{ marginTop: 4 }}>
              {rows.length === 0
                ? "Chưa có quốc gia nào"
                : `${rows.length} quốc gia · ${rows.reduce((s, r) => s + r.count, 0)} tài khoản đã gán`}
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
                <th style={{ width: 80 }}>Mã</th>
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
                      Tạo quốc gia đầu tiên ở form phía trên
                    </div>
                  </td>
                </tr>
              )}
              {rows.map((c) => (
                <tr key={c.id} className={editingId === c.id ? "selected" : ""}>
                  <td>
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 999,
                        background: c.color,
                        display: "inline-block",
                        border: "1px solid var(--line)",
                      }}
                    />
                  </td>
                  <td>
                    <span
                      style={{
                        fontSize: 14,
                        color: "var(--ink)",
                        fontWeight: 500,
                      }}
                    >
                      {c.name}
                    </span>
                  </td>
                  <td>
                    {c.code ? (
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          letterSpacing: "0.12em",
                          color: c.color,
                          fontWeight: 600,
                        }}
                      >
                        {c.code}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="right">
                    <span className="mono-num text-muted">{c.sortOrder}</span>
                  </td>
                  <td className="right">
                    <span className="mono-num">{c.count}</span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => startEdit(c)}
                        className="btn"
                        style={{ padding: "6px 12px", fontSize: 10 }}
                      >
                        Sửa
                      </button>
                      <button
                        onClick={() => deleteCountry(c.id, c.count)}
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
