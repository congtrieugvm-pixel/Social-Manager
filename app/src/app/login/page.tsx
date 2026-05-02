"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") || "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `Lỗi ${res.status}`);
        return;
      }
      router.replace(from || "/");
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
        <div className="brand-sub">Đăng nhập</div>
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
          />
        </label>
        <label className="auth-field">
          <span className="section-label">Password</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
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
          disabled={submitting || !username.trim() || !password}
          className="btn btn-accent"
          style={{ marginTop: 6 }}
        >
          {submitting ? "Đang đăng nhập…" : "Đăng nhập"}
        </button>
      </form>
      <div className="auth-foot">
        Chưa có tài khoản?{" "}
        <Link href="/register" className="text-accent">
          Đăng ký
        </Link>
      </div>
    </div>
  );
}
