"use client";

import { useState } from "react";

export interface DayPoint {
  date: string; // YYYY-MM-DD
  value: number | null;
}

export function ddmm(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

const fmt = (n: number) => n.toLocaleString("vi-VN");

// Column chart of daily reach. One series → one color (--accent), no legend;
// the section title names it. Columns ≤ 24px wide, 4px rounded data-end,
// square at the baseline; hover shows a tooltip, hit target = whole slot.
export function BarChart({ points }: { points: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 840;
  const H = 190;
  const top = 26;
  const bottom = 24;
  const base = H - bottom;
  const n = points.length;
  const slot = W / Math.max(n, 1);
  const barW = Math.max(4, Math.min(24, slot - 2));
  const max = Math.max(0, ...points.map((p) => p.value ?? 0));
  const scale = max > 0 ? (base - top) / max : 0;
  const labelEvery = n > 14 ? 4 : 1;
  const maxIdx = points.findIndex((p) => p.value === max && max > 0);

  const bar = (x: number, y: number, w: number) => {
    const h = base - y;
    const r = Math.min(4, w / 2, h);
    return `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${base} Z`;
  };

  const hovered = hover !== null ? points[hover] : null;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Biểu đồ reach theo ngày"
        style={{ display: "block", overflow: "visible" }}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={0} x2={W} y1={top} y2={top} stroke="var(--line)" strokeDasharray="2 4" />
        <line x1={0} x2={W} y1={base} y2={base} stroke="var(--line-strong)" />
        {points.map((p, i) => {
          const cx = slot * i + slot / 2;
          const x = cx - barW / 2;
          const v = p.value ?? 0;
          const y = base - v * scale;
          return (
            <g key={p.date}>
              {v > 0 && (
                <path
                  d={bar(x, y, barW)}
                  fill="var(--accent)"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              {p.value === null && (
                <text x={cx} y={base - 4} textAnchor="middle" fill="var(--dim)" fontSize={10}>
                  —
                </text>
              )}
              {i === maxIdx && (
                <text
                  x={cx}
                  y={y - 6}
                  textAnchor="middle"
                  fill="var(--ink-soft)"
                  fontSize={10}
                  fontFamily="var(--font-mono)"
                >
                  {fmt(v)}
                </text>
              )}
              {(i % labelEvery === 0 || i === n - 1) && (
                <text
                  x={cx}
                  y={H - 6}
                  textAnchor="middle"
                  fill="var(--muted)"
                  fontSize={10}
                  fontFamily="var(--font-mono)"
                >
                  {ddmm(p.date)}
                </text>
              )}
              <rect
                x={slot * i}
                y={0}
                width={slot}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            </g>
          );
        })}
      </svg>
      {hovered && hover !== null && (
        <div
          className="mono"
          style={{
            position: "absolute",
            top: 0,
            left: `${((hover + 0.5) / n) * 100}%`,
            transform: `translateX(${hover > n / 2 ? "-100%" : "0"})`,
            background: "var(--bg-3)",
            border: "1px solid var(--line-strong)",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 11,
            color: "var(--ink)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          <div style={{ color: "var(--muted)" }}>{ddmm(hovered.date)}</div>
          <div style={{ fontVariantNumeric: "tabular-nums" }}>
            {hovered.value === null ? "Chưa có số" : `${fmt(hovered.value)} reach`}
          </div>
        </div>
      )}
    </div>
  );
}

// Tiny trend line for a table row. Decorative — the row's numbers carry the
// data — so no axes; nulls break the line.
export function Sparkline({ points }: { points: DayPoint[] }) {
  const W = 84;
  const H = 22;
  const vals = points.map((p) => p.value);
  const nums = vals.filter((v): v is number => v !== null);
  if (nums.length < 2) {
    return <span style={{ color: "var(--dim)" }}>—</span>;
  }
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const span = max - min || 1;
  const step = W / Math.max(vals.length - 1, 1);
  let d = "";
  let pen = false;
  vals.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    const x = i * step;
    const y = H - 2 - ((v - min) / span) * (H - 4);
    d += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
    pen = true;
  });
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden style={{ display: "block" }}>
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
