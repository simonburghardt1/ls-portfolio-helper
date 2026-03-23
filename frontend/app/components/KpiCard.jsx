export default function KpiCard({ id, name, value, unit, change, good_direction, onClick, isSelected }) {
    const display = value == null ? "--" : Number(value).toFixed(2);

    let changeEl = null;
    if (change != null) {
        const isGood = good_direction === "down" ? change < 0 : change > 0;
        const color = isGood ? "#4ade80" : "#f87171";
        const arrow = change > 0 ? "▲" : "▼";
        const absChange = Math.abs(change).toFixed(2);
        changeEl = (
            <div style={{ fontSize: 12, color, marginTop: 8, display: "flex", alignItems: "center", gap: 3 }}>
                <span>{arrow}</span>
                <span>{absChange}</span>
                <span style={{ color: "#6b7280", marginLeft: 2 }}>MoM</span>
            </div>
        );
    }

    return (
        <button
            onClick={() => onClick(id)}
            style={{
                border: isSelected ? "1px solid #60a5fa" : "1px solid #374151",
                borderRadius: 14,
                padding: "14px 18px",
                minWidth: 160,
                background: isSelected ? "#111827" : "#0f172a",
                color: "#e5e7eb",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.2s ease",
                boxShadow: isSelected
                    ? "0 0 0 1px rgba(96,165,250,0.25), 0 8px 30px rgba(0,0,0,0.35)"
                    : "0 4px 12px rgba(0,0,0,0.2)",
            }}
        >
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {name}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>
                    {display}
                </div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>{unit}</div>
            </div>
            {changeEl}
        </button>
    );
}
