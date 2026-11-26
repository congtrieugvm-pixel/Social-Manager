"use client";

import { useState } from "react";
import { postJson, safeJson } from "@/lib/req-body";
import { notify } from "./notify";

type Proxy = { id: number; name: string; enabled: number };

// Proxy for one account's browser, right on the accounts tab: inherit the group's proxy, go direct,
// pick an existing proxy, or paste a new one (host:port[:user:pass]) that is created and assigned.
export function AccountProxy({ accountId, mode, proxyId, proxies, onChange }: {
  accountId: number;
  mode: string;
  proxyId: number | null;
  proxies: Proxy[];
  onChange: (mode: string, proxyId: number | null) => void;
}) {
  const [m, setM] = useState(mode || "inherit");
  const [pid, setPid] = useState<string>(proxyId ? String(proxyId) : "");
  const [paste, setPaste] = useState("");
  const [usePaste, setUsePaste] = useState(false);
  const [busy, setBusy] = useState(false);

  // Parse "host:port", "host:port:user:pass" or a full URL into {server, username, password}.
  function parsePaste(raw: string): { server: string; username?: string; password?: string; name: string } | null {
    const s = raw.trim();
    if (!s) return null;
    if (/^(https?|socks5):\/\//i.test(s)) {
      try { const u = new URL(s); return { server: `${u.protocol}//${u.host}`, username: u.username || undefined, password: u.password || undefined, name: u.host }; } catch { return null; }
    }
    const parts = s.split(":");
    if (parts.length < 2) return null;
    const [host, port, user, pass] = parts;
    if (!host || !/^\d{2,5}$/.test(port)) return null;
    return { server: `http://${host}:${port}`, username: user || undefined, password: pass || undefined, name: `${host}:${port}` };
  }

  async function apply() {
    setBusy(true);
    try {
      let body: Record<string, unknown> = { accountId, mode: m };
      if (m === "custom") {
        if (usePaste) {
          const np = parsePaste(paste);
          if (!np) { notify.error("Proxy không hợp lệ. Dùng host:port hoặc host:port:user:pass."); return; }
          body = { accountId, mode: "custom", newProxy: np };
        } else {
          if (!pid) { notify.error("Chọn một proxy."); return; }
          body = { accountId, mode: "custom", proxyId: Number(pid) };
        }
      }
      const res = await postJson("/api/browser/account-proxy", body);
      const data = await safeJson<{ ok?: boolean; proxyId?: number; error?: string }>(res);
      if (!res.ok || data.error) { notify.error(data.error || "Không lưu được proxy"); return; }
      const newId = m === "custom" ? (data.proxyId ?? Number(pid)) : null;
      onChange(m, newId);
      if (usePaste) { setUsePaste(false); setPaste(""); if (data.proxyId) setPid(String(data.proxyId)); }
      notify.success("Đã đặt proxy. Áp dụng khi mở trình duyệt lần tới.");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ padding: "10px 6px", borderTop: "1px solid var(--line)", fontSize: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <strong>Proxy trình duyệt</strong>
      <select className="input" value={m} onChange={(e) => setM(e.target.value)} aria-label="Chế độ proxy">
        <option value="inherit">Dùng proxy của nhóm (cài ở trang Proxy)</option>
        <option value="custom">Proxy riêng</option>
        <option value="direct">Không dùng proxy</option>
      </select>
      {m === "custom" && (
        <>
          <div style={{ display: "flex", gap: 10 }}>
            <label style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><input type="radio" checked={!usePaste} onChange={() => setUsePaste(false)} /> Chọn sẵn</label>
            <label style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><input type="radio" checked={usePaste} onChange={() => setUsePaste(true)} /> Dán proxy mới</label>
          </div>
          {usePaste ? (
            <input className="input" placeholder="host:port hoặc host:port:user:pass" value={paste} onChange={(e) => setPaste(e.target.value)} autoComplete="off" spellCheck={false} />
          ) : (
            <select className="input" value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Chọn proxy">
              <option value="">— Chọn proxy —</option>
              {proxies.map((p) => <option key={p.id} value={p.id}>{p.name}{p.enabled ? "" : " (đã tắt)"}</option>)}
            </select>
          )}
        </>
      )}
      <button className="btn btn-primary" disabled={busy} onClick={() => void apply()}>{busy ? "Đang lưu…" : "Lưu proxy"}</button>
    </div>
  );
}
