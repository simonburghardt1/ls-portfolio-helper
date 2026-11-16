"use client";

import KpiCard from "@/app/components/KpiCard";

/**
 * A row of KPI cards, one per chart series, that double as the chart's legend and its
 * show/hide toggles (click a card). The colour dash in the label matches the line.
 *
 * Props:
 *   items:    [{ key, label, color, value (formatted), valueColor?, caption? }]
 *   active:   Set of keys currently shown
 *   onToggle: (key) => void — omit for a static legend row
 *   minWidth: card min width in px (default 160)
 */
export default function SeriesCards({ items, active, onToggle, minWidth = 160 }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))`, gap: "var(--space-3)", marginBottom: "var(--space-5)" }}>
      {items.map((it) => {
        const on = active ? active.has(it.key) : true;
        return (
          <KpiCard
            key={it.key}
            id={it.key}
            label={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: on ? 1 : 0.6 }}>
                <span style={{ width: 10, height: 2, flexShrink: 0, background: on ? it.color : "var(--text-disabled)" }} />
                {it.label}
              </span>
            }
            formatted={it.value}
            valueColor={it.valueColor}
            caption={it.caption}
            onClick={onToggle}
            isSelected={onToggle ? on : undefined}
          />
        );
      })}
    </div>
  );
}

/** Toggle helper for a Set of active keys that never empties. */
export function toggleKeepOne(prev, key) {
  const next = new Set(prev);
  if (next.has(key)) {
    if (next.size === 1) return prev;
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}
