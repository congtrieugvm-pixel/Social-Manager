"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

/** Phone bottom sheet: slides up over a dimmed page; Esc / backdrop / ✕ close it. */
export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <span className="sheet-grip" aria-hidden="true" />
          <h2>{title}</h2>
          <button type="button" className="sheet-x" aria-label="Đóng" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
