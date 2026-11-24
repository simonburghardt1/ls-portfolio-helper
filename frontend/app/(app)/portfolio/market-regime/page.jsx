"use client";

import { useState, useEffect, useMemo } from "react";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import Button from "@/app/components/Button";
import KpiCard from "@/app/components/KpiCard";
import InfoTip from "@/app/components/InfoTip";
import StateMessage from "@/app/components/StateMessage";
import RegimeChart, { REGIME_CONFIG, REGIME_COLORS } from "@/app/components/RegimeChart";
import { scoreToRegime, lastNonNull, getCurrentRegimeInfo } from "@/app/lib/regime";
import Page from "@/app/components/Page";
import { authFetch } from "@/app/lib/api";

const API = "http://localhost:8000";

const DEFAULT_WEIGHTS = { bmsb: 0.30, breadth: 0.28, vix: 0.17, credit: 0.25 };

// Each index is scored on its own instruments (backend services/market_regime.py): breadth =
// equal-weight vs. cap-weight ETF, volatility = the index's own VIX. Credit is market-wide.
const INDEXES = {
  SPY: { vol: "VIX", breadth: "RSP/SPY", inception: "RSP before 2003, HYG/LQD before 2007" },
  QQQ: { vol: "VXN", breadth: "QQEW/QQQ", inception: "VXN before 2001, QQEW before 2006, HYG/LQD before 2007" },
};

// Colors follow the app's standard chart-series order (--chart-1..4 in globals.css)
const componentMeta = (index) => [
  { key: "bmsb",    label: "BMSB",              color: "var(--chart-1)" },
  { key: "breadth", label: "Market Breadth",    color: "var(--chart-2)" },
  { key: "vix",     label: INDEXES[index].vol,  color: "var(--chart-3)" },
  { key: "credit",  label: "Credit",            color: "var(--chart-4)" },
];

const EMA_COLOR = "var(--chart-10)";
const SMA_COLOR = "var(--chart-11)";

function methodInfo(index) {
  const { vol, breadth, inception } = INDEXES[index];
  return (
    `Composite of four signals on daily ${index} closes: BMSB (price vs. its bull market support band), Market Breadth (${breadth}), ` +
    `${vol} (raw level within its 52-week range) and Credit Spread (HYG/LQD), smoothed with a 10-period EMA. ` +
    "Composite above +0.2 = Uptrend, below −0.2 = Downtrend, else Ranging. " +
    `Components without data yet (${inception}) are left out and the weights renormalized.`
  );
}

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
  const [index,    setIndex]    = useState("SPY");
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
    authFetch(`${API}/api/market/regime?index=${index}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [index]);

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
      price: { data: prices, label: index, color: "var(--text-primary)", formatValue: (v) => `$${v.toFixed(2)}` },
      overlays: [
        { key: "ema21", label: "EMA-21W", color: EMA_COLOR, data: ema21 },
        { key: "sma20", label: "SMA-20W", color: SMA_COLOR, data: sma20 },
      ],
      regimes,
      composite: { data: composite, domain: [-1, 1], thresholds: MARKET_THRESHOLDS },
      components: componentMeta(index).map(({ key, label, color }) => ({
        key, label, color, weight: weights[key], data: scores?.[key],
      })),
    };
  }, [computedData, weights, index]);

  // Period → visible range (drives RegimeChart's light-touch zoom effect)
  const visibleRange = useMemo(() => {
    const sel = PERIODS.find((p) => p.label === period);
    if (!sel?.years) return null;
    const to = new Date(), from = new Date();
    from.setFullYear(from.getFullYear() - sel.years);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }, [period]);

  function changeIndex(k) {
    if (k === index) return;
    setIndex(k);
    setLoading(true);
    setError(null);
  }

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

  // The header (with the SPY/QQQ switch) stays put while another index loads
  const header = (
    <PageHeader
      title="Market Regime"
      badges={<InfoTip text={methodInfo(index)} />}
      subtitle={`Composite of BMSB, Market Breadth, ${INDEXES[index].vol} and Credit Spread.`}
      actions={
        <div style={{ display: "flex", gap: 4 }}>
          {Object.keys(INDEXES).map((k) => (
            <Button key={k} variant="range-toggle" active={index === k} onClick={() => changeIndex(k)}>{k}</Button>
          ))}
        </div>
      }
    />
  );

  if (loading) return <Page>{header}<StateMessage kind="loading" /></Page>;
  if (error)   return <Page>{header}<StateMessage kind="error">{error}</StateMessage></Page>;

  const { dates, prices, regimes, composite, scores } = computedData;
  const currentInfo  = getCurrentRegimeInfo(regimes, dates);
  const currentPrice = currentInfo ? prices[currentInfo.index] : null;
  const ytdReturn     = getYtdReturn(dates, prices);
  const cfg           = currentInfo ? REGIME_CONFIG[currentInfo.regime] : null;

  const componentKpis = componentMeta(index).map(({ key, label }) => {
    const score   = lastNonNull(scores?.[key]);
    const regime  = scoreToRegime(score, MARKET_THRESHOLDS);
    const regCfg  = regime ? REGIME_CONFIG[regime] : null;
    return { key, label, score, regime, color: regCfg?.color ?? "var(--text-secondary)", regLabel: regCfg?.label ?? "—" };
  });

  const pendingSum = Object.values(pendingWeights).reduce((a, b) => a + b, 0);

  return (
    <Page>

      {header}

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

        <KpiCard label={`${index} Price`} formatted={currentPrice != null ? `$${currentPrice.toFixed(2)}` : "—"} small />
        <KpiCard
          label={`${index} YTD`}
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
          {[["EMA-21W", EMA_COLOR], ["SMA-20W", SMA_COLOR]].map(([label, color]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-secondary)" }}>
              <div style={{ width: 18, height: 0, borderTop: `2px dashed ${color}` }} /><span>{label}</span>
            </div>
          ))}
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
          <Button
            variant="range-toggle"
            active={weightsOpen || !isDefaultWeights}
            onClick={weightsOpen ? () => setWeightsOpen(false) : handleOpenWeights}
          >
            Weights{!isDefaultWeights ? " •" : ""}
          </Button>
        </div>
      </div>

      {/* Weights settings panel */}
      {weightsOpen && (
        <Panel title="Component weights" style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 12 }}>
            {componentMeta(index).map(({ key, label, color }) => (
              <div key={key} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 2, background: color }} />{label}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={pendingWeights[key]}
                  onChange={(e) => setPendingWeights((prev) => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                  style={{ width: 72, padding: "4px 8px", background: "var(--bg-base)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-family-mono)", fontSize: 13 }}
                />
              </div>
            ))}
          </div>
          {Math.abs(pendingSum - 1) > 0.001 && (
            <div style={{ fontSize: 11, color: "var(--caution)", marginBottom: 10 }}>
              Sum {pendingSum.toFixed(2)}: weights are normalized to 1 on apply.
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button variant="primary" onClick={handleApply}>
              Apply
            </Button>
            <Button variant="secondary" onClick={handleReset}>
              Reset to defaults
            </Button>
          </div>
        </Panel>
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

    </Page>
  );
}
