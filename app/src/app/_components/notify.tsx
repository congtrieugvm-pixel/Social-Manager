"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

// In-app replacements for alert() / confirm() / prompt():
//   notify("Đã lưu")                       → toast (tone guessed from the text)
//   notify.error("…") / .success / .info
//   await confirmDialog({ message, confirmLabel, danger }) → boolean
//   await promptDialog({ title, label })    → string | null
// <Notifier /> (mounted once in AppShell) renders them.

type Tone = "success" | "error" | "warn" | "info";
interface Toast {
  id: number;
  tone: Tone;
  text: string;
}
interface Dialog {
  kind: "confirm" | "prompt";
  title: string;
  message?: string;
  label?: string;
  placeholder?: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (v: boolean | string | null) => void;
}

let nextId = 1;
const toastSubs = new Set<(t: Toast) => void>();
const dialogSubs = new Set<(d: Dialog) => void>();

function guessTone(text: string): Tone {
  // "Không có …" is guidance (nothing matched), not a failure.
  if (/^(Chưa|Thiếu|Hãy|Vui lòng|Không có)/i.test(text)) return "warn";
  if (/^(Lỗi|Không|Thất bại|Sai|Trình duyệt chặn)/i.test(text)) return "error";
  if (/^(Đã|Hoàn tất|Xong)/i.test(text)) return "success";
  return "info";
}

function push(tone: Tone, text: string) {
  const t = { id: nextId++, tone, text };
  toastSubs.forEach((fn) => fn(t));
}

export const notify = Object.assign((text: string) => push(guessTone(text), text), {
  success: (text: string) => push("success", text),
  error: (text: string) => push("error", text),
  warn: (text: string) => push("warn", text),
  info: (text: string) => push("info", text),
});

export function confirmDialog(opts: { title?: string; message: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const d: Dialog = {
      kind: "confirm",
      title: opts.title ?? "Xác nhận",
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? "Đồng ý",
      danger: opts.danger,
      resolve: (v) => resolve(v === true),
    };
    if (dialogSubs.size === 0) return resolve(window.confirm(opts.message));
    dialogSubs.forEach((fn) => fn(d));
  });
}

export function promptDialog(opts: { title: string; label?: string; placeholder?: string; confirmLabel?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    const d: Dialog = {
      kind: "prompt",
      title: opts.title,
      label: opts.label,
      placeholder: opts.placeholder,
      confirmLabel: opts.confirmLabel ?? "Lưu",
      resolve: (v) => resolve(typeof v === "string" ? v : null),
    };
    if (dialogSubs.size === 0) return resolve(window.prompt(opts.title));
    dialogSubs.forEach((fn) => fn(d));
  });
}

const ICON = { success: CheckCircle2, error: XCircle, warn: AlertTriangle, info: Info } as const;

export function Notifier() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onToast = (t: Toast) => {
      setToasts((list) => [...list.slice(-3), t]);
      // Errors and multi-line results stay longer.
      const ms = t.tone === "error" || t.text.includes("\n") ? 9000 : 4000;
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), ms);
    };
    const onDialog = (d: Dialog) => {
      setValue("");
      setDialog(d);
    };
    toastSubs.add(onToast);
    dialogSubs.add(onDialog);
    return () => {
      toastSubs.delete(onToast);
      dialogSubs.delete(onDialog);
    };
  }, []);

  useEffect(() => {
    if (!dialog) return;
    (dialog.kind === "prompt" ? inputRef.current : okRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);

  function close(ok: boolean) {
    if (!dialog) return;
    dialog.resolve(dialog.kind === "prompt" ? (ok ? value.trim() || null : null) : ok);
    setDialog(null);
  }

  return (
    <>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICON[t.tone];
          return (
            <div key={t.id} className={`toast ${t.tone}`}>
              <Icon size={18} aria-hidden="true" />
              <div className="toast-text">{t.text}</div>
              <button className="toast-x" aria-label="Đóng thông báo" onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      {dialog && (
        <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <form
            className="modal dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onSubmit={(e) => {
              e.preventDefault();
              close(true);
            }}
          >
            <h2 id="dialog-title" className="h2-serif">{dialog.title}</h2>
            {dialog.message && <p className="dialog-msg">{dialog.message}</p>}
            {dialog.kind === "prompt" && (
              <label className="dialog-field">
                {dialog.label && <span>{dialog.label}</span>}
                <input ref={inputRef} className="input" value={value} placeholder={dialog.placeholder} onChange={(e) => setValue(e.target.value)} />
              </label>
            )}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => close(false)}>Huỷ</button>
              <button
                ref={okRef}
                type="submit"
                className={`btn ${dialog.danger ? "btn-danger-solid" : "btn-primary"}`}
                disabled={dialog.kind === "prompt" && !value.trim()}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
