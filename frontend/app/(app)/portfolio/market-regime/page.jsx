"use client";

import { useState, useEffect, useMemo } from "react";
import {
  ComposedChart,
  Line,
  ReferenceArea,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

const API = "http://localhost:8000";

const REGIME_CONFIG = {
  up:      { label: "Trending Up",   color: "#22c55e", bg: "rgba(5,46,22,0.35)" },
  down:    { label: "Trending Down", color: "#ef4444", bg: "rgba(46,5,22,0.35)" },
  ranging: { label: "Ranging",       color: "#f59e0b", bg: "rgba(28,24,8,0.45)" },
};

const PERIODS = [
  { label: "1Y",  years: 1  },
  { label: "3Y",  years: 3  },
  { label: "5Y",  years: 5  },
  { label: "10Y", years: 10 },
  { label: "20Y", years: 20 },
  { label: "All", years: null },
];

function buildRegimeBlocks(dates, regimes) {
  const blocks = [];
  let start = null;
  let current = null;
  for (let i = 0; i < regimes.length; i++) {
    if (regimes[i] !== current) {
      if (current !== null) {
        blocks.push({ regime: current, x1: start, x2: dates[i - 1] });
      }
      current = regimes[i];
      start = dates[i];
    }
  }
  if (current !== null) {
    blocks.push({ regime: current, x1: start, x2: dates[dates.length - 1] });
  }
  return blocks.filter((b) => b.regime !== null);
}

function getCurrentRegimeInfo(regimes, dates, prices) {
  if (!regimes || regimes.length === 0) return null;
  let lastIdx = regimes.length - 1;
  while (lastIdx >= 0 && regimes[lastIdx] === null) lastIdx--;
  if (lastIdx < 0) return null;
  const currentRegime = regimes[lastIdx];
  let streakStart = lastIdx;
  while (streakStart > 0 && regimes[streakStart - 1] === currentRegime) streakStart--;
  return {
    regime: currentRegime,
    days: lastIdx - streakStart + 1,
    date: dates[lastIdx],
    price: prices[lastIdx],
  };
}

function getYtdReturn(dates, prices) {
  if (!dates || dates.length === 0) return null;
  const ytdStart = `${new Date().getFullYear()}-01-01`;
  const startIdx = dates.findIndex((d) => d >= ytdStart);
  if (startIdx < 0) return null;
  const base = startIdx > 0 ? prices[startIdx - 1] : prices[startIdx];
  return (prices[prices.length - 1] / base - 1) * 100;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  const price  = payload.find((p) => p.dataKey === "price");
  const sma50  = payload.find((p) => p.dataKey === "sma50");
  const sma200 = payload.find((p) => p.dataKey === "sma200");
  return (
    <div style={{ background: "#0d1829", border: "1px solid #1f2937", borderRadius: 6, padding: "8px 12px", fontSize: 12 }}>
      <div style={{ color: "#6b7280", marginBottom: 4 }}>{label}</div>
      {price  && <div style={{ color: "#e5e7eb" }}>SPY  <strong>${price.value?.toFixed(2)}</strong></div>}
      {sma50  && sma50.value  != null && <div style={{ color: "#60a5fa" }}>SMA50  <strong>${sma50.value.toFixed(2)}</strong></div>}
      {sma200 && sma200.value != null && <div style={{ color: "#f97316" }}>SMA200 <strong>${sma200.value.toFixed(2)}</strong></div>}
    </div>
  );
};

export default function MarketRegimePage() {
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [period,    setPeriod]    = useState("All");
  const [logScale,  setLogScale]  = useState(false);

  useEffect(() => {
    fetch(`${API}/api/market/regime`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((json) => { setData(json); setLoading(false); })
      .catch((e)  => { setError(e.message); setLoading(false); });
  }, []);

  // Slice data to the selected period
  const { chartData, regimeBlocks, ticks } = useMemo(() => {
    if (!data) return { chartData: [], regimeBlocks: [], ticks: [] };

    const { dates, prices, sma50, sma200, regimes } = data;

    const selectedPeriod = PERIODS.find((p) => p.label === period);
    let startDate = null;
    if (selectedPeriod?.years) {
      const d = new Date();
      d.setFullYear(d.getFullYear() - selectedPeriod.years);
      startDate = d.toISOString().slice(0, 10);
    }

    const sliced = dates.reduce((acc, date, i) => {
      if (!startDate || date >= startDate) {
        acc.push({ date, price: prices[i], sma50: sma50[i], sma200: sma200[i], regime: regimes[i] });
      }
      return acc;
    }, []);

    const slicedDates   = sliced.map((d) => d.date);
    const slicedRegimes = sliced.map((d) => d.regime);
    const blocks = buildRegimeBlocks(slicedDates, slicedRegimes);

    // Year ticks — one per year, or monthly for 1Y
    const seenKeys = new Set();
    const tickList = sliced
      .filter((d) => {
        const key = selectedPeriod?.years === 1 ? d.date.slice(0, 7) : d.date.slice(0, 4);
        if (!seenKeys.has(key)) { seenKeys.add(key); return true; }
        return false;
      })
      .map((d) => d.date);

    return { chartData: sliced, regimeBlocks: blocks, ticks: tickList };
  }, [data, period]);

  const selectedPeriod = PERIODS.find((p) => p.label === period);

  if (loading) return <div style={{ padding: "40px 32px", color: "#4b5563", fontSize: 14 }}>Loading regime data…</div>;
  if (error)   return <div style={{ padding: "40px 32px", color: "#fca5a5", fontSize: 13 }}>Error: {error}</div>;

  const { dates, prices, regimes } = data;
  const currentInfo = getCurrentRegimeInfo(regimes, dates, prices);
  const ytdReturn   = getYtdReturn(dates, prices);
  const cfg         = currentInfo ? REGIME_CONFIG[currentInfo.regime] : null;

  const yTickFmt = (v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`;

  return (
    <div style={{ padding: "28px 32px", minHeight: "100vh", background: "#020617", color: "#e5e7eb" }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f9fafb", margin: 0 }}>Market Regime</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
          S&P 500 classified into Trending Up / Trending Down / Ranging using SMA-50 × SMA-200 crossover with slope filter.
        </p>
      </div>

      {/* KPI strip */}
      <div style={{ display: "flex", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
        {cfg && (
          <div style={{ background: "#080e1a", border: `1px solid ${cfg.color}40`, borderRadius: 10, padding: "16px 24px", minWidth: 200 }}>
            <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Current Regime</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: cfg.bg, border: `1px solid ${cfg.color}60`, borderRadius: 20, padding: "4px 14px" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: cfg.color }} />
              <span style={{ fontSize: 15, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>{currentInfo.days} days in regime</div>
          </div>
        )}
        <KpiCard label="SPY Price" value={currentInfo ? `$${currentInfo.price.toFixed(2)}` : "—"} />
        <KpiCard
          label="SPY YTD"
          value={ytdReturn != null ? `${ytdReturn >= 0 ? "+" : ""}${ytdReturn.toFixed(2)}%` : "—"}
          color={ytdReturn == null ? undefined : ytdReturn >= 0 ? "#86efac" : "#fca5a5"}
        />
        <KpiCard label="As of" value={currentInfo?.date ?? "—"} />
      </div>

      {/* Chart controls row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>

        {/* Legend */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {Object.entries(REGIME_CONFIG).map(([key, c]) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#6b7280" }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: c.bg, border: `1px solid ${c.color}60` }} />
              <span style={{ color: c.color }}>{c.label}</span>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#6b7280" }}>
            <div style={{ width: 18, height: 2, background: "#60a5fa" }} />
            <span>SMA-50</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#6b7280" }}>
            <div style={{ width: 18, height: 2, background: "#f97316" }} />
            <span>SMA-200</span>
          </div>
        </div>

        {/* Right controls: period buttons + log toggle */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {PERIODS.map((p) => (
            <button
              key={p.label}
              onClick={() => setPeriod(p.label)}
              style={{
                background: period === p.label ? "#1e3a5f" : "transparent",
                border: `1px solid ${period === p.label ? "#2d5a8e" : "#1f2937"}`,
                borderRadius: 5,
                padding: "4px 10px",
                fontSize: 12,
                color: period === p.label ? "#93c5fd" : "#4b5563",
                cursor: "pointer",
                fontWeight: period === p.label ? 600 : 400,
              }}
            >
              {p.label}
            </button>
          ))}
          <div style={{ width: 1, height: 20, background: "#1f2937", margin: "0 4px" }} />
          <button
            onClick={() => setLogScale((v) => !v)}
            style={{
              background: logScale ? "#1e3a5f" : "transparent",
              border: `1px solid ${logScale ? "#2d5a8e" : "#1f2937"}`,
              borderRadius: 5,
              padding: "4px 10px",
              fontSize: 12,
              color: logScale ? "#93c5fd" : "#4b5563",
              cursor: "pointer",
              fontWeight: logScale ? 600 : 400,
            }}
          >
            Log
          </button>
        </div>
      </div>

      {/* Chart */}
      <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 10, padding: "20px 8px 12px" }}>
        <ResponsiveContainer width="100%" height={460}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="#0d1829" vertical={false} />

            <XAxis
              dataKey="date"
              ticks={ticks}
              tickFormatter={(d) => selectedPeriod?.years === 1 ? d.slice(0, 7) : d.slice(0, 4)}
              tick={{ fontSize: 11, fill: "#4b5563" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              scale={logScale ? "log" : "auto"}
              domain={logScale ? ["auto", "auto"] : ["auto", "auto"]}
              tick={{ fontSize: 11, fill: "#4b5563" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={yTickFmt}
              width={56}
              allowDataOverflow
            />

            <Tooltip content={<CustomTooltip />} />

            {/* Regime background bands */}
            {regimeBlocks.map((block, i) => (
              <ReferenceArea
                key={i}
                x1={block.x1}
                x2={block.x2}
                fill={REGIME_CONFIG[block.regime].bg}
                stroke="none"
                ifOverflow="visible"
              />
            ))}

            {/* Moving averages */}
            <Line type="monotone" dataKey="sma50"  stroke="#60a5fa" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls name="SMA-50" />
            <Line type="monotone" dataKey="sma200" stroke="#f97316" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls name="SMA-200" />

            {/* SPY price — rendered last so it sits on top */}
            <Line type="monotone" dataKey="price" stroke="#e5e7eb" strokeWidth={1.5} dot={false} name="SPY" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Algorithm note */}
      <div style={{ marginTop: 16, fontSize: 12, color: "#374151", lineHeight: 1.6 }}>
        <strong style={{ color: "#4b5563" }}>Algorithm:</strong>{" "}
        Trending Up when SMA-50 &gt; SMA-200 <em>and</em> SMA-50 slope (20d) &gt; +0.3%.
        Trending Down when SMA-50 &lt; SMA-200 <em>and</em> slope &lt; -0.3%.
        All other periods classified as Ranging.
      </div>
    </div>
  );
}

function KpiCard({ label, value, color = "#e5e7eb" }) {
  return (
    <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 10, padding: "16px 20px", minWidth: 130 }}>
      <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
