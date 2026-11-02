"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BarChart3, Bookmark, LogOut, Users, type LucideIcon } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon | (() => React.JSX.Element);
  children?: Array<{ href: string; label: string }>;
};

/** TikTok / Facebook marks drawn as simple outlines to sit with the Lucide set. */
export function TikTokIcon({ size = 18 }: { size?: number } = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" />
      <path d="M14 3c.4 2.6 2.2 4.4 5 4.7" />
    </svg>
  );
}
export function FacebookIcon({ size = 18 }: { size?: number } = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 8h-2a2 2 0 0 0-2 2v11" />
      <path d="M8.5 13H15" />
      <rect x="3" y="3" width="18" height="18" rx="4" />
    </svg>
  );
}

const nav: NavItem[] = [
  { href: "/", label: "Tài khoản TikTok", icon: TikTokIcon },
  { href: "/facebook", label: "Tài khoản Facebook", icon: FacebookIcon },
  { href: "/insight", label: "Insight", icon: BarChart3 },
  { href: "/youtube", label: "Bookmark Key", icon: Bookmark },
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
      <div style={{ marginBottom: 18 }}>
        <div className="brand">
          <img src="/logo.png" alt="" className="brand-logo" />
          <span>Social Manager</span>
        </div>
      </div>

      <nav className="nav-list" aria-label="Mục chính">
        {nav.map((item) => {
          const groupActive = item.children
            ? item.children.some((c) => c.href === pathname) ||
              pathname.startsWith(`${item.href}/`) ||
              pathname === item.href
            : item.href === pathname;
          const Icon = item.icon;
          return (
            <div key={item.href}>
              <Link
                href={item.href}
                prefetch
                className={`nav-item ${groupActive ? "active" : ""}`}
                aria-current={groupActive ? "page" : undefined}
              >
                <Icon size={18} aria-hidden="true" />
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
                        prefetch
                        className={`nav-sub-item ${active ? "active" : ""}`}
                        aria-current={active ? "page" : undefined}
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
          <div className="nav-label">Quản trị</div>
          <nav className="nav-list" aria-label="Quản trị">
            <Link
              href="/admin/users"
              prefetch
              className={`nav-item ${pathname.startsWith("/admin/users") ? "active" : ""}`}
              aria-current={pathname.startsWith("/admin/users") ? "page" : undefined}
            >
              <Users size={18} aria-hidden="true" />
              <span>Người dùng</span>
            </Link>
          </nav>
        </>
      )}

      <div className="sidebar-footer">
        <ThemeToggle />
        <div className="sidebar-footer-card sidebar-user">
          <div className="sidebar-user-name">
            <strong>{user.username}</strong>
            {isAdmin && <span className="sidebar-user-role">Admin</span>}
          </div>
          <button onClick={logout} disabled={loggingOut} className="sidebar-logout" title="Đăng xuất">
            <LogOut size={16} aria-hidden="true" />
            <span>{loggingOut ? "Đang đăng xuất…" : "Đăng xuất"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
