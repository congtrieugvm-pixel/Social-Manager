"use client";

import { useEffect, useRef, useState } from "react";
import { pollHotmailCode, type HotmailCode } from "@/lib/hotmail-client";
import { confirmDialog, notify } from "./notify";

export function HotmailConnect({ accountId, email, hasToken, msEmail, onConnectionChange }: {
  accountId: number;
  email: string | null;
  hasToken: boolean;
  msEmail: string | null;
  onConnectionChange: (connected: boolean, email: string | null) => void;
}) {
  const [connected, setConnected] = useState(hasToken);
  const [mailbox, setMailbox] = useState(msEmail);
  const [phase, setPhase] = useState<"idle" | "auth" | "polling" | "disconnecting">("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<HotmailCode | null>(null);
  const [copied, setCopied] = useState(false);
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  const oauthCleanup = useRef<(() => void) | null>(null);
  const lastCode = useRef<HotmailCode | undefined>(undefined);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
      oauthCleanup.current?.();
    };
  }, []);

  async function copyCode(code: string, automatic = false) {
    try {
      await navigator.clipboard.writeText(code);
      if (active.current) setCopied(true);
    } catch {
      if (active.current) {
        setCopied(false);
        setMessage(automatic ? "Đã nhận mã. Bấm Chép để sao chép." : "Trình duyệt chưa cho phép sao chép; bạn có thể chọn mã để chép.");
      }
    }
  }

  function connect() {
    if (phase !== "idle") return;
    setError(""); setMessage(""); setCopied(false); setResult(null);
    const popup = window.open(`/api/oauth/microsoft/start?accountId=${accountId}`, `ms-oauth-${accountId}`,
      "width=540,height=680,popup=yes");
    if (!popup) { setError("Trình duyệt chặn popup. Hãy cho phép popup rồi bấm Get Token lại."); return; }
    setPhase("auth");
    setMessage("Hoàn tất đăng nhập/cấp quyền trong cửa sổ Microsoft. Token sẽ được lưu tự động.");
    const started = Date.now();
    const cleanup = () => {
      clearInterval(watcher);
      window.removeEventListener("message", receive);
      oauthCleanup.current = null;
    };
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== popup) return;
      const payload = event.data;
      if (!payload || payload.type !== "ms-oauth-result" ||
        (payload.accountId !== accountId && payload.accountId !== null)) return;
      cleanup();
      if (!active.current) return;
      setPhase("idle");
      setMessage("");
      if (payload.ok === true && payload.accountId === accountId && typeof payload.email === "string") {
        setConnected(true); setMailbox(payload.email); lastCode.current = undefined;
        onConnectionChange(true, payload.email);
        setMessage("Đã lưu token. Bấm Get Code khi cần lấy mã TikTok.");
      } else setError(typeof payload.message === "string" ? payload.message : "Chưa kết nối được Microsoft.");
    };
    const watcher = setInterval(() => {
      if (!popup.closed && Date.now() - started < 10 * 60_000) return;
      cleanup();
      if (!active.current) return;
      setPhase("idle"); setMessage("");
      setError(popup.closed ? "Cửa sổ đăng nhập đã đóng. Hãy Get Token lại nếu chưa hoàn tất." : "Phiên đăng nhập hết thời gian. Hãy Get Token lại.");
    }, 500);
    window.addEventListener("message", receive);
    oauthCleanup.current = cleanup;
  }

  async function getCode() {
    if (phase !== "idle") return;
    const controller = new AbortController();
    request.current = controller;
    setPhase("polling"); setError(""); setCopied(false); setResult(null);
    setMessage("Đang tìm mã TikTok mới…");
    try {
      const data = await pollHotmailCode(accountId, {
        signal: controller.signal, previous: lastCode.current,
        onWaiting: (seconds, reason) => {
          if (active.current) setMessage(reason || `Đang chờ thư mới · còn tối đa ${seconds} giây`);
        },
      });
      if (!active.current || controller.signal.aborted) return;
      setMessage("");
      if (data.needsAuth) {
        setConnected(false);
        setError(data.error || "Hãy Get Token để kết nối Hotmail.");
        return;
      }
      const code = data as HotmailCode;
      lastCode.current = code;
      setResult(code);
      await copyCode(code.code, true);
    } catch (err) {
      if (active.current && !controller.signal.aborted) {
        setMessage(""); setError(err instanceof Error ? err.message : "Không lấy được mã.");
      }
    } finally {
      if (active.current) setPhase("idle");
      request.current = null;
    }
  }

  async function disconnect() {
    if (!await confirmDialog({ message: "Ngắt kết nối Hotmail? Lần sau cần Get Token lại.", confirmLabel: "Ngắt kết nối", danger: true })) return;
    if (active.current) { setPhase("disconnecting"); setError(""); }
    try {
      const response = await fetch(`/api/accounts/${accountId}/hotmail-code`, { method: "DELETE" });
      if (!response.ok) throw new Error("Chưa ngắt được kết nối. Hãy thử lại.");
      if (active.current) {
        setConnected(false); setMailbox(null); setResult(null); setMessage("Đã ngắt kết nối.");
        lastCode.current = undefined;
        onConnectionChange(false, null);
      }
      notify.success("Đã ngắt kết nối Hotmail.");
    } catch (err) { notify.error(err instanceof Error ? err.message : "Lỗi ngắt kết nối Hotmail."); }
    finally { if (active.current) setPhase("idle"); }
  }

  const busy = phase !== "idle";
  return <section aria-label="Hotmail OAuth2" style={{ padding: "10px 6px", borderTop: "1px solid var(--line)", fontSize: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
      <strong>Hotmail OAuth2</strong>
      <span style={{ color: connected ? "var(--accent)" : "var(--muted)" }}>{connected ? "Đã kết nối" : "Chưa kết nối"}</span>
    </div>
    <div style={{ color: "var(--muted)", overflowWrap: "anywhere", marginBottom: 8 }}>{mailbox || email || "Chưa có email"}</div>
    <div style={{ display: "flex", gap: 8 }}>
      <button className="btn" disabled={busy || !email} onClick={connect}>{phase === "auth" ? "Chờ đăng nhập…" : connected ? "Get Token lại" : "Get Token"}</button>
      <button className="btn" disabled={busy || !connected} onClick={getCode}>{phase === "polling" ? "Đang chờ mã…" : lastCode.current ? "Get Code mới" : "Get Code"}</button>
      {phase === "polling" && <button className="btn" onClick={() => { request.current?.abort(); setMessage("Đã dừng chờ mã."); }}>Dừng</button>}
    </div>
    <div aria-live="polite" style={{ lineHeight: 1.6 }}>
      {message && <p style={{ color: "var(--muted)", margin: "8px 0 0" }}>{message}</p>}
      {error && <p role="alert" style={{ color: "var(--danger)", margin: "8px 0 0" }}>{error}</p>}
      {result && <div style={{ marginTop: 10, padding: 8, background: "var(--bg-1)", border: "1px solid var(--line)", borderRadius: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <code style={{ fontSize: 20, letterSpacing: 3, userSelect: "text" }}>{result.code}</code>
          <button className="btn" onClick={() => copyCode(result.code)}>{copied ? "Đã chép" : "Chép"}</button>
        </div>
        <div style={{ color: "var(--muted)", marginTop: 5, overflowWrap: "anywhere" }}>
          {result.from} · {new Date(result.receivedAt).toLocaleTimeString("vi-VN")}<br />{result.subject}
        </div>
      </div>}
    </div>
    {hasToken && !busy && <button onClick={disconnect} style={{ background: "transparent", border: 0, padding: "8px 0 0", color: "var(--muted)", cursor: "pointer" }}>Ngắt kết nối Hotmail</button>}
  </section>;
}
