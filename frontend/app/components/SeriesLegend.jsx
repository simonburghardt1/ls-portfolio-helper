/**
 * Quiet one-line chart legend: colour dash, label, latest value and an optional note per
 * series, no boxes. Sits in a Panel's `title` slot so the chart keeps the focus — the
 * lighter alternative to SeriesCards. Click an entry to show/hide its line.
 *
 * Props:
 *   items:    [{ key, label, color, value?, note? }]  (value/note: string or node)
 *   active:   Set of keys currently shown (omit: all shown)
 *   onToggle: (key) => void — omit for a static legend
 *   asOf:     optional muted text at the end, e.g. the month all values are from
 */
export default function SeriesLegend({ items, active, onToggle, asOf }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px", alignItems: "baseline" }}>
      {items.map((it) => {
        const on = active ? active.has(it.key) : true;
        const Tag = onToggle ? "button" : "span";
        return (
          <Tag
            key={it.key}
            type={onToggle ? "button" : undefined}
            onClick={onToggle ? () => onToggle(it.key) : undefined}
            aria-pressed={onToggle ? on : undefined}
            title={onToggle ? (on ? "Hide line" : "Show line") : undefined}
            style={{
              display: "inline-flex", alignItems: "baseline", gap: 8, padding: 0,
              background: "transparent", border: "none", cursor: onToggle ? "pointer" : "default",
              fontFamily: "var(--font-family-sans)", fontSize: 12, color: "var(--text-secondary)",
              opacity: on ? 1 : 0.45,
            }}
          >
            <span style={{ width: 12, height: 2, alignSelf: "center", flexShrink: 0, background: on ? it.color : "var(--text-disabled)" }} />
            <span>{it.label}</span>
            {it.value != null && (
              <span style={{ fontFamily: "var(--font-family-mono)", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{it.value}</span>
            )}
            {it.note != null && <span style={{ fontFamily: "var(--font-family-mono)", fontSize: 11 }}>{it.note}</span>}
          </Tag>
        );
      })}
      {asOf && <span style={{ fontFamily: "var(--font-family-mono)", fontSize: 11, color: "var(--text-disabled)" }}>{asOf}</span>}
    </div>
  );
}
