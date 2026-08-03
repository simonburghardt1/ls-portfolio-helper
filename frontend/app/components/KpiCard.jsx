/**
 * Shared KPI tile. Two modes:
 *
 *   interactive (pass onClick) — renders as a <button>, click-to-select
 *                                 semantics (Dashboard: picks the chart series).
 *   static      (omit onClick) — renders as a <div>, purely informational
 *                                 (Track Record's KPI strips).
 *
 * Two value-formatting paths:
 *   value      — a raw number, coerced via Number(value).toFixed(2) (Dashboard).
 *   formatted  — a pre-formatted display string, used as-is, takes priority
 *                over `value` when present (Track Record's "€1,131.4K" etc.).
 *
 * Props:
 *   id, label, value, formatted, unit, change, good_direction: as above
 *   onClick, isSelected: interactive-only, ignored when onClick is omitted
 *   small:       bool — denser padding/font for multi-tile strips
 *   valueColor:  optional explicit color override for the main value
 *                (defaults to --text-primary)
 *   caption:     optional plain muted line below the value (string or node),
 *                for a secondary fact that isn't a MoM delta (e.g. "score 0.55").
 *                Ignored when `change` is present — `change` wins.
 */
export default function KpiCard({ id, label, value, formatted, unit, change, good_direction, onClick, isSelected, small = false, valueColor, caption }) {
    const display = formatted ?? (value == null ? "--" : Number(value).toFixed(2));

    let changeEl = null;
    if (change != null) {
        const isGood = good_direction === "down" ? change < 0 : change > 0;
        const color = isGood ? "var(--positive)" : "var(--negative)";
        const arrow = change > 0 ? "▲" : "▼";
        const absChange = Math.abs(change).toFixed(2);
        changeEl = (
            <div style={{ fontFamily: "var(--font-family-mono)", fontSize: "var(--text-data-sm-size)", fontWeight: "var(--text-data-sm-weight)", color, marginTop: 8, display: "flex", alignItems: "center", gap: 3 }}>
                <span>{arrow}</span>
                <span>{absChange}</span>
                <span style={{ fontFamily: "var(--font-family-sans)", fontWeight: 400, color: "var(--text-secondary)", marginLeft: 2 }}>MoM</span>
            </div>
        );
    } else if (caption != null) {
        changeEl = (
            <div style={{ fontFamily: "var(--font-family-sans)", fontSize: "var(--text-data-sm-size)", color: "var(--text-secondary)", marginTop: 8 }}>
                {caption}
            </div>
        );
    }

    const interactive = typeof onClick === "function";
    const Tag = interactive ? "button" : "div";

    return (
        <Tag
            type={interactive ? "button" : undefined}
            onClick={interactive ? () => onClick(id) : undefined}
            style={{
                border: interactive && isSelected ? "1px solid var(--text-secondary)" : "1px solid var(--border)",
                borderRadius: "var(--radius-none)",
                padding: small ? "10px 14px" : "20px",
                minWidth: small ? 100 : 160,
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                cursor: interactive ? "pointer" : "default",
                textAlign: "left",
                transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                boxShadow: interactive && isSelected ? "inset 0 0 0 1px rgba(139,144,150,0.35)" : "none",
            }}
        >
            <div style={{ fontFamily: "var(--font-family-sans)", fontSize: "var(--text-label-size)", color: "var(--text-secondary)", marginBottom: small ? 4 : 12, textTransform: "uppercase", letterSpacing: "var(--text-label-tracking)", fontWeight: "var(--text-label-weight)" }}>
                {label}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                <div style={{
                    fontFamily: "var(--font-family-mono)",
                    fontSize: small ? "var(--text-data-sm-size)" : "var(--text-data-lg-size)",
                    fontWeight: small ? "var(--text-data-sm-weight)" : "var(--text-data-lg-weight)",
                    lineHeight: small ? "var(--text-data-sm-line-height)" : "var(--text-data-lg-line-height)",
                    letterSpacing: small ? "normal" : "var(--text-data-lg-tracking)",
                    fontVariantNumeric: "tabular-nums",
                    color: valueColor ?? "var(--text-primary)",
                }}>
                    {display}
                </div>
                {unit && <div style={{ fontFamily: "var(--font-family-sans)", fontSize: "var(--text-data-sm-size)", color: "var(--text-secondary)" }}>{unit}</div>}
            </div>
            {changeEl}
        </Tag>
    );
}
