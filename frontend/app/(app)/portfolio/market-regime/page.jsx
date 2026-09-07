"use client";

import { useState, useEffect, useMemo } from "react";
import PageHeader from "@/app/components/PageHeader";
import Button from "@/app/components/Button";
import KpiCard from "@/app/components/KpiCard";
import RegimeChart, { REGIME_CONFIG, REGIME_COLORS } from "@/app/components/RegimeChart";
import { scoreToRegime, lastNonNull, getCurrentRegimeInfo } from "@/app/lib/regime";

const API = "http://localhost:8000";

const DEFAULT_WEIGHTS = { bmsb: 0.30, breadth: 0.28, vix: 0.17, credit: 0.25 };

// Colors follow the app's standard chart-series order (--chart-1..4 in globals.css)
const COMPONENT_META = [
  { key: "bmsb",    label: "BMSB",           color: "#3b82f6" },
  { key: "breadth", label: "Market Breadth",  color: "#10b981" },
  { key: "vix",     label: "VIX",             color: "#f59e0b" },
  { key: "credit",  label: "Credit",          color: "#8b5cf6" },
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
const MARKET_THRESHOLDS = { up: THRESHOLD, down: -THRESHOLD };

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

  const [weights,        setWeights]        = useState(DEFAULT_WEIGHTS);
  const [pendingWeights, setPendingWeights] = useState(DEFAULT_WEIGHTS);
  const [weightsOpen,    setWeightsOpen]    = useState(false);

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

  // RegimeChart props — recomputed only when the underlying data/weights change,
  // so RegimeChart's internal rebuild effect fires exactly when it did before.
  const chartProps = useMemo(() => {
    if (!computedData) return null;
    const { dates, prices, ema21, sma20, regimes, composite, scores } = computedData;
    return {
      dates,
      price: { data: prices, label: "SPY", color: "#e5e7eb", formatValue: (v) => `$${v.toFixed(2)}` },
      overlays: [
        { key: "ema21", label: "EMA-21W", color: "#a78bfa", data: ema21 },
        { key: "sma20", label: "SMA-20W", color: "#fb923c", data: sma20 },
      ],
      regimes,
      composite: { data: composite, domain: [-1, 1], thresholds: MARKET_THRESHOLDS },
      components: COMPONENT_META.map(({ key, label, color }) => ({
        key, label, color, weight: weights[key], data: scores?.[key],
      })),
    };
  }, [computedData, weights]);

  // Period → visible range (drives RegimeChart's light-touch zoom effect)
  const visibleRange = useMemo(() => {
    const sel = PERIODS.find((p) => p.label === period);
    if (!sel?.years) return null;
    const to = new Date(), from = new Date();
    from.setFullYear(from.getFullYear() - sel.years);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }, [period]);

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

  if (loading) return <div style={{ padding: "40px 32px", color: "var(--text-secondary)", fontSize: 14 }}>Loading regime data…</div>;
  if (error)   return <div style={{ padding: "40px 32px", color: "var(--negative)", fontSize: 13 }}>Error: {error}</div>;

  const { dates, prices, regimes, composite, scores } = computedData;
  const currentInfo  = getCurrentRegimeInfo(regimes, dates);
  const currentPrice = currentInfo ? prices[currentInfo.index] : null;
  const ytdReturn     = getYtdReturn(dates, prices);
  const cfg           = currentInfo ? REGIME_CONFIG[currentInfo.regime] : null;

  const componentKpis = SCORE_LABELS.map(({ key, label }) => {
    const score   = lastNonNull(scores?.[key]);
    const regime  = scoreToRegime(score, MARKET_THRESHOLDS);
    const regCfg  = regime ? REGIME_CONFIG[regime] : null;
    return { key, label, score, regime, color: regCfg?.color ?? "#6b7280", regLabel: regCfg?.label ?? "—" };
  });

  const pendingSum = Object.values(pendingWeights).reduce((a, b) => a + b, 0);

  return (
    <div style={{ padding: "28px 32px", minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)" }}>

      {/* Header */}
      <PageHeader
        title="Market Regime"
        subtitle={<>Composite of <strong style={{ color: "#9ca3af" }}>BMSB · Market Breadth (RSP/SPY) · VIX (raw level, 52W range) · Credit Spread (HYG/LQD)</strong> — daily closes.</>}
      />

      {/* KPI strip */}
      <div style={{ display: "flex", gap: 14, marginBottom: 28, flexWrap: "wrap", alignItems: "stretch" }}>
        {cfg && (
          <KpiCard
            label="Composite Regime"
            formatted={cfg.label}
            valueColor={cfg.color}
            small
            caption={<>
              {currentInfo.periods} weeks · score {lastNonNull(composite)?.toFixed(2)}
              {!isDefaultWeights && <span style={{ color: "var(--caution)", marginLeft: 6 }}>custom</span>}
            </>}
          />
        )}

        {componentKpis.map(({ key, label, score, color, regLabel }) => (
          <KpiCard
            key={key}
            label={label}
            formatted={regLabel}
            valueColor={color}
            small
            caption={score != null ? `score ${score.toFixed(2)}` : undefined}
          />
        ))}

        <KpiCard label="SPY Price" formatted={currentPrice != null ? `$${currentPrice.toFixed(2)}` : "—"} small />
        <KpiCard
          label="SPY YTD"
          formatted={ytdReturn != null ? `${ytdReturn >= 0 ? "+" : ""}${ytdReturn.toFixed(2)}%` : "—"}
          valueColor={ytdReturn == null ? undefined : ytdReturn >= 0 ? "var(--positive)" : "var(--negative)"}
          small
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
            <Button
              key={p.label}
              variant="range-toggle"
              active={period === p.label}
              onClick={() => setPeriod(p.label)}
            >
              {p.label}
            </Button>
          ))}
          <div style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
          <Button
            variant="range-toggle"
            active={logScale}
            onClick={() => setLogScale((v) => !v)}
          >
            Log
          </Button>
          <div style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
          <button
            onClick={weightsOpen ? () => setWeightsOpen(false) : handleOpenWeights}
            style={{
              background: !isDefaultWeights || weightsOpen ? "#1e3a5f" : "transparent",
              border: `1px solid ${!isDefaultWeights || weightsOpen ? "#2d5a8e" : "var(--border)"}`,
              borderRadius: 5, padding: "4px 10px", fontSize: 12,
              color: !isDefaultWeights || weightsOpen ? "#93c5fd" : "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            ⚙ Weights{!isDefaultWeights ? " •" : ""}
          </button>
        </div>
      </div>

      {/* Weights settings panel */}
      {weightsOpen && (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)", padding: "16px 20px", marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>
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
                  style={{ width: 72, padding: "4px 8px", background: "transparent", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", fontSize: 13, fontVariantNumeric: "tabular-nums" }}
                />
              </div>
            ))}
          </div>
          {Math.abs(pendingSum - 1) > 0.001 && (
            <div style={{ fontSize: 11, color: "var(--caution)", marginBottom: 10 }}>
              Sum: {pendingSum.toFixed(2)} — weights will be normalized to 1 on apply
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button variant="primary" onClick={handleApply}>
              Apply
            </Button>
            <Button variant="secondary" onClick={handleReset}>
              Reset to defaults
            </Button>
            {!isDefaultWeights && (
              <span style={{ fontSize: 11, color: "var(--caution)", marginLeft: 4 }}>
                Custom weights active — composite is computed client-side
              </span>
            )}
          </div>
        </div>
      )}

      <RegimeChart
        dates={chartProps.dates}
        price={chartProps.price}
        overlays={chartProps.overlays}
        regimes={chartProps.regimes}
        composite={chartProps.composite}
        components={chartProps.components}
        visibleRange={visibleRange}
        logScale={logScale}
      />

      {/* Algorithm note */}
      <div style={{ marginTop: 16, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
        <strong style={{ color: "var(--text-secondary)" }}>Weights:</strong>{" "}
        {COMPONENT_META.map(({ key, label }, i) => (
          <span key={key}>
            {label} {Math.round(weights[key] * 100)}%{i < COMPONENT_META.length - 1 ? " · " : ""}
          </span>
        ))}.{" "}
        Regime thresholds: composite &gt; +0.2 → <span style={{ color: "var(--positive)" }}>Uptrend</span>,{" "}
        &lt; −0.2 → <span style={{ color: "var(--negative)" }}>Downtrend</span>, else <span style={{ color: "var(--caution)" }}>Ranging</span>.{" "}
        Components missing before their data inception (RSP 2003, HYG/LQD 2007) are excluded and weights renormalized.
      </div>
    </div>
  );
}
