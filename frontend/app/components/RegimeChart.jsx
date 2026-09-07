"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineSeries,
  HistogramSeries,
  PriceScaleMode,
} from "lightweight-charts";

// Canvas (lightweight-charts) colors can't consume CSS vars, so these are literal
// rgb/hex bases matching --positive/--negative/--caution in globals.css. Shared
// across every page that renders a discrete regime label + background shading —
// import these instead of inventing a second copy.
export const REGIME_COLORS = {
  up:      "rgba(52, 211, 153, 0.45)",
  down:    "rgba(242, 88,  92,  0.50)",
  ranging: "rgba(245, 158,  11, 0.38)",
};

export const REGIME_CONFIG = {
  up:      { label: "Uptrend",   color: "#34d399" },
  down:    { label: "Downtrend", color: "#f2585c" },
  ranging: { label: "Ranging",   color: "#f59e0b" },
};

// ─── Custom Primitive — regime background fills (moved verbatim from the
// original market-regime/page.jsx implementation) ──────────────────────────────

class RegimeRenderer {
  constructor(source) { this._source = source; }
  draw(target) {
    target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio }) => {
      const chart = this._source._chart;
      if (!chart) return;
      const ts = chart.timeScale();
      for (const block of this._source._blocks) {
        let x1 = ts.timeToCoordinate(block.x1);
        let x2 = ts.timeToCoordinate(block.x2);
        if (x1 === null && x2 === null) continue;
        if (x1 === null) x1 = 0;
        if (x2 === null) x2 = bitmapSize.width / horizontalPixelRatio;
        const left  = Math.round(Math.min(x1, x2) * horizontalPixelRatio);
        const right = Math.round(Math.max(x1, x2) * horizontalPixelRatio);
        context.fillStyle = this._source._colors[block.regime] ?? "transparent";
        context.fillRect(left, 0, right - left, bitmapSize.height);
      }
    });
  }
}
class RegimePaneView {
  constructor(source) { this._renderer = new RegimeRenderer(source); }
  renderer() { return this._renderer; }
  zOrder()   { return "bottom"; }
}
class RegimePrimitive {
  constructor(blocks, colors) { this._blocks = blocks; this._colors = colors; this._chart = null; this._views = []; }
  attached({ chart }) { this._chart = chart; this._views = [new RegimePaneView(this)]; }
  detached()          { this._chart = null; this._views = []; }
  updateAllViews()    {}
  paneViews()         { return this._views; }
}

function buildRegimeBlocks(dates, regimes) {
  const blocks = [];
  let start = null, current = null;
  for (let i = 0; i < regimes.length; i++) {
    if (regimes[i] !== current) {
      if (current !== null) blocks.push({ regime: current, x1: start, x2: dates[i] });
      current = regimes[i]; start = dates[i];
    }
  }
  if (current !== null) {
    const d = new Date(dates[dates.length - 1]);
    d.setDate(d.getDate() + 7);
    blocks.push({ regime: current, x1: start, x2: d.toISOString().slice(0, 10) });
  }
  return blocks.filter((b) => b.regime !== null);
}

/**
 * Shared 3-pane regime chart: main price chart (with optional dashed overlay
 * lines and colored regime-state background shading), a composite-score
 * histogram pane with threshold lines, and a component-signals line-chart pane
 * with a legend. All three panes are time-synced.
 *
 * IMPORTANT — memoize what you pass in: `price`/`overlays`/`components`/`composite`
 * are effect dependencies that fully destroy and rebuild all 3 charts. Passing
 * new array/object references on every render (e.g. inline literals) will
 * rebuild the charts every render — derive them with useMemo in the caller,
 * keyed on the actual underlying data.
 *
 * Props:
 *   dates:        string[] ("YYYY-MM-DD"), shared x-axis for every series
 *   price:        { data: (number|null)[], label, color?, formatValue?: (v) => string }
 *   overlays:     [{ key, label, color, lineStyle?, data: (number|null)[] }]  (dashed lines on the main chart)
 *   regimes:      ("up"|"down"|"ranging"|null)[]  — drives the background shading
 *   regimeConfig: optional override of REGIME_CONFIG
 *   regimeColors: optional override of REGIME_COLORS
 *   composite:    { data: (number|null)[], domain: [min,max], thresholds: {up,down}, zero? }
 *                 zero defaults to the midpoint of domain — histogram base + sign-coloring pivot
 *   components:   [{ key, label, color, weight?: number (0-1, shown as "(NN%)"), data: (number|null)[] }]
 *   visibleRange: {from,to} | null — controlled zoom; null means "fit content"
 *   logScale:     bool — main chart price-scale mode
 *   sectionTitles:{ composite?: string, components?: string }
 *   heights:      { main?: number, composite?: number, components?: number }
 */
export default function RegimeChart({
  dates,
  price,
  overlays = [],
  regimes,
  regimeConfig = REGIME_CONFIG,
  regimeColors = REGIME_COLORS,
  composite,
  components = [],
  visibleRange = null,
  logScale = false,
  sectionTitles = {},
  heights = {},
}) {
  const mainRef   = useRef(null);
  const subRef    = useRef(null);
  const compRef   = useRef(null);
  const mainChart = useRef(null);
  const subChart  = useRef(null);
  const compChart = useRef(null);
  const syncing   = useRef(false);
  // React always runs the *previous* effect's cleanup before the *next* effect body,
  // so by the time a rebuild's effect body runs, mainChart.current has already been
  // nulled out by the outgoing chart's own cleanup — reading getVisibleRange() from
  // the ref at that point always sees null. The manually-zoomed range has to be
  // captured *inside* the outgoing cleanup itself (while its `mc` closure variable
  // is still a live chart instance) and handed off through this ref instead.
  const lastVisibleRange = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  const mainHeight       = heights.main ?? 460;
  const compositeHeight  = heights.composite ?? 130;
  const componentsHeight = heights.components ?? 220;
  const compositeTitle   = sectionTitles.composite ?? "Composite Score";
  const componentsTitle  = sectionTitles.components ?? "Component Signals";
  const formatValue      = price.formatValue ?? ((v) => v.toFixed(2));

  // Build (or rebuild) all three charts when the underlying data changes;
  // save+restore the manually-zoomed visible range across the rebuild.
  useEffect(() => {
    if (!dates?.length || !mainRef.current || !subRef.current || !compRef.current) return;

    const savedRange = lastVisibleRange.current;

    mainChart.current?.remove();
    subChart.current?.remove();
    compChart.current?.remove();

    const zero = composite.zero ?? (composite.domain[0] + composite.domain[1]) / 2;
    const blocks = buildRegimeBlocks(dates, regimes ?? []);

    // ── Main chart ────────────────────────────────────────────────────────────
    const mc = createChart(mainRef.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#9ca3af" },
      grid: { vertLines: { color: "rgba(55,65,81,0.35)" }, horzLines: { color: "rgba(55,65,81,0.35)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: { borderColor: "#374151", timeVisible: false },
      width: mainRef.current.clientWidth,
      height: mainHeight,
    });
    mainChart.current = mc;

    const overlaySeries = overlays.map((ov) => {
      const s = mc.addSeries(LineSeries, {
        color: ov.color, lineWidth: 1.5, lineStyle: ov.lineStyle ?? 1,
        priceLineVisible: false, lastValueVisible: false, title: ov.label,
      });
      s.setData(dates.map((d, i) => ({ time: d, value: ov.data[i] })).filter((p) => p.value != null));
      return { ...ov, series: s };
    });

    const priceSeries = mc.addSeries(LineSeries, {
      color: price.color ?? "#e5e7eb", lineWidth: 2,
      priceLineVisible: false, lastValueVisible: true, title: price.label,
    });
    priceSeries.setData(dates.map((d, i) => ({ time: d, value: price.data[i] })).filter((p) => p.value != null));
    priceSeries.attachPrimitive(new RegimePrimitive(blocks, regimeColors));

    mc.timeScale().fitContent();

    mc.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) { setTooltip(null); return; }
      setTooltip({
        x: param.point.x, y: param.point.y, date: param.time,
        price: param.seriesData.get(priceSeries)?.value,
        overlays: overlaySeries.map((ov) => ({
          label: ov.label, color: ov.color, value: param.seriesData.get(ov.series)?.value,
        })),
      });
    });

    // ── Composite score sub-pane ──────────────────────────────────────────────
    const sc = createChart(subRef.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#9ca3af" },
      grid: { vertLines: { color: "rgba(55,65,81,0.35)" }, horzLines: { visible: false } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#374151", scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: "#374151", timeVisible: true },
      width: subRef.current.clientWidth,
      height: compositeHeight,
    });
    subChart.current = sc;

    const histSeries = sc.addSeries(HistogramSeries, {
      priceLineVisible: false, lastValueVisible: false,
      base: zero,
    });
    histSeries.setData(
      dates
        .map((d, i) => ({
          time: d,
          value: composite.data[i],
          color: composite.data[i] == null ? "transparent"
               : composite.data[i] > zero ? "rgba(52,211,153,0.75)" : "rgba(242,88,92,0.75)",
        }))
        .filter((p) => p.value != null)
    );

    const threshUp = sc.addSeries(LineSeries, {
      color: "rgba(52,211,153,0.45)", lineWidth: 1, lineStyle: 2,
      priceLineVisible: false, lastValueVisible: false,
    });
    const threshDn = sc.addSeries(LineSeries, {
      color: "rgba(242,88,92,0.45)", lineWidth: 1, lineStyle: 2,
      priceLineVisible: false, lastValueVisible: false,
    });
    const validDates = dates.filter((_, i) => composite.data[i] != null);
    if (validDates.length >= 2) {
      const first = validDates[0], last = validDates[validDates.length - 1];
      threshUp.setData([{ time: first, value: composite.thresholds.up }, { time: last, value: composite.thresholds.up }]);
      threshDn.setData([{ time: first, value: composite.thresholds.down }, { time: last, value: composite.thresholds.down }]);
    }

    sc.timeScale().fitContent();

    // ── Component signals chart ───────────────────────────────────────────────
    const cc = createChart(compRef.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#9ca3af" },
      grid: { vertLines: { color: "rgba(55,65,81,0.35)" }, horzLines: { visible: false } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#374151", scaleMargins: { top: 0.05, bottom: 0.05 } },
      timeScale: { borderColor: "#374151", timeVisible: true },
      width: compRef.current.clientWidth,
      height: componentsHeight,
    });
    compChart.current = cc;

    for (const comp of components) {
      const title = comp.weight != null ? `${comp.label} (${Math.round(comp.weight * 100)}%)` : comp.label;
      const s = cc.addSeries(LineSeries, {
        color: comp.color, lineWidth: 1.5,
        priceLineVisible: false, lastValueVisible: true, title,
      });
      s.setData(dates.map((d, i) => ({ time: d, value: comp.data[i] })).filter((p) => p.value != null));
    }

    const zeroLine = cc.addSeries(LineSeries, {
      color: "rgba(100,116,139,0.35)", lineWidth: 1, lineStyle: 2,
      priceLineVisible: false, lastValueVisible: false,
    });
    if (validDates.length >= 2) {
      zeroLine.setData([
        { time: validDates[0], value: 0 },
        { time: validDates[validDates.length - 1], value: 0 },
      ]);
    }
    cc.timeScale().fitContent();

    // Restore saved range, else apply the visibleRange prop.
    const initialRange = savedRange ?? visibleRange;
    if (initialRange) {
      mc.timeScale().setVisibleRange(initialRange);
      sc.timeScale().setVisibleRange(initialRange);
      cc.timeScale().setVisibleRange(initialRange);
    }

    // ── Sync time scales ──────────────────────────────────────────────────────
    mc.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (syncing.current || !range) return;
      syncing.current = true;
      sc.timeScale().setVisibleRange(range);
      cc.timeScale().setVisibleRange(range);
      syncing.current = false;
    });
    sc.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (syncing.current || !range) return;
      syncing.current = true;
      mc.timeScale().setVisibleRange(range);
      cc.timeScale().setVisibleRange(range);
      syncing.current = false;
    });
    cc.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (syncing.current || !range) return;
      syncing.current = true;
      mc.timeScale().setVisibleRange(range);
      sc.timeScale().setVisibleRange(range);
      syncing.current = false;
    });

    // ── Resize ────────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      mc.applyOptions({ width: mainRef.current?.clientWidth ?? 600 });
      sc.applyOptions({ width: subRef.current?.clientWidth ?? 600 });
      cc.applyOptions({ width: compRef.current?.clientWidth ?? 600 });
    });
    ro.observe(mainRef.current);

    return () => {
      lastVisibleRange.current = mc.timeScale().getVisibleRange();
      ro.disconnect();
      mc.remove(); mainChart.current = null;
      sc.remove(); subChart.current  = null;
      cc.remove(); compChart.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, price, overlays, regimes, composite, components]);

  // Light-touch: apply visibleRange without rebuilding (drives period buttons).
  useEffect(() => {
    if (!mainChart.current) return;
    if (visibleRange) {
      mainChart.current.timeScale().setVisibleRange(visibleRange);
      subChart.current?.timeScale().setVisibleRange(visibleRange);
      compChart.current?.timeScale().setVisibleRange(visibleRange);
    } else {
      mainChart.current.timeScale().fitContent();
      subChart.current?.timeScale().fitContent();
      compChart.current?.timeScale().fitContent();
    }
  }, [visibleRange]);

  // Light-touch: log scale.
  useEffect(() => {
    if (!mainChart.current) return;
    mainChart.current.priceScale("right").applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  }, [logScale]);

  return (
    <>
      {/* Main price chart */}
      <div style={{ position: "relative", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)", overflow: "hidden" }}>
        <div ref={mainRef} />
        {tooltip && (
          <div style={{
            position: "absolute",
            left: Math.min(tooltip.x + 16, (mainRef.current?.clientWidth ?? 600) - 170),
            top: Math.max(tooltip.y - 10, 8),
            background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
            padding: "8px 12px", fontSize: 12, pointerEvents: "none", zIndex: 10, minWidth: 150,
          }}>
            <div style={{ color: "var(--text-secondary)", marginBottom: 4 }}>{tooltip.date}</div>
            {tooltip.price != null && <div style={{ color: "var(--text-primary)" }}>{price.label} <strong>{formatValue(tooltip.price)}</strong></div>}
            {tooltip.overlays.map((ov) => ov.value != null && (
              <div key={ov.label} style={{ color: ov.color }}>{ov.label} <strong>{formatValue(ov.value)}</strong></div>
            ))}
          </div>
        )}
      </div>

      {/* Composite score sub-pane */}
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderTop: "1px solid var(--border)", borderRadius: "var(--radius-none)", overflow: "hidden" }}>
        <div style={{ padding: "4px 8px 0", fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {compositeTitle}
        </div>
        <div ref={subRef} />
      </div>

      {/* Component signals chart */}
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)", padding: "16px 20px", marginTop: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
          {componentsTitle}
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
          {components.map((comp) => (
            <div key={comp.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#9ca3af" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: comp.color, flexShrink: 0 }} />
              <span style={{ color: comp.color }}>
                {comp.label}{comp.weight != null ? ` (${Math.round(comp.weight * 100)}%)` : ""}
              </span>
            </div>
          ))}
        </div>
        <div ref={compRef} />
      </div>
    </>
  );
}
