export default function KpiCard({
    id,
    name,
    value,
    unit,
    onClick,
    isSelected,
}) {
    const display = value == null ? "--" : Number(value).toFixed(2);

    return (
        <button
            onClick={() => onClick(id)}
            style={{
                border: isSelected ? "1px solid #60a5fa" : "1px solid #374151",
                borderRadius: 16,
                padding: 18,
                minWidth: 230,
                background: isSelected ? "#111827" : "#0f172a",
                color: "#e5e7eb",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.2s ease",
                boxShadow: isSelected
                    ? "0 0 0 1px rgba(96,165,250,0.25), 0 8px 30px rgba(0,0,0,0.35)"
                    : "0 6px 20px rgba(0,0,0,0.25)",
            }}
        >
            <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 10 }}>
                {name}
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>
                    {display}
                </div>
                <div style={{ fontSize: 14, color: "#9ca3af" }}>{unit}</div>
            </div>
        </button>
    );
}
