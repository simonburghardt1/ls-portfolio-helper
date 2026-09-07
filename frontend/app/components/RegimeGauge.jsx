/**
 * 0-100 continuous gradient meter (UX-DR4 — no prior component in this app displays
 * a single score this way; existing pages use KpiCard tiles or discrete badges).
 *
 * A horizontal bar, red→yellow→green, sharp corners (matches the app's system-wide
 * "sharp corners except Badge's interactive pill and nav/tabs" convention), with a
 * marker at the current score and the numeric value printed above it.
 *
 * Props:
 *   score:  number | null — 0-100. null renders an empty/greyed-out track with "—".
 *   label:  string — heading above the gauge (e.g. "Regime Score").
 */
export default function RegimeGauge({ score, label }) {
  const clamped = score == null ? null : Math.max(0, Math.min(100, score));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div style={{ fontFamily: "var(--font-family-sans)", fontSize: "var(--text-label-size)", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "var(--text-label-tracking)", fontWeight: "var(--text-label-weight)" }}>
          {label}
        </div>
        <div style={{ fontFamily: "var(--font-family-mono)", fontSize: "var(--text-data-lg-size)", fontWeight: "var(--text-data-lg-weight)", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
          {clamped != null ? clamped.toFixed(0) : "—"}
        </div>
      </div>

      <div style={{ position: "relative", height: 10, background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
        {clamped != null && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(90deg, var(--negative) 0%, #f59e0b 50%, var(--positive) 100%)",
              opacity: 0.35,
            }}
          />
        )}
        {clamped != null && (
          <div
            style={{
              position: "absolute",
              top: -3,
              bottom: -3,
              left: `calc(${clamped}% - 1px)`,
              width: 2,
              background: "var(--text-primary)",
            }}
          />
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "var(--text-secondary)" }}>
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </div>
    </div>
  );
}
