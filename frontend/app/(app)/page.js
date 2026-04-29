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

  const statusColor = status === "Live" ? "var(--positive)" : status === "Loading..." ? "var(--caution)" : "var(--negative)";

  return (
    <div style={{ color: "var(--text-primary)" }}>
      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "32px 36px 48px" }}>

        {/* Header */}
        <header style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 32, paddingBottom: 20, borderBottom: "1px solid var(--border)",
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "var(--font-xl)", fontWeight: 700, color: "var(--text-primary)" }}>
              Macro Dashboard
            </h1>
            <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: "var(--font-base)" }}>
              FRED data · Leading &amp; concurrent indicators
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={() => loadData(selectedSeriesId)}
              style={{
                background: "var(--green-900)", color: "var(--green-400)",
                border: "1px solid var(--green-muted)", borderRadius: "var(--radius-sm)",
                padding: "8px 16px", cursor: "pointer", fontWeight: 600, fontSize: "var(--font-base)",
              }}
            >
              Refresh
            </button>
            <div style={{
              fontSize: "var(--font-base)", color: statusColor,
              background: "var(--bg-elevated)", border: "1px solid var(--border)",
              padding: "8px 14px", borderRadius: "var(--radius-sm)",
            }}>
              {status}
            </div>
          </div>
        </header>

        {/* KPI Groups */}
        {grouped.map(({ label, kpis: groupKpis }) => (
          <section key={label} style={{ marginBottom: 24 }}>
            <div style={{
              fontSize: "var(--font-sm)", fontWeight: 600, color: "var(--text-ghost)",
              letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10,
            }}>
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
          marginTop: 12, background: "var(--bg-surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)", padding: 24,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "var(--font-sm)", color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
                Selected Series
              </div>
              <h2 style={{ margin: 0, fontSize: "var(--font-xl)", fontWeight: 700, color: "var(--text-primary)" }}>
                {chartSeries ? chartSeries.name : "—"}
              </h2>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {["1Y", "5Y", "10Y", "MAX"].map((range) => (
                <button key={range} onClick={() => handleRangeClick(range)} style={{
                  background: selectedRange === range ? "var(--green-900)" : "transparent",
                  color: selectedRange === range ? "var(--green-400)" : "var(--text-muted)",
                  border: `1px solid ${selectedRange === range ? "var(--green-muted)" : "var(--border)"}`,
                  borderRadius: "var(--radius-sm)", padding: "6px 12px",
                  cursor: "pointer", fontSize: "var(--font-base)", fontWeight: 500,
                }}>
                  {range}
                </button>
              ))}
              {chartSeries?.values?.length > 0 && (
                <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 14px" }}>
                  <div style={{ fontSize: "var(--font-sm)", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>Latest</div>
                  <div style={{ fontSize: "var(--font-lg)", fontWeight: 600, color: "var(--text-primary)", marginTop: 2 }}>
                    {Number(chartSeries.values.at(-1)).toFixed(2)}
                    <span style={{ fontSize: "var(--font-sm)", color: "var(--text-secondary)", marginLeft: 4 }}>{chartSeries.unit}</span>
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
                borderColor: "var(--green-500)",
                borderWidth: 2,
              }]}
            />
          ) : (
            <div style={{ color: "var(--text-muted)", height: 380, display: "flex", alignItems: "center", justifyContent: "center" }}>
              Loading chart...
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
