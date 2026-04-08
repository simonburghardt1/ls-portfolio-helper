"use client";
import { useEffect, useState } from "react";

const API = "http://localhost:8000";

const PERIODS = [
  { label: "13W",  weeks: 13  },
  { label: "26W",  weeks: 26  },
  { label: "52W",  weeks: 52  },
  { label: "104W", weeks: 104 },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function pct(v, dp = 2) {
  if (v == null) return "—";
  return `${(v * 100).toFixed(dp)}%`;
}

function fmtNum(v, dp = 5) {
  if (v == null) return "—";
  return v.toFixed(dp);
}

function fmtUsd(v) {
  if (v == null) return "—";
  const abs = Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return `${v < 0 ? "−" : ""}$${abs}`;
}

// Heat-map colour: blue (negative) → white (zero) → orange (positive)
function covColor(val, maxAbs) {
  if (maxAbs === 0) return "transparent";
  const t = Math.min(Math.abs(val) / maxAbs, 1);
  if (val > 0) return `rgba(234,88,12,${0.12 + t * 0.55})`;   // orange
  if (val < 0) return `rgba(37,99,235,${0.12 + t * 0.55})`;   // blue
  return "transparent";
}

// Correlation colour
function corrColor(val, isDiag) {
  if (isDiag) return "rgba(55,65,81,0.6)";
  const t = Math.min(Math.abs(val), 1);
  if (val > 0) return `rgba(22,163,74,${0.1 + t * 0.55})`;    // green
  if (val < 0) return `rgba(220,38,38,${0.1 + t * 0.55})`;    // red
  return "transparent";
}

const cellBase = {
  padding: "4px 7px",
  textAlign: "right",
  fontSize: 11,
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
};

const rowLabel = {
  padding: "4px 10px",
  fontSize: 11,
  fontWeight: 600,
  color: "#9ca3af",
  whiteSpace: "nowrap",
  position: "sticky",
  left: 0,
  background: "#080e1a",
  zIndex: 1,
};

const thStyle = {
  padding: "5px 7px",
  fontSize: 10,
  fontWeight: 700,
  color: "#374151",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  textAlign: "right",
  borderBottom: "1px solid #1f2937",
  background: "#080e1a",
  position: "sticky",
  top: 0,
  zIndex: 2,
};

const thRowLabel = {
  ...thStyle,
  textAlign: "left",
  position: "sticky",
  left: 0,
  zIndex: 3,
};

function pnlColor(v) {
  if (v == null || v === 0) return "#6b7280";
  return v > 0 ? "#86efac" : "#fca5a5";
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function VolatilityPage() {
  const [savedPortfolios, setSavedPortfolios] = useState([]);
  const [source, setSource]   = useState("live");   // "live" | portfolio id
  const [weeks, setWeeks]     = useState(52);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  // Load saved portfolio list on mount
  useEffect(() => {
    fetch(`${API}/api/portfolios`)
      .then(r => r.json())
      .then(setSavedPortfolios)
      .catch(() => {});
  }, []);

  // Reload when source or period changes
  useEffect(() => {
    loadData();
  }, [source, weeks]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const url = source === "live"
        ? `${API}/api/track-record/positions/volatility?weeks=${weeks}`
        : `${API}/api/portfolios/${source}/volatility?weeks=${weeks}`;
      const res  = await fetch(url);
      const json = await res.json();
      if (json.error) { setError(json.error); setData(null); }
      else setData(json);
    } catch (e) {
      setError(String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  // ── Pre-compute display values ──────────────────────────────────────────────

  const isLive = source === "live";

  let covMaxAbs = 0;
  if (data?.cov_matrix) {
    data.cov_matrix.forEach(row =>
      row.forEach(v => { if (Math.abs(v) > covMaxAbs) covMaxAbs = Math.abs(v); })
    );
  }

  const totalGross = data?.allocations
    ? data.allocations.reduce((s, a) => s + Math.abs(a), 0)
    : null;

  const scenarios = [0.5, 1.0, 1.5, 2.0].map(sharpe => ({
    sharpe,
    vol:    data ? pct(data.portfolio_std_annual) : "—",
    ret:    data ? pct(sharpe * data.portfolio_std_annual) : "—",
  }));

  // Av correlation per ticker (mean of off-diagonal row, sign-adjusted)
  function avCorr(rowIdx) {
    if (!data) return null;
    const row  = data.corr_matrix[rowIdx];
    const sign = data.weights[rowIdx] >= 0 ? 1 : -1;
    const vals = row.filter((_, j) => j !== rowIdx);
    if (!vals.length) return null;
    return sign * vals.reduce((s, v) => s + v, 0) / vals.length;
  }

  // Portfolio correlation = average of all per-ticker Av Correlations
  const avCorrValues = data ? data.tickers.map((_, i) => avCorr(i)).filter(v => v != null) : [];
  const portfolioCorr = avCorrValues.length > 0
    ? avCorrValues.reduce((s, v) => s + v, 0) / avCorrValues.length
    : null;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: "28px 32px", color: "#e5e7eb", minHeight: "100vh", background: "#060d18" }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#f9fafb", marginBottom: 4 }}>
          Portfolio Volatility &amp; Correlation
        </h1>
        <p style={{ fontSize: 12, color: "#4b5563" }}>
          Weekly return covariance and correlation matrices for your portfolio positions.
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 28, flexWrap: "wrap" }}>
        {/* Source buttons */}
        <button
          onClick={() => setSource("live")}
          style={{
            padding: "6px 14px", fontSize: 12, borderRadius: 6, cursor: "pointer",
            background: source === "live" ? "#1e3a5f" : "transparent",
            border:     source === "live" ? "1px solid #2d5a8e" : "1px solid #1f2937",
            color:      source === "live" ? "#93c5fd" : "#6b7280",
          }}
        >
          Live Portfolio
        </button>

        {savedPortfolios.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#4b5563" }}>Saved:</span>
            <select
              value={source === "live" ? "" : source}
              onChange={e => e.target.value && setSource(Number(e.target.value))}
              style={{
                background: "#0d1829", border: "1px solid #1f2937", borderRadius: 6,
                color: "#9ca3af", fontSize: 12, padding: "5px 10px", cursor: "pointer",
              }}
            >
              <option value="">— select —</option>
              {savedPortfolios.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Divider */}
        <div style={{ width: 1, height: 20, background: "#1f2937" }} />

        {/* Period selector */}
        {PERIODS.map(p => (
          <button key={p.label} onClick={() => setWeeks(p.weeks)} style={{
            padding: "5px 10px", fontSize: 12, borderRadius: 5, cursor: "pointer",
            background: weeks === p.weeks ? "#0f2040" : "transparent",
            border:     weeks === p.weeks ? "1px solid #1e3a5f" : "1px solid #1f2937",
            color:      weeks === p.weeks ? "#60a5fa" : "#6b7280",
          }}>{p.label}</button>
        ))}

        {loading && <span style={{ fontSize: 12, color: "#4b5563" }}>Loading…</span>}
      </div>

      {error && (
        <div style={{ color: "#fca5a5", fontSize: 13, marginBottom: 20 }}>Error: {error}</div>
      )}

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      {data && (
        <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
          {[
            {
              label: "Portfolio Volatility",
              sub:   "Annualized",
              value: pct(data.portfolio_std_annual, 2),
              color: "#f59e0b",
            },
            {
              label: "Portfolio Correlation",
              sub:   "Avg of Av Correlations",
              value: portfolioCorr != null ? pct(portfolioCorr, 2) : "—",
              color: pnlColor(portfolioCorr),
            },
            {
              label: "Av Asset Std Dev",
              sub:   "Annualized",
              value: pct(data.av_asset_std_annual, 2),
              color: "#9ca3af",
            },
          ].map(k => (
            <div key={k.label} style={{
              background: "#080e1a", border: "1px solid #1f2937", borderRadius: 8,
              padding: "14px 20px", minWidth: 180, flex: "1 1 180px",
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
                {k.label}
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: k.color, lineHeight: 1 }}>
                {k.value}
              </div>
              <div style={{ fontSize: 10, color: "#4b5563", marginTop: 4 }}>{k.sub}</div>
            </div>
          ))}
        </div>
      )}

      {data && (
        <>
          {/* ── Variance-Covariance Matrix ─────────────────────────────────── */}
          <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Variance-Covariance Matrix
          </div>

          <div style={{ overflowX: "auto", marginBottom: 8 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr>
                  <th style={{ ...thRowLabel, minWidth: 60 }}>Ticker</th>
                  {data.tickers.map(t => (
                    <th key={t} style={thStyle}>{t}</th>
                  ))}
                  {isLive && <th style={{ ...thStyle, color: "#9ca3af" }}>$ Net Alloc</th>}
                  <th style={{ ...thStyle, color: "#9ca3af" }}>% Weight</th>
                </tr>
              </thead>
              <tbody>
                {data.tickers.map((ticker, i) => (
                  <tr key={ticker}
                    style={{ borderBottom: "1px solid rgba(31,41,55,0.4)" }}
                    onMouseEnter={e => e.currentTarget.style.filter = "brightness(1.15)"}
                    onMouseLeave={e => e.currentTarget.style.filter = ""}
                  >
                    <td style={rowLabel}>{ticker}</td>
                    {data.cov_matrix[i].map((val, j) => (
                      <td key={j} style={{
                        ...cellBase,
                        background: covColor(val, covMaxAbs),
                        color: "#d1d5db",
                        minWidth: 72,
                        fontWeight: i === j ? 700 : 400,
                      }}>
                        {fmtNum(val)}
                      </td>
                    ))}
                    {isLive && (
                      <td style={{ ...cellBase, color: pnlColor(data.allocations?.[i]), minWidth: 90 }}>
                        {fmtUsd(data.allocations?.[i])}
                      </td>
                    )}
                    <td style={{ ...cellBase, color: pnlColor(data.weights[i]), minWidth: 72 }}>
                      {pct(data.weights[i])}
                    </td>
                  </tr>
                ))}
                {/* Gross row */}
                {isLive && totalGross != null && (
                  <tr style={{ borderTop: "1px solid #1f2937" }}>
                    <td style={{ ...rowLabel, color: "#4b5563" }} colSpan={data.tickers.length + 1}>
                      Gross:
                    </td>
                    <td style={{ ...cellBase, color: "#9ca3af", fontWeight: 700 }}>
                      {fmtUsd(totalGross)}
                    </td>
                    <td style={{ ...cellBase, color: "#4b5563" }}>100%</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Stats + Scenario ──────────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 32, marginTop: 20, marginBottom: 28, flexWrap: "wrap" }}>
            {/* Stats block */}
            <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 8, padding: "14px 20px", minWidth: 260 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>Portfolio Risk</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 24px", fontSize: 12 }}>
                <span style={{ color: "#4b5563" }}>Portfolio Variance</span>
                <span style={{ color: "#e5e7eb" }}>{data.portfolio_variance?.toFixed(6)} <span style={{ color: "#374151", fontSize: 10 }}>*Weekly</span></span>

                <span style={{ color: "#4b5563" }}>Std Dev</span>
                <span style={{ color: "#e5e7eb" }}>
                  {pct(data.portfolio_std_weekly, 2)} <span style={{ color: "#374151", fontSize: 10 }}>*Weekly</span>
                </span>

                <span style={{ color: "#4b5563" }}></span>
                <span style={{ color: pnlColor(data.portfolio_std_annual) }}>
                  {pct(data.portfolio_std_annual, 2)} <span style={{ color: "#374151", fontSize: 10 }}>*Annual</span>
                </span>

                <span style={{ color: "#4b5563" }}>Av Asset Std Dev</span>
                <span style={{ color: "#9ca3af" }}>
                  {pct(data.av_asset_std_weekly, 2)} <span style={{ color: "#374151", fontSize: 10 }}>*Weekly</span>
                </span>

                <span style={{ color: "#4b5563" }}></span>
                <span style={{ color: "#9ca3af" }}>
                  {pct(data.av_asset_std_annual, 2)} <span style={{ color: "#374151", fontSize: 10 }}>*Annual</span>
                </span>
              </div>
              {data.skipped?.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 10, color: "#374151" }}>
                  Excluded: {data.skipped.join(", ")}
                </div>
              )}
            </div>

            {/* Scenario analysis */}
            <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 8, padding: "14px 20px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>Scenario Analysis</div>
              <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: "left", paddingLeft: 0, position: "static" }}>Gross Sharpe</th>
                    <th style={{ ...thStyle, position: "static" }}>Volatility</th>
                    <th style={{ ...thStyle, position: "static" }}>Return</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map(s => (
                    <tr key={s.sharpe} style={{ borderBottom: "1px solid #0d1829" }}>
                      <td style={{ padding: "4px 12px 4px 0", color: "#9ca3af" }}>{s.sharpe.toFixed(1)}</td>
                      <td style={{ ...cellBase, color: "#f59e0b" }}>{s.vol}</td>
                      <td style={{ ...cellBase, color: "#86efac" }}>{s.ret}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Correlation Matrix ────────────────────────────────────────── */}
          <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Correlation Matrix
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr>
                  <th style={{ ...thRowLabel, minWidth: 60 }}>Ticker</th>
                  {data.tickers.map(t => (
                    <th key={t} style={thStyle}>{t}</th>
                  ))}
                  <th style={{ ...thStyle, color: "#9ca3af" }}>Long / Short</th>
                  <th style={{ ...thStyle, color: "#9ca3af" }}>Av Correlation</th>
                </tr>
              </thead>
              <tbody>
                {data.tickers.map((ticker, i) => {
                  const av = avCorr(i);
                  const isLong = data.weights[i] >= 0;
                  return (
                    <tr key={ticker}
                      style={{ borderBottom: "1px solid rgba(31,41,55,0.4)" }}
                      onMouseEnter={e => e.currentTarget.style.filter = "brightness(1.15)"}
                      onMouseLeave={e => e.currentTarget.style.filter = ""}
                    >
                      <td style={rowLabel}>{ticker}</td>
                      {data.corr_matrix[i].map((val, j) => {
                        const isDiag = i === j;
                        return (
                          <td key={j} style={{
                            ...cellBase,
                            background: corrColor(val, isDiag),
                            color: isDiag ? "#374151" : "#d1d5db",
                            minWidth: 68,
                          }}>
                            {isDiag ? "—" : pct(val)}
                          </td>
                        );
                      })}
                      <td style={{ ...cellBase, color: isLong ? "#86efac" : "#fca5a5", minWidth: 72 }}>
                        {isLong ? "+1" : "−1"}
                      </td>
                      <td style={{ ...cellBase, color: pnlColor(av), minWidth: 90 }}>
                        {av != null ? pct(av) : "—"}
                      </td>
                    </tr>
                  );
                })}
                {/* Portfolio summary row */}
                <tr style={{ borderTop: "2px solid #1f2937", background: "rgba(255,255,255,0.02)" }}>
                  <td style={{ ...rowLabel, color: "#6b7280", fontStyle: "italic" }}>Portfolio</td>
                  {data.tickers.map((_, j) => (
                    <td key={j} style={{ ...cellBase, color: "#374151", minWidth: 68 }}>—</td>
                  ))}
                  <td style={{ ...cellBase, color: "#4b5563", minWidth: 72 }}>—</td>
                  <td style={{
                    ...cellBase, minWidth: 90, fontWeight: 700, fontSize: 12,
                    color: pnlColor(portfolioCorr),
                    background: portfolioCorr != null ? corrColor(portfolioCorr, false) : "transparent",
                  }}>
                    {portfolioCorr != null ? pct(portfolioCorr, 2) : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, fontSize: 10, color: "#374151" }}>
            Based on {data.weeks_used} weeks of weekly returns data.
          </div>
        </>
      )}

      {!loading && !data && !error && (
        <div style={{ color: "#374151", fontSize: 13, paddingTop: 40 }}>
          Select a portfolio source above to compute the matrices.
        </div>
      )}
    </div>
  );
}
