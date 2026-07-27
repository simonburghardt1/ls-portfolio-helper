export default function KpiCard({ id, name, value, unit, change, good_direction, onClick, isSelected }) {
    const display = value == null ? "--" : Number(value).toFixed(2);

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
    }

    return (
        <button
            onClick={() => onClick(id)}
            style={{
                border: isSelected ? "1px solid var(--text-secondary)" : "1px solid var(--border)",
                borderRadius: "var(--radius-none)",
                padding: "20px",
                minWidth: 160,
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                cursor: "pointer",
                textAlign: "left",
                transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                boxShadow: isSelected ? "inset 0 0 0 1px rgba(139,144,150,0.35)" : "none",
            }}
        >
            <div style={{ fontFamily: "var(--font-family-sans)", fontSize: "var(--text-label-size)", color: "var(--text-secondary)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "var(--text-label-tracking)", fontWeight: "var(--text-label-weight)" }}>
                {name}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                <div style={{ fontFamily: "var(--font-family-mono)", fontSize: "var(--text-data-lg-size)", fontWeight: "var(--text-data-lg-weight)", lineHeight: "var(--text-data-lg-line-height)", letterSpacing: "var(--text-data-lg-tracking)", fontVariantNumeric: "tabular-nums" }}>
                    {display}
                </div>
                <div style={{ fontFamily: "var(--font-family-sans)", fontSize: "var(--text-data-sm-size)", color: "var(--text-secondary)" }}>{unit}</div>
            </div>
            {changeEl}
        </button>
    );
}
