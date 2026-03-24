"use client";

import { useEffect, useState } from "react";
import LineChart from "@/app/components/LineChart";

const API = "http://localhost:8000";

const TABS = ["Components", "Regions", "Industries"];

const RANGES = [
  { label: "5Y",  years: 5 },
  { label: "10Y", years: 10 },
  { label: "20Y", years: 20 },
  { label: "All", years: null },
];

// OPT_INDEX lives on its own chart; everything else shares the components chart
const INDEX_ID = "NFIB_OPT_INDEX";

// Leading indicator = average of these 5 component series
const LEADING_IDS = ["NFIB_EXPAND", "NFIB_EMP_EXPECT", "NFIB_INV_EXPECT", "NFIB_BUS_COND", "NFIB_SALES_EXPECT"];

function computeLeadingIndicator(series) {
  const available = LEADING_IDS.filter((id) => series[id]?.dates?.length > 0);
  if (available.length === 0) return null;

  // Build date → values map
  const byDate = {};
  for (const id of available) {
    const s = series[id];
    s.dates.forEach((d, i) => {
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(s.values[i]);
    });
  }

  const dates  = [];
  const values = [];
  for (const [date, vals] of Object.entries(byDate).sort()) {
    if (vals.length === available.length) {   // only dates where all series have a value
      dates.push(date);
      values.push(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
  }
  return { dates, values };
}

function rangeFrom(years) {
  if (!years) return null;
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);
  return { from: from.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };
}

// ── Components tab ────────────────────────────────────────────────────────────

function ComponentsTab() {
  const [series, setSeries]         = useState({});
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [range, setRange]           = useState("10Y");
  const [visible, setVisible]       = useState({});
  const [refreshing, setRefreshing] = useState(false);

  function load() {
    setLoading(true);
    fetch(`${API}/api/nfib/components`)
      .then((r) => r.json())
      .then((d) => {
        const s = d.series ?? {};
        setSeries(s);
        setVisible({
          __leading: true,
          ...Object.fromEntries(Object.keys(s).filter((k) => k !== INDEX_ID).map((k) => [k, true])),
        });
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch(`${API}/api/nfib/refresh`, { method: "POST" });
      if (!res.ok) throw new Error("Refresh failed");
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }

  function toggleSeries(id) {
    setVisible((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const indexSeries   = series[INDEX_ID];
  const componentKeys = Object.keys(series).filter((k) => k !== INDEX_ID);

  const leading = computeLeadingIndicator(series);

  const indexDataset = indexSeries ? [{
    dates: indexSeries.dates, data: indexSeries.values,
    borderColor: indexSeries.color, borderWidth: 2, label: indexSeries.label,
  }] : [];

  const componentDatasets = [
    ...(leading && visible["__leading"] ? [{
      dates: leading.dates, data: leading.values,
      borderColor: "#f97316", borderWidth: 3, label: "Leading Indicator",
    }] : []),
    ...componentKeys
      .filter((id) => visible[id])
      .map((id) => ({
        dates: series[id].dates, data: series[id].values,
        borderColor: series[id].color, borderWidth: 2, label: series[id].label,
      })),
  ];

  const visibleRange = rangeFrom(RANGES.find((r) => r.label === range)?.years);
  const hasData = Object.keys(series).length > 0;

  return (
    <div>
      {loading && <div style={{ color: "#4b5563", fontSize: 14 }}>Loading…</div>}
      {error   && <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12 }}>Error: {error}</div>}

      {!loading && !hasData && (
        <div style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 12, padding: "32px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 14, color: "#6b7280", marginBottom: 12 }}>No data yet.</div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ background: "#2563eb", color: "white", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 13, cursor: "pointer" }}
          >
            {refreshing ? "Fetching…" : "Fetch from NFIB"}
          </button>
        </div>
      )}

      {!loading && hasData && (
        <>
          {/* Range + refresh */}
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, marginBottom: 14 }}>
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
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              style={{ marginLeft: 8, padding: "3px 10px", borderRadius: 5, fontSize: 12, cursor: "pointer", border: "1px solid #374151", background: "transparent", color: "#6b7280" }}
            >
              {refreshing ? "…" : "↻"}
            </button>
          </div>

          {/* ── Leading Indicator KPI card ── */}
          {leading && (() => {
            const latest = leading.values[leading.values.length - 1];
            const prev   = leading.values[leading.values.length - 2];
            const diff   = latest != null && prev != null ? latest - prev : null;
            return (
              <div style={{
                background: "#0f172a", border: "1px solid #f97316",
                borderRadius: 10, padding: "14px 20px", marginBottom: 20,
                display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap",
              }}>
                <div>
                  <div style={{ fontSize: 10, color: "#f97316", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>
                    Leading Indicator
                  </div>
                  <div style={{ fontSize: 11, color: "#4b5563" }}>
                    Avg of: Expansion · Employment · Inventory · Economic Outlook · Sales Plans
                  </div>
                </div>
                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#e5e7eb" }}>
                    {latest?.toFixed(1)}<span style={{ fontSize: 13, color: "#4b5563", marginLeft: 2 }}>%</span>
                  </div>
                  {diff != null && (
                    <div style={{ fontSize: 12, color: diff >= 0 ? "#4ade80" : "#f87171" }}>
                      {diff >= 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(1)}pp MoM
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── Optimism Index chart ── */}
          {indexSeries && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: indexSeries.color }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>{indexSeries.label}</span>
                <span style={{ fontSize: 11, color: "#4b5563" }}>Index 1986=100</span>
                <span style={{ marginLeft: "auto", fontSize: 22, fontWeight: 700, color: "#e5e7eb" }}>
                  {indexSeries.values[indexSeries.values.length - 1]?.toFixed(1)}
                </span>
                {indexSeries.values.length > 1 && (() => {
                  const diff = indexSeries.values[indexSeries.values.length - 1] - indexSeries.values[indexSeries.values.length - 2];
                  return (
                    <span style={{ fontSize: 12, color: diff >= 0 ? "#4ade80" : "#f87171" }}>
                      {diff >= 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(1)}
                    </span>
                  );
                })()}
              </div>
              <div style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 12, padding: "16px 8px 8px" }}>
                <LineChart dates={null} datasets={indexDataset} visibleRange={visibleRange} referenceLine={100} />
              </div>
            </div>
          )}

          {/* ── Component series chart ── */}
          <div>
            {/* Toggles */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {/* Leading Indicator toggle */}
              {leading && (
                <button
                  onClick={() => toggleSeries("__leading")}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "3px 10px", borderRadius: 5, fontSize: 11,
                    cursor: "pointer", border: "1px solid",
                    borderColor: visible["__leading"] ? "#f97316" : "#374151",
                    background:  visible["__leading"] ? "#f9731618" : "transparent",
                    color:       visible["__leading"] ? "#f97316" : "#4b5563",
                    fontWeight: 600,
                  }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: visible["__leading"] ? "#f97316" : "#374151" }} />
                  Leading Indicator
                </button>
              )}
              {componentKeys.map((id) => {
                const s = series[id];
                return (
                  <button
                    key={id}
                    onClick={() => toggleSeries(id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "3px 10px", borderRadius: 5, fontSize: 11,
                      cursor: "pointer", border: "1px solid",
                      borderColor: visible[id] ? s.color : "#374151",
                      background:  visible[id] ? `${s.color}18` : "transparent",
                      color:       visible[id] ? s.color : "#4b5563",
                    }}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: visible[id] ? s.color : "#374151" }} />
                    {s.label}
                  </button>
                );
              })}
            </div>

            <div style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 12, padding: "16px 8px 8px" }}>
              {componentDatasets.length > 0
                ? <LineChart dates={null} datasets={componentDatasets} visibleRange={visibleRange} />
                : <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#374151", fontSize: 13 }}>Select at least one series</div>
              }
            </div>
          </div>

          {/* Latest value cards */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
            {componentKeys.map((id) => {
              const s = series[id];
              const latest = s.values[s.values.length - 1];
              const prev   = s.values[s.values.length - 2];
              const diff   = latest != null && prev != null ? latest - prev : null;
              return (
                <div key={id} style={{
                  background: "#0f172a", border: "1px solid #1f2937",
                  borderRadius: 8, padding: "10px 14px", flex: "1 1 150px",
                  borderTop: `2px solid ${s.color}`,
                }}>
                  <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 3 }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#e5e7eb" }}>
                    {latest?.toFixed(1) ?? "—"}<span style={{ fontSize: 11, color: "#4b5563", marginLeft: 2 }}>%</span>
                  </div>
                  {diff != null && (
                    <div style={{ fontSize: 11, color: diff >= 0 ? "#4ade80" : "#f87171", marginTop: 1 }}>
                      {diff >= 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(1)}pp
                    </div>
                  )}
                  <div style={{ fontSize: 9, color: "#374151", marginTop: 2 }}>
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

// ── Soon placeholder ──────────────────────────────────────────────────────────

function SoonTab({ label }) {
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 12, padding: "48px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 14, color: "#6b7280" }}>{label} — coming soon</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NfibPage() {
  const [tab, setTab] = useState("Components");

  return (
    <div style={{ color: "#e5e7eb", maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#e5e7eb", marginBottom: 4 }}>
          NFIB Small Business Confidence
        </h1>
        <p style={{ color: "#6b7280", fontSize: 13 }}>
          National Federation of Independent Business — Survey of Small Business Economic Trends
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 20, borderBottom: "1px solid #1f2937", paddingBottom: 0 }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 18px", fontSize: 13, cursor: "pointer",
              background: "transparent", border: "none",
              borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent",
              color: tab === t ? "#e5e7eb" : "#6b7280",
              marginBottom: -1,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Components"  && <ComponentsTab />}
      {tab === "Regions"     && <SoonTab label="Small Business Optimism by Region" />}
      {tab === "Industries"  && <SoonTab label="Small Business Optimism by Industry" />}
    </div>
  );
}
