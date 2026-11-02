"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bookmark, Menu } from "lucide-react";
import { FacebookIcon, Sidebar, TikTokIcon } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";

const TABS: Array<{ href: string; label: string; icon: (p: { size?: number }) => React.ReactNode }> = [
  { href: "/", label: "TikTok", icon: TikTokIcon },
  { href: "/facebook", label: "Facebook", icon: FacebookIcon },
  { href: "/insight", label: "Insight", icon: ({ size }) => <BarChart3 size={size} aria-hidden="true" /> },
  { href: "/youtube", label: "Bookmark", icon: ({ size }) => <Bookmark size={size} aria-hidden="true" /> },
];
import { Notifier } from "./notify";

interface AppShellProps {
  user: { username: string; role: string };
  children: React.ReactNode;
}

/**
 * Client wrapper that renders the sidebar shell on desktop and an off-canvas
 * drawer on mobile. The hamburger button toggles the drawer; route changes
 * auto-close it. Body scroll-lock applied while the drawer is open so the
 * page underneath doesn't scroll along with the menu.
 */
export function AppShell({ user, children }: AppShellProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close drawer on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while drawer is open (mobile only — desktop CSS hides
  // the drawer mode entirely).
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // "/" jumps to the page's search box (any input marked data-search).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const box = document.querySelector<HTMLInputElement>("input[data-search]");
      if (!box) return;
      e.preventDefault();
      box.focus();
      box.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="shell">
      {/* Mobile-only top bar with hamburger + brand. Hidden on desktop. */}
      <header className="mobile-topbar" role="banner">
        <button
          type="button"
          className="hamburger"
          aria-label={open ? "Đóng menu" : "Mở menu"}
          aria-expanded={open}
          aria-controls="app-sidebar"
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <div className="mobile-topbar-brand">
          <img src="/logo.png" alt="" className="brand-logo" />
          <span>Social Manager</span>
        </div>
        <span className="mobile-topbar-spacer" />
        <ThemeToggle compact />
      </header>

      {/* Sidebar — sticky on desktop, off-canvas drawer on mobile. */}
      <div
        id="app-sidebar"
        className={`sidebar-wrap ${open ? "is-open" : ""}`}
        aria-hidden={!open && undefined /* aria-hidden ignored on desktop via CSS */}
      >
        <Sidebar user={user} />
      </div>

      {/* Backdrop — click to close on mobile. */}
      {open && (
        <button
          type="button"
          aria-label="Đóng menu"
          className="sidebar-backdrop"
          onClick={() => setOpen(false)}
        />
      )}

      <main className="main">{children}</main>
      <Notifier />

      {/* Phones: thumb-reach tab bar. "Thêm" opens the drawer (users, theme, sign out). */}
      <nav className="tabbar" aria-label="Điều hướng chính">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link key={href} href={href} prefetch className={`tab${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
              <Icon size={22} />
              <span>{label}</span>
            </Link>
          );
        })}
        <button type="button" className={`tab${open ? " active" : ""}`} onClick={() => setOpen(true)} aria-expanded={open} aria-controls="app-sidebar">
          <Menu size={22} aria-hidden="true" />
          <span>Thêm</span>
        </button>
      </nav>
    </div>
  );
}
