"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

type NavItem = {
  href: string;
  label: string;
  children?: Array<{ href: string; label: string }>;
};

const nav: NavItem[] = [
  { href: "/", label: "Tài Khoản Tiktok" },
  { href: "/facebook", label: "Tài Khoản Facebook" },
  {
    href: "/fanpage",
    label: "Quản Lý Fanpage",
    children: [
      { href: "/fanpage", label: "Danh sách fanpage" },
      { href: "/insights", label: "Nội dung" },
      { href: "/insights/reach", label: "Reach Dashboard" },
    ],
  },
];

interface SidebarProps {
  user: { username: string; role: string };
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const isAdmin = user.role === "admin";

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore — middleware will catch the missing cookie next request
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="sidebar">
      <div style={{ marginBottom: 28 }}>
        <div className="brand">
          Social<em>Manager</em>
        </div>
        <div className="brand-sub">Account Management</div>
      </div>

      <div className="nav-label">Workspace</div>
      <nav className="nav-list">
        {nav.map((item) => {
          const groupActive = item.children
            ? item.children.some((c) => c.href === pathname) ||
              pathname.startsWith(`${item.href}/`) ||
              pathname === item.href
            : item.href === pathname;
          return (
            <div key={item.href}>
              <Link
                href={item.href}
                className={`nav-item ${groupActive ? "active" : ""}`}
              >
                <span>{item.label}</span>
              </Link>
              {item.children && groupActive && (
                <div className="nav-sub-list">
                  {item.children.map((sub) => {
                    const active = sub.href === pathname;
                    return (
                      <Link
                        key={sub.href}
                        href={sub.href}
                        className={`nav-sub-item ${active ? "active" : ""}`}
                      >
                        <span>{sub.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {isAdmin && (
        <>
          <div className="nav-label">Admin</div>
          <nav className="nav-list">
            <Link
              href="/admin/users"
              className={`nav-item ${pathname.startsWith("/admin/users") ? "active" : ""}`}
            >
              <span>Quản lý User</span>
            </Link>
          </nav>
        </>
      )}

      <div className="sidebar-footer">
        <div
          className="sidebar-footer-card"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--muted)",
                marginBottom: 4,
              }}
            >
              Đăng nhập
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--ink)",
                wordBreak: "break-word",
              }}
            >
              {user.username}
              {isAdmin && (
                <span
                  className="mono"
                  style={{
                    marginLeft: 6,
                    fontSize: 9,
                    letterSpacing: "0.12em",
                    color: "var(--accent)",
                  }}
                >
                  ADMIN
                </span>
              )}
            </div>
          </div>
          <button
            onClick={logout}
            disabled={loggingOut}
            className="btn"
            style={{
              padding: "5px 8px",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              width: "100%",
            }}
          >
            {loggingOut ? "Đang thoát…" : "Đăng xuất"}
          </button>
        </div>
      </div>
    </aside>
  );
}
