"use client";

import { useEffect, useState } from "react";
import LineChart from "@/app/components/LineChart";

const API = "http://localhost:8000";

const TABS = ["Components", "Regions", "Industries"];

const RANGES = [
  { label: "5Y",  years: 5  },
  { label: "10Y", years: 10 },
  { label: "20Y", years: 20 },
  { label: "All", years: null },
];

// OPT_INDEX lives on its own chart; everything else shares the components chart
const INDEX_ID = "NFIB_OPT_INDEX";

// The 5 forward-looking components that compose the Leading Indicator
const LEADING_IDS = [
  "NFIB_EXPAND",
  "NFIB_EMP_EXPECT",
  "NFIB_INV_EXPECT",
  "NFIB_BUS_COND",
  "NFIB_SALES_EXPECT",
];

// ── Pure utilities ─────────────────────────────────────────────────────────────

/**
 * Z-score average of LEADING_IDS, scaled so mean=100 and 1σ=10 pts
 * (Conference Board–style indexing).
 * Only months where all 5 components are present are included.
 */
function computeLeadingIndicator(series) {
  const available = LEADING_IDS.filter((id) => series[id]?.dates?.length > 0);
  if (available.length === 0) return null;

  // Standardize each component over its full history
  const standardized = {};
  for (const id of available) {
    const vals = series[id].values;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std  = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
    standardized[id] = { dates: series[id].dates, z: vals.map((v) => (v - mean) / std) };
  }

  // Collect all z-scores per date
  const byDate = {};
  for (const id of available) {
    const { dates, z } = standardized[id];
    dates.forEach((d, i) => { (byDate[d] ??= []).push(z[i]); });
  }

  // Average z-scores; drop months where any component is missing
  const dates  = [];
  const values = [];
  for (const [date, zs] of Object.entries(byDate).sort()) {
    if (zs.length === available.length) {
      dates.push(date);
      values.push(100 + (zs.reduce((a, b) => a + b, 0) / zs.length) * 10);
    }
  }
  return { dates, values };
}

/** Returns a {from, to} date range object, or null for "All". */
function rangeFrom(years) {
  if (!years) return null;
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);
  return { from: from.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };
}

// ── Shared UI primitives ───────────────────────────────────────────────────────

/** Range selector buttons + refresh icon, right-aligned. */
function RangeRefreshBar({ range, onRange, onRefresh, refreshing }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, marginBottom: 14 }}>
      {RANGES.map((r) => (
        <button key={r.label} onClick={() => onRange(r.label)} style={{
          padding: "3px 10px", borderRadius: 5, fontSize: 12, cursor: "pointer",
          border: "1px solid #374151",
          background: range === r.label ? "#1e3a5f" : "transparent",
          color:      range === r.label ? "#93c5fd" : "#6b7280",
        }}>
          {r.label}
        </button>
      ))}
      <button onClick={onRefresh} disabled={refreshing} style={{
        marginLeft: 8, padding: "3px 10px", borderRadius: 5, fontSize: 12,
        cursor: "pointer", border: "1px solid #374151", background: "transparent", color: "#6b7280",
      }}>
        {refreshing ? "…" : "↻"}
      </button>
    </div>
  );
}

/** Dark card wrapper for chart areas. Accepts optional extra inline styles. */
function ChartBox({ children, style }) {
  return (
    <div style={{
      background: "#0f172a", border: "1px solid #1f2937",
      borderRadius: 12, padding: "16px 8px 8px",
      ...style,
    }}>
      {children}
    </div>
  );
}

/** Colored pill toggle for a single series. */
function SeriesToggle({ label, color, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 5, fontSize: 11, cursor: "pointer", border: "1px solid",
      borderColor: active ? color  : "#374151",
      background:  active ? `${color}18` : "transparent",
      color:       active ? color  : "#4b5563",
    }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: active ? color : "#374151" }} />
      {label}
    </button>
  );
}

/** Empty state card shown before first fetch. */
function EmptyState({ message, onFetch, fetching }) {
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 12, padding: "32px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 14, color: "#6b7280", marginBottom: 12 }}>{message}</div>
      <button onClick={onFetch} disabled={fetching} style={{
        background: "#2563eb", color: "white", border: "none",
        borderRadius: 8, padding: "8px 20px", fontSize: 13, cursor: "pointer",
      }}>
        {fetching ? "Fetching…" : "Fetch from NFIB"}
      </button>
    </div>
  );
}

// ── Components tab ─────────────────────────────────────────────────────────────

function ComponentsTab() {
  const [series, setSeries]           = useState({});
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [range, setRange]             = useState("10Y");
  const [visible, setVisible]         = useState({});
  const [showLeading, setShowLeading] = useState(true);
  const [refreshing, setRefreshing]   = useState(false);

  function load() {
    setLoading(true);
    fetch(`${API}/api/nfib/components`)
      .then((r) => r.json())
      .then((d) => {
        const s = d.series ?? {};
        setSeries(s);
        setVisible(Object.fromEntries(
          Object.keys(s).filter((k) => k !== INDEX_ID).map((k) => [k, true])
        ));
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

  if (loading) return <div style={{ color: "#4b5563", fontSize: 14 }}>Loading…</div>;
  if (error)   return <div style={{ color: "#f87171", fontSize: 13 }}>{error}</div>;
  if (!Object.keys(series).length)
    return <EmptyState message="No data yet." onFetch={handleRefresh} fetching={refreshing} />;

  const indexSeries   = series[INDEX_ID];
  const componentKeys = Object.keys(series).filter((k) => k !== INDEX_ID);
  const leading       = computeLeadingIndicator(series);
  const visibleRange  = rangeFrom(RANGES.find((r) => r.label === range)?.years);

  const indexDatasets = [
    ...(indexSeries ? [{
      dates: indexSeries.dates, data: indexSeries.values,
      borderColor: indexSeries.color, borderWidth: 2, label: indexSeries.label,
    }] : []),
    ...(leading && showLeading ? [{
      dates: leading.dates, data: leading.values,
      borderColor: "#f97316", borderWidth: 2, lineStyle: 2,
      label: "NFIB Leading Indicator", lastValueVisible: true,
    }] : []),
  ];

  const componentDatasets = componentKeys
    .filter((id) => visible[id])
    .map((id) => ({
      dates: series[id].dates, data: series[id].values,
      borderColor: series[id].color, borderWidth: 2, label: series[id].label,
    }));

  return (
    <div>
      <RangeRefreshBar range={range} onRange={setRange} onRefresh={handleRefresh} refreshing={refreshing} />

      {/* ── Optimism Index chart ── */}
      {indexSeries && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: indexSeries.color }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>{indexSeries.label}</span>
            <span style={{ fontSize: 11, color: "#4b5563" }}>Index 1986=100</span>

            {/* Leading Indicator toggle (dashed orange) */}
            {leading && (
              <button
                onClick={() => setShowLeading((v) => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "2px 9px", borderRadius: 5, fontSize: 11, cursor: "pointer", border: "1px solid",
                  borderColor: showLeading ? "#f97316" : "#374151",
                  background:  showLeading ? "#f9731618" : "transparent",
                  color:       showLeading ? "#f97316" : "#4b5563",
                }}
              >
                <div style={{ width: 8, height: 2, background: showLeading ? "#f97316" : "#374151", borderTop: "2px dashed" }} />
                Leading Indicator
              </button>
            )}

            {/* Latest value + MoM change */}
            <span style={{ marginLeft: "auto", fontSize: 22, fontWeight: 700, color: "#e5e7eb" }}>
              {indexSeries.values.at(-1)?.toFixed(1)}
            </span>
            {indexSeries.values.length > 1 && (() => {
              const diff = indexSeries.values.at(-1) - indexSeries.values.at(-2);
              return (
                <span style={{ fontSize: 12, color: diff >= 0 ? "#4ade80" : "#f87171" }}>
                  {diff >= 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(1)}
                </span>
              );
            })()}
          </div>
          <ChartBox>
            <LineChart dates={null} datasets={indexDatasets} visibleRange={visibleRange} referenceLine={100} />
          </ChartBox>
        </div>
      )}

      {/* ── Component series chart ── */}
      <div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {componentKeys.map((id) => (
            <SeriesToggle
              key={id}
              label={series[id].label}
              color={series[id].color}
              active={visible[id]}
              onClick={() => setVisible((p) => ({ ...p, [id]: !p[id] }))}
            />
          ))}
        </div>
        <ChartBox>
          {componentDatasets.length > 0
            ? <LineChart dates={null} datasets={componentDatasets} visibleRange={visibleRange} />
            : <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#374151", fontSize: 13 }}>Select at least one series</div>
          }
        </ChartBox>
      </div>

      {/* ── Latest value cards ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
        {componentKeys.map((id) => {
          const s      = series[id];
          const latest = s.values.at(-1);
          const prev   = s.values.at(-2);
          const diff   = latest != null && prev != null ? latest - prev : null;
          return (
            <div key={id} style={{
              background: "#0f172a", border: "1px solid #1f2937",
              borderRadius: 8, padding: "10px 14px", flex: "1 1 150px",
              borderTop: `2px solid ${s.color}`,
            }}>
              <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 3 }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#e5e7eb" }}>
                {latest?.toFixed(1) ?? "—"}
                <span style={{ fontSize: 11, color: "#4b5563", marginLeft: 2 }}>%</span>
              </div>
              {diff != null && (
                <div style={{ fontSize: 11, color: diff >= 0 ? "#4ade80" : "#f87171", marginTop: 1 }}>
                  {diff >= 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(1)}pp
                </div>
              )}
              <div style={{ fontSize: 9, color: "#374151", marginTop: 2 }}>{s.dates.at(-1)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Industries tab ─────────────────────────────────────────────────────────────

function IndustriesTab() {
  const [series, setSeries]         = useState({});
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [range, setRange]           = useState("10Y");
  const [visible, setVisible]       = useState({});
  const [refreshing, setRefreshing] = useState(false);

  function load() {
    setLoading(true);
    fetch(`${API}/api/nfib/industries`)
      .then((r) => r.json())
      .then((d) => {
        const s = d.series ?? {};
        setSeries(s);
        setVisible(Object.fromEntries(Object.keys(s).map((k) => [k, true])));
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch(`${API}/api/nfib/refresh-industries`, { method: "POST" });
      if (!res.ok) throw new Error("Refresh failed");
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <div style={{ color: "#4b5563", fontSize: 14 }}>Loading…</div>;
  if (error)   return <div style={{ color: "#f87171", fontSize: 13 }}>{error}</div>;
  if (!Object.keys(series).length)
    return <EmptyState message="No industry data yet." onFetch={handleRefresh} fetching={refreshing} />;

  const datasets = Object.entries(series)
    .filter(([id]) => visible[id])
    .map(([, s]) => ({
      dates: s.dates, data: s.values,
      borderColor: s.color, borderWidth: 2, label: s.label,
    }));

  const visibleRange = rangeFrom(RANGES.find((r) => r.label === range)?.years);

  return (
    <div>
      <RangeRefreshBar range={range} onRange={setRange} onRefresh={handleRefresh} refreshing={refreshing} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {Object.entries(series).map(([id, s]) => (
          <SeriesToggle
            key={id}
            label={s.label}
            color={s.color}
            active={visible[id]}
            onClick={() => setVisible((p) => ({ ...p, [id]: !p[id] }))}
          />
        ))}
      </div>

      <ChartBox style={{ marginBottom: 20 }}>
        {datasets.length > 0
          ? <LineChart dates={null} datasets={datasets} visibleRange={visibleRange} referenceLine={100} />
          : <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#374151", fontSize: 13 }}>Select at least one industry</div>
        }
      </ChartBox>

      {/* Latest value cards */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {Object.entries(series).map(([id, s]) => {
          const latest = s.values.at(-1);
          const prev   = s.values.at(-2);
          const diff   = latest != null && prev != null ? latest - prev : null;
          return (
            <div key={id} style={{
              background: "#0f172a", border: `1px solid ${s.color}33`,
              borderRadius: 10, padding: "12px 16px", minWidth: 140,
            }}>
              <div style={{ fontSize: 10, color: s.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#e5e7eb" }}>{latest?.toFixed(1)}</div>
              {diff != null && (
                <div style={{ fontSize: 11, color: diff >= 0 ? "#4ade80" : "#f87171", marginTop: 1 }}>
                  {diff >= 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(1)} MoM
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Placeholder tab ────────────────────────────────────────────────────────────

function SoonTab({ label }) {
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 12, padding: "48px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 14, color: "#6b7280" }}>{label} — coming soon</div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

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

      <div style={{ display: "flex", gap: 2, marginBottom: 20, borderBottom: "1px solid #1f2937" }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 18px", fontSize: 13, cursor: "pointer",
            background: "transparent", border: "none",
            borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent",
            color: tab === t ? "#e5e7eb" : "#6b7280",
            marginBottom: -1,
          }}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Components" && <ComponentsTab />}
      {tab === "Regions"    && <SoonTab label="Small Business Optimism by Region" />}
      {tab === "Industries" && <IndustriesTab />}
    </div>
  );
}
