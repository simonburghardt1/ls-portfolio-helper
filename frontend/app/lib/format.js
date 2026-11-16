// Shared number formatting + sign colouring. Use these instead of per-page pct()/fmtPct()
// helpers so every page renders numbers the same way.

/** 0.0123 → "+1.23%". Null/NaN → "—". Never renders "-0.00%". */
export function fmtPct(v, dp = 2, { sign = true } = {}) {
  if (v == null || Number.isNaN(v)) return "—";
  const s = (v * 100).toFixed(dp);
  if (Number(s) === 0) return `${(0).toFixed(dp)}%`;
  return `${sign && v > 0 ? "+" : ""}${s}%`;
}

/** Plain number with fixed decimals, "—" for null. */
export function fmtNum(v, dp = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return Number(v).toFixed(dp);
}

/** CSS colour for a signed value: positive / negative token, secondary text for null or 0. */
export function signColor(v) {
  if (v == null || Number.isNaN(v) || v === 0) return "var(--text-secondary)";
  return v > 0 ? "var(--positive)" : "var(--negative)";
}
