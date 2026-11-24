// Shared bits of the macro indicator pages (monthly/quarterly FRED-style series).

import { signColor } from "@/app/lib/format";

export const MACRO_RANGES = [
  { label: "5Y", years: 5 },
  { label: "10Y", years: 10 },
  { label: "20Y", years: 20 },
  { label: "All", years: null },
];

/** LineChart visibleRange for the last `years` years; null = fit everything. */
export function rangeFrom(years) {
  if (!years) return null;
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);
  return { from: from.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };
}

/** "2026-09-01" → "Sep 2026" */
export function fmtMonth(date) {
  if (!date) return "";
  return new Date(date).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * SeriesLegend props for the latest values of several series: { items, asOf }. When every
 * series ends in the same month, that month is shown once (asOf) instead of per entry.
 * `entries` is [[key, series], …].
 */
export function latestLegend(entries, opts) {
  const months = new Set(entries.map(([, s]) => s.dates[s.dates.length - 1]));
  const common = months.size === 1;
  return {
    items: entries.map(([k, s]) => latestItem(k, s, { ...opts, date: !common })),
    asOf: common ? fmtMonth([...months][0]) : undefined,
  };
}

/**
 * SeriesLegend item for a series' latest value, e.g. "Building Permits 1295K". The value is
 * coloured by its change vs. the prior month (green up, red down; the change in the tooltip).
 * `s` is { label, color, dates, values }; date: false leaves the month out.
 */
export function latestItem(key, s, { dp = 1, unit = "", date = true } = {}) {
  const n = s.values.length;
  const latest = s.values[n - 1];
  const prev = s.values[n - 2];
  const diff = latest != null && prev != null ? latest - prev : null;
  const text = latest != null ? `${latest.toFixed(dp)}${unit}` : "—";
  return {
    key,
    label: s.label,
    color: s.color,
    value: diff != null ? (
      <span style={{ color: signColor(diff) }} title={`${diff >= 0 ? "+" : ""}${diff.toFixed(dp)} vs. prior month`}>{text}</span>
    ) : text,
    note: date ? fmtMonth(s.dates[n - 1]) : undefined,
  };
}
