"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode, HistogramSeries } from "lightweight-charts";
import LineChart from "@/app/components/LineChart";
import PageHeader from "@/app/components/PageHeader";
import Tabs from "@/app/components/Tabs";
import KpiCard from "@/app/components/KpiCard";

const API = "http://localhost:8000";

const REGIONS = [
  { value: "US", label: "United States" },
  { value: "UK", label: "United Kingdom" },
  { value: "EU", label: "EU Region" },
  { value: "DE", label: "Germany" },
  { value: "JP", label: "Japan" },
  { value: "CN", label: "China", soon: true },
];

const LAG_COLORS = {
  lag0: "#3b82f6",
  lag1: "#10b981",
  lag2: "#f59e0b",
  lag3: "#a78bfa",
  lag4: "#ef4444",
};
const LAG_LABELS = {
  lag0: "No Lag",
  lag1: "1Q Lag",
  lag2: "2Q Lag",
  lag3: "3Q Lag",
  lag4: "4Q Lag",
};

export default function GdpPage() {
  const [region, setRegion] = useState("US");
  const [tab, setTab] = useState("gdp");
  const [activeLags, setActiveLags] = useState(new Set(Object.keys(LAG_LABELS)));

  const [series, setSeries] = useState(null);
  const [unit, setUnit] = useState("");
  const [correlation, setCorrelation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function toggleLag(lag) {
    setActiveLags((prev) => {
      const next = new Set(prev);
      if (next.has(lag)) { if (next.size === 1) return prev; next.delete(lag); }
      else next.add(lag);
      return next;
    });
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSeries(null);
    setUnit("");
    setCorrelation(null);
    Promise.all([
      fetch(`${API}/api/gdp/series?region=${region}`).then((r) => r.json()),
      fetch(`${API}/api/gdp/market-correlation?region=${region}`).then((r) => r.json()),
    ])
      .then(([s, c]) => { setSeries(s.series); setUnit(s.unit ?? ""); setCorrelation(c); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [region]);

  if (loading) return <PageShell><LoadingState /></PageShell>;
  if (error)   return <PageShell><div style={{ color: "#f87171" }}>Error: {error}</div></PageShell>;

  const nominal = series?.nominal;
  const real    = series?.real;

  const avgCorrelation = correlation?.correlation
    ? Object.fromEntries(
        Object.entries(correlation.correlation).map(([lag, values]) => [lag, mean(values)])
      )
    : {};

  return (
    <PageShell>
      <PageHeader title="GDP" subtitle="Gross Domestic Product — quarterly, seasonally adjusted annual rate." />

      {/* Region selector */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 8 }}>Region</label>
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          style={SELECT_STYLE}
        >
          {REGIONS.map((r) => (
            <option key={r.value} value={r.value} disabled={r.soon}>
              {r.label}{r.soon ? " (coming soon)" : ""}
            </option>
          ))}
        </select>
      </div>

      <Tabs
        tabs={[
          { key: "gdp",         label: "GDP" },
          { key: "correlation", label: "Market Correlation" },
          { key: "deepdive",    label: "Report Deep Dive" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "gdp" && real && (
        <>
          <Panel title={`Nominal GDP vs. Real GDP${unit ? ` (${unit})` : ""}`}>
            <LineChart
              dates={real.dates}
              datasets={[
                ...(nominal ? [{ dates: nominal.dates, data: nominal.values, borderColor: nominal.color, borderWidth: 2, label: nominal.label }] : []),
                { dates: real.dates, data: real.values, borderColor: real.color, borderWidth: 2, label: real.label },
              ]}
            />
          </Panel>

          {nominal && (
            <Panel title="Nominal GDP — YoY %">
              <GdpHistogram dates={nominal.yoy_dates} values={nominal.yoy} />
            </Panel>
          )}

          <Panel title="Real GDP — YoY %">
            <GdpHistogram dates={real.yoy_dates} values={real.yoy} />
          </Panel>

          {!nominal && (
            <div style={{ fontSize: 12, color: "#4b5563", marginTop: -16, marginBottom: 24 }}>
              No nominal GDP chart for this region — the underlying quarterly series was discontinued by its source.
            </div>
          )}
        </>
      )}

      {tab === "correlation" && correlation?.error && (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)", padding: "32px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 14, color: "#f87171" }}>{correlation.error}</div>
        </div>
      )}

      {tab === "correlation" && correlation && !correlation.error && (
        <>
          <Panel title={`Real GDP YoY (right axis) vs. ${correlation.market_name} YoY (left axis)`}>
            <LineChart
              dates={correlation.dates}
              datasets={[
                { dates: correlation.dates, data: correlation.gdp_yoy,   borderColor: "#10b981", borderWidth: 2, label: "Real GDP YoY", priceScaleId: "right" },
                { dates: correlation.dates, data: correlation.sp500_yoy, borderColor: "#3b82f6", borderWidth: 1.5, label: `${correlation.market_name} YoY`, priceScaleId: "left" },
              ]}
            />
          </Panel>

          <Panel title={`Rolling ${correlation.window_quarters / 4}Y Correlation — Real GDP YoY vs. ${correlation.market_name} YoY (by lag)`}>
            <p style={{ fontSize: 12, color: "#4b5563", marginBottom: 12 }}>
              Lag N = {correlation.market_name} YoY from N quarters earlier, correlated against the current quarter's GDP YoY
              — tests whether the market leads GDP.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              {Object.keys(LAG_LABELS).map((lag) => {
                const on = activeLags.has(lag);
                return (
                  <button key={lag} onClick={() => toggleLag(lag)} style={{
                    padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                    border: `1px solid ${on ? LAG_COLORS[lag] : "var(--border)"}`,
                    background: on ? `${LAG_COLORS[lag]}22` : "transparent",
                    color: on ? LAG_COLORS[lag] : "#6b7280",
                    fontWeight: on ? 600 : 400,
                  }}>
                    {LAG_LABELS[lag]}
                  </button>
                );
              })}
            </div>
            <LineChart
              dates={correlation.dates}
              datasets={Object.entries(correlation.correlation)
                .filter(([lag]) => activeLags.has(lag))
                .map(([lag, values]) => ({
                  dates: correlation.dates, data: values.map((v) => (v == null ? null : v * 100)),
                  borderColor: LAG_COLORS[lag], borderWidth: lag === "lag0" ? 2 : 1.3,
                  label: LAG_LABELS[lag],
                }))}
              referenceLine={0}
            />
          </Panel>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {Object.keys(LAG_LABELS).map((lag) => (
              <KpiCard
                key={lag}
                label={`Avg. Correlation — ${LAG_LABELS[lag]}`}
                formatted={avgCorrelation[lag] != null ? `${(avgCorrelation[lag] * 100).toFixed(1)}%` : "—"}
                valueColor={avgCorrelation[lag] == null ? undefined : avgCorrelation[lag] >= 0 ? "var(--positive)" : "var(--negative)"}
                small
              />
            ))}
          </div>
        </>
      )}

      {tab === "deepdive" && (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)", padding: "32px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 14, color: "#6b7280" }}>Report Deep Dive — coming soon.</div>
        </div>
      )}
    </PageShell>
  );
}

function mean(values) {
  const valid = values.filter((v) => v != null && !isNaN(v));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

// ── Histogram (bar-per-quarter, colored by sign) ────────────────────────────

function GdpHistogram({ dates, values }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !dates?.length) return;

    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#9ca3af" },
      grid: { vertLines: { color: "rgba(55,65,81,0.35)" }, horzLines: { color: "rgba(55,65,81,0.35)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: { borderColor: "#374151", timeVisible: false },
      width: el.clientWidth,
      height: 220,
    });

    const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: true, base: 0 });
    hist.setData(
      dates.map((d, i) => ({
        time: d,
        value: values[i],
        color: values[i] == null ? "transparent" : values[i] >= 0 ? "rgba(52,211,153,0.75)" : "rgba(242,88,92,0.75)",
      })).filter((p) => p.value != null)
    );
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);

    return () => { ro.disconnect(); chart.remove(); };
  }, [dates, values]);

  return <div ref={containerRef} />;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SELECT_STYLE = {
  background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
  color: "#e5e7eb", fontSize: 13, padding: "8px 12px", width: 320, cursor: "pointer",
};

function Panel({ title, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb", marginBottom: 10 }}>{title}</div>
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)", padding: "16px 8px 8px" }}>
        {children}
      </div>
    </div>
  );
}

function PageShell({ children }) {
  return (
    <div style={{ color: "#e5e7eb", maxWidth: 1200, margin: "0 auto", padding: "28px 24px" }}>
      {children}
    </div>
  );
}

function LoadingState() {
  return <div style={{ color: "#4b5563", fontSize: 14, padding: "40px 0" }}>Loading…</div>;
}
