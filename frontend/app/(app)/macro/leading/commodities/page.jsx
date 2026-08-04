"use client";

import { useEffect, useState } from "react";
import LineChart from "@/app/components/LineChart";
import PageHeader from "@/app/components/PageHeader";
import Button from "@/app/components/Button";

const API = "http://localhost:8000";

const RANGES = [
  { label: "2Y",  years: 2 },
  { label: "5Y",  years: 5 },
  { label: "10Y", years: 10 },
  { label: "All", years: null },
];

function rangeFrom(years) {
  if (!years) return null;
  const to = new Date();
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);
  return {
    from: from.toISOString().slice(0, 10),
    to:   to.toISOString().slice(0, 10),
  };
}

// ── Return calculations ─────────────────────────────────────────────────────

function dailyReturns(dates, closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) out.push((closes[i] / closes[i - 1] - 1) * 100);
  }
  return out;
}

function isoWeekKey(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fdDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fdDay + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function weeklyReturns(dates, closes) {
  const weekly = [];
  let curKey = null, curClose = null;
  for (let i = 0; i < dates.length; i++) {
    const key = isoWeekKey(dates[i]);
    if (key !== curKey) {
      if (curClose != null) weekly.push(curClose);
      curKey = key;
    }
    curClose = closes[i];
  }
  if (curClose != null) weekly.push(curClose);

  const out = [];
  for (let i = 1; i < weekly.length; i++) {
    if (weekly[i - 1] > 0) out.push((weekly[i] / weekly[i - 1] - 1) * 100);
  }
  return out;
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr, m) {
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
}

export default function CommodityPricesPage() {
  const [list, setList] = useState({});
  const [commodity, setCommodity] = useState(null);
  const [series, setSeries] = useState(null);
  const [range, setRange] = useState("5Y");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API}/api/commodities/list`)
      .then((r) => r.json())
      .then((d) => {
        setList(d);
        const first = Object.keys(d)[0];
        if (first) setCommodity(first);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!commodity) return;
    setLoading(true);
    setSeries(null);
    fetch(`${API}/api/commodities/prices?commodity=${commodity}`)
      .then((r) => r.json())
      .then((d) => { setSeries(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [commodity]);

  const visibleRange = rangeFrom(RANGES.find((r) => r.label === range)?.years);

  const dReturns = series?.dates?.length > 1 ? dailyReturns(series.dates, series.closes) : [];
  const wReturns = series?.dates?.length > 1 ? weeklyReturns(series.dates, series.closes) : [];

  return (
    <PageShell>
      <PageHeader
        title="Commodity Prices"
        subtitle="Historical prices and return distributions"
      />

      {/* Commodity selector */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 8 }}>
          Commodity
        </label>
        <select
          value={commodity || ""}
          onChange={(e) => setCommodity(e.target.value)}
          style={SELECT_STYLE}
        >
          {Object.entries(list).map(([id, meta]) => (
            <option key={id} value={id}>{meta.label}</option>
          ))}
        </select>
      </div>

      {error && <div style={{ color: "#f87171", marginBottom: 16 }}>Error: {error}</div>}

      {loading ? (
        <LoadingState />
      ) : !series?.dates?.length ? (
        <EmptyState />
      ) : (
        <>
          {/* ── Price Chart ── */}
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e5e7eb", marginBottom: 10 }}>
            {series.label} — Price
          </div>

          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            {RANGES.map((r) => (
              <Button
                key={r.label}
                variant="range-toggle"
                active={range === r.label}
                onClick={() => setRange(r.label)}
              >
                {r.label}
              </Button>
            ))}
          </div>

          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)", padding: "16px 8px 8px", marginBottom: 36 }}>
            <LineChart
              dates={series.dates}
              datasets={[{ dates: series.dates, data: series.closes, borderColor: "#3b82f6", borderWidth: 1.5, label: series.label }]}
              visibleRange={visibleRange}
            />
          </div>

          {/* ── Distribution of Returns ── */}
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e5e7eb", marginBottom: 4 }}>
            Distribution of Returns
          </div>
          <p style={{ fontSize: 12, color: "#4b5563", marginBottom: 20 }}>
            Bars are colored by distance from the mean: within 1σ, 1–2σ, 2–3σ, beyond 3σ.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <ReturnsHistogram title="Daily Returns" returns={dReturns} />
            <ReturnsHistogram title="Weekly Returns" returns={wReturns} />
          </div>
        </>
      )}
    </PageShell>
  );
}

// ── Histogram ────────────────────────────────────────────────────────────────

const BAND_COLORS = { 1: "#3b82f6", 2: "#f59e0b", 3: "#f97316", 4: "#ef4444" };

function bandColor(zAbs) {
  if (zAbs <= 1) return BAND_COLORS[1];
  if (zAbs <= 2) return BAND_COLORS[2];
  if (zAbs <= 3) return BAND_COLORS[3];
  return BAND_COLORS[4];
}

function ReturnsHistogram({ title, returns }) {
  if (!returns.length) {
    return (
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#9ca3af", marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>Not enough data.</div>
      </div>
    );
  }

  const m = mean(returns);
  const sd = stdDev(returns, m);
  const min = Math.min(...returns);
  const max = Math.max(...returns);

  const binCount = 40;
  const binWidth = (max - min) / binCount || 1;
  const bins = new Array(binCount).fill(0);
  returns.forEach((r) => {
    let idx = Math.floor((r - min) / binWidth);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    bins[idx]++;
  });
  const maxCount = Math.max(...bins, 1);

  const width = 760, height = 260;
  const padding = { left: 44, right: 16, top: 12, bottom: 30 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const xScale = (v) => padding.left + ((v - min) / (max - min || 1)) * plotW;

  const sdLines = sd > 0 ? [-3, -2, -1, 0, 1, 2, 3].map((k) => ({ k, x: m + k * sd })) : [];

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb", marginBottom: 8 }}>{title}</div>
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)", padding: "12px 8px" }}>
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible", display: "block" }}>
          {bins.map((count, i) => {
            const x0 = min + i * binWidth;
            const x1 = x0 + binWidth;
            const barH = (count / maxCount) * plotH;
            const zAbs = sd > 0 ? Math.abs((x0 + x1) / 2 - m) / sd : 0;
            return (
              <rect
                key={i}
                x={xScale(x0)}
                y={padding.top + plotH - barH}
                width={Math.max(xScale(x1) - xScale(x0) - 1, 0.5)}
                height={barH}
                fill={bandColor(zAbs)}
              >
                <title>{`${x0.toFixed(2)}% to ${x1.toFixed(2)}%: ${count} obs.`}</title>
              </rect>
            );
          })}

          {sdLines.map(({ k, x }) => (
            <g key={k}>
              <line
                x1={xScale(x)} x2={xScale(x)}
                y1={padding.top} y2={padding.top + plotH}
                stroke={k === 0 ? "#e5e7eb" : "#6b7280"}
                strokeDasharray={k === 0 ? "" : "3,3"}
                strokeWidth={k === 0 ? 1.5 : 1}
              />
              <text x={xScale(x)} y={height - 8} fontSize="9" fill="#6b7280" textAnchor="middle">
                {k === 0 ? "μ" : `${k > 0 ? "+" : ""}${k}σ`}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div style={{ display: "flex", gap: 20, marginTop: 8, fontSize: 11, color: "#6b7280", flexWrap: "wrap" }}>
        <span>Mean: <strong style={{ color: "#e5e7eb" }}>{m.toFixed(3)}%</strong></span>
        <span>Std Dev: <strong style={{ color: "#e5e7eb" }}>{sd.toFixed(3)}%</strong></span>
        <span>Min: <strong style={{ color: "#e5e7eb" }}>{min.toFixed(2)}%</strong></span>
        <span>Max: <strong style={{ color: "#e5e7eb" }}>{max.toFixed(2)}%</strong></span>
        <span>n: <strong style={{ color: "#e5e7eb" }}>{returns.length}</strong></span>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const SELECT_STYLE = {
  background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
  color: "#e5e7eb", fontSize: 13, padding: "8px 12px", width: 320, cursor: "pointer",
};

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

function EmptyState() {
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)", padding: "32px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 14, color: "#6b7280" }}>No price data available for this commodity yet.</div>
    </div>
  );
}
