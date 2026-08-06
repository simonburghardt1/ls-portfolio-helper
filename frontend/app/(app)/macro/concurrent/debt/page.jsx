"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode, HistogramSeries } from "lightweight-charts";
import LineChart from "@/app/components/LineChart";
import PageHeader from "@/app/components/PageHeader";
import Tabs from "@/app/components/Tabs";
import KpiCard from "@/app/components/KpiCard";

const API = "http://localhost:8000";

const CORR_COLORS = {
  debt_sp500: "#3b82f6",
  debt_gdp:   "#f59e0b",
};
const CORR_LABELS = {
  debt_sp500: "Debt & S&P 500",
  debt_gdp:   "Debt & GDP",
};

function mean(values) {
  const valid = values.filter((v) => v != null && !isNaN(v));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

export default function DebtPage() {
  const [tab, setTab] = useState("debt");
  const [seriesId, setSeriesId] = useState("FYGFD");
  const [showGdp, setShowGdp] = useState(false);

  const [series, setSeries] = useState(null);
  const [correlation, setCorrelation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/debt/series`).then((r) => r.json()),
      fetch(`${API}/api/debt/market-correlation`).then((r) => r.json()),
    ])
      .then(([s, c]) => { setSeries(s.series); setCorrelation(c); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return <PageShell><LoadingState /></PageShell>;
  if (error)   return <PageShell><div style={{ color: "#f87171" }}>Error: {error}</div></PageShell>;

  const selected = series?.[seriesId];

  const avgCorrelation = correlation?.correlation
    ? Object.fromEntries(
        Object.entries(correlation.correlation).map(([k, values]) => [k, mean(values)])
      )
    : {};

  const corrDates = correlation?.years?.map((y) => `${y}-01-01`) ?? [];

  return (
    <PageShell>
      <PageHeader title="Debt" subtitle="US Gross Federal Debt — annual." />

      <Tabs
        tabs={[
          { key: "debt",        label: "Debt" },
          { key: "correlation", label: "Market Correlation" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "debt" && series && (
        <>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 8 }}>Series</label>
            <select value={seriesId} onChange={(e) => setSeriesId(e.target.value)} style={SELECT_STYLE}>
              {Object.entries(series).map(([sid, s]) => (
                <option key={sid} value={sid}>{s.label}</option>
              ))}
            </select>
          </div>

          {selected && (
            <>
              <Panel title={selected.label}>
                <LineChart
                  dates={selected.dates}
                  datasets={[{ dates: selected.dates, data: selected.values, borderColor: selected.color, borderWidth: 2, label: selected.label }]}
                />
              </Panel>

              <Panel title={`${selected.label} — YoY %`}>
                <DebtHistogram dates={selected.yoy_dates} values={selected.yoy} />
              </Panel>
            </>
          )}
        </>
      )}

      {tab === "correlation" && correlation && (
        <>
          <div style={{ marginBottom: 16 }}>
            <button onClick={() => setShowGdp((v) => !v)} style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
              border: `1px solid ${showGdp ? "#10b981" : "var(--border)"}`,
              background: showGdp ? "#10b98122" : "transparent",
              color: showGdp ? "#10b981" : "#6b7280",
              fontWeight: showGdp ? 600 : 400,
            }}>
              Real GDP YoY
            </button>
          </div>

          <Panel title="Federal Debt YoY (right axis) vs. S&P 500 YoY (left axis)">
            <LineChart
              dates={corrDates}
              datasets={[
                { dates: corrDates, data: correlation.debt_yoy,  borderColor: "#3b82f6", borderWidth: 2,   label: "Debt YoY",     priceScaleId: "right" },
                { dates: corrDates, data: correlation.sp500_yoy, borderColor: "#ef4444", borderWidth: 1.5, label: "S&P 500 YoY",  priceScaleId: "left" },
                ...(showGdp ? [{ dates: corrDates, data: correlation.gdp_yoy, borderColor: "#10b981", borderWidth: 1.5, label: "Real GDP YoY", priceScaleId: "right" }] : []),
              ]}
            />
          </Panel>

          <Panel title={`Rolling ${correlation.window_years}Y Correlation`}>
            <LineChart
              dates={corrDates}
              datasets={Object.entries(correlation.correlation).map(([k, values]) => ({
                dates: corrDates, data: values.map((v) => (v == null ? null : v * 100)),
                borderColor: CORR_COLORS[k], borderWidth: 2, label: CORR_LABELS[k],
              }))}
              referenceLine={0}
            />
          </Panel>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {Object.keys(CORR_LABELS).map((k) => (
              <KpiCard
                key={k}
                label={`Avg. Correlation — ${CORR_LABELS[k]}`}
                formatted={avgCorrelation[k] != null ? `${(avgCorrelation[k] * 100).toFixed(1)}%` : "—"}
                valueColor={avgCorrelation[k] == null ? undefined : avgCorrelation[k] >= 0 ? "var(--positive)" : "var(--negative)"}
                small
              />
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}

// ── Histogram (bar-per-year, colored by sign) ───────────────────────────────

function DebtHistogram({ dates, values }) {
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
