"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Copy, Check, RefreshCw, Trash2, Loader2 } from "lucide-react";
import { safeJson } from "@/lib/req-body";
import styles from "./utilities.module.css";

// Manage the per-user browser-extension API key, used by the "Lưu kênh YouTube" button.
export default function ExtKeyCard() {
  const [exists, setExists] = useState<boolean | null>(null);
  const [key, setKey] = useState<string | null>(null); // plaintext, only right after generating
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"key" | "origin" | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    void fetch("/api/ext/key", { cache: "no-store" }).then(safeJson<{ exists: boolean }>).then((d) => setExists(!!d.exists)).catch(() => setExists(false));
  }, []);

  const rotate = useCallback(async () => {
    setBusy(true);
    try {
      const d = await safeJson<{ key?: string; error?: string }>(await fetch("/api/ext/key", { method: "POST" }));
      if (d.key) { setKey(d.key); setExists(true); }
    } finally { setBusy(false); }
  }, []);

  const revoke = useCallback(async () => {
    if (!confirm("Thu hồi API key? Tiện ích đang dùng key cũ sẽ ngừng lưu được cho tới khi bạn dán key mới.")) return;
    setBusy(true);
    try { await fetch("/api/ext/key", { method: "DELETE" }); setExists(false); setKey(null); } finally { setBusy(false); }
  }, []);

  const copy = (text: string, which: "key" | "origin") => {
    void navigator.clipboard.writeText(text).then(() => { setCopied(which); setTimeout(() => setCopied(null), 1500); });
  };

  return (
    <aside className={styles.guide} aria-labelledby="extkey-title">
      <div className={styles.guideHeader}>
        <span className={styles.stepLabel}><KeyRound size={14} aria-hidden="true" /> LƯU KÊNH YOUTUBE</span>
        <h2 id="extkey-title">API key cho tiện ích</h2>
      </div>
      <p className={styles.description}>
        Dán <strong>API key</strong> và <strong>địa chỉ web</strong> vào tiện ích một lần. Sau đó vào bất kỳ kênh YouTube nào, bấm
        nút <strong>Lưu kênh</strong> là kênh tự vào Bookmark Key của bạn.
      </p>

      <div className={styles.field}>
        <label>Địa chỉ web</label>
        <div className={styles.copyRow}>
          <code>{origin || "…"}</code>
          <button type="button" className="btn btn-quiet" disabled={!origin} onClick={() => copy(origin, "origin")}>
            {copied === "origin" ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
      </div>

      {key ? (
        <div className={styles.field}>
          <label>API key — chỉ hiện lần này, hãy sao chép ngay</label>
          <div className={styles.copyRow}>
            <code className={styles.secret}>{key}</code>
            <button type="button" className="btn btn-primary" onClick={() => copy(key, "key")}>
              {copied === "key" ? <Check size={15} /> : <Copy size={15} />}Sao chép
            </button>
          </div>
        </div>
      ) : (
        <p className={styles.notice}>
          {exists === null ? "Đang kiểm tra…" : exists ? "Bạn đã có một API key. Tạo lại nếu bị lộ hoặc quên — key cũ sẽ ngừng hoạt động." : "Chưa có API key. Tạo một key để dùng nút Lưu kênh."}
        </p>
      )}

      <div className={styles.row}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void rotate()}>
          {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}{exists ? "Tạo lại key" : "Tạo API key"}
        </button>
        {exists && (
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void revoke()}>
            <Trash2 size={16} />Thu hồi
          </button>
        )}
      </div>
    </aside>
  );
}
