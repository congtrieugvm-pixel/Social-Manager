"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export const THEME_KEY = "sm_theme";
type Theme = "light" | "dark";

/**
 * Inline <head> script: applies the saved theme (and table density) before
 * first paint so a dark user never sees a light flash. Light is the default.
 */
export const THEME_BOOT = `try{var d=document.documentElement,t=localStorage.getItem("${THEME_KEY}");if(t==="dark")d.dataset.theme="dark";if(localStorage.getItem("sm_density")==="compact")d.dataset.density="compact"}catch(e){}`;

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // private mode — the switch still works for this visit
    }
  }

  const label = theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối";
  return (
    <button type="button" className={compact ? "theme-toggle compact" : "theme-toggle"} onClick={toggle} aria-label={label} title={label}>
      {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
      {!compact && <span>{theme === "dark" ? "Giao diện sáng" : "Giao diện tối"}</span>}
    </button>
  );
}
