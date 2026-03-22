"use client";

import { useState } from "react";
import LineChart from "@/app/components/LineChart";

const defaultPositions = [
  { ticker: "MSTR", weight: 0.1, side: "short" },
  { ticker: "BMBL", weight: 0.1, side: "short" },
  { ticker: "HUBS", weight: 0.1, side: "short" },
  { ticker: "LLY",  weight: 0.1, side: "long"  },
  { ticker: "NBIS", weight: 0.1, side: "long"  },
  { ticker: "ONDS", weight: 0.1, side: "long"  },
  { ticker: "GPRE", weight: 0.1, side: "long"  },
  { ticker: "SOFI", weight: 0.1, side: "short" },
  { ticker: "DKNG", weight: 0.1, side: "short" },
  { ticker: "SEZL", weight: 0.1, side: "long"  },
];

export default function PortfolioPage() {
  const [positions, setPositions] = useState(defaultPositions);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("Idle");
  const [errors, setErrors] = useState([]);
  const [selectedTimeframe, setSelectedTimeframe] = useState("12M");
  const [tableFrequency, setTableFrequency] = useState("daily");

  function updatePosition(index, field, value) {
    const updated = [...positions];
    updated[index] = { ...updated[index], [field]: field === "weight" ? Number(value) : value };
    setPositions(updated);
  }

  function addRow() {
    setPositions([...positions, { ticker: "", weight: 0, side: "long" }]);
  }

  function removeRow(index) {
    setPositions(positions.filter((_, i) => i !== index));
  }

  function computePortfolioSummary(positions) {
    const clean = positions.filter((p) => p.ticker && !isNaN(Number(p.weight)));
    return {
      positionCount: clean.length,
      grossExposure: clean.reduce((s, p) => s + Math.abs(Number(p.weight) || 0), 0),
      netExposure: clean.reduce((s, p) => s + (p.side === "short" ? -1 : 1) * (Number(p.weight) || 0), 0),
      longCount: clean.filter((p) => p.side === "long").length,
      shortCount: clean.filter((p) => p.side === "short").length,
    };
  }

  function validatePositions(positions) {
    const errors = [];
    positions.forEach((p, i) => {
      if (!p.ticker?.trim()) errors.push(`Row ${i + 1}: ticker is required`);
      if (p.weight === "" || isNaN(Number(p.weight))) errors.push(`Row ${i + 1}: weight must be a number`);
      if (!["long", "short"].includes(p.side)) errors.push(`Row ${i + 1}: side must be long or short`);
    });
    return errors;
  }

  async function runBacktest() {
    const validationErrors = validatePositions(positions);
    setErrors(validationErrors);
    if (validationErrors.length > 0) { setStatus("Validation error"); return; }

    setStatus("Loading...");
    try {
      const clean = positions
        .filter((p) => p.ticker && p.side && p.weight !== 0)
        .map((p) => ({ ticker: p.ticker.trim().toUpperCase(), weight: Number(p.weight), side: p.side }));

      const res = await fetch("http://localhost:8000/api/portfolio/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions: clean }),
      });
      setResult(await res.json());
      setStatus("Done");
    } catch (e) {
      console.error(e);
      setStatus("Error");
    }
  }

  function getFilteredChartData(result, timeframe) {
    if (!result?.series) return null;
    const { dates, portfolio, benchmark } = result.series;
    const days = timeframe === "3M" ? 63 : timeframe === "6M" ? 126 : 252;
    const start = Math.max(0, dates.length - days);
    const d = dates.slice(start), p = portfolio.slice(start), b = benchmark.slice(start);
    if (!p.length || !b.length) return null;
    return {
      dates: d,
      portfolio: p.map((v) => ((1 + v) / (1 + p[0]) - 1) * 100),
      benchmark: b.map((v) => ((1 + v) / (1 + b[0]) - 1) * 100),
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

  const summary = computePortfolioSummary(positions);
  const chartData = getFilteredChartData(result, selectedTimeframe);
  const tableRows = getTableRows(result, tableFrequency);

  return (
    <div style={{ color: "#e5e7eb", fontFamily: "Arial, sans-serif" }}>
      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "28px 24px 40px 24px" }}>
        <h1 style={{ marginBottom: 8 }}>Portfolio Backtester</h1>
        <p style={{ color: "#9ca3af", marginBottom: 20 }}>
          Build a long/short portfolio and backtest its historical performance.
        </p>

        <section style={{ marginBottom: 24, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <SummaryCard label="Positions" value={summary.positionCount} />
          <SummaryCard label="Gross Exposure" value={`${(summary.grossExposure * 100).toFixed(1)}%`} />
          <SummaryCard label="Net Exposure" value={`${(summary.netExposure * 100).toFixed(1)}%`}
            valueColor={summary.netExposure > 0 ? "#86efac" : summary.netExposure < 0 ? "#fca5a5" : "#e5e7eb"} />
          <SummaryCard label="Longs" value={summary.longCount} />
          <SummaryCard label="Shorts" value={summary.shortCount} />
        </section>

        <section style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 20, padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Positions</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#9ca3af" }}>
                  <th style={{ padding: "10px 12px" }}>Ticker</th>
                  <th style={{ padding: "10px 12px" }}>Weight</th>
                  <th style={{ padding: "10px 12px" }}>Side</th>
                  <th style={{ padding: "10px 12px" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos, index) => (
                  <tr key={index} style={{ borderTop: "1px solid #1f2937" }}>
                    <td style={{ padding: "12px" }}>
                      <input value={pos.ticker} onChange={(e) => updatePosition(index, "ticker", e.target.value)}
                        placeholder="AAPL" style={{ ...inputStyle, border: !pos.ticker?.trim() ? "1px solid #dc2626" : inputStyle.border }} />
                    </td>
                    <td style={{ padding: "12px" }}>
                      <input type="number" step="0.01" value={pos.weight} onChange={(e) => updatePosition(index, "weight", e.target.value)}
                        placeholder="0.10" style={{ ...inputStyle, border: pos.weight === "" || isNaN(Number(pos.weight)) ? "1px solid #dc2626" : inputStyle.border }} />
                    </td>
                    <td style={{ padding: "12px" }}>
                      <select value={pos.side} onChange={(e) => updatePosition(index, "side", e.target.value)} style={inputStyle}>
                        <option value="long">long</option>
                        <option value="short">short</option>
                      </select>
                    </td>
                    <td style={{ padding: "12px" }}>
                      <button onClick={() => removeRow(index)} style={dangerButtonStyle}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 18, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={addRow} style={secondaryButtonStyle}>+ Add Position</button>
            <button onClick={runBacktest} style={primaryButtonStyle}>Run Backtest</button>
            {errors.length > 0 && (
              <div style={{ marginTop: 16, background: "#3f1d1d", border: "1px solid #7f1d1d", color: "#fecaca", borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Please fix:</div>
                {errors.map((err, i) => <div key={i} style={{ fontSize: 14, marginBottom: 4 }}>• {err}</div>)}
              </div>
            )}
            <div style={{ color: "#9ca3af" }}>{status}</div>
          </div>
        </section>

        {result && (
          <>
            <section style={{ marginTop: 24, display: "flex", gap: 16, flexWrap: "wrap" }}>
              {["3M", "6M", "12M"].map((p) => (
                <div key={p} style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 16, padding: 18, minWidth: 160 }}>
                  <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8 }}>{p} Return</div>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>
                    {result.summary[p] == null ? "--" : `${(result.summary[p] * 100).toFixed(2)}%`}
                  </div>
                </div>
              ))}
            </section>
            <section style={{ marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
              {["3M", "6M", "12M"].map((p) => (
                <div key={`b-${p}`} style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 16, padding: 18, minWidth: 160 }}>
                  <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8 }}>{p} S&P 500</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#f59e0b" }}>
                    {result.benchmark_summary[p] == null ? "--" : `${(result.benchmark_summary[p] * 100).toFixed(2)}%`}
                  </div>
                </div>
              ))}
            </section>

            <section style={{ marginTop: 24, background: "#0f172a", border: "1px solid #1f2937", borderRadius: 20, padding: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <h2 style={{ margin: 0 }}>Cumulative Performance</h2>
                <div style={{ display: "flex", gap: 8 }}>
                  {["3M", "6M", "12M"].map((tf) => (
                    <button key={tf} onClick={() => setSelectedTimeframe(tf)} style={{ background: selectedTimeframe === tf ? "#2563eb" : "#020617", color: "white", border: "1px solid #374151", borderRadius: 10, padding: "8px 12px", cursor: "pointer", fontWeight: 600 }}>
                      {tf}
                    </button>
                  ))}
                </div>
              </div>
              {chartData && (
                <LineChart dates={chartData.dates} datasets={[
                  { label: "Portfolio", data: chartData.portfolio, borderColor: "#60a5fa", backgroundColor: "rgba(96,165,250,0.2)", borderWidth: 2, pointRadius: 0, tension: 0.25 },
                  { label: "S&P 500 (SPY)", data: chartData.benchmark, borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,0.2)", borderWidth: 2, pointRadius: 0, tension: 0.25 },
                ]} />
              )}
            </section>

            <section style={{ marginTop: 24, background: "#0f172a", border: "1px solid #1f2937", borderRadius: 20, padding: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <h2 style={{ margin: 0 }}>{tableFrequency === "daily" ? "Daily" : "Weekly"} Portfolio Returns</h2>
                <div style={{ display: "flex", gap: 8 }}>
                  {["daily", "weekly"].map((freq) => (
                    <button key={freq} onClick={() => setTableFrequency(freq)} style={{ background: tableFrequency === freq ? "#2563eb" : "#020617", color: "white", border: "1px solid #374151", borderRadius: 10, padding: "8px 12px", cursor: "pointer", fontWeight: 600, textTransform: "capitalize" }}>
                      {freq}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto", border: "1px solid #1f2937", borderRadius: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead style={{ position: "sticky", top: 0, background: "#111827", zIndex: 1 }}>
                    <tr style={{ textAlign: "left", color: "#9ca3af" }}>
                      <th style={{ padding: "12px 14px", fontSize: 13 }}>Date</th>
                      <th style={{ padding: "12px 14px", fontSize: 13 }}>{tableFrequency === "daily" ? "Daily PnL" : "Weekly PnL"}</th>
                      <th style={{ padding: "12px 14px", fontSize: 13 }}>Cumulative PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #1f2937" }}>
                        <td style={{ padding: "12px 14px", fontSize: 14 }}>{row.date}</td>
                        <td style={{ padding: "12px 14px", fontSize: 14, color: row.daily_return > 0 ? "#86efac" : row.daily_return < 0 ? "#fca5a5" : "#e5e7eb" }}>
                          {(row.daily_return * 100).toFixed(2)}%
                        </td>
                        <td style={{ padding: "12px 14px", fontSize: 14, color: row.cumulative_return > 0 ? "#86efac" : row.cumulative_return < 0 ? "#fca5a5" : "#e5e7eb" }}>
                          {(row.cumulative_return * 100).toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, valueColor = "#e5e7eb" }) {
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 16, padding: 18, minWidth: 160 }}>
      <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: valueColor }}>{value}</div>
    </div>
  );
}

const inputStyle = { width: "100%", background: "#020617", color: "#e5e7eb", border: "1px solid #374151", borderRadius: 10, padding: "10px 12px", fontSize: 14 };
const primaryButtonStyle = { background: "#2563eb", color: "white", border: "none", borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontWeight: 600 };
const secondaryButtonStyle = { background: "#1e293b", color: "white", border: "1px solid #374151", borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontWeight: 600 };
const dangerButtonStyle = { background: "#3f1d1d", color: "#fecaca", border: "1px solid #7f1d1d", borderRadius: 10, padding: "8px 12px", cursor: "pointer", fontWeight: 600 };
