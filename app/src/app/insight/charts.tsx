"use client";

import { useEffect, useRef, useState } from "react";

export interface DayPoint {
  date: string; // YYYY-MM-DD
  value: number | null;
}

export function ddmm(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

const fmt = (n: number) => n.toLocaleString("vi-VN");

// Compact line chart of daily reach. Fixed pixel height (it used to scale
// with the width — ~450px tall on a wide screen); the width is measured so
// text never stretches. One series → one color (--accent), no legend; the
// section title names it. Hover: crosshair + marker + tooltip; nulls (day
// not published yet) break the line.
export function LineChart({ points, height = 120 }: { points: DayPoint[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const padL = 4;
  const padR = 4;
  const top = 16;
  const bottom = 20;
  const H = height;
  const W = Math.max(width, 1);
  const n = points.length;
  const plotW = W - padL - padR;
  const base = H - bottom;
  const max = Math.max(0, ...points.map((p) => p.value ?? 0));
  const x = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => (max > 0 ? base - (v / max) * (base - top) : base);

  // Line + area, broken at nulls.
  let line = "";
  let area = "";
  let seg: Array<[number, number]> = [];
  const flush = () => {
    if (seg.length === 0) return;
    line += seg.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ") + " ";
    area += `M${seg[0][0].toFixed(1)},${base} ` + seg.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join(" ") + ` L${seg[seg.length - 1][0].toFixed(1)},${base} Z `;
    seg = [];
  };
  points.forEach((p, i) => {
    if (p.value == null) flush();
    else seg.push([x(i), y(p.value)]);
  });
  flush();

  const maxIdx = points.findIndex((p) => p.value === max && max > 0);
  // Room-based label thinning: roughly one date label per 56px.
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 56))));
  const hovered = hover !== null ? points[hover] : null;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left - padL) / Math.max(plotW, 1);
    setHover(Math.min(n - 1, Math.max(0, Math.round(rel * (n - 1)))));
  }

  return (
    <div ref={ref} style={{ position: "relative", width: "100%", height: H }}>
      {width > 0 && (
        <svg
          width={W}
          height={H}
          role="img"
          aria-label="Biểu đồ reach theo ngày"
          style={{ display: "block", overflow: "visible" }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <line x1={padL} x2={W - padR} y1={top} y2={top} stroke="var(--line)" strokeDasharray="2 4" />
          <line x1={padL} x2={W - padR} y1={base} y2={base} stroke="var(--line-strong)" />
          <path d={area} fill="var(--accent-soft)" stroke="none" />
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {maxIdx >= 0 && (
            <text
              x={Math.min(Math.max(x(maxIdx), 24), W - 24)}
              y={y(max) - 6}
              textAnchor="middle"
              fill="var(--ink-soft)"
              fontSize={10}
              fontFamily="var(--font-mono)"
            >
              {fmt(max)}
            </text>
          )}
          {points.map((p, i) =>
            i % every === 0 || i === n - 1 ? (
              <text
                key={p.date}
                x={x(i)}
                y={H - 5}
                textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                fill="var(--muted)"
                fontSize={10}
                fontFamily="var(--font-mono)"
              >
                {ddmm(p.date)}
              </text>
            ) : null,
          )}
          {hovered && hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={top} y2={base} stroke="var(--line-strong)" />
              {hovered.value != null && (
                <circle cx={x(hover)} cy={y(hovered.value)} r={4.5} fill="var(--accent)" stroke="var(--paper)" strokeWidth={2} />
              )}
            </g>
          )}
        </svg>
      )}
      {hovered && hover !== null && (
        <div
          className="mono"
          style={{
            position: "absolute",
            top: 0,
            left: x(hover),
            transform: `translateX(${hover > n / 2 ? "calc(-100% - 10px)" : "10px"})`,
            background: "var(--bg-3)",
            border: "1px solid var(--line-strong)",
            borderRadius: 6,
            padding: "5px 9px",
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
