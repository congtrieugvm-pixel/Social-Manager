"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type FieldKey =
  | "username"
  | "password"
  | "email"
  | "twofa"
  | "emailPassword"
  | "note"
  | "skip";

const FIELD_LABELS: Record<FieldKey, string> = {
  username: "Username",
  password: "Password",
  email: "Email",
  twofa: "2FA",
  emailPassword: "Email password",
  note: "Note",
  skip: "Bỏ qua",
};

const FIELD_SHORT: Record<FieldKey, string> = {
  username: "user",
  password: "pass",
  email: "email",
  twofa: "2fa",
  emailPassword: "email_pass",
  note: "note",
  skip: "—",
};

const DEFAULT_ORDER: FieldKey[] = [
  "username",
  "password",
  "email",
  "twofa",
  "emailPassword",
];

const PRESETS: Array<{ name: string; order: FieldKey[] }> = [
  { name: "user | pass", order: ["username", "password"] },
  { name: "user | pass | email", order: ["username", "password", "email"] },
  {
    name: "user | pass | email | 2fa",
    order: ["username", "password", "email", "twofa"],
  },
  { name: "Đầy đủ 5 cột", order: DEFAULT_ORDER },
  {
    name: "email | pass | 2fa | email_pass | user",
    order: ["email", "password", "twofa", "emailPassword", "username"],
  },
  {
    name: "user | pass | email | 2fa | email_pass | note",
    order: ["username", "password", "email", "twofa", "emailPassword", "note"],
  },
];

interface ParsedRow {
  lineNumber: number;
  raw: string;
  username: string;
  password: string;
  email: string;
  twofa: string;
  emailPassword: string;
  note: string;
  valid: boolean;
  error?: string;
}

interface PreviewResponse {
  rows: ParsedRow[];
  duplicatesInInput: string[];
}

interface ImportResponse {
  totalParsed: number;
  validCount: number;
  inserted: number;
  skippedExisting: number;
  invalid: number;
}

interface GroupRow {
  id: number;
  name: string;
  color: string;
  count: number;
}

export default function ImportPage() {
  const [text, setText] = useState("");
  const [delimiter, setDelimiter] = useState("|");
  const [groupId, setGroupId] = useState<number | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [order, setOrder] = useState<FieldKey[]>(DEFAULT_ORDER);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/groups", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setGroups(d.groups ?? []))
      .catch(() => {});
  }, []);

  const hasUsername = order.includes("username");
  const formatString = order.map((k) => `{${FIELD_SHORT[k]}}`).join(delimiter);

  function setColumn(idx: number, key: FieldKey) {
    setOrder((prev) => prev.map((v, i) => (i === idx ? key : v)));
  }

  function moveColumn(idx: number, dir: -1 | 1) {
    setOrder((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function removeColumn(idx: number) {
    setOrder((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  function addColumn() {
    setOrder((prev) => (prev.length >= 8 ? prev : [...prev, "skip"]));
  }

  const EXAMPLE_LINE = order
    .map((k) => {
      switch (k) {
        case "username":
          return "example_user";
        case "password":
          return "Passw0rd!";
        case "email":
          return "example@gmail.com";
        case "twofa":
          return "JBSWY3DPEHPK3PXP";
        case "emailPassword":
          return "EmailPass123";
        case "note":
          return "ghi chú tài khoản";
        default:
          return "—";
      }
    })
    .join(delimiter);

  // Build a short line to demonstrate variable field count (only username + password).
  const SHORT_EXAMPLE = order
    .filter((k) => k === "username" || k === "password")
    .map((k) => (k === "username" ? "user_chi_co_pass" : "Passw0rd!"))
    .join(delimiter);

  const placeholder = `# Thứ tự cột: ${formatString}
# Dòng bắt đầu bằng # sẽ bị bỏ qua
# Mỗi dòng có thể ít cột hơn — trường trống sẽ bỏ qua
${EXAMPLE_LINE}
${SHORT_EXAMPLE}`;

  async function handlePreview() {
    if (!hasUsername) {
      alert("Phải chọn ít nhất 1 cột là Username");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/accounts/import", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, delimiter, order }),
      });
      const data = (await res.json()) as PreviewResponse;
      setPreview(data);
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    setLoading(true);
    try {
      const res = await fetch("/api/accounts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, delimiter, order, groupId }),
      });
      const data = (await res.json()) as ImportResponse;
      setResult(data);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }

  const validCount = preview?.rows.filter((r) => r.valid).length ?? 0;
  const invalidCount = preview?.rows.filter((r) => !r.valid).length ?? 0;

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <span className="eyebrow">Nhập dữ liệu</span>
          <h1 className="h1-serif">
            Import <em>hàng loạt</em>
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="btn-group">
            <span
              className="btn-seg"
              style={{ color: "var(--muted)", cursor: "default" }}
            >
              Delimiter
            </span>
            <input
              className="input-inline"
              value={delimiter}
              onChange={(e) => setDelimiter(e.target.value || "|")}
              maxLength={3}
              style={{
                border: 0,
                background: "var(--ink)",
                color: "var(--paper)",
                borderRadius: 6,
                padding: "7px 14px",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.12em",
              }}
            />
          </div>
        </div>
      </header>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="h2-serif">
              Thứ tự <em>cột</em>
            </h2>
            <div className="section-label" style={{ marginTop: 4 }}>
              Mỗi dòng trong input được cắt bởi “{delimiter}” — gán mỗi vị trí vào
              một trường dữ liệu
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => setOrder(p.order)}
                className="btn"
                style={{ padding: "6px 12px", fontSize: 10 }}
                title={p.order.join(delimiter)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "stretch",
          }}
        >
          {order.map((key, idx) => (
            <div
              key={idx}
              style={{
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: "10px 12px",
                background: "var(--paper)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                minWidth: 160,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.12em",
                    color: "var(--muted)",
                    textTransform: "uppercase",
                  }}
                >
                  Cột {idx + 1}
                </span>
                <div style={{ display: "flex", gap: 2 }}>
                  <button
                    onClick={() => moveColumn(idx, -1)}
                    disabled={idx === 0}
                    title="Chuyển trái"
                    style={{
                      background: "transparent",
                      border: 0,
                      cursor: idx === 0 ? "not-allowed" : "pointer",
                      color: idx === 0 ? "var(--line)" : "var(--muted)",
                      padding: "0 4px",
                      fontSize: 14,
                    }}
                  >
                    ←
                  </button>
                  <button
                    onClick={() => moveColumn(idx, 1)}
                    disabled={idx === order.length - 1}
                    title="Chuyển phải"
                    style={{
                      background: "transparent",
                      border: 0,
                      cursor:
                        idx === order.length - 1 ? "not-allowed" : "pointer",
                      color:
                        idx === order.length - 1
                          ? "var(--line)"
                          : "var(--muted)",
                      padding: "0 4px",
                      fontSize: 14,
                    }}
                  >
                    →
                  </button>
                  <button
                    onClick={() => removeColumn(idx)}
                    disabled={order.length <= 1}
                    title="Xóa cột"
                    style={{
                      background: "transparent",
                      border: 0,
                      cursor:
                        order.length <= 1 ? "not-allowed" : "pointer",
                      color:
                        order.length <= 1 ? "var(--line)" : "var(--accent)",
                      padding: "0 4px",
                      fontSize: 14,
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
              <select
                value={key}
                onChange={(e) => setColumn(idx, e.target.value as FieldKey)}
                className="input"
                style={{ padding: "6px 8px", fontSize: 13 }}
              >
                {(Object.keys(FIELD_LABELS) as FieldKey[]).map((k) => (
                  <option key={k} value={k}>
                    {FIELD_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <button
            onClick={addColumn}
            disabled={order.length >= 8}
            className="btn"
            style={{
              borderStyle: "dashed",
              minWidth: 120,
              color: "var(--muted)",
            }}
            title="Thêm cột"
          >
            + Thêm cột
          </button>
          <button
            onClick={() => setOrder(DEFAULT_ORDER)}
            className="btn"
            style={{ color: "var(--muted)" }}
          >
            Mặc định
          </button>
        </div>

        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            background: "var(--bg-warm)",
            borderRadius: 8,
            border: "1px solid var(--line)",
          }}
        >
          <div className="section-label" style={{ marginBottom: 4 }}>
            Format hiện tại
          </div>
          <code
            className="mono"
            style={{
              fontSize: 13,
              color: hasUsername ? "var(--ink)" : "var(--accent)",
              wordBreak: "break-all",
            }}
          >
            {formatString}
          </code>
          {!hasUsername && (
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--accent)",
                marginTop: 6,
                letterSpacing: "0.08em",
              }}
            >
              ⚠ Phải có ít nhất 1 cột được gán là Username
            </div>
          )}
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--muted)",
              marginTop: 8,
              letterSpacing: "0.06em",
              lineHeight: 1.5,
            }}
          >
            Mỗi dòng có thể có ít cột hơn cấu hình — các trường trống sẽ được lưu là
            rỗng. Chỉ cần <span style={{ color: "var(--ink)" }}>username</span> có mặt
            là dòng hợp lệ.
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="h2-serif">
              Nội dung <em>nhập</em>
            </h2>
            <div className="section-label" style={{ marginTop: 4 }}>
              Mỗi dòng một tài khoản theo thứ tự cột ở trên
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="section-label">Nhóm</span>
            <select
              className="input"
              value={groupId ?? ""}
              onChange={(e) =>
                setGroupId(e.target.value ? Number(e.target.value) : null)
              }
              style={{ minWidth: 200 }}
            >
              <option value="">— Không nhóm —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <Link
              href="/groups"
              className="mono"
              style={{
                fontSize: 11,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--accent)",
              }}
            >
              Quản lý nhóm →
            </Link>
          </div>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="textarea"
          spellCheck={false}
        />

        <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={handlePreview}
            disabled={loading || !text.trim() || !hasUsername}
            className="btn btn-primary"
          >
            {loading ? "Đang xử lý…" : "Xem trước"}
          </button>
          {preview && validCount > 0 && (
            <button
              onClick={handleImport}
              disabled={loading}
              className="btn btn-accent"
            >
              Import {validCount} tài khoản
              {groupId != null &&
                ` → ${groups.find((g) => g.id === groupId)?.name ?? ""}`}
            </button>
          )}
        </div>
      </section>

      {result && (
        <section
          className="card"
          style={{
            borderColor: "rgba(45,90,61,0.3)",
            background: "rgba(45,90,61,0.06)",
            marginBottom: 48,
          }}
        >
          <div className="eyebrow" style={{ color: "var(--good)", marginBottom: 12 }}>
            Hoàn tất
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 24,
              marginTop: 8,
            }}
          >
            <div>
              <div className="section-label">Đã lưu</div>
              <div className="kpi-num" style={{ color: "var(--good)" }}>
                {result.inserted}
              </div>
            </div>
            <div>
              <div className="section-label">Trùng (bỏ qua)</div>
              <div className="kpi-num">{result.skippedExisting}</div>
            </div>
            <div>
              <div className="section-label">Không hợp lệ</div>
              <div className="kpi-num" style={{ color: "var(--accent)" }}>
                {result.invalid}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Link
              href="/"
              className="mono"
              style={{
                fontSize: 11,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--accent)",
              }}
            >
              Xem danh sách →
            </Link>
          </div>
        </section>
      )}

      {preview && (
        <section className="section">
          <div className="section-head">
            <div>
              <h2 className="h2-serif">
                Xem trước <em>kết quả</em>
              </h2>
              <div className="section-label" style={{ marginTop: 4 }}>
                Kiểm tra dữ liệu trước khi lưu
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span className="pill ok">
                <span className="dot ok" /> Hợp lệ {validCount}
              </span>
              {invalidCount > 0 && (
                <span className="pill err">
                  <span className="dot err" /> Lỗi {invalidCount}
                </span>
              )}
              {preview.duplicatesInInput.length > 0 && (
                <span className="pill">Trùng input {preview.duplicatesInInput.length}</span>
              )}
            </div>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Line</th>
                  <th>Username</th>
                  <th>Email</th>
                  <th>2FA</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.lineNumber} className={!r.valid ? "selected" : ""}>
                    <td>
                      <span className="mono-num text-muted">#{r.lineNumber}</span>
                    </td>
                    <td>
                      <span className="mono" style={{ color: "var(--ink)" }}>
                        {r.username || "—"}
                      </span>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
                        {r.email || "—"}
                      </span>
                    </td>
                    <td>
                      {r.twofa ? (
                        <span className="chip">Có</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {r.valid ? (
                        <span className="pill ok">
                          <span className="dot ok" /> OK
                        </span>
                      ) : (
                        <span className="pill err" title={r.error}>
                          <span className="dot err" />
                          {r.error}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
