"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import LineChart from "@/app/components/LineChart";

const API = "http://localhost:8000";

const DEFAULT_POSITIONS = [
  { ticker: "MSTR", weight: 0.10, side: "short" },
  { ticker: "BMBL", weight: 0.10, side: "short" },
  { ticker: "HUBS", weight: 0.10, side: "short" },
  { ticker: "LLY",  weight: 0.10, side: "long"  },
  { ticker: "NBIS", weight: 0.10, side: "long"  },
  { ticker: "ONDS", weight: 0.10, side: "long"  },
  { ticker: "GPRE", weight: 0.10, side: "long"  },
  { ticker: "SOFI", weight: 0.10, side: "short" },
  { ticker: "DKNG", weight: 0.10, side: "short" },
  { ticker: "SEZL", weight: 0.10, side: "long"  },
];

export default function BacktestingPage() {
  const [positions,         setPositions]         = useState(DEFAULT_POSITIONS);
  const [result,            setResult]            = useState(null);
  const [status,            setStatus]            = useState("idle");   // idle | running | done | error
  const [errors,            setErrors]            = useState([]);
  const [selectedTimeframe, setSelectedTimeframe] = useState("12M");
  const [tableFrequency,    setTableFrequency]    = useState("daily");

  // Analytics state (beta + correlation)
  const [betas,             setBetas]             = useState({});       // {TICKER: float}
  const [portfolioBeta,     setPortfolioBeta]     = useState(null);
  const [portfolioCorr,     setPortfolioCorr]     = useState(null);
  const [betaStatus,        setBetaStatus]        = useState("idle");   // idle | loading | done | error

  // Regime-adjust state
  const [regimeAdjust,      setRegimeAdjust]      = useState(false);
  const [regimeTargets,     setRegimeTargets]     = useState({ up: 0.5, ranging: 0.0, down: -0.5 });
  const [compareStatus,     setCompareStatus]     = useState("idle");  // idle | loading | done | error

  // Load portfolio state
  const [savedPortfolios,   setSavedPortfolios]   = useState([]);
  const [selectedPortfolio, setSelectedPortfolio] = useState("");
  const [loadedName,        setLoadedName]        = useState(null);

  useEffect(() => {
    fetch(`${API}/api/portfolios`)
      .then(r => r.json())
      .then(setSavedPortfolios)
      .catch(() => {});
  }, []);

  // ── Portfolio loader ───────────────────────────────────────────────────────

  async function fetchAnalytics(positionsList) {
    setBetaStatus("loading");
    try {
      const res = await fetch(`${API}/api/portfolio/analytics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions: cleanPositions(positionsList) }),
      });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setBetas(json.betas);
      setPortfolioBeta(json.portfolio_beta);
      setPortfolioCorr(json.correlation);
      setBetaStatus("done");
    } catch {
      setBetaStatus("error");
    }
  }

  function loadPortfolio() {
    const p = savedPortfolios.find(p => String(p.id) === selectedPortfolio);
    if (!p) return;
    const loaded = p.positions.map(pos => ({ ...pos }));
    setPositions(loaded);
    setLoadedName(p.name);
    setResult(null);
    setStatus("idle");
    setErrors([]);
    setBetaStatus("idle");
    // Auto-calculate analytics for the loaded portfolio
    fetchAnalytics(loaded);
  }

  // ── Position helpers ───────────────────────────────────────────────────────

  function updatePosition(index, field, value) {
    setPositions(prev => {
      const next = [...prev];
      if (field === "weight") {
        // UI shows % (e.g. 10), we store decimal (e.g. 0.10)
        next[index] = { ...next[index], weight: value === "" ? "" : Number(value) / 100 };
      } else {
        next[index] = { ...next[index], [field]: value };
      }
      return next;
    });
    // Clear beta data when positions change
    setBetas({});
    setPortfolioBeta(null);
    setBetaStatus("idle");
  }

  function toggleSide(index) {
    setPositions(prev => {
      const next = [...prev];
      next[index] = { ...next[index], side: next[index].side === "long" ? "short" : "long" };
      return next;
    });
    setBetas({});
    setPortfolioBeta(null);
    setBetaStatus("idle");
  }

  function addRow() {
    setPositions(prev => [...prev, { ticker: "", weight: 0.10, side: "long" }]);
  }

  function removeRow(index) {
    setPositions(prev => prev.filter((_, i) => i !== index));
    setBetas({});
    setPortfolioBeta(null);
    setBetaStatus("idle");
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  function computeSummary(positions) {
    const clean = positions.filter(p => p.ticker && p.weight !== "" && !isNaN(Number(p.weight)));
    return {
      count:   clean.length,
      gross:   clean.reduce((s, p) => s + Math.abs(Number(p.weight) || 0), 0),
      net:     clean.reduce((s, p) => s + (p.side === "short" ? -1 : 1) * (Number(p.weight) || 0), 0),
      longs:   clean.filter(p => p.side === "long").length,
      shorts:  clean.filter(p => p.side === "short").length,
    };
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  function validate(positions) {
    const errs = [];
    positions.forEach((p, i) => {
      if (!p.ticker?.trim())                               errs.push(`Row ${i + 1}: ticker required`);
      if (p.weight === "" || isNaN(Number(p.weight)))      errs.push(`Row ${i + 1}: weight must be a number`);
      if (!["long", "short"].includes(p.side))             errs.push(`Row ${i + 1}: invalid side`);
    });
    return errs;
  }

  function cleanPositions(positions) {
    return positions
      .filter(p => p.ticker && p.side && p.weight !== 0 && p.weight !== "")
      .map(p => ({ ticker: p.ticker.trim().toUpperCase(), weight: Number(p.weight), side: p.side }));
  }

  // ── Beta Adjust ────────────────────────────────────────────────────────────

  async function betaAdjust() {
    const errs = validate(positions);
    if (errs.length) { setErrors(errs); return; }
    setErrors([]);
    setBetaStatus("loading");
    try {
      const res = await fetch(`${API}/api/portfolio/beta-adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions: cleanPositions(positions) }),
      });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const json = await res.json();
      setPositions(json.positions);
      setBetas(json.betas);
      setPortfolioBeta(json.portfolio_beta);
      setPortfolioCorr(json.correlation ?? null);
      setBetaStatus("done");
    } catch (e) {
      console.error(e);
      setBetaStatus("error");
    }
  }

  // ── Backtest ───────────────────────────────────────────────────────────────

  async function runBacktest() {
    const errs = validate(positions);
    setErrors(errs);
    if (errs.length) { setStatus("idle"); return; }
    setStatus("running");
    setCompareStatus("idle");
    try {
      const res = await fetch(`${API}/api/portfolio/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions: cleanPositions(positions) }),
      });
      setResult(await res.json());
      setStatus("done");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }

  async function compareRegimeAdjusted() {
    const errs = validate(positions);
    if (errs.length) { setErrors(errs); return; }
    setCompareStatus("loading");
    try {
      const res = await fetch(`${API}/api/portfolio/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positions:      cleanPositions(positions),
          regime_adjust:  true,
          regime_targets: { up: Number(regimeTargets.up), ranging: Number(regimeTargets.ranging), down: Number(regimeTargets.down) },
        }),
      });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const json = await res.json();
      // Merge regime_adjusted overlay into the existing result without replacing the static series
      setResult(prev => ({
        ...prev,
        series:        { ...prev.series, regime_adjusted: json.series.regime_adjusted },
        summary_regime: json.summary_regime,
      }));
      setCompareStatus("done");
    } catch (e) {
      console.error(e);
      setCompareStatus("error");
    }
  }

  function clearRegimeComparison() {
    setResult(prev => {
      if (!prev) return prev;
      const { regime_adjusted: _, ...series } = prev.series;
      return { ...prev, series, summary_regime: undefined };
    });
    setCompareStatus("idle");
  }

  // ── Chart / table helpers ──────────────────────────────────────────────────

  function getFilteredChartData(result, timeframe) {
    if (!result?.series) return null;
    const { dates, portfolio, benchmark, regime_adjusted } = result.series;
    const days = timeframe === "3M" ? 63 : timeframe === "6M" ? 126 : 252;
    const start = Math.max(0, dates.length - days);
    const d = dates.slice(start), p = portfolio.slice(start), b = benchmark.slice(start);
    const ra = regime_adjusted ? regime_adjusted.slice(start) : null;
    if (!p.length || !b.length) return null;
    return {
      dates: d,
      portfolio:       p.map(v => ((1 + v) / (1 + p[0]) - 1) * 100),
      benchmark:       b.map(v => ((1 + v) / (1 + b[0]) - 1) * 100),
      regime_adjusted: ra ? ra.map(v => ((1 + v) / (1 + ra[0]) - 1) * 100) : null,
    };
  }

  function getTableRows(result, frequency) {
    if (!result?.daily) return [];
    if (frequency === "daily") return [...result.daily].reverse();
    const rows = result.daily;
    const weekly = [];
    let currentWeek = null, weekStartCum = null, lastRow = null;
    for (const row of rows) {
      const d = new Date(row.date);
      const wk = `${d.getUTCFullYear()}-${Math.floor((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 604800000)}`;
      if (!currentWeek) { currentWeek = wk; weekStartCum = 0; lastRow = row; }
      else if (wk !== currentWeek) {
        weekly.push({ date: lastRow.date, daily_return: (1 + lastRow.cumulative_return) / (1 + weekStartCum) - 1, cumulative_return: lastRow.cumulative_return });
        currentWeek = wk; weekStartCum = lastRow.cumulative_return; lastRow = row;
      } else { lastRow = row; }
    }
    if (lastRow) weekly.push({ date: lastRow.date, daily_return: (1 + lastRow.cumulative_return) / (1 + weekStartCum) - 1, cumulative_return: lastRow.cumulative_return });
    return weekly.reverse();
  }

  const summary   = computeSummary(positions);
  const chartData = getFilteredChartData(result, selectedTimeframe);
  const tableRows = getTableRows(result, tableFrequency);
  const hasBetas  = Object.keys(betas).length > 0;

  return (
    <div style={{ background: "#020617", minHeight: "100vh", color: "#e5e7eb" }}>
      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "28px 32px 60px" }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f9fafb", margin: 0 }}>Portfolio Backtester</h1>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            {loadedName ? `Loaded: ${loadedName}` : "Build a long/short portfolio and backtest its historical performance."}
          </p>
        </div>

        {/* Load Portfolio */}
        {savedPortfolios.length > 0 && (
          <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 8, padding: "12px 16px", marginBottom: 20, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>Load saved portfolio:</span>
            <select
              value={selectedPortfolio}
              onChange={e => setSelectedPortfolio(e.target.value)}
              style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 6, padding: "6px 10px", fontSize: 13, color: "#e5e7eb", cursor: "pointer" }}
            >
              <option value="">— select —</option>
              {savedPortfolios.map(p => (
                <option key={p.id} value={String(p.id)}>{p.name} ({p.positions.length} pos)</option>
              ))}
            </select>
            <button
              onClick={loadPortfolio}
              disabled={!selectedPortfolio}
              style={selectedPortfolio ? btnPrimary : btnDisabled}
            >
              Load
            </button>
          </div>
        )}

        {/* KPI Cards */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
          <KpiCard label="Positions"      value={summary.count} />
          <KpiCard label="Gross Exposure" value={`${(summary.gross * 100).toFixed(1)}%`} />
          <KpiCard label="Net Exposure"   value={`${(summary.net * 100).toFixed(1)}%`}
            valueColor={summary.net > 0 ? "#86efac" : summary.net < 0 ? "#fca5a5" : "#e5e7eb"} />
          <KpiCard label="Longs"  value={summary.longs} />
          <KpiCard label="Shorts" value={summary.shorts} />
          <KpiCardLink
            href="/portfolio/risk/beta"
            label="Portfolio β"
            value={portfolioBeta !== null ? portfolioBeta.toFixed(4) : "—"}
            loading={betaStatus === "loading"}
            valueColor={
              portfolioBeta === null ? "#4b5563"
              : Math.abs(portfolioBeta) < 0.05 ? "#86efac"
              : Math.abs(portfolioBeta) < 0.15  ? "#f59e0b"
              : "#fca5a5"
            }
          />
          <KpiCardLink
            href="/portfolio/risk/volatility"
            label="Correlation (SPY)"
            value={portfolioCorr !== null ? portfolioCorr.toFixed(4) : "—"}
            loading={betaStatus === "loading"}
            valueColor={
              portfolioCorr === null ? "#4b5563"
              : Math.abs(portfolioCorr) < 0.2 ? "#86efac"
              : Math.abs(portfolioCorr) < 0.5  ? "#f59e0b"
              : "#fca5a5"
            }
          />
        </div>

        {/* Positions Table */}
        <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
          {/* Table header bar */}
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #1f2937", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#9ca3af", letterSpacing: "0.04em" }}>POSITIONS</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={addRow} style={btnSecondary}>+ Add Row</button>
              <button
                onClick={betaAdjust}
                disabled={betaStatus === "loading"}
                style={betaStatus === "loading" ? btnDisabled : btnBeta}
              >
                {betaStatus === "loading" ? "Fetching betas…" : "⚡ Beta-Adjust"}
              </button>
              <button
                onClick={runBacktest}
                disabled={status === "running"}
                style={status === "running" ? btnDisabled : btnPrimary}
              >
                {status === "running" ? "Running…" : "▶ Run Backtest"}
              </button>
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #0d1829" }}>
                  <Th style={{ width: 36, textAlign: "center" }}>#</Th>
                  <Th>Ticker</Th>
                  <Th>Side</Th>
                  <Th>Weight</Th>
                  {hasBetas && <Th>Beta</Th>}
                  <Th style={{ width: 40 }}></Th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos, i) => {
                  const beta = betas[pos.ticker?.toUpperCase()];
                  const weightPct = pos.weight === "" ? "" : (Number(pos.weight) * 100).toFixed(2);
                  return (
                    <tr
                      key={i}
                      style={{ borderBottom: "1px solid #0d1829", transition: "background 0.1s" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#0a1628"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      {/* Row number */}
                      <td style={{ padding: "10px 12px", textAlign: "center", fontSize: 11, color: "#374151", fontVariantNumeric: "tabular-nums" }}>
                        {i + 1}
                      </td>

                      {/* Ticker */}
                      <td style={{ padding: "8px 12px" }}>
                        <input
                          value={pos.ticker}
                          onChange={e => updatePosition(i, "ticker", e.target.value.toUpperCase())}
                          placeholder="AAPL"
                          style={{
                            ...cellInput,
                            fontFamily: "ui-monospace, monospace",
                            fontWeight: 700,
                            fontSize: 13,
                            color: "#f9fafb",
                            border: pos.ticker?.trim() ? "1px solid transparent" : "1px solid #dc2626",
                            width: 90,
                          }}
                        />
                      </td>

                      {/* Side pill — click to toggle */}
                      <td style={{ padding: "8px 12px" }}>
                        <button
                          onClick={() => toggleSide(i)}
                          style={{
                            padding: "4px 12px",
                            borderRadius: 20,
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: "0.06em",
                            cursor: "pointer",
                            border: "none",
                            background: pos.side === "long" ? "rgba(22, 163, 74, 0.2)" : "rgba(220, 38, 38, 0.2)",
                            color:      pos.side === "long" ? "#86efac"                : "#fca5a5",
                          }}
                        >
                          {pos.side === "long" ? "LONG" : "SHORT"}
                        </button>
                      </td>

                      {/* Weight */}
                      <td style={{ padding: "8px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <input
                            type="number"
                            step="0.01"
                            value={weightPct}
                            onChange={e => updatePosition(i, "weight", e.target.value)}
                            placeholder="10.00"
                            style={{
                              ...cellInput,
                              width: 72,
                              textAlign: "right",
                              fontVariantNumeric: "tabular-nums",
                              border: (pos.weight === "" || isNaN(Number(pos.weight))) ? "1px solid #dc2626" : "1px solid transparent",
                            }}
                          />
                          <span style={{ fontSize: 12, color: "#4b5563" }}>%</span>
                        </div>
                      </td>

                      {/* Beta (only shown after Beta-Adjust) */}
                      {hasBetas && (
                        <td style={{ padding: "8px 12px" }}>
                          <span style={{
                            fontSize: 12,
                            fontVariantNumeric: "tabular-nums",
                            color: beta == null ? "#374151"
                              : beta > 1.5 ? "#fca5a5"
                              : beta < 0.5 ? "#86efac"
                              : "#9ca3af",
                          }}>
                            {beta != null ? beta.toFixed(2) : "—"}
                          </span>
                        </td>
                      )}

                      {/* Remove */}
                      <td style={{ padding: "8px 8px", textAlign: "center" }}>
                        <button
                          onClick={() => removeRow(i)}
                          style={{ background: "none", border: "none", color: "#374151", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px" }}
                          onMouseEnter={e => e.currentTarget.style.color = "#fca5a5"}
                          onMouseLeave={e => e.currentTarget.style.color = "#374151"}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Beta-Adjust note */}
          {betaStatus === "done" && (
            <div style={{ padding: "10px 20px", borderTop: "1px solid #0d1829", fontSize: 12, color: "#4b6a9b" }}>
              Beta-adjusted. Portfolio β = <strong style={{ color: Math.abs(portfolioBeta) < 0.05 ? "#86efac" : "#f59e0b" }}>{portfolioBeta?.toFixed(4)}</strong>. Run the backtest to see updated performance.
            </div>
          )}
          {betaStatus === "error" && (
            <div style={{ padding: "10px 20px", borderTop: "1px solid #7f1d1d", fontSize: 12, color: "#fca5a5" }}>
              Failed to fetch beta data. Check that the backend is running and tickers are valid.
            </div>
          )}
        </div>

        {/* Regime-Adjust panel */}
        <div style={{ background: "#080e1a", border: `1px solid ${regimeAdjust ? "rgba(167,139,250,0.3)" : "#1f2937"}`, borderRadius: 8, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button onClick={() => { setRegimeAdjust(v => !v); clearRegimeComparison(); }} style={regimeAdjust ? btnRegimeActive : btnRegime}>
              ◈ Regime-Adjust
            </button>
            {regimeAdjust && (
              <>
                <span style={{ fontSize: 11, color: "#6b7280" }}>Target β:</span>
                {[
                  { key: "up",      label: "Up",      color: "#86efac" },
                  { key: "ranging", label: "Ranging", color: "#f59e0b" },
                  { key: "down",    label: "Down",    color: "#fca5a5" },
                ].map(({ key, label, color }) => (
                  <label key={key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                    <span style={{ color, fontWeight: 600 }}>{label}</span>
                    <input
                      type="number"
                      step="0.1"
                      min="-1"
                      max="1"
                      value={regimeTargets[key]}
                      onChange={e => { setRegimeTargets(prev => ({ ...prev, [key]: e.target.value })); clearRegimeComparison(); }}
                      style={{ ...cellInput, border: "1px solid #1f2937", width: 58, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                    />
                  </label>
                ))}
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                  {compareStatus === "done" && (
                    <button onClick={clearRegimeComparison} title="Remove overlay" style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px" }}
                      onMouseEnter={e => e.currentTarget.style.color = "#fca5a5"}
                      onMouseLeave={e => e.currentTarget.style.color = "#6b7280"}
                    >×</button>
                  )}
                  <button
                    onClick={compareRegimeAdjusted}
                    disabled={status !== "done" || compareStatus === "loading"}
                    style={status !== "done" || compareStatus === "loading" ? btnDisabled : btnRegimeActive}
                  >
                    {compareStatus === "loading" ? "Comparing…" : compareStatus === "done" ? "↻ Recompare" : "Compare Regime-Adjusted"}
                  </button>
                  {compareStatus === "error" && <span style={{ fontSize: 11, color: "#fca5a5" }}>Failed</span>}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Validation errors */}
        {errors.length > 0 && (
          <div style={{ background: "#1c0a0a", border: "1px solid #7f1d1d", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#fca5a5" }}>
            {errors.map((e, i) => <div key={i}>• {e}</div>)}
          </div>
        )}

        {/* ── Results ─────────────────────────────────────────────────────────── */}
        {result && (
          <>
            {/* Period returns */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              {["3M", "6M", "12M"].map(p => (
                <ReturnCard key={p} label={`${p} Return`} value={result.summary[p]} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: result.summary_regime ? 12 : 24 }}>
              {["3M", "6M", "12M"].map(p => (
                <ReturnCard key={`b-${p}`} label={`${p} S&P 500`} value={result.benchmark_summary[p]} color="#f59e0b" />
              ))}
            </div>
            {result.summary_regime && (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
                {["3M", "6M", "12M"].map(p => (
                  <ReturnCard key={`ra-${p}`} label={`${p} Regime-Adj`} value={result.summary_regime[p]} color="#a78bfa" />
                ))}
              </div>
            )}

            {/* Cumulative chart */}
            <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#9ca3af", letterSpacing: "0.04em" }}>CUMULATIVE PERFORMANCE</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {["3M", "6M", "12M"].map(tf => (
                    <button key={tf} onClick={() => setSelectedTimeframe(tf)} style={selectedTimeframe === tf ? btnPrimary : btnSecondary}>
                      {tf}
                    </button>
                  ))}
                </div>
              </div>
              {chartData && (
                <LineChart dates={chartData.dates} datasets={[
                  { label: "Portfolio",      data: chartData.portfolio,       borderColor: "#60a5fa", backgroundColor: "rgba(96,165,250,0.1)",  borderWidth: 2, pointRadius: 0, tension: 0.25 },
                  { label: "S&P 500 (SPY)",  data: chartData.benchmark,       borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,0.1)",  borderWidth: 2, pointRadius: 0, tension: 0.25 },
                  ...(chartData.regime_adjusted ? [
                    { label: "Regime-Adjusted", data: chartData.regime_adjusted, borderColor: "#a78bfa", backgroundColor: "rgba(167,139,250,0.1)", borderWidth: 2, pointRadius: 0, tension: 0.25 },
                  ] : []),
                ]} />
              )}
            </div>

            {/* Returns table */}
            <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #1f2937", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#9ca3af", letterSpacing: "0.04em" }}>
                  {tableFrequency === "daily" ? "DAILY" : "WEEKLY"} RETURNS
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  {["daily", "weekly"].map(f => (
                    <button key={f} onClick={() => setTableFrequency(f)} style={tableFrequency === f ? btnPrimary : btnSecondary}>
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ maxHeight: 420, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead style={{ position: "sticky", top: 0, background: "#080e1a", zIndex: 1 }}>
                    <tr style={{ borderBottom: "1px solid #0d1829" }}>
                      <Th>Date</Th>
                      <Th>{tableFrequency === "daily" ? "Daily PnL" : "Weekly PnL"}</Th>
                      <Th>Cumulative PnL</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #0d1829" }}
                        onMouseEnter={e => e.currentTarget.style.background = "#0a1628"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        <td style={{ padding: "10px 20px", fontSize: 13, color: "#9ca3af", fontVariantNumeric: "tabular-nums" }}>{row.date}</td>
                        <Td value={row.daily_return} />
                        <Td value={row.cumulative_return} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiCard({ label, value, valueColor = "#f9fafb", loading = false }) {
  return (
    <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 8, padding: "14px 18px", minWidth: 130 }}>
      <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: loading ? "#374151" : valueColor, fontVariantNumeric: "tabular-nums" }}>
        {loading ? "…" : value}
      </div>
    </div>
  );
}

function KpiCardLink({ href, label, value, valueColor, loading }) {
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      <div
        style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 8, padding: "14px 18px", minWidth: 130, cursor: "pointer", transition: "border-color 0.15s" }}
        onMouseEnter={e => e.currentTarget.style.borderColor = "#2d5a8e"}
        onMouseLeave={e => e.currentTarget.style.borderColor = "#1f2937"}
      >
        <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
          {label}
          <span style={{ fontSize: 9, color: "#1e3a5f" }}>↗</span>
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: loading ? "#374151" : (valueColor ?? "#f9fafb"), fontVariantNumeric: "tabular-nums" }}>
          {loading ? "…" : value}
        </div>
      </div>
    </Link>
  );
}

function ReturnCard({ label, value, color = "#f9fafb" }) {
  return (
    <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 8, padding: "14px 18px", minWidth: 130 }}>
      <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
        {value == null ? "—" : `${(value * 100).toFixed(2)}%`}
      </div>
    </div>
  );
}

function Th({ children, style }) {
  return (
    <th style={{ padding: "10px 20px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.07em", ...style }}>
      {children}
    </th>
  );
}

function Td({ value }) {
  const color = value > 0 ? "#86efac" : value < 0 ? "#fca5a5" : "#6b7280";
  return (
    <td style={{ padding: "10px 20px", fontSize: 13, color, fontVariantNumeric: "tabular-nums" }}>
      {(value * 100).toFixed(2)}%
    </td>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const cellInput = {
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: 5,
  padding: "5px 8px",
  fontSize: 13,
  color: "#e5e7eb",
  outline: "none",
  transition: "border-color 0.15s",
};

const btnBase = {
  borderRadius: 6,
  padding: "7px 14px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  transition: "opacity 0.15s",
};
const btnPrimary     = { ...btnBase, background: "#1e3a5f", border: "1px solid #2d5a8e", color: "#93c5fd" };
const btnSecondary   = { ...btnBase, background: "transparent", border: "1px solid #1f2937", color: "#6b7280" };
const btnBeta        = { ...btnBase, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b" };
const btnDisabled    = { ...btnBase, background: "transparent", border: "1px solid #1f2937", color: "#374151", cursor: "default" };
const btnRegime      = { ...btnBase, background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)", color: "#8b7ec8" };
const btnRegimeActive = { ...btnBase, background: "rgba(167,139,250,0.18)", border: "1px solid #a78bfa", color: "#a78bfa" };
