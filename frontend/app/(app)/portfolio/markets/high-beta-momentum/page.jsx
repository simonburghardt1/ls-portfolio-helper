"use client";

import { useEffect, useState } from "react";
import LineChart from "@/app/components/LineChart";
import PageHeader from "@/app/components/PageHeader";
import KpiCard from "@/app/components/KpiCard";
import Button from "@/app/components/Button";

const API = "http://localhost:8000";

const RANGES = [
  { label: "1Y",  years: 1 },
  { label: "3Y",  years: 3 },
  { label: "5Y",  years: 5 },
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

function pct(v, dp = 2) {
  if (v == null || isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`;
}

function computeStats(dates, levels) {
  if (!dates?.length) return null;

  const first = levels[0];
  const last  = levels[levels.length - 1];
  const sinceInception = last / first - 1;

  const firstDate = new Date(dates[0]);
  const lastDate  = new Date(dates[dates.length - 1]);
  const years = (lastDate - firstDate) / (1000 * 60 * 60 * 24 * 365.25);
  const cagr = years > 0 ? Math.pow(last / first, 1 / years) - 1 : null;

  const ytdStart = `${lastDate.getFullYear()}-01-01`;
  const ytdIdx = dates.findIndex((d) => d >= ytdStart);
  const ytdReturn = ytdIdx >= 0 ? last / levels[Math.max(ytdIdx - 1, 0)] - 1 : null;

  let peak = levels[0];
  let maxDrawdown = 0;
  for (const lvl of levels) {
    if (lvl > peak) peak = lvl;
    const dd = lvl / peak - 1;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }

  return { sinceInception, cagr, ytdReturn, maxDrawdown };
}

export default function HighBetaMomentumPage() {
  const [series, setSeries]   = useState(null);
  const [range, setRange]     = useState("3Y");
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const [rebalanceDates, setRebalanceDates] = useState([]);
  const [selectedDate, setSelectedDate]     = useState(null);
  const [holdings, setHoldings]             = useState(null);
  const [holdingsLoading, setHoldingsLoading] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/high-beta-momentum/index-series`)
      .then((r) => r.json())
      .then((d) => { setSeries(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });

    fetch(`${API}/api/high-beta-momentum/rebalance-dates`)
      .then((r) => r.json())
      .then((d) => {
        const dates = d.dates || [];
        setRebalanceDates(dates);
        if (dates.length) setSelectedDate(dates[dates.length - 1]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    setHoldingsLoading(true);
    fetch(`${API}/api/high-beta-momentum/holdings?date=${selectedDate}`)
      .then((r) => r.json())
      .then((d) => { setHoldings(d); setHoldingsLoading(false); })
      .catch(() => setHoldingsLoading(false));
  }, [selectedDate]);

  const visibleRange = rangeFrom(RANGES.find((r) => r.label === range)?.years);
  const stats = series ? computeStats(series.dates, series.index_level) : null;

  const avgBeta = holdings?.rows?.length
    ? holdings.rows.reduce((s, r) => s + (r.beta ?? 0), 0) / holdings.rows.length
    : null;
  const avgMomentum = holdings?.rows?.length
    ? holdings.rows.reduce((s, r) => s + (r.momentum ?? 0), 0) / holdings.rows.length
    : null;

  if (loading) return <PageShell><LoadingState /></PageShell>;
  if (error)   return <PageShell><div style={{ color: "#f87171" }}>Error: {error}</div></PageShell>;

  const hasData = series?.dates?.length > 0;

  return (
    <PageShell>
      <PageHeader
        title="High Beta Momentum"
        subtitle="A reconstructed proxy for Goldman Sachs' GSPRHIMO basket — GS's real holdings aren't public, so this is our own systematic rebuild: top 50 US stocks ($3B-$50B market cap) ranked by 0.5×z(1Y beta) + 0.5×z(12-1 momentum), equal-weighted, rebalanced monthly."
      />

      {!hasData ? (
        <EmptyState />
      ) : (
        <>
          {/* KPI strip */}
          <div style={{ display: "flex", gap: 14, marginBottom: 28, flexWrap: "wrap" }}>
            <KpiCard label="Since Inception" formatted={pct(stats.sinceInception)}
              valueColor={stats.sinceInception >= 0 ? "var(--positive)" : "var(--negative)"} small />
            <KpiCard label="CAGR" formatted={pct(stats.cagr)}
              valueColor={stats.cagr >= 0 ? "var(--positive)" : "var(--negative)"} small />
            <KpiCard label="YTD Return" formatted={pct(stats.ytdReturn)}
              valueColor={stats.ytdReturn >= 0 ? "var(--positive)" : "var(--negative)"} small />
            <KpiCard label="Max Drawdown" formatted={pct(stats.maxDrawdown)} valueColor="var(--negative)" small />
            <KpiCard label="Latest Rebalance" formatted={rebalanceDates[rebalanceDates.length - 1] ?? "—"} small />
            <KpiCard label="Avg Beta (current)" formatted={avgBeta != null ? avgBeta.toFixed(2) : "—"} small />
            <KpiCard label="Avg 12-1 Momentum" formatted={avgMomentum != null ? pct(avgMomentum) : "—"} small />
            <KpiCard label="# Holdings" formatted={holdings?.rows?.length ?? "—"} small
              valueColor={holdings?.rows?.length < 50 ? "var(--caution)" : undefined} />
          </div>

          {/* Period toggle */}
          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            {RANGES.map((r) => (
              <Button key={r.label} variant="range-toggle" active={range === r.label} onClick={() => setRange(r.label)}>
                {r.label}
              </Button>
            ))}
          </div>

          {/* Index chart */}
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)", padding: "16px 8px 8px", marginBottom: 36 }}>
            <LineChart
              dates={series.dates}
              datasets={[{ dates: series.dates, data: series.index_level, borderColor: "#a78bfa", borderWidth: 2, label: "HBM Index" }]}
              visibleRange={visibleRange}
              referenceLine={100}
            />
          </div>

          {/* Holdings */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#e5e7eb" }}>Holdings</div>
            <select
              value={selectedDate || ""}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={SELECT_STYLE}
            >
              {rebalanceDates.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {holdingsLoading ? (
            <LoadingState />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={thStyle}>Rank</th>
                    <th style={thStyle}>Ticker</th>
                    <th style={thStyle}>Beta</th>
                    <th style={thStyle}>Momentum (12-1)</th>
                    <th style={thStyle}>z(Beta)</th>
                    <th style={thStyle}>z(Momentum)</th>
                    <th style={thStyle}>Combined Score</th>
                    <th style={thStyle}>Market Cap</th>
                    <th style={thStyle}>Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {(holdings?.rows || []).map((r, i) => (
                    <tr key={r.ticker} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                      <td style={tdStyle}>{r.rank}</td>
                      <td style={{ ...tdStyle, fontWeight: 600, color: "#e5e7eb" }}>{r.ticker}</td>
                      <td style={tdStyle}>{r.beta?.toFixed(2) ?? "—"}</td>
                      <td style={tdStyle}>{r.momentum != null ? pct(r.momentum) : "—"}</td>
                      <td style={tdStyle}>{r.z_beta?.toFixed(2) ?? "—"}</td>
                      <td style={tdStyle}>{r.z_momentum?.toFixed(2) ?? "—"}</td>
                      <td style={tdStyle}>{r.combined_score?.toFixed(2) ?? "—"}</td>
                      <td style={tdStyle}>{r.market_cap != null ? `$${(r.market_cap / 1e9).toFixed(1)}B` : "—"}</td>
                      <td style={tdStyle}>{(r.weight * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Methodology footnote */}
          <div style={{ marginTop: 24, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            <strong style={{ color: "var(--text-secondary)" }}>Methodology:</strong>{" "}
            Universe = NASDAQ/NYSE stocks, $3B–$50B market cap (approximated historically as current shares
            outstanding × historical price — point-in-time historical constituent data isn't freely available,
            so this may miss names since delisted). Monthly rebalance: top 50 by 0.5×z(1Y trailing beta vs. SPY)
            + 0.5×z(12-1 momentum, i.e. trailing 12-month return excluding the most recent month), equal-weighted.
            A mid-month delisting redistributes its weight pro-rata to the remaining holdings for the rest of that
            month. This is our own reconstruction, not Goldman Sachs' actual GSPRHIMO basket or its real holdings.
          </div>
        </>
      )}
    </PageShell>
  );
}

const thStyle = { textAlign: "left", padding: "8px 12px", color: "#6b7280", fontWeight: 600, whiteSpace: "nowrap" };
const tdStyle = { padding: "8px 12px", color: "#9ca3af", whiteSpace: "nowrap" };

const SELECT_STYLE = {
  background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
  color: "#e5e7eb", fontSize: 13, padding: "6px 10px", cursor: "pointer",
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
      <div style={{ fontSize: 14, color: "#6b7280", marginBottom: 12 }}>No data yet.</div>
      <div style={{ fontSize: 13, color: "#4b5563" }}>
        Go to <span style={{ color: "#3b82f6" }}>Admin → High Beta Momentum</span> to run the initial historical build.
      </div>
    </div>
  );
}
