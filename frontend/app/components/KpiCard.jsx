export default function KpiCard({ id, name, value, unit, change, good_direction, onClick, isSelected }) {
    const display = value == null ? "--" : Number(value).toFixed(2);

    let changeEl = null;
    if (change != null) {
        const isGood = good_direction === "down" ? change < 0 : change > 0;
        const color = isGood ? "var(--positive)" : "var(--negative)";
        const arrow = change > 0 ? "▲" : "▼";
        const absChange = Math.abs(change).toFixed(2);
        changeEl = (
            <div style={{ fontSize: 12, color, marginTop: 8, display: "flex", alignItems: "center", gap: 3 }}>
                <span>{arrow}</span>
                <span>{absChange}</span>
                <span style={{ color: "var(--text-muted)", marginLeft: 2 }}>MoM</span>
            </div>
        );
    }

    return (
        <button
            onClick={() => onClick(id)}
            style={{
                border: isSelected ? "1px solid var(--green-500)" : "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                padding: "20px",
                minWidth: 160,
                background: isSelected ? "var(--green-900)" : "var(--bg-elevated)",
                color: "var(--text-primary)",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.2s ease",
                boxShadow: isSelected
                    ? "0 0 0 1px rgba(16,185,129,0.25), 0 8px 30px rgba(0,0,0,0.35)"
                    : "0 4px 12px rgba(0,0,0,0.2)",
            }}
        >
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
                {name}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                    {display}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{unit}</div>
            </div>
            {changeEl}
        </button>
    );
}
