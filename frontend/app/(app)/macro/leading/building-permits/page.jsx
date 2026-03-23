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

function rangeFrom(years) {
  if (!years) return null;
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);
  return { from: from.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };
}

export default function BuildingPermitsPage() {
  const [series, setSeries]   = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [range, setRange]     = useState("20Y");

  useEffect(() => {
    fetch(`${API}/api/building-permits/series`)
      .then((r) => r.json())
      .then((d) => { setSeries(d.series ?? {}); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  const datasets = Object.values(series).map((s) => ({
    dates:       s.dates,
    data:        s.values,
    borderColor: s.color,
    borderWidth: 2,
    label:       s.label,
  }));

  const visibleRange = rangeFrom(RANGES.find((r) => r.label === range)?.years);
  const hasData = datasets.length > 0;

  return (
    <div style={{ color: "#e5e7eb", maxWidth: 1000, margin: "0 auto", padding: "28px 24px" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#e5e7eb", marginBottom: 4 }}>
          US Building Permits
        </h1>
        <p style={{ color: "#6b7280", fontSize: 13 }}>
          US Census Bureau — Thousands of units, seasonally adjusted annual rate
        </p>
      </div>

      {loading && <div style={{ color: "#4b5563", fontSize: 14 }}>Loading…</div>}
      {error   && <div style={{ color: "#f87171", fontSize: 14 }}>Error: {error}</div>}

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
                  color:      range === r.label ? "#93c5fd" : "#6b7280",
                }}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Chart */}
          <div style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 12, padding: "16px 8px 8px" }}>
            <LineChart dates={null} datasets={datasets} visibleRange={visibleRange} />
          </div>

          {/* Latest value cards */}
          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {Object.values(series).map((s) => {
              const latest = s.values[s.values.length - 1];
              const prev   = s.values[s.values.length - 2];
              const diff   = latest != null && prev != null ? latest - prev : null;
              return (
                <div key={s.label} style={{
                  background: "#0f172a", border: "1px solid #1f2937",
                  borderRadius: 10, padding: "12px 16px", flex: "1 1 180px",
                  borderTop: `2px solid ${s.color}`,
                }}>
                  <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#e5e7eb" }}>
                    {latest != null ? latest.toFixed(0) : "—"}
                    <span style={{ fontSize: 12, color: "#4b5563", fontWeight: 400, marginLeft: 4 }}>K</span>
                  </div>
                  {diff != null && (
                    <div style={{ fontSize: 12, color: diff >= 0 ? "#4ade80" : "#f87171", marginTop: 2 }}>
                      {diff >= 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(0)} MoM
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
