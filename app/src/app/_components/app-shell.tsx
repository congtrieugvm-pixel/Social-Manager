"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";

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
          Social<em>Manager</em>
        </div>
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
    </div>
  );
}
