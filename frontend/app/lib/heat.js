// Heatmap cell backgrounds, shared by every matrix/heatmap table (Seasonality monthly
// returns, correlation and covariance matrices). Alpha scales with |v| / cap.

const SCHEMES = {
  // gain/loss or positive/negative relationship — the app's green/red
  gainloss: { pos: "22,163,74", neg: "220,38,38" },
  // magnitude without good/bad meaning (covariance) — orange/blue, not the gain/loss tokens
  diverging: { pos: "234,88,12", neg: "37,99,235" },
};

/** Background colour for a heatmap cell. cap = value that gets full intensity. */
export function heatColor(v, cap, scheme = "gainloss") {
  if (v == null || Number.isNaN(v) || !cap) return "transparent";
  const t = Math.min(Math.abs(v) / cap, 1);
  if (v === 0) return "transparent";
  const { pos, neg } = SCHEMES[scheme];
  return `rgba(${v > 0 ? pos : neg},${0.08 + t * 0.57})`;
}

/** Cap at the given percentile of |values|, so a single extreme doesn't wash out the rest. */
export function heatCap(values, percentile = 0.9, floor = 0) {
  const abs = values.filter((v) => v != null && !Number.isNaN(v)).map(Math.abs).sort((a, b) => a - b);
  if (!abs.length) return floor;
  const pos = (abs.length - 1) * percentile;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return Math.max(abs[lo] + (abs[hi] - abs[lo]) * (pos - lo), floor);
}
