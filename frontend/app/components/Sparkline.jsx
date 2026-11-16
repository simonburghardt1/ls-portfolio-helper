/**
 * Small area sparkline for overview cards (Baskets, Portfolios). Stretches to its container;
 * give the parent a height. `values` is a level series (≥ 2 points), `color` any CSS color.
 */
export default function Sparkline({ values, color }) {
  const w = 240, h = 44, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    pad + (1 - (v - min) / span) * (h - 2 * pad),
  ]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">
      <path d={area} style={{ fill: color }} opacity={0.12} />
      <path d={line} fill="none" style={{ stroke: color }} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
