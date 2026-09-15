/**
 * Bar-chart histogram for a fixed set of pre-computed bins (label + count + matching
 * dates), e.g. the Volatility page's Distribution of Returns. Not built on
 * lightweight-charts (what LineChart wraps) — that library is a time-series chart keyed
 * on dates, which doesn't fit a return-bucket x-axis. Plain CSS grid instead, single-use
 * for this shape of data.
 *
 * CSS grid, not flexbox: with a flex column per bar (bar / x-axis label stacked,
 * justifyContent: flex-end), each column's own stack height depends on its own label's
 * wrapped height, so columns of different label lengths drift out of alignment —
 * flexbox has no shared baseline across sibling columns. Grid row tracks are shared,
 * fixed lanes across every column, so the bar row's height/position can never be
 * affected by what a neighboring cell's label does.
 *
 * Props:
 *   bins: [{ range_label, lower, upper, count }, ...]
 *   selectedIndex: currently-selected bin index, or null
 *   onSelect(index): called with the clicked bin's index, or null to deselect
 */
const BAR_ROW_HEIGHT = 160;
const LABEL_ROW_HEIGHT = 110;

// Compact but still shows the full range (the user's own ask) — an en dash instead of
// "to", and a single trailing "%" instead of one per bound.
function compactLabel(bin) {
  if (bin.lower == null) return `< ${(bin.upper * 100).toFixed(2)}%`;
  if (bin.upper == null) return `> ${(bin.lower * 100).toFixed(2)}%`;
  return `${(bin.lower * 100).toFixed(2)}–${(bin.upper * 100).toFixed(2)}%`;
}

export default function Histogram({ bins, selectedIndex = null, onSelect }) {
  if (!bins?.length) return null;
  const maxCount = Math.max(...bins.map((b) => b.count), 1);

  function handleClick(i) {
    onSelect?.(selectedIndex === i ? null : i);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${bins.length}, 1fr)`, gridTemplateRows: `${BAR_ROW_HEIGHT}px ${LABEL_ROW_HEIGHT}px`, columnGap: 4, padding: "0 4px" }}>
      {bins.map((b, i) => (
        <div
          key={i}
          title={`${b.range_label} — ${b.count} weeks`}
          onClick={() => handleClick(i)}
          style={{
            gridRow: 1,
            gridColumn: i + 1,
            alignSelf: "end",
            height: b.count > 0 ? Math.max((b.count / maxCount) * BAR_ROW_HEIGHT, 3) : 0,
            background: selectedIndex === i ? "#93c5fd" : "var(--chart-1)",
            opacity: selectedIndex === i ? 1 : 0.75,
            cursor: onSelect ? "pointer" : "default",
          }}
        />
      ))}
      {bins.map((b, i) => (
        <div
          key={i}
          title={`${b.range_label} — ${b.count} weeks`}
          onClick={() => handleClick(i)}
          style={{
            gridRow: 2,
            gridColumn: i + 1,
            fontSize: 10.5,
            color: selectedIndex === i ? "var(--text-primary)" : "var(--text-secondary)",
            fontWeight: selectedIndex === i ? 600 : 400,
            whiteSpace: "nowrap",
            transform: "rotate(-60deg)",
            transformOrigin: "top right",
            textAlign: "right",
            marginTop: 8,
            paddingRight: 4,
            cursor: onSelect ? "pointer" : "default",
          }}
        >
          {compactLabel(b)}
        </div>
      ))}
    </div>
  );
}
