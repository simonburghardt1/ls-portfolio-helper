"use client";

import { useState } from "react";
import LineChart from "../components/LineChart";
import Link from "next/link";

const defaultPositions = [
  {
    "ticker": "MSTR",
    "weight": 0.1,
    "side": "short"
  },
  {
    "ticker": "BMBL",
    "weight": 0.1,
    "side": "short"
  },
  {
    "ticker": "HUBS",
    "weight": 0.1,
    "side": "short"
  },
{
    "ticker": "LLY",
    "weight": 0.1,
    "side": "long"
  },
{
    "ticker": "NBIS",
    "weight": 0.1,
    "side": "long"
  },
{
    "ticker": "ONDS",
    "weight": 0.1,
    "side": "long"
  },
  {
    "ticker": "GPRE",
    "weight": 0.1,
    "side": "long"
  },
  {
    "ticker": "SOFI",
    "weight": 0.1,
    "side": "short"
  },
  {
    "ticker": "DKNG",
    "weight": 0.1,
    "side": "short"
  },
  {
    "ticker": "SEZL",
    "weight": 0.1,
    "side": "long"
  }
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
    updated[index] = {
      ...updated[index],
      [field]: field === "weight" ? Number(value) : value,
    };
    setPositions(updated);
  }

  function addRow() {
    setPositions([
      ...positions,
      { ticker: "", weight: 0, side: "long" },
    ]);
  }

  function removeRow(index) {
    const updated = positions.filter((_, i) => i !== index);
    setPositions(updated);
  }

  function computePortfolioSummary(positions) {
    const cleanPositions = positions.filter((p) => p.ticker && !isNaN(Number(p.weight)));

    const grossExposure = cleanPositions.reduce(
      (sum, p) => sum + Math.abs(Number(p.weight) || 0),
      0
    );

    const netExposure = cleanPositions.reduce((sum, p) => {
      const weight = Number(p.weight) || 0;
      return sum + (p.side === "short" ? -weight : weight);
    }, 0);

    const longCount = cleanPositions.filter((p) => p.side === "long").length;
    const shortCount = cleanPositions.filter((p) => p.side === "short").length;

    return {
      positionCount: cleanPositions.length,
      grossExposure,
      netExposure,
      longCount,
      shortCount,
    };
  }

  function validatePositions(positions) {
    const errors = [];

    positions.forEach((p, index) => {
      if (!p.ticker || !p.ticker.trim()) {
        errors.push(`Row ${index + 1}: ticker is required`);
      }

      if (p.weight === "" || isNaN(Number(p.weight))) {
        errors.push(`Row ${index + 1}: weight must be a number`);
      }

      if (!["long", "short"].includes(p.side)) {
        errors.push(`Row ${index + 1}: side must be long or short`);
      }
    });

    return errors;
  }

  async function runBacktest() {
    try {
      const validationErrors = validatePositions(positions);
      setErrors(validationErrors);

      if (validationErrors.length > 0) {
        setStatus("Validation error");
        return;
      }

      setStatus("Loading...");

      const cleanPositions = positions
        .filter((p) => p.ticker && p.side && p.weight !== 0)
        .map((p) => ({
          ticker: p.ticker.trim().toUpperCase(),
          weight: Number(p.weight),
          side: p.side,
        }));

      const res = await fetch("http://localhost:8000/api/portfolio/backtest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ positions: cleanPositions }),
      });

      const data = await res.json();
      setResult(data);
      setStatus("Done");
    } catch (e) {
      console.error(e);
      setStatus("Error");
    }
  }

  const summary = computePortfolioSummary(positions);


  function timeframeToDays(timeframe) {
    if (timeframe === "3M") return 63;
    if (timeframe === "6M") return 126;
    if (timeframe === "12M") return 252;
    return 252;
  }

  function getFilteredChartData(result, timeframe) {
    if (!result || !result.series) return null;

    const { dates, portfolio, benchmark } = result.series;
    const lookback = timeframeToDays(timeframe);

    const startIndex = Math.max(0, dates.length - lookback);

    const slicedDates = dates.slice(startIndex);
    const slicedPortfolio = portfolio.slice(startIndex);
    const slicedBenchmark = benchmark.slice(startIndex);

    if (slicedPortfolio.length === 0 || slicedBenchmark.length === 0) {
      return null;
    }

    const portfolioBase = slicedPortfolio[0];
    const benchmarkBase = slicedBenchmark[0];

    const rebasedPortfolio = slicedPortfolio.map((v) => ((1 + v) / (1 + portfolioBase) - 1) * 100);
    const rebasedBenchmark = slicedBenchmark.map((v) => ((1 + v) / (1 + benchmarkBase) - 1) * 100);

    return {
      dates: slicedDates,
      portfolio: rebasedPortfolio,
      benchmark: rebasedBenchmark,
    };
  }

  const chartData = getFilteredChartData(result, selectedTimeframe);

  function getTableRows(result, frequency) {
    if (!result || !result.daily) return [];

    if (frequency === "daily") {
      return [...result.daily].reverse();
    }

    if (frequency === "weekly") {
      const rows = result.daily;
      if (rows.length === 0) return [];

      const weeklyRows = [];
      let currentWeek = null;
      let weekStartCum = null;
      let lastRowOfWeek = null;

      for (const row of rows) {
        const date = new Date(row.date);
        const year = date.getUTCFullYear();

        // crude but effective week key
        const startOfYear = new Date(Date.UTC(year, 0, 1));
        const dayDiff = Math.floor((date - startOfYear) / (1000 * 60 * 60 * 24));
        const weekNumber = Math.floor(dayDiff / 7);
        const weekKey = `${year}-${weekNumber}`;

        if (currentWeek === null) {
          currentWeek = weekKey;
          weekStartCum = 0;
          lastRowOfWeek = row;
        } else if (weekKey !== currentWeek) {
          const weeklyReturn =
            ((1 + lastRowOfWeek.cumulative_return) / (1 + weekStartCum)) - 1;

          weeklyRows.push({
            date: lastRowOfWeek.date,
            daily_return: weeklyReturn,
            cumulative_return: lastRowOfWeek.cumulative_return,
          });

          currentWeek = weekKey;
          weekStartCum = lastRowOfWeek.cumulative_return;
          lastRowOfWeek = row;
        } else {
          lastRowOfWeek = row;
        }
      }

      if (lastRowOfWeek) {
        const weeklyReturn =
          ((1 + lastRowOfWeek.cumulative_return) / (1 + weekStartCum)) - 1;

        weeklyRows.push({
          date: lastRowOfWeek.date,
          daily_return: weeklyReturn,
          cumulative_return: lastRowOfWeek.cumulative_return,
        });
      }

      return weeklyRows.reverse();
    }

    return [];
  }

  const tableRows = getTableRows(result, tableFrequency);


  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#020617",
        color: "#e5e7eb",
        padding: 24,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1300, margin: "0 auto" }}>
        <div style={{ marginBottom: 20 }}>
          <Link href="/" style={{ color: "#93c5fd", textDecoration: "none" }}>
            ← Back to macro dashboard
          </Link>
        </div>

        <h1 style={{ marginBottom: 8 }}>Portfolio Backtester</h1>
        <p style={{ color: "#9ca3af", marginBottom: 20 }}>
          Build a simple long/short portfolio and backtest its historical performance.
        </p>

        <section
          style={{
            marginBottom: 24,
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <SummaryCard label="Positions" value={summary.positionCount} />
          <SummaryCard
            label="Gross Exposure"
            value={`${(summary.grossExposure * 100).toFixed(1)}%`}
          />
          <SummaryCard
            label="Net Exposure"
            value={`${(summary.netExposure * 100).toFixed(1)}%`}
            valueColor={
              summary.netExposure > 0
                ? "#86efac"
                : summary.netExposure < 0
                ? "#fca5a5"
                : "#e5e7eb"
            }
          />
          <SummaryCard label="Longs" value={summary.longCount} />
          <SummaryCard label="Shorts" value={summary.shortCount} />
        </section>

        <section
          style={{
            background: "#0f172a",
            border: "1px solid #1f2937",
            borderRadius: 20,
            padding: 20,
          }}
        >
          <h2 style={{ marginTop: 0 }}>Positions</h2>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                marginTop: 12,
              }}
            >
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
                      <input
                        value={pos.ticker}
                        onChange={(e) =>
                          updatePosition(index, "ticker", e.target.value)
                        }
                        placeholder="AAPL"
                        style={{inputStyle, border: !pos.ticker || !pos.ticker.trim()
                              ? "1px solid #dc2626"
                              : inputStyle.border,
                        }}
                      />
                    </td>
                    <td style={{ padding: "12px" }}>
                      <input
                        type="number"
                        step="0.01"
                        value={pos.weight}
                        onChange={(e) =>
                          updatePosition(index, "weight", e.target.value)
                        }
                        placeholder="0.10"
                            style={{inputStyle, border:
                              pos.weight === "" || isNaN(Number(pos.weight))
                                ? "1px solid #dc2626"
                                : inputStyle.border,
                          }}
                      />
                    </td>
                    <td style={{ padding: "12px" }}>
                      <select
                        value={pos.side}
                        onChange={(e) =>
                          updatePosition(index, "side", e.target.value)
                        }
                        style={inputStyle}
                      >
                        <option value="long">long</option>
                        <option value="short">short</option>
                      </select>
                    </td>
                    <td style={{ padding: "12px" }}>
                      <button
                        onClick={() => removeRow(index)}
                        style={dangerButtonStyle}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            style={{
              marginTop: 18,
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <button onClick={addRow} style={secondaryButtonStyle}>
              + Add Position
            </button>

            <button onClick={runBacktest} style={primaryButtonStyle}>
              Run Backtest
            </button>

            {errors.length > 0 && (
              <div
                style={{
                  marginTop: 16,
                  background: "#3f1d1d",
                  border: "1px solid #7f1d1d",
                  color: "#fecaca",
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Please fix:</div>
                {errors.map((err, idx) => (
                  <div key={idx} style={{ fontSize: 14, marginBottom: 4 }}>
                    • {err}
                  </div>
                ))}
              </div>
            )}

            <div style={{ color: "#9ca3af" }}>{status}</div>
          </div>
        </section>

        {result && (
          <>
            <section
              style={{
                marginTop: 24,
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              {["3M", "6M", "12M"].map((period) => (
                <div
                  key={period}
                  style={{
                    background: "#0f172a",
                    border: "1px solid #1f2937",
                    borderRadius: 16,
                    padding: 18,
                    minWidth: 160,
                  }}
                >
                  <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8 }}>
                    {period} Return
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>
                    {result.summary[period] == null
                      ? "--"
                      : `${(result.summary[period] * 100).toFixed(2)}%`}
                  </div>
                </div>
              ))}
            </section>

            <section
              style={{
                marginTop: 16,
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              {["3M", "6M", "12M"].map((period) => (
                <div
                  key={`benchmark-${period}`}
                  style={{
                    background: "#0f172a",
                    border: "1px solid #1f2937",
                    borderRadius: 16,
                    padding: 18,
                    minWidth: 160,
                  }}
                >
                  <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8 }}>
                    {period} S&P 500
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#f59e0b" }}>
                    {result.benchmark_summary[period] == null
                      ? "--"
                      : `${(result.benchmark_summary[period] * 100).toFixed(2)}%`}
                  </div>
                </div>
              ))}
            </section>

            <section
              style={{
                marginTop: 24,
                background: "#0f172a",
                border: "1px solid #1f2937",
                borderRadius: 20,
                padding: 22,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 16,
                }}
              >
                <h2 style={{ margin: 0 }}>Cumulative Performance</h2>

                <div style={{ display: "flex", gap: 8 }}>
                  {["3M", "6M", "12M"].map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setSelectedTimeframe(tf)}
                      style={{
                        background: selectedTimeframe === tf ? "#2563eb" : "#020617",
                        color: "white",
                        border: "1px solid #374151",
                        borderRadius: 10,
                        padding: "8px 12px",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>

              {chartData && (
                <LineChart
                  dates={chartData.dates}
                  datasets={[
                    {
                      label: "Portfolio",
                      data: chartData.portfolio,
                      borderColor: "#60a5fa",
                      backgroundColor: "rgba(96,165,250,0.2)",
                      borderWidth: 2,
                      pointRadius: 0,
                      tension: 0.25,
                    },
                    {
                      label: "S&P 500 (SPY)",
                      data: chartData.benchmark,
                      borderColor: "#f59e0b",
                      backgroundColor: "rgba(245,158,11,0.2)",
                      borderWidth: 2,
                      pointRadius: 0,
                      tension: 0.25,
                    },
                  ]}
                />
              )}
            </section>

            <section
              style={{
                marginTop: 24,
                background: "#0f172a",
                border: "1px solid #1f2937",
                borderRadius: 20,
                padding: 22,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 16,
                }}
              >
                <h2 style={{ margin: 0 }}>
                  {tableFrequency === "daily" ? "Daily Portfolio Returns" : "Weekly Portfolio Returns"}
                </h2>

                <div style={{ display: "flex", gap: 8 }}>
                  {["daily", "weekly"].map((freq) => (
                    <button
                      key={freq}
                      onClick={() => setTableFrequency(freq)}
                      style={{
                        background: tableFrequency === freq ? "#2563eb" : "#020617",
                        color: "white",
                        border: "1px solid #374151",
                        borderRadius: 10,
                        padding: "8px 12px",
                        cursor: "pointer",
                        fontWeight: 600,
                        textTransform: "capitalize",
                      }}
                    >
                      {freq}
                    </button>
                  ))}
                </div>
              </div>

              <div
                style={{
                  overflowX: "auto",
                  maxHeight: 420,
                  overflowY: "auto",
                  border: "1px solid #1f2937",
                  borderRadius: 12,
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                  }}
                >
                  <thead
                    style={{
                      position: "sticky",
                      top: 0,
                      background: "#111827",
                      zIndex: 1,
                    }}
                  >
                    <tr style={{ textAlign: "left", color: "#9ca3af" }}>
                      <th style={tableHeaderStyle}>Date</th>
                      <th style={tableHeaderStyle}>
                        {tableFrequency === "daily" ? "Daily PnL" : "Weekly PnL"}
                      </th>
                      <th style={tableHeaderStyle}>Cumulative PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, index) => (
                      <tr
                        key={index}
                        style={{
                          borderTop: "1px solid #1f2937",
                        }}
                      >
                        <td style={tableCellStyle}>{row.date}</td>
                        <td
                          style={{
                            ...tableCellStyle,
                            color:
                              row.daily_return > 0
                                ? "#86efac"
                                : row.daily_return < 0
                                ? "#fca5a5"
                                : "#e5e7eb",
                          }}
                        >
                          {(row.daily_return * 100).toFixed(2)}%
                        </td>
                        <td
                          style={{
                            ...tableCellStyle,
                            color:
                              row.cumulative_return > 0
                                ? "#86efac"
                                : row.cumulative_return < 0
                                ? "#fca5a5"
                                : "#e5e7eb",
                          }}
                        >
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
    </main>
  );
}

function SummaryCard({ label, value, valueColor = "#e5e7eb" }) {
  return (
    <div
      style={{
        background: "#0f172a",
        border: "1px solid #1f2937",
        borderRadius: 16,
        padding: 18,
        minWidth: 160,
      }}
    >
      <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: valueColor }}>
        {value}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  background: "#020617",
  color: "#e5e7eb",
  border: "1px solid #374151",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 14,
};

const primaryButtonStyle = {
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: 10,
  padding: "10px 16px",
  cursor: "pointer",
  fontWeight: 600,
};

const secondaryButtonStyle = {
  background: "#1e293b",
  color: "white",
  border: "1px solid #374151",
  borderRadius: 10,
  padding: "10px 16px",
  cursor: "pointer",
  fontWeight: 600,
};

const dangerButtonStyle = {
  background: "#3f1d1d",
  color: "#fecaca",
  border: "1px solid #7f1d1d",
  borderRadius: 10,
  padding: "8px 12px",
  cursor: "pointer",
  fontWeight: 600,
};

const tableHeaderStyle = {
  padding: "12px 14px",
  fontSize: 13,
};

const tableCellStyle = {
  padding: "12px 14px",
  fontSize: 14,
};