"use client";

import { useEffect, useState } from "react";
import KpiCard from "@/app/components/KpiCard";
import LineChart from "@/app/components/LineChart";

const KPI_GROUPS = ["Yields", "Inflation", "Employment"];

function getVisibleRange(button) {
  if (button === "MAX") return null;
  const to = new Date().toISOString().split("T")[0];
  const from = new Date();
  from.setFullYear(from.getFullYear() - (button === "1Y" ? 1 : button === "5Y" ? 5 : 10));
  return { from: from.toISOString().split("T")[0], to };
}

export default function Page() {
  const [kpis, setKpis] = useState([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState("US_CPI_YOY");
  const [chartSeries, setChartSeries] = useState(null);
  const [status, setStatus] = useState("Loading...");
  const [selectedRange, setSelectedRange] = useState("5Y");
  const [visibleRange, setVisibleRange] = useState(() => getVisibleRange("5Y"));

  async function loadKpis() {
    const res = await fetch("http://localhost:8000/api/macro/kpis");
    const data = await res.json();
    setKpis(data.kpis || []);
  }

  async function loadSeries(seriesId) {
    const res = await fetch(`http://localhost:8000/api/macro/series/${seriesId}?range=MAX`);
    const data = await res.json();
    setChartSeries(data);
  }

  async function loadData(seriesId = selectedSeriesId) {
    try {
      setStatus("Loading...");
      await Promise.all([loadKpis(), loadSeries(seriesId)]);
      setStatus("Live");
    } catch (e) {
      console.error(e);
      setStatus("Error");
    }
  }

  useEffect(() => { loadData(selectedSeriesId); }, []);

  async function handleCardClick(seriesId) {
    setSelectedSeriesId(seriesId);
    try {
      await loadSeries(seriesId);
    } catch (e) {
      console.error(e);
    }
  }

  function handleRangeClick(range) {
    setSelectedRange(range);
    setVisibleRange(getVisibleRange(range));
  }

  const grouped = KPI_GROUPS.map((g) => ({
    label: g,
    kpis: kpis.filter((k) => k.group === g),
  }));

  return (
    <div style={{ color: "#e5e7eb", fontFamily: "Arial, sans-serif" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "28px 24px 40px" }}>

        {/* Header */}
        <header style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 28, paddingBottom: 18, borderBottom: "1px solid #1f2937",
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>Macro Dashboard</h1>
            <div style={{ marginTop: 6, color: "#9ca3af", fontSize: 14 }}>FRED data · Leading & concurrent indicators</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={() => loadData(selectedSeriesId)}
              style={{ background: "#2563eb", color: "white", border: "none", borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontWeight: 600 }}
            >
              Refresh
            </button>
            <div style={{
              fontSize: 14, color: status === "Live" ? "#86efac" : status === "Loading..." ? "#fcd34d" : "#fca5a5",
              background: "#0f172a", border: "1px solid #374151", padding: "10px 14px", borderRadius: 10,
            }}>
              {status}
            </div>
          </div>
        </header>

        {/* KPI Groups */}
        {grouped.map(({ label, kpis: groupKpis }) => (
          <section key={label} style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#3b4c6b", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
              {label}
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {groupKpis.map((k) => (
                <KpiCard
                  key={k.id}
                  id={k.id}
                  name={k.name}
                  value={k.value}
                  unit={k.unit}
                  change={k.change}
                  good_direction={k.good_direction}
                  onClick={handleCardClick}
                  isSelected={selectedSeriesId === k.id}
                />
              ))}
            </div>
          </section>
        ))}

        {/* Chart */}
        <section style={{
          marginTop: 12, background: "#0f172a", border: "1px solid #1f2937",
          borderRadius: 20, padding: 22, boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Selected Series</div>
              <h2 style={{ margin: 0, fontSize: 22 }}>{chartSeries ? chartSeries.name : "—"}</h2>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {["1Y", "5Y", "10Y", "MAX"].map((range) => (
                <button key={range} onClick={() => handleRangeClick(range)} style={{
                  background: selectedRange === range ? "#2563eb" : "#020617",
                  color: "white", border: "1px solid #374151", borderRadius: 8,
                  padding: "6px 12px", cursor: "pointer", fontSize: 13,
                }}>
                  {range}
                </button>
              ))}
              {chartSeries?.values?.length > 0 && (
                <div style={{ background: "#020617", border: "1px solid #374151", borderRadius: 10, padding: "8px 14px" }}>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>Latest</div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>
                    {Number(chartSeries.values.at(-1)).toFixed(2)}
                    <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 4 }}>{chartSeries.unit}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {chartSeries ? (
            <LineChart
              dates={chartSeries.dates}
              visibleRange={visibleRange}
              datasets={[{
                label: chartSeries.name,
                data: chartSeries.values,
                borderColor: "#3b82f6",
                borderWidth: 2,
              }]}
            />
          ) : (
            <div style={{ color: "#9ca3af", height: 380, display: "flex", alignItems: "center", justifyContent: "center" }}>
              Loading chart...
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
