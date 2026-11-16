/**
 * Removable pill for an active selection (e.g. a compared ticker or year).
 *
 * Props:
 *   color:    optional series colour, shown as a dot (matches the chart line)
 *   onRemove: optional — renders the × button
 *   children: label
 */
export default function Chip({ color, onRemove, children }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: onRemove ? "2px 4px 2px 10px" : "2px 10px",
        border: "1px solid var(--border)", borderRadius: "var(--radius-full)",
        fontSize: 12, color: "var(--text-primary)", whiteSpace: "nowrap",
      }}
    >
      {color && <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />}
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${typeof children === "string" ? children : ""}`.trim()}
          style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 4px" }}
        >
          ×
        </button>
      )}
    </span>
  );
}
