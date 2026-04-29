"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineSeries,
  HistogramSeries,
  PriceScaleMode,
} from "lightweight-charts";

const API = "http://localhost:8000";

const DEFAULT_WEIGHTS = { bmsb: 0.30, breadth: 0.28, vix: 0.17, credit: 0.25 };

const REGIME_COLORS = {
  up:      "rgba(22, 163, 74,  0.45)",
  down:    "rgba(220, 38,  38,  0.50)",
  ranging: "rgba(217, 119,  6,  0.38)",
};

const REGIME_CONFIG = {
  up:      { label: "Uptrend",   color: "#22c55e" },
  down:    { label: "Downtrend", color: "#ef4444" },
  ranging: { label: "Ranging",   color: "#f59e0b" },
};

const COMPONENT_META = [
  { key: "bmsb",    label: "BMSB",           color: "#10b981" },
  { key: "breadth", label: "Market Breadth",  color: "#60a5fa" },
  { key: "vix",     label: "VIX",             color: "#f59e0b" },
  { key: "credit",  label: "Credit",          color: "#a78bfa" },
];

const SCORE_LABELS = [
  { key: "bmsb",    label: "BMSB"           },
  { key: "breadth", label: "Market Breadth" },
  { key: "vix",     label: "VIX"            },
  { key: "credit",  label: "Credit"         },
];

const PERIODS = [
  { label: "1Y",  years: 1  },
  { label: "3Y",  years: 3  },
  { label: "5Y",  years: 5  },
  { label: "10Y", years: 10 },
  { label: "20Y", years: 20 },
  { label: "All", years: null },
];

const THRESHOLD = 0.2;
const EWM_SPAN  = 10;

// ─── Custom Primitive — regime background fills ───────────────────────────────

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
        context.fillStyle = REGIME_COLORS[block.regime] ?? "transparent";
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
  constructor(blocks) { this._blocks = blocks; this._chart = null; this._views = []; }
  attached({ chart }) { this._chart = chart; this._views = [new RegimePaneView(this)]; }
  detached()          { this._chart = null; this._views = []; }
  updateAllViews()    {}
  paneViews()         { return this._views; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function lastNonNull(arr) {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return null;
}

function scoreToRegime(score) {
  if (score == null) return null;
  if (score >  THRESHOLD) return "up";
  if (score < -THRESHOLD) return "down";
  return "ranging";
}

function getCurrentRegimeInfo(regimes, dates, prices) {
  if (!regimes?.length) return null;
  let i = regimes.length - 1;
  while (i >= 0 && regimes[i] === null) i--;
  if (i < 0) return null;
  const regime = regimes[i];
  let start = i;
  while (start > 0 && regimes[start - 1] === regime) start--;
  return { regime, weeks: i - start + 1, date: dates[i], price: prices[i] };
}

function getYtdReturn(dates, prices) {
  if (!dates?.length) return null;
  const ytdStart = `${new Date().getFullYear()}-01-01`;
  const idx = dates.findIndex((d) => d >= ytdStart);
  if (idx < 0) return null;
  const base = idx > 0 ? prices[idx - 1] : prices[idx];
  return (prices[prices.length - 1] / base - 1) * 100;
}

function recomputeComposite(data, weights) {
  const { dates, scores } = data;
  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
  const normW = weightSum > 0
    ? Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / weightSum]))
    : weights;

  const compositeRaw = dates.map((_, i) => {
    let tw = 0, ts = 0;
    for (const [k, w] of Object.entries(normW)) {
      const v = scores[k]?.[i];
      if (v != null && !isNaN(v)) { ts += w * v; tw += w; }
    }
    return tw > 0 ? ts / tw : null;
  });

  const alpha = 2 / (EWM_SPAN + 1);
  const composite = [];
  let prev = null;
  for (const v of compositeRaw) {
    if (v == null) {
      composite.push(prev);
    } else if (prev === null) {
      composite.push(v);
      prev = v;
    } else {
      const next = alpha * v + (1 - alpha) * prev;
      composite.push(next);
      prev = next;
    }
  }

  const regimes = composite.map((v) =>
    v == null ? null : v > THRESHOLD ? "up" : v < -THRESHOLD ? "down" : "ranging"
  );

  return { ...data, composite, regimes };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MarketRegimePage() {
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [period,   setPeriod]   = useState("1Y");
  const [logScale, setLogScale] = useState(false);
  const [tooltip,  setTooltip]  = useState(null);

  const [weights,        setWeights]        = useState(DEFAULT_WEIGHTS);
  const [pendingWeights, setPendingWeights] = useState(DEFAULT_WEIGHTS);
  const [weightsOpen,    setWeightsOpen]    = useState(false);

  const mainRef   = useRef(null);
  const subRef    = useRef(null);
  const compRef   = useRef(null);
  const mainChart = useRef(null);
  const subChart  = useRef(null);
  const compChart = useRef(null);
  const syncing   = useRef(false);

  const isDefaultWeights = Object.entries(weights).every(
    ([k, v]) => Math.abs(v - DEFAULT_WEIGHTS[k]) < 0.001
  );

  useEffect(() => {
    fetch(`${API}/api/market/regime`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const computedData = useMemo(() => {
    if (!data) return null;
    return recomputeComposite(data, weights);
  }, [data, weights]);

  // Build all three charts when computedData changes; save+restore visible range
  useEffect(() => {
    if (!computedData || !mainRef.current || !subRef.current || !compRef.current) return;

    const savedRange = mainChart.current?.timeScale().getVisibleRange() ?? null;

    mainChart.current?.remove();
    subChart.current?.remove();
    compChart.current?.remove();

    const { dates, prices, ema21, sma20, regimes, composite, scores } = computedData;
    const blocks = buildRegimeBlocks(dates, regimes);

    // Component labels with current weight %
    const compLabels = Object.fromEntries(
      COMPONENT_META.map(({ key, label, color }) => [
        key,
        {
          color,
          label: `${label} (${Math.round(weights[key] * 100)}%)`,
        },
      ])
    );

    // ── Main chart ────────────────────────────────────────────────────────────
    const mc = createChart(mainRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#080e1a" }, textColor: "#6b7280" },
      grid: { vertLines: { color: "rgba(31,41,55,0.5)" }, horzLines: { color: "rgba(31,41,55,0.5)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1f2937" },
      timeScale: { borderColor: "#1f2937", timeVisible: false },
      width: mainRef.current.clientWidth,
      height: 460,
    });
    mainChart.current = mc;

    const emaSeries = mc.addSeries(LineSeries, {
      color: "#a78bfa", lineWidth: 1.5, lineStyle: 1,
      priceLineVisible: false, lastValueVisible: false, title: "EMA-21W",
    });
    emaSeries.setData(dates.map((d, i) => ({ time: d, value: ema21[i] })).filter((p) => p.value != null));

    const smaSeries = mc.addSeries(LineSeries, {
      color: "#fb923c", lineWidth: 1.5, lineStyle: 1,
      priceLineVisible: false, lastValueVisible: false, title: "SMA-20W",
    });
    smaSeries.setData(dates.map((d, i) => ({ time: d, value: sma20[i] })).filter((p) => p.value != null));

    const priceSeries = mc.addSeries(LineSeries, {
      color: "#e5e7eb", lineWidth: 2,
      priceLineVisible: false, lastValueVisible: true, title: "SPY",
    });
    priceSeries.setData(dates.map((d, i) => ({ time: d, value: prices[i] })).filter((p) => p.value != null));
    priceSeries.attachPrimitive(new RegimePrimitive(blocks));

    mc.timeScale().fitContent();

    mc.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) { setTooltip(null); return; }
      setTooltip({
        x: param.point.x, y: param.point.y, date: param.time,
        spy: param.seriesData.get(priceSeries)?.value,
        ema: param.seriesData.get(emaSeries)?.value,
        sma: param.seriesData.get(smaSeries)?.value,
      });
    });

    // ── Sub chart (composite score) ───────────────────────────────────────────
    const sc = createChart(subRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#080e1a" }, textColor: "#6b7280" },
      grid: { vertLines: { color: "rgba(31,41,55,0.5)" }, horzLines: { visible: false } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1f2937", scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: "#1f2937", timeVisible: true },
      width: subRef.current.clientWidth,
      height: 130,
    });
    subChart.current = sc;

    const histSeries = sc.addSeries(HistogramSeries, {
      priceLineVisible: false, lastValueVisible: false,
      base: 0,
    });
    histSeries.setData(
      dates
        .map((d, i) => ({
          time: d,
          value: composite[i],
          color: composite[i] == null ? "transparent"
               : composite[i] > 0 ? "rgba(22,163,74,0.75)" : "rgba(220,38,38,0.75)",
        }))
        .filter((p) => p.value != null)
    );

    const threshUp = sc.addSeries(LineSeries, {
      color: "rgba(34,197,94,0.45)", lineWidth: 1, lineStyle: 2,
      priceLineVisible: false, lastValueVisible: false,
    });
    const threshDn = sc.addSeries(LineSeries, {
      color: "rgba(239,68,68,0.45)", lineWidth: 1, lineStyle: 2,
      priceLineVisible: false, lastValueVisible: false,
    });
    const validDates = dates.filter((_, i) => composite[i] != null);
    if (validDates.length >= 2) {
      const first = validDates[0], last = validDates[validDates.length - 1];
      threshUp.setData([{ time: first, value:  0.2 }, { time: last, value:  0.2 }]);
      threshDn.setData([{ time: first, value: -0.2 }, { time: last, value: -0.2 }]);
    }

    sc.timeScale().fitContent();

    // ── Component signals chart ───────────────────────────────────────────────
    const cc = createChart(compRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#080e1a" }, textColor: "#6b7280" },
      grid: { vertLines: { color: "rgba(31,41,55,0.5)" }, horzLines: { visible: false } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1f2937", scaleMargins: { top: 0.05, bottom: 0.05 } },
      timeScale: { borderColor: "#1f2937", timeVisible: true },
      width: compRef.current.clientWidth,
      height: 220,
    });
    compChart.current = cc;

    for (const [key, { color, label }] of Object.entries(compLabels)) {
      const s = cc.addSeries(LineSeries, {
        color, lineWidth: 1.5,
        priceLineVisible: false, lastValueVisible: true, title: label,
      });
      s.setData(
        dates.map((d, i) => ({ time: d, value: scores?.[key]?.[i] }))
             .filter((p) => p.value != null)
      );
    }

    const zeroLine = cc.addSeries(LineSeries, {
      color: "rgba(100,116,139,0.35)", lineWidth: 1, lineStyle: 2,
      priceLineVisible: false, lastValueVisible: false,
    });
    const validDatesComp = dates.filter((_, i) => composite[i] != null);
    if (validDatesComp.length >= 2) {
      zeroLine.setData([
        { time: validDatesComp[0], value: 0 },
        { time: validDatesComp[validDatesComp.length - 1], value: 0 },
      ]);
    }
    cc.timeScale().fitContent();

    // Restore saved range or apply initial period
    if (savedRange) {
      mc.timeScale().setVisibleRange(savedRange);
      sc.timeScale().setVisibleRange(savedRange);
      cc.timeScale().setVisibleRange(savedRange);
    } else {
      const initialPeriod = PERIODS.find((p) => p.label === period);
      if (initialPeriod?.years) {
        const to = new Date(), from = new Date();
        from.setFullYear(from.getFullYear() - initialPeriod.years);
        const range = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
        mc.timeScale().setVisibleRange(range);
        sc.timeScale().setVisibleRange(range);
        cc.timeScale().setVisibleRange(range);
      }
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
      ro.disconnect();
      mc.remove(); mainChart.current = null;
      sc.remove(); subChart.current  = null;
      cc.remove(); compChart.current = null;
    };
  }, [computedData]);

  // Period → visible range
  useEffect(() => {
    if (!mainChart.current) return;
    const sel = PERIODS.find((p) => p.label === period);
    if (!sel?.years) {
      mainChart.current.timeScale().fitContent();
    } else {
      const to = new Date(), from = new Date();
      from.setFullYear(from.getFullYear() - sel.years);
      mainChart.current.timeScale().setVisibleRange({
        from: from.toISOString().slice(0, 10),
        to:   to.toISOString().slice(0, 10),
      });
    }
  }, [period]);

  // Log scale
  useEffect(() => {
    if (!mainChart.current) return;
    mainChart.current.priceScale("right").applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  }, [logScale]);

  function handleOpenWeights() {
    setPendingWeights(weights);
    setWeightsOpen(true);
  }

  function handleApply() {
    setWeights(pendingWeights);
  }

  function handleReset() {
    setPendingWeights(DEFAULT_WEIGHTS);
    setWeights(DEFAULT_WEIGHTS);
  }

  if (loading) return <div style={{ padding: "40px 32px", color: "#4b5563", fontSize: 14 }}>Loading regime data…</div>;
  if (error)   return <div style={{ padding: "40px 32px", color: "#fca5a5", fontSize: 13 }}>Error: {error}</div>;

  const { dates, prices, regimes, composite, scores } = computedData;
  const currentInfo = getCurrentRegimeInfo(regimes, dates, prices);
  const ytdReturn   = getYtdReturn(dates, prices);
  const cfg         = currentInfo ? REGIME_CONFIG[currentInfo.regime] : null;

  const componentKpis = SCORE_LABELS.map(({ key, label }) => {
    const score   = lastNonNull(scores?.[key]);
    const regime  = scoreToRegime(score);
    const regCfg  = regime ? REGIME_CONFIG[regime] : null;
    return { key, label, score, regime, color: regCfg?.color ?? "#6b7280", regLabel: regCfg?.label ?? "—" };
  });

  const pendingSum = Object.values(pendingWeights).reduce((a, b) => a + b, 0);

  return (
    <div style={{ padding: "28px 32px", minHeight: "100vh", background: "#020617", color: "#e5e7eb" }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f9fafb", margin: 0 }}>Market Regime</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
          Composite of <strong style={{ color: "#9ca3af" }}>BMSB · Market Breadth · VIX · Credit Spreads</strong> — daily closes.
        </p>
      </div>

      {/* KPI strip */}
      <div style={{ display: "flex", gap: 14, marginBottom: 28, flexWrap: "wrap", alignItems: "stretch" }}>
        {cfg && (
          <div style={{ background: "#080e1a", border: `1px solid ${cfg.color}40`, borderRadius: 10, padding: "16px 24px", minWidth: 200 }}>
            <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Composite Regime</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: REGIME_COLORS[currentInfo.regime], border: `1px solid ${cfg.color}60`, borderRadius: 20, padding: "4px 14px" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: cfg.color }} />
              <span style={{ fontSize: 15, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
              {currentInfo.weeks} weeks · score {lastNonNull(composite)?.toFixed(2)}
              {!isDefaultWeights && <span style={{ color: "#f59e0b", marginLeft: 6 }}>custom</span>}
            </div>
          </div>
        )}

        {componentKpis.map(({ key, label, score, color, regLabel }) => (
          <div key={key} style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 10, padding: "16px 20px", minWidth: 130 }}>
            <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{label}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: 600, color }}>{regLabel}</span>
            </div>
            <div style={{ fontSize: 11, color: "#4b5563", marginTop: 5 }}>score {score != null ? score.toFixed(2) : "—"}</div>
          </div>
        ))}

        <KpiCard label="SPY Price" value={currentInfo ? `$${currentInfo.price.toFixed(2)}` : "—"} />
        <KpiCard
          label="SPY YTD"
          value={ytdReturn != null ? `${ytdReturn >= 0 ? "+" : ""}${ytdReturn.toFixed(2)}%` : "—"}
          color={ytdReturn == null ? undefined : ytdReturn >= 0 ? "#86efac" : "#fca5a5"}
        />
      </div>

      {/* Controls row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {Object.entries(REGIME_CONFIG).map(([key, c]) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
              <div style={{ width: 14, height: 14, borderRadius: 3, background: REGIME_COLORS[key], border: `1px solid ${c.color}80` }} />
              <span style={{ color: c.color }}>{c.label}</span>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#6b7280" }}>
            <div style={{ width: 18, height: 0, borderTop: "2px dashed #a78bfa" }} /><span>EMA-21W</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#6b7280" }}>
            <div style={{ width: 18, height: 0, borderTop: "2px dashed #fb923c" }} /><span>SMA-20W</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {PERIODS.map((p) => (
            <button key={p.label} onClick={() => setPeriod(p.label)} style={{
              background: period === p.label ? "#1e3a5f" : "transparent",
              border: `1px solid ${period === p.label ? "#2d5a8e" : "#1f2937"}`,
              borderRadius: 5, padding: "4px 10px", fontSize: 12,
              color: period === p.label ? "#93c5fd" : "#4b5563",
              cursor: "pointer", fontWeight: period === p.label ? 600 : 400,
            }}>{p.label}</button>
          ))}
          <div style={{ width: 1, height: 20, background: "#1f2937", margin: "0 4px" }} />
          <button onClick={() => setLogScale((v) => !v)} style={{
            background: logScale ? "#1e3a5f" : "transparent",
            border: `1px solid ${logScale ? "#2d5a8e" : "#1f2937"}`,
            borderRadius: 5, padding: "4px 10px", fontSize: 12,
            color: logScale ? "#93c5fd" : "#4b5563",
            cursor: "pointer", fontWeight: logScale ? 600 : 400,
          }}>Log</button>
          <div style={{ width: 1, height: 20, background: "#1f2937", margin: "0 4px" }} />
          <button
            onClick={weightsOpen ? () => setWeightsOpen(false) : handleOpenWeights}
            style={{
              background: !isDefaultWeights || weightsOpen ? "#1e3a5f" : "transparent",
              border: `1px solid ${!isDefaultWeights || weightsOpen ? "#2d5a8e" : "#1f2937"}`,
              borderRadius: 5, padding: "4px 10px", fontSize: 12,
              color: !isDefaultWeights || weightsOpen ? "#93c5fd" : "#4b5563",
              cursor: "pointer",
            }}
          >
            ⚙ Weights{!isDefaultWeights ? " •" : ""}
          </button>
        </div>
      </div>

      {/* Weights settings panel */}
      {weightsOpen && (
        <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 8, padding: "16px 20px", marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>
            Component Weights
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 12 }}>
            {COMPONENT_META.map(({ key, label, color }) => (
              <div key={key} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <label style={{ fontSize: 12, color, fontWeight: 500 }}>{label}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={pendingWeights[key]}
                  onChange={(e) => setPendingWeights((prev) => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                  style={{ width: 72, padding: "4px 8px", background: "#0f1d2e", border: "1px solid #1e2d3d", borderRadius: 4, color: "#e2e8f0", fontSize: 13, fontVariantNumeric: "tabular-nums" }}
                />
              </div>
            ))}
          </div>
          {Math.abs(pendingSum - 1) > 0.001 && (
            <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 10 }}>
              Sum: {pendingSum.toFixed(2)} — weights will be normalized to 1 on apply
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={handleApply}
              style={{ padding: "5px 16px", background: "#1e3a5f", border: "1px solid #2d5a8e", borderRadius: 5, color: "#93c5fd", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              Apply
            </button>
            <button
              onClick={handleReset}
              style={{ padding: "5px 16px", background: "transparent", border: "1px solid #1f2937", borderRadius: 5, color: "#6b7280", fontSize: 12, cursor: "pointer" }}
            >
              Reset to defaults
            </button>
            {!isDefaultWeights && (
              <span style={{ fontSize: 11, color: "#f59e0b", marginLeft: 4 }}>
                Custom weights active — composite is computed client-side
              </span>
            )}
          </div>
        </div>
      )}

      {/* Main price chart */}
      <div style={{ position: "relative", background: "#080e1a", border: "1px solid #1f2937", borderRadius: "10px 10px 0 0", overflow: "hidden" }}>
        <div ref={mainRef} />
        {tooltip && (
          <div style={{
            position: "absolute",
            left: Math.min(tooltip.x + 16, (mainRef.current?.clientWidth ?? 600) - 170),
            top: Math.max(tooltip.y - 10, 8),
            background: "#0d1829", border: "1px solid #1f2937", borderRadius: 6,
            padding: "8px 12px", fontSize: 12, pointerEvents: "none", zIndex: 10, minWidth: 150,
          }}>
            <div style={{ color: "#6b7280", marginBottom: 4 }}>{tooltip.date}</div>
            {tooltip.spy != null && <div style={{ color: "#e5e7eb" }}>SPY <strong>${tooltip.spy.toFixed(2)}</strong></div>}
            {tooltip.ema != null && <div style={{ color: "#a78bfa" }}>EMA-21W <strong>${tooltip.ema.toFixed(2)}</strong></div>}
            {tooltip.sma != null && <div style={{ color: "#fb923c" }}>SMA-20W <strong>${tooltip.sma.toFixed(2)}</strong></div>}
          </div>
        )}
      </div>

      {/* Composite score sub-pane */}
      <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderTop: "1px solid #0d1829", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
        <div style={{ padding: "4px 8px 0", fontSize: 10, color: "#374151", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Composite Score
        </div>
        <div ref={subRef} />
      </div>

      {/* Component signals chart */}
      <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 10, padding: "16px 20px", marginTop: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
          Component Signals
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
          {COMPONENT_META.map(({ key, color, label }) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#9ca3af" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <span style={{ color }}>
                {label} ({Math.round(weights[key] * 100)}%)
              </span>
            </div>
          ))}
        </div>
        <div ref={compRef} />
      </div>

      {/* Algorithm note */}
      <div style={{ marginTop: 16, fontSize: 12, color: "#374151", lineHeight: 1.7 }}>
        <strong style={{ color: "#4b5563" }}>Weights:</strong>{" "}
        {COMPONENT_META.map(({ key, label }, i) => (
          <span key={key}>
            {label} {Math.round(weights[key] * 100)}%{i < COMPONENT_META.length - 1 ? " · " : ""}
          </span>
        ))}.{" "}
        Regime thresholds: composite &gt; +0.2 → <span style={{ color: "#22c55e" }}>Uptrend</span>,{" "}
        &lt; −0.2 → <span style={{ color: "#ef4444" }}>Downtrend</span>, else <span style={{ color: "#f59e0b" }}>Ranging</span>.{" "}
        Components missing before their data inception (RSP 2003, HYG/LQD 2007) are excluded and weights renormalized.
      </div>
    </div>
  );
}

function KpiCard({ label, value, color = "#e5e7eb" }) {
  return (
    <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 10, padding: "16px 20px", minWidth: 120 }}>
      <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
