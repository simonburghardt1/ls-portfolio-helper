"use client";

import { useMemo, useState } from "react";
import { useElementWidth } from "@/app/lib/hooks";
import { describe, niceBinWidth, normPdf } from "@/app/lib/stats";
import Button from "@/app/components/Button";

/**
 * Histogram of a sample (returns, MoM changes, …) with a fitted normal curve, the mean, an
 * optional marker for the current value, and a log-y switch. Bars left of `pivot` take
 * colors.below, the rest colors.above. Pair it with <DistributionStats> for the numbers.
 *
 * Props:
 *   values:   number[] — the observations (nulls ignored)
 *   dates:    optional string[] aligned with values; selected bins report their dates
 *   format:   (v) => axis/tooltip label (default: the value with 2 decimals)
 *   pivot:    colour split (default 0)
 *   colors:   { below, above } (default --negative / --positive)
 *   marker:   optional { value, label } — e.g. this month's reading
 *   selected: optional { lower, upper } — highlights that bin
 *   onSelect: optional (bin | null) => void; bin = { lower, upper, count, dates } — makes bars clickable
 *   height:   plot height in px (default 320)
 */
export default function DistributionHistogram({
  values, dates, format = (v) => v.toFixed(2), pivot = 0,
  colors = { below: "var(--negative)", above: "var(--positive)" },
  marker, selected, onSelect, height = 320,
}) {
  const [ref, width] = useElementWidth();
  const [logY, setLogY] = useState(false);

  const model = useMemo(() => buildModel(values, dates), [values, dates]);

  return (
    <div ref={ref} style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 8, fontSize: 12, color: "var(--text-secondary)" }}>
        <LegendSwatch><span style={{ width: 10, height: 10, background: colors.above, opacity: 0.8 }} /><span style={{ width: 10, height: 10, background: colors.below, opacity: 0.8, marginLeft: -6 }} />Observed</LegendSwatch>
        <LegendSwatch><span style={{ width: 14, height: 2, background: "var(--caution)" }} />Normal fit</LegendSwatch>
        <LegendSwatch><span style={{ width: 14, borderTop: "2px dotted var(--text-secondary)" }} />Mean</LegendSwatch>
        <div style={{ marginLeft: "auto" }}>
          <Button variant="range-toggle" active={logY} onClick={() => setLogY((v) => !v)}>Log y</Button>
        </div>
      </div>
      {model && width > 0 ? (
        <Plot model={model} width={width} height={height} logY={logY} format={format} pivot={pivot} colors={colors} marker={marker} selected={selected} onSelect={onSelect} />
      ) : (
        <div style={{ height }} />
      )}
    </div>
  );
}

function LegendSwatch({ children }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{children}</span>;
}

function buildModel(values, dates) {
  const pairs = values.map((v, i) => [v, dates?.[i]]).filter(([v]) => v != null && Number.isFinite(v));
  if (pairs.length < 3) return null;
  const stats = describe(pairs.map(([v]) => v));
  const sorted = pairs.map(([v]) => v).sort((a, b) => a - b);
  const w = niceBinWidth(sorted);
  const start = Math.floor(sorted[0] / w) * w;
  const count = Math.max(1, Math.ceil((sorted[sorted.length - 1] - start) / w + 1e-9));
  const bins = Array.from({ length: count }, (_, i) => ({ lower: start + i * w, upper: start + (i + 1) * w, count: 0, dates: [] }));
  for (const [v, d] of pairs) {
    const b = bins[Math.min(count - 1, Math.floor((v - start) / w + 1e-9))];
    b.count++;
    if (d) b.dates.push(d);
  }
  return { bins, stats, w, lo: start, hi: start + count * w };
}

const PAD = { left: 44, right: 12, top: 26, bottom: 28 };

function niceStep(span, target) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].find((s) => s * mag >= raw) * mag;
}

function Plot({ model, width, height, logY, format, pivot, colors, marker, selected, onSelect }) {
  const { bins, stats, w, lo, hi } = model;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const maxCount = Math.max(...bins.map((b) => b.count), 1);

  // Expected count per bin under N(mean, sigma)
  const fit = (x) => (stats.sigma > 0 ? (stats.n * w * normPdf((x - stats.mean) / stats.sigma)) / stats.sigma : 0);
  const yMax = Math.max(maxCount, fit(stats.mean)) * 1.08;

  const x = (v) => PAD.left + ((v - lo) / (hi - lo)) * plotW;
  const LOG_FLOOR = 0.7; // count 1 still gets a visible bar on the log scale
  const y = logY
    ? (c) => PAD.top + plotH - (c <= LOG_FLOOR ? 0 : (Math.log10(c / LOG_FLOOR) / Math.log10(yMax / LOG_FLOOR)) * plotH)
    : (c) => PAD.top + plotH - (c / yMax) * plotH;

  const yTicks = logY
    ? [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].filter((t) => t <= yMax)
    : (() => { const s = niceStep(yMax, 5); return Array.from({ length: Math.floor(yMax / s) + 1 }, (_, i) => i * s); })();
  const xStep = niceStep(hi - lo, Math.max(3, Math.floor(plotW / 90)));
  const xTicks = [];
  for (let t = Math.ceil(lo / xStep) * xStep; t <= hi + 1e-12; t += xStep) xTicks.push(Number(t.toPrecision(12)));

  const curve = [];
  for (let i = 0; i <= 160; i++) {
    const xv = lo + ((hi - lo) * i) / 160;
    const c = fit(xv);
    if (logY && c < LOG_FLOOR) continue;
    curve.push(`${curve.length ? "L" : "M"}${x(xv).toFixed(1)},${y(c).toFixed(1)}`);
  }

  const isSel = (b) => selected && Math.abs(b.lower - selected.lower) < w / 1000;
  const grid = "rgba(55,65,81,0.35)";
  const tick = { fontSize: 10, fill: "var(--text-secondary)", fontFamily: "var(--font-family-mono)" };
  const markerIn = marker?.value != null && marker.value >= lo && marker.value <= hi;

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={grid} />
          <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" style={tick}>{t}</text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={`x${t}`} x={x(t)} y={height - 8} textAnchor="middle" style={tick}>{format(t)}</text>
      ))}
      <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke="var(--border)" />

      {bins.map((b, i) => {
        if (!b.count) return null;
        const top = y(b.count);
        const dim = selected && !isSel(b);
        return (
          <rect
            key={i}
            x={x(b.lower) + 0.5}
            y={top}
            width={Math.max(x(b.upper) - x(b.lower) - 1, 0.5)}
            height={PAD.top + plotH - top}
            fill={(b.lower + b.upper) / 2 < pivot ? colors.below : colors.above}
            fillOpacity={dim ? 0.25 : isSel(b) ? 1 : 0.75}
            style={{ cursor: onSelect ? "pointer" : "default" }}
            onClick={onSelect ? () => onSelect(isSel(b) ? null : b) : undefined}
          >
            <title>{`${format(b.lower)} to ${format(b.upper)}: ${b.count} (${((b.count / stats.n) * 100).toFixed(1)}%)`}</title>
          </rect>
        );
      })}

      <path d={curve.join("")} fill="none" stroke="var(--caution)" strokeWidth={1.5} style={{ pointerEvents: "none" }} />
      <line x1={x(stats.mean)} x2={x(stats.mean)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--text-secondary)" strokeDasharray="2,3" style={{ pointerEvents: "none" }} />

      {markerIn && (
        <g style={{ pointerEvents: "none" }}>
          <line x1={x(marker.value)} x2={x(marker.value)} y1={PAD.top - 6} y2={PAD.top + plotH} stroke="var(--text-primary)" strokeDasharray="3,3" />
          <circle cx={x(marker.value)} cy={PAD.top + plotH} r={4} fill="var(--text-primary)" stroke="var(--bg-surface)" />
          <text
            x={x(marker.value) + (x(marker.value) > width * 0.7 ? -6 : 6)}
            y={PAD.top - 10}
            textAnchor={x(marker.value) > width * 0.7 ? "end" : "start"}
            style={{ fontSize: 12, fill: "var(--text-primary)", fontFamily: "var(--font-family-mono)" }}
          >
            {marker.label}
          </text>
        </g>
      )}
    </svg>
  );
}
