"use client";

import { useEffect, useState } from "react";
import LineChart from "@/app/components/LineChart";

const API = "http://localhost:8000";

const RANGES = [
  { label: "5Y",  years: 5 },
  { label: "10Y", years: 10 },
  { label: "20Y", years: 20 },
  { label: "All", years: null },
];

/** Linear regression trend line dataset for a single series. */
function trendLine(dates, values, color) {
  if (!dates || dates.length < 10) return null;

  const n = dates.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX  += i;
    sumY  += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;

  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  return {
    dates:            [dates[0], dates[n - 1]],
    data:             [intercept, intercept + slope * (n - 1)],
    borderColor:      color,
    borderWidth:      1,
    lineStyle:        2,    // dashed
    lastValueVisible: false,
    label:            "",
  };
}

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

export default function ConsumerConfidencePage() {
  const [series, setSeries]         = useState({});
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [range, setRange]           = useState("20Y");
  useEffect(() => {
    fetch(`${API}/api/consumer-confidence/series`)
      .then((r) => r.json())
      .then((d) => { setSeries(d.series ?? {}); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  const seriesDatasets = Object.values(series).map((s) => ({
    dates:       s.dates,
    data:        s.values,
    borderColor: s.color,
    borderWidth: 2,
    label:       s.label,
  }));

  const trendDatasets = Object.values(series)
    .map((s) => trendLine(s.dates, s.values, s.color))
    .filter(Boolean);

  const datasets = [...seriesDatasets, ...trendDatasets];

  const visibleRange = rangeFrom(RANGES.find((r) => r.label === range)?.years);
  const hasData = datasets.length > 0;

  return (
    <div style={{ color: "#e5e7eb", maxWidth: 1000, margin: "0 auto", padding: "28px 24px" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#e5e7eb", marginBottom: 4 }}>
          Consumer Confidence
        </h1>
        <p style={{ color: "#6b7280", fontSize: 13 }}>
          University of Michigan Survey of Consumers — Index 1966:Q1=100
        </p>
      </div>

      {loading && <div style={{ color: "#4b5563", fontSize: 14 }}>Loading…</div>}
      {error   && <div style={{ color: "#f87171", fontSize: 14 }}>Error: {error}</div>}

      {!loading && !error && !hasData && (
        <div style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 12, padding: "32px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 14, color: "#6b7280", marginBottom: 8 }}>No data available.</div>
          <div style={{ fontSize: 13, color: "#4b5563" }}>
            Current Conditions and Expectations data can be imported via{" "}
            <span style={{ color: "#3b82f6" }}>Admin → Consumer Confidence Import</span>.
          </div>
        </div>
      )}

      {!loading && hasData && (
        <>
          {/* Legend + range */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", gap: 16 }}>
              {Object.values(series).map((s) => (
                <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 24, height: 3, background: s.color, borderRadius: 2 }} />
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>{s.label}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {RANGES.map((r) => (
                <button key={r.label} onClick={() => setRange(r.label)} style={{
                  padding: "3px 10px", borderRadius: 5, fontSize: 12, cursor: "pointer",
                  border: "1px solid #374151",
                  background: range === r.label ? "#1e3a5f" : "transparent",
                  color: range === r.label ? "#93c5fd" : "#6b7280",
                }}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Chart */}
          <div style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 12, padding: "16px 8px 8px" }}>
            <LineChart dates={null} datasets={datasets} visibleRange={visibleRange} referenceLine={85} />
          </div>

          {/* Latest values */}
          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {Object.values(series).map((s) => {
              const latest = s.values[s.values.length - 1];
              const prev   = s.values[s.values.length - 2];
              const diff   = latest != null && prev != null ? latest - prev : null;
              return (
                <div key={s.label} style={{
                  background: "#0f172a", border: "1px solid #1f2937",
                  borderRadius: 10, padding: "12px 16px", flex: "1 1 160px",
                  borderTop: `2px solid ${s.color}`,
                }}>
                  <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#e5e7eb" }}>
                    {latest?.toFixed(1) ?? "—"}
                  </div>
                  {diff != null && (
                    <div style={{ fontSize: 12, color: diff >= 0 ? "#4ade80" : "#f87171", marginTop: 2 }}>
                      {diff >= 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(1)} MoM
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: "#374151", marginTop: 2 }}>
                    {s.dates[s.dates.length - 1]}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
