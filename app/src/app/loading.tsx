// Root-level loading UI — Next App Router renders this instantly when the
// user navigates while server-side data is being fetched. Without it,
// browser sticks on the old page until new HTML arrives, which feels
// laggy on Cloudflare Workers (D1 latency adds ~100-200ms per nav).
//
// Top progress bar is intentionally tiny: looks like a real browser progress
// indicator, doesn't push content around. Body skeleton is grey-blocked so
// switching pages feels like a paint, not a freeze.

export default function RootLoading() {
  return (
    <div
      style={{
        position: "relative",
        padding: "32px 28px",
        animation: "fade-in 0.12s ease",
      }}
    >
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background:
            "linear-gradient(90deg, transparent 0%, var(--accent, #1877f2) 50%, transparent 100%)",
          backgroundSize: "200% 100%",
          animation: "topbar-shimmer 0.9s linear infinite",
          zIndex: 100,
        }}
      />
      <div
        style={{
          height: 28,
          width: "40%",
          background: "var(--line)",
          borderRadius: 6,
          marginBottom: 18,
          opacity: 0.6,
        }}
      />
      <div
        style={{
          height: 14,
          width: "70%",
          background: "var(--line)",
          borderRadius: 4,
          marginBottom: 28,
          opacity: 0.45,
        }}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              height: 78,
              background: "var(--line)",
              borderRadius: 8,
              opacity: 0.35,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes topbar-shimmer {
          from { background-position: 200% 0; }
          to { background-position: -200% 0; }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
