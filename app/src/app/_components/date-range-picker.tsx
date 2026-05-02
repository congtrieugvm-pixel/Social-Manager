"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// ── Date helpers ────────────────────────────────────────────────
function toISO(d: Date): string {
  // Local-tz YYYY-MM-DD (avoids timezone shift from Date.toISOString()).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(x, offset);
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}
function fmtVnDay(d: Date): string {
  return `${d.getDate()} Tháng ${d.getMonth() + 1}, ${d.getFullYear()}`;
}
function fmtRange(fromIso: string | null, toIso: string | null): string {
  if (!fromIso || !toIso) return "—";
  return `${fmtVnDay(parseISO(fromIso))} – ${fmtVnDay(parseISO(toIso))}`;
}

export interface PickerPreset {
  key: string;
  label: string;
  compute(): { from: Date; to: Date };
}

export const DEFAULT_PRESETS: readonly PickerPreset[] = [
  {
    key: "yesterday",
    label: "Hôm qua",
    compute() {
      const y = addDays(startOfDay(new Date()), -1);
      return { from: y, to: y };
    },
  },
  {
    key: "last7",
    label: "7 ngày qua",
    compute() {
      const t = startOfDay(new Date());
      return { from: addDays(t, -6), to: t };
    },
  },
  {
    key: "last28",
    label: "28 ngày qua",
    compute() {
      const t = startOfDay(new Date());
      return { from: addDays(t, -27), to: t };
    },
  },
  {
    key: "last90",
    label: "90 ngày qua",
    compute() {
      const t = startOfDay(new Date());
      return { from: addDays(t, -89), to: t };
    },
  },
  {
    key: "thisWeek",
    label: "Tuần này",
    compute() {
      const t = startOfDay(new Date());
      return { from: startOfWeek(t), to: t };
    },
  },
  {
    key: "thisMonth",
    label: "Tháng này",
    compute() {
      const t = startOfDay(new Date());
      return { from: startOfMonth(t), to: t };
    },
  },
  {
    key: "thisYear",
    label: "Năm nay",
    compute() {
      const t = startOfDay(new Date());
      return { from: startOfYear(t), to: t };
    },
  },
  {
    key: "lastWeek",
    label: "Tuần trước",
    compute() {
      const w = startOfWeek(new Date());
      return { from: addDays(w, -7), to: addDays(w, -1) };
    },
  },
  {
    key: "lastMonth",
    label: "Tháng trước",
    compute() {
      const m = startOfMonth(new Date());
      return { from: addMonths(m, -1), to: addDays(m, -1) };
    },
  },
];

// "All" preset for tabs that want a sensible "no upper-bound filter" default
// (e.g. content tab — show every post the user has, capped only at today).
export const ALL_PRESET: PickerPreset = {
  key: "all",
  label: "Tất cả",
  compute() {
    const t = startOfDay(new Date());
    return { from: addDays(t, -365 * 5), to: t };
  },
};

export interface DateRangeValue {
  from: string; // ISO YYYY-MM-DD
  to: string; // ISO YYYY-MM-DD
  presetLabel: string | null;
}

export function DateRangePicker({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
}: {
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
  presets?: readonly PickerPreset[];
}) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState<Date | null>(null);
  const [draftTo, setDraftTo] = useState<Date | null>(null);
  const [draftPresetKey, setDraftPresetKey] = useState<string | null>(null);
  const [calAnchor, setCalAnchor] = useState<Date>(() =>
    startOfMonth(addMonths(new Date(), -1)),
  );
  const ref = useRef<HTMLDivElement | null>(null);
  const presetsByKey = useMemo(
    () => Object.fromEntries(presets.map((p) => [p.key, p])),
    [presets],
  );

  function openPicker() {
    setDraftFrom(parseISO(value.from));
    setDraftTo(parseISO(value.to));
    setDraftPresetKey(
      value.presetLabel
        ? presets.find((p) => p.label === value.presetLabel)?.key ?? null
        : null,
    );
    const cap = startOfMonth(addMonths(new Date(), -1));
    const fromMonth = startOfMonth(parseISO(value.from));
    setCalAnchor(fromMonth.getTime() < cap.getTime() ? fromMonth : cap);
    setOpen(true);
  }
  function closePicker() {
    setOpen(false);
  }
  function applyDraft() {
    if (!draftFrom || !draftTo) return;
    const [a, b] =
      draftFrom.getTime() <= draftTo.getTime()
        ? [draftFrom, draftTo]
        : [draftTo, draftFrom];
    onChange({
      from: toISO(a),
      to: toISO(b),
      presetLabel: draftPresetKey ? presetsByKey[draftPresetKey]?.label ?? null : null,
    });
    setOpen(false);
  }
  function pickPreset(key: string) {
    const p = presetsByKey[key];
    if (!p) return;
    const { from, to } = p.compute();
    setDraftFrom(from);
    setDraftTo(to);
    setDraftPresetKey(key);
    const cap = startOfMonth(addMonths(new Date(), -1));
    const fromMonth = startOfMonth(from);
    setCalAnchor(fromMonth.getTime() < cap.getTime() ? fromMonth : cap);
  }
  function pickCalDay(d: Date) {
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(d);
      setDraftTo(null);
      setDraftPresetKey(null);
    } else {
      setDraftTo(d);
      setDraftPresetKey(null);
    }
  }
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) closePicker();
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const triggerLabel = useMemo(() => {
    const range = fmtRange(value.from, value.to);
    return value.presetLabel ? `${value.presetLabel}: ${range}` : range;
  }, [value]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => (open ? closePicker() : openPicker())}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 14px",
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--bg)",
          color: "var(--ink)",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 12,
          fontWeight: 500,
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span aria-hidden>📅</span>
        <span>{triggerLabel}</span>
        <span style={{ color: "var(--muted)", fontSize: 10 }}>▼</span>
      </button>
      {open && (
        <Popover
          presets={presets}
          draftFrom={draftFrom}
          draftTo={draftTo}
          draftPresetKey={draftPresetKey}
          calAnchor={calAnchor}
          setCalAnchor={setCalAnchor}
          onPickPreset={pickPreset}
          onPickDay={pickCalDay}
          onCancel={closePicker}
          onApply={applyDraft}
        />
      )}
    </div>
  );
}

const VN_DOW = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;

function Popover({
  presets,
  draftFrom,
  draftTo,
  draftPresetKey,
  calAnchor,
  setCalAnchor,
  onPickPreset,
  onPickDay,
  onCancel,
  onApply,
}: {
  presets: readonly PickerPreset[];
  draftFrom: Date | null;
  draftTo: Date | null;
  draftPresetKey: string | null;
  calAnchor: Date;
  setCalAnchor: (d: Date) => void;
  onPickPreset: (key: string) => void;
  onPickDay: (d: Date) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const leftMonth = calAnchor;
  const rightMonth = addMonths(calAnchor, 1);
  const today = startOfDay(new Date());
  const rightAtCurrent =
    rightMonth.getFullYear() === today.getFullYear() &&
    rightMonth.getMonth() === today.getMonth();
  const canApply = !!(draftFrom && draftTo);
  const fromIsBeforeTo =
    draftFrom && draftTo && draftFrom.getTime() <= draftTo.getTime();
  const [normFrom, normTo] = fromIsBeforeTo
    ? [draftFrom, draftTo]
    : draftFrom && draftTo
      ? [draftTo, draftFrom]
      : [draftFrom, draftTo];

  return (
    <div
      role="dialog"
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        zIndex: 50,
        display: "grid",
        gridTemplateColumns: "180px 1fr",
        background: "var(--paper)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.16)",
        minWidth: 640,
      }}
    >
      <ul
        style={{
          margin: 0,
          padding: "8px 4px",
          listStyle: "none",
          borderRight: "1px solid var(--line)",
        }}
      >
        {presets.map((p) => {
          const on = draftPresetKey === p.key;
          return (
            <li key={p.key}>
              <button
                onClick={() => onPickPreset(p.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "7px 10px",
                  background: on ? "rgba(94,106,210,0.10)" : "transparent",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  color: "var(--ink)",
                  fontFamily: "inherit",
                  fontSize: 12,
                  textAlign: "left",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 999,
                    border: on
                      ? "4px solid var(--accent, #1877f2)"
                      : "1px solid var(--line)",
                    background: on ? "var(--paper)" : "transparent",
                    flexShrink: 0,
                  }}
                />
                {p.label}
              </button>
            </li>
          );
        })}
      </ul>

      <div style={{ padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <CalendarPane
            month={leftMonth}
            from={normFrom}
            to={normTo}
            maxDate={today}
            onPick={onPickDay}
            onPrev={() => setCalAnchor(addMonths(calAnchor, -1))}
            onNext={null}
            showPrev
            showNext={false}
          />
          <CalendarPane
            month={rightMonth}
            from={normFrom}
            to={normTo}
            maxDate={today}
            onPick={onPickDay}
            onPrev={null}
            onNext={rightAtCurrent ? null : () => setCalAnchor(addMonths(calAnchor, 1))}
            showPrev={false}
            showNext={!rightAtCurrent}
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 14,
            paddingTop: 10,
            borderTop: "1px solid var(--line)",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--ink)" }}>
            {normFrom && normTo
              ? `${fmtVnDay(normFrom)} - ${fmtVnDay(normTo)}`
              : normFrom
                ? `${fmtVnDay(normFrom)} - chọn ngày kết thúc…`
                : "Chọn ngày bắt đầu…"}
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={onCancel}
            style={{
              padding: "6px 14px",
              border: "1px solid var(--line)",
              borderRadius: 6,
              background: "transparent",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12,
              color: "var(--ink)",
            }}
          >
            Hủy
          </button>
          <button
            onClick={onApply}
            disabled={!canApply}
            style={{
              padding: "6px 16px",
              border: "1px solid var(--accent, #1877f2)",
              borderRadius: 6,
              background: canApply ? "var(--accent, #1877f2)" : "var(--line)",
              color: canApply ? "var(--paper, #fff)" : "var(--muted)",
              cursor: canApply ? "pointer" : "not-allowed",
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Cập nhật
          </button>
        </div>
      </div>
    </div>
  );
}

function CalendarPane({
  month,
  from,
  to,
  maxDate,
  onPick,
  onPrev,
  onNext,
  showPrev,
  showNext,
}: {
  month: Date;
  from: Date | null;
  to: Date | null;
  maxDate: Date;
  onPick: (d: Date) => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  showPrev: boolean;
  showNext: boolean;
}) {
  // Build the day grid for the given month. Leading days (before the 1st)
  // and trailing days (after month-end, padding to a full week row) render
  // as empty placeholders — we never bleed adjacent months into the view.
  const first = startOfMonth(month);
  const lead = first.getDay();
  const last = endOfMonth(month);
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++)
    cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  const fromMs = from ? from.getTime() : null;
  const toMs = to ? to.getTime() : null;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <button
          onClick={() => onPrev?.()}
          disabled={!showPrev || !onPrev}
          style={{
            visibility: showPrev ? "visible" : "hidden",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 16,
            color: "var(--ink)",
            padding: 4,
          }}
          aria-label="Tháng trước"
        >
          ‹
        </button>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
          Tháng {month.getMonth() + 1} {month.getFullYear()}
        </div>
        <button
          onClick={() => onNext?.()}
          disabled={!showNext || !onNext}
          style={{
            visibility: showNext ? "visible" : "hidden",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 16,
            color: "var(--ink)",
            padding: 4,
          }}
          aria-label="Tháng sau"
        >
          ›
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 2,
          fontSize: 11,
        }}
      >
        {VN_DOW.map((d) => (
          <div
            key={d}
            style={{
              textAlign: "center",
              color: "var(--muted)",
              padding: "4px 0",
              fontWeight: 600,
            }}
          >
            {d}
          </div>
        ))}
        {cells.map((c, i) => {
          if (!c) return <div key={i} />;
          const ms = startOfDay(c).getTime();
          const isFuture = ms > maxDate.getTime();
          const isStart = fromMs === ms;
          const isEnd = toMs === ms;
          const inRange =
            fromMs !== null && toMs !== null && ms > fromMs && ms < toMs;
          const isEdge = isStart || isEnd;
          return (
            <button
              key={i}
              onClick={() => !isFuture && onPick(startOfDay(c))}
              disabled={isFuture}
              aria-disabled={isFuture}
              title={isFuture ? "Không thể xem ngày tương lai" : undefined}
              style={{
                padding: "6px 0",
                border: "none",
                borderRadius: isEdge
                  ? isStart && isEnd
                    ? 6
                    : isStart
                      ? "6px 0 0 6px"
                      : "0 6px 6px 0"
                  : 0,
                background: isEdge
                  ? "var(--accent, #1877f2)"
                  : inRange
                    ? "rgba(24,119,242,0.16)"
                    : "transparent",
                color: isFuture
                  ? "var(--line)"
                  : isEdge
                    ? "#fff"
                    : "var(--ink)",
                cursor: isFuture ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                fontSize: 11,
                fontWeight: isEdge ? 700 : 400,
                opacity: isFuture ? 0.5 : 1,
              }}
            >
              {c.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
