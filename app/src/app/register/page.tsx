"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (password !== confirm) {
      setError("Hai mật khẩu không khớp");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "X-Body": JSON.stringify({ username: username.trim(), password }),
        },
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `Lỗi ${res.status}`);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <div style={{ marginBottom: 28 }}>
        <div className="brand" style={{ fontSize: 28 }}>
          Social<em>Manager</em>
        </div>
        <div className="brand-sub">Đăng ký tài khoản</div>
      </div>
      <form onSubmit={onSubmit} className="auth-form">
        <label className="auth-field">
          <span className="section-label">Username</span>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            spellCheck={false}
            placeholder="3-32 ký tự, chữ/số/._-"
          />
        </label>
        <label className="auth-field">
          <span className="section-label">Password</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="Tối thiểu 6 ký tự"
          />
        </label>
        <label className="auth-field">
          <span className="section-label">Nhập lại password</span>
          <input
            className="input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        {error && (
          <div
            className="mono"
            style={{
              color: "#e05b5b",
              fontSize: 11,
              letterSpacing: "0.04em",
            }}
          >
            ⚠ {error}
          </div>
        )}
        <button
          type="submit"
          disabled={
            submitting ||
            !username.trim() ||
            !password ||
            !confirm
          }
          className="btn btn-accent"
          style={{ marginTop: 6 }}
        >
          {submitting ? "Đang đăng ký…" : "Đăng ký"}
        </button>
      </form>
      <div className="auth-foot">
        Đã có tài khoản?{" "}
        <Link href="/login" className="text-accent">
          Đăng nhập
        </Link>
      </div>
    </div>
  );
}
