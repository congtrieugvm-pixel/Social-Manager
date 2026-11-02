"use client";

import { useEffect, useState } from "react";

export const DENSITY_KEY = "sm_density";
type Density = "comfy" | "compact";

/** Table density for every table in the app ("Gọn" fits ~1.5× more rows). */
export function DensityToggle() {
  const [density, setDensity] = useState<Density>("comfy");
  useEffect(() => {
    setDensity(document.documentElement.dataset.density === "compact" ? "compact" : "comfy");
  }, []);

  function pick(next: Density) {
    setDensity(next);
    if (next === "compact") document.documentElement.dataset.density = "compact";
    else delete document.documentElement.dataset.density;
    try {
      localStorage.setItem(DENSITY_KEY, next);
    } catch {
      // private mode — applies to this visit only
    }
  }

  return (
    <div className="btn-group density-toggle" role="radiogroup" aria-label="Mật độ bảng">
      {(
        [
          ["compact", "Gọn"],
          ["comfy", "Thoáng"],
        ] as const
      ).map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={density === k}
          className={`btn-seg${density === k ? " active" : ""}`}
          onClick={() => pick(k)}
          title={k === "compact" ? "Hàng thấp hơn, xem được nhiều dòng hơn" : "Hàng cao, dễ đọc"}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
