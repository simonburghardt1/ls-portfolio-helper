"use client";

import { useEffect, useState } from "react";
import KpiCard from "./components/KpiCard";
import LineChart from "./components/LineChart";
import Link from "next/link";
import { useRequireAuth } from "./hooks/useRequireAuth";
import { useAuthStore } from "./store/authStore";
import { useRouter } from "next/navigation";

export default function Page() {
  const { isAuthenticated, user } = useRequireAuth();
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();

  const [kpis, setKpis] = useState([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState("US_CPI_YOY");
  const [chartSeries, setChartSeries] = useState(null);
  const [status, setStatus] = useState("Loading...");
  const [selectedRange, setSelectedRange] = useState("MAX");

  async function loadKpis() {
    const res = await fetch("http://localhost:8000/api/macro/kpis");
    const data = await res.json();
    setKpis(data.kpis || []);
  }

  async function loadSeries(seriesId, range = selectedRange) {
    const res = await fetch(
      `http://localhost:8000/api/macro/series/${seriesId}?range=${range}`
    );
    const data = await res.json();
    setChartSeries(data);
  }

  async function loadData(seriesId = selectedSeriesId, range = selectedRange) {
  try {
    setStatus("Loading...");
    await loadKpis();
    await loadSeries(seriesId, range);
    setStatus("Live");
  } catch (e) {
    console.error(e);
    setStatus("Backend not reachable");
  }
}

  useEffect(() => {
    if (isAuthenticated) loadData(selectedSeriesId);
  }, [isAuthenticated]);

  async function handleCardClick(seriesId) {
    setSelectedSeriesId(seriesId);
    setStatus("Loading...");
    try {
      await loadSeries(seriesId, selectedRange);
      setStatus("Live");
    } catch (e) {
      console.error(e);
      setStatus("Backend not reachable");
    }
  }

  async function handleRangeClick(range) {
    setSelectedRange(range);
    setStatus("Loading...");
    try {
      await loadSeries(selectedSeriesId, range);
      setStatus("Live");
    } catch (e) {
      console.error(e);
      setStatus("Backend not reachable");
    }
  }

  async function handleRangeClick(range) {
    setSelectedRange(range);
    setStatus("Loading...");
    try {
      await loadSeries(selectedSeriesId, range);
      setStatus("Live");
    } catch (e) {
      console.error(e);
      setStatus("Backend not reachable");
    }
  }

  if (!isAuthenticated) return null;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#020617",
        color: "#e5e7eb",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding: "28px 24px 40px 24px",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 28,
            paddingBottom: 18,
            borderBottom: "1px solid #1f2937",
          }}
        >
          <div>
            <div style={{ fontSize: 13, color: "#93c5fd", marginBottom: 6 }}>
              LOCAL DEVELOPMENT
            </div>
            <h1 style={{ margin: 0, fontSize: 32 }}>Macro Dashboard</h1>
            <div style={{ marginTop: 6, color: "#9ca3af", fontSize: 14 }}>
              Python FastAPI backend · React frontend · FRED data
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {user && (
              <span style={{ color: "#6b7280", fontSize: 13 }}>{user.full_name}</span>
            )}
            <button
              onClick={() => loadData(selectedSeriesId)}
              style={{
                background: "#2563eb",
                color: "white",
                border: "none",
                borderRadius: 10,
                padding: "10px 16px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Refresh
            </button>
            <button
              onClick={() => { logout(); router.push("/login"); }}
              style={{
                background: "transparent",
                color: "#9ca3af",
                border: "1px solid #374151",
                borderRadius: 10,
                padding: "10px 16px",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Logout
            </button>

            <div
              style={{
                fontSize: 14,
                color: status === "Live" ? "#86efac" : "#fca5a5",
                background: "#0f172a",
                border: "1px solid #374151",
                padding: "10px 14px",
                borderRadius: 10,
              }}
            >
              {status}
            </div>
          </div>
        </header>

        <div style={{ marginBottom: 16 }}>
          <Link href="/portfolio" style={{ color: "#93c5fd", textDecoration: "none" }}>
            Go to portfolio backtester →
          </Link>
        </div>

        <section style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 14 }}>
            Key Macro Indicators
          </div>

          <div
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            {kpis.map((k) => (
              <KpiCard
                key={k.id}
                id={k.id}
                name={k.name}
                value={k.value}
                unit={k.unit}
                onClick={handleCardClick}
                isSelected={selectedSeriesId === k.id}
              />
            ))}
          </div>
        </section>

        <section
          style={{
            marginTop: 28,
            background: "#0f172a",
            border: "1px solid #1f2937",
            borderRadius: 20,
            padding: 22,
            boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 20,
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontSize: 13, color: "#9ca3af", marginBottom: 6 }}>
                SELECTED SERIES
              </div>
              <h2 style={{ margin: 0, fontSize: 24 }}>
                {chartSeries ? chartSeries.name : "Loading chart..."}
              </h2>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>

  {/* RANGE BUTTONS */}
  <div style={{ display: "flex", gap: 8 }}>
    {["1Y", "5Y", "10Y", "MAX"].map((range) => (
      <button
        key={range}
        onClick={() => handleRangeClick(range)}
        style={{
          background: selectedRange === range ? "#2563eb" : "#020617",
          color: "white",
          border: "1px solid #374151",
          borderRadius: 8,
          padding: "6px 10px",
          cursor: "pointer",
        }}
      >
        {range}
      </button>
    ))}
  </div>

  {/* LATEST VALUE BOX */}
  {chartSeries && chartSeries.values?.length > 0 && (
    <div
      style={{
        background: "#020617",
        border: "1px solid #374151",
        borderRadius: 12,
        padding: "10px 14px",
      }}
    >
      <div style={{ fontSize: 12, color: "#9ca3af" }}>
        Latest
      </div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>
        {Number(chartSeries.values.at(-1)).toFixed(2)}
        <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: 4 }}>
          {chartSeries.unit}
        </span>
      </div>
    </div>
  )}

</div>
          </div>

          {chartSeries ? (
            <LineChart
              dates={chartSeries.dates}
              datasets={[
                {
                  label: chartSeries.name,
                  data: chartSeries.values,
                  borderColor: "#3b82f6",
                  backgroundColor: "rgba(59,130,246,0.08)",
                  borderWidth: 2,
                  pointRadius: 0,
                  tension: 0.3,
                },
              ]}
            />
          ) : (
            <div style={{ color: "#9ca3af" }}>Loading chart...</div>
          )}
        </section>
      </div>
    </main>
  );
}