"use client";

import { useState } from "react";
import LineChart from "@/app/components/LineChart";
import Panel from "@/app/components/Panel";
import SeriesCards, { toggleKeepOne } from "@/app/components/SeriesCards";

// Shared by Correlation and Beta: one card per rolling window that doubles as the
// legend/toggle for that window's line in the chart below.

export const ROLLING_WINDOWS = [
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "6m", label: "6M" },
  { key: "1y", label: "1Y" },
  { key: "5y", label: "5Y" },
];

// Literal hex (canvas charts can't read CSS vars) — --chart-10, -1, -2, -3, -5
const WINDOW_COLORS = { "1m": "#a78bfa", "3m": "#3b82f6", "6m": "#10b981", "1y": "#f59e0b", "5y": "#ef4444" };

/**
 * Props:
 *   title:         panel title ("Rolling correlation")
 *   current:       { [windowKey]: number|null } — latest value per window
 *   series(key):   → { dates, data } for that window's line (already in display units)
 *   format(v):     card value formatter
 *   valueColor(v): optional card value colour
 *   referenceLine: horizontal guide in the chart (0 for correlation, 1 for beta)
 *   defaultActive: window keys shown initially
 */
export default function RollingWindows({ title, current, series, format, valueColor, referenceLine, defaultActive }) {
  const [active, setActive] = useState(() => new Set(defaultActive));

  const datasets = ROLLING_WINDOWS.filter((w) => active.has(w.key)).map((w) => {
    const s = series(w.key);
    return { dates: s.dates, data: s.data, borderColor: WINDOW_COLORS[w.key], borderWidth: 1.5, label: w.label };
  });
  const allDates = [...new Set(datasets.flatMap((d) => d.dates))].sort();

  return (
    <>
      <SeriesCards
        minWidth={140}
        items={ROLLING_WINDOWS.map((w) => ({
          key: w.key, label: w.label, color: WINDOW_COLORS[w.key],
          value: format(current?.[w.key]), valueColor: valueColor?.(current?.[w.key]),
        }))}
        active={active}
        onToggle={(k) => setActive((p) => toggleKeepOne(p, k))}
      />
      <Panel title={title}>
        <LineChart dates={allDates} datasets={datasets} referenceLine={referenceLine} height={360} />
      </Panel>
    </>
  );
}
