// Loading placeholders shaped like the content that is coming, so the page
// does not jump when data arrives. The shimmer stops under reduced motion.

const WIDTHS = [72, 54, 86, 63, 78, 48, 90, 60];

/** Rows for a table body that is still loading. */
export function SkeletonRows({ rows = 8, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="sk-tr" aria-hidden="true">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}>
              <span className="sk" style={{ width: c === 0 ? 16 : `${WIDTHS[(r + c) % WIDTHS.length]}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** A card of placeholder lines, with an optional progress caption. */
export function SkeletonCard({ rows = 6, caption }: { rows?: number; caption?: string }) {
  return (
    <div className="card sk-card" role="status" aria-busy="true" aria-label={caption ?? "Đang tải"}>
      {caption && <div className="sk-caption">{caption}</div>}
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="sk-line" aria-hidden="true">
          <span className="sk sk-dot" />
          <span className="sk" style={{ width: `${WIDTHS[r % WIDTHS.length] / 1.6}%` }} />
          <span className="sk sk-num" />
        </div>
      ))}
    </div>
  );
}
