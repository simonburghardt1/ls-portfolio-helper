"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import LineChart from "@/app/components/LineChart";

const API = "http://localhost:8000";

// ── Shared styles ─────────────────────────────────────────────────────────────

const card = {
  background: "#080e1a",
  border: "1px solid #1f2937",
  borderRadius: 10,
  padding: "14px 18px",
};

const TAB_STYLE = (active) => ({
  padding: "6px 18px",
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  color: active ? "#93c5fd" : "#6b7280",
  background: active ? "#0f172a" : "transparent",
  border: "none",
  borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent",
  cursor: "pointer",
  transition: "color 0.15s",
});

// ── Colour helpers ────────────────────────────────────────────────────────────

function momColor(v) {
  if (v == null) return "#374151";
  if (v >  0.6) return "#7f1d1d";
  if (v >  0.4) return "#991b1b";
  if (v >  0.2) return "#dc2626";
  if (v >  0.0) return "#f87171";
  if (v > -0.1) return "#6b7280";
  if (v > -0.3) return "#60a5fa";
  return "#1d4ed8";
}

function yoyColor(v) {
  if (v == null) return "#374151";
  if (v >  6)   return "#7f1d1d";
  if (v >  4)   return "#991b1b";
  if (v >  2.5) return "#dc2626";
  if (v >  1.5) return "#f87171";
  if (v >  0)   return "#6b7280";
  if (v > -1)   return "#93c5fd";
  return "#1d4ed8";
}

function streakArrows(streak) {
  if (streak === 0) return <span style={{ color: "#6b7280" }}>—</span>;
  const abs   = Math.abs(streak);
  const up    = streak > 0;
  const color = up ? "#f87171" : "#60a5fa";
  const arrow = up ? "↑" : "↓";
  return <span style={{ color, letterSpacing: 1 }}>{arrow.repeat(Math.min(abs, 6))}</span>;
}

function fmt1(v) { return v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%"; }

// ── Distribution histogram helper ─────────────────────────────────────────────

function buildHistogram(values, binWidth = 0.1) {
  const valid = values.filter((v) => v != null && isFinite(v));
  if (!valid.length) return [];
  // Round v/binWidth to avoid floating-point errors like 0.2/0.1 = 1.9999…
  const toBinIdx = (v) => Math.floor(Math.round(v / binWidth * 1e6) / 1e6);
  const toKey    = (idx) => Math.round(idx * binWidth * 1000) / 1000;
  const minIdx = toBinIdx(Math.min(...valid));
  const maxIdx = toBinIdx(Math.max(...valid));
  const bins = {};
  for (let idx = minIdx; idx <= maxIdx; idx++) {
    bins[toKey(idx)] = 0;
  }
  valid.forEach((v) => {
    const key = toKey(toBinIdx(v));
    bins[key] = (bins[key] ?? 0) + 1;
  });
  return Object.entries(bins)
    .map(([bin, count]) => ({ bin: +bin, label: (+bin).toFixed(1) + "%", count }))
    .sort((a, b) => a.bin - b.bin);
}

// ── Recharts custom tooltip ───────────────────────────────────────────────────

function BarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 6, padding: "8px 12px", fontSize: 12 }}>
      <div style={{ color: "#9ca3af", marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color ?? "#e5e7eb" }}>
          {p.name}: <strong>{p.value != null ? (p.value >= 0 ? "+" : "") + p.value.toFixed(2) + "%" : "—"}</strong>
        </div>
      ))}
    </div>
  );
}

function HistTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 6, padding: "8px 12px", fontSize: 12 }}>
      <div style={{ color: "#9ca3af" }}>Bin: {d.label}</div>
      <div style={{ color: "#e5e7eb" }}>Count: <strong>{d.count}</strong></div>
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function KpiCard({ label, value, mom, yoy, color, date, isActive, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        ...card,
        flex: "1 1 150px", minWidth: 140,
        borderTop: `2px solid ${color}`,
        outline: isActive ? `1px solid ${color}` : "none",
        background: isActive ? `${color}11` : card.background,
        cursor: "pointer",
        transition: "background 0.15s",
      }}
    >
      <div style={{ fontSize: 11, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
        {label}
      </div>
      {/* YoY as the headline number */}
      <div style={{ fontSize: 26, fontWeight: 700, color: yoyColor(yoy), marginBottom: 4, lineHeight: 1 }}>
        {fmt1(yoy)}
      </div>
      <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 4 }}>YoY</div>
      <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
        <span style={{ color: momColor(mom) }}>MoM {fmt1(mom)}</span>
        <span style={{ color: "#374151" }}>|</span>
        <span style={{ color: "#4b5563" }}>{value != null ? value.toFixed(1) : "—"}</span>
      </div>
      <div style={{ fontSize: 10, color: "#374151", marginTop: 4 }}>{date ?? "—"}</div>
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ series }) {
  const seriesKeys = Object.keys(series);
  const firstKey = seriesKeys[0] ?? "CPIAUCSL";
  const [selectedSid, setSelectedSid] = useState(firstKey);
  const [range, setRange] = useState("5Y");

  const RANGES = [
    { label: "5Y",  months: 60 },
    { label: "10Y", months: 120 },
    { label: "20Y", months: 240 },
    { label: "All", months: null },
  ];

  const sel = series[selectedSid] ?? {};

  // Build time-series bar data for the selected series only
  const barData = useMemo(() => {
    const dates = sel.dates ?? [];
    const nMonths = RANGES.find((r) => r.label === range)?.months;
    const startIdx = nMonths ? Math.max(0, dates.length - nMonths) : 0;
    return dates.slice(startIdx).map((date, di) => {
      const i = startIdx + di;
      return {
        date: date.slice(0, 7),
        mom: sel.mom?.[i] ?? null,
        yoy: sel.yoy?.[i] ?? null,
      };
    });
  }, [sel, range]);

  const momHist = useMemo(() => buildHistogram(sel.mom?.filter((v) => v != null) ?? [], 0.1), [sel]);
  const yoyHist = useMemo(() => buildHistogram(sel.yoy?.filter((v) => v != null) ?? [], 0.5), [sel]);

  return (
    <div>
      {/* KPI cards — clicking selects the series for the charts below */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
        {seriesKeys.map((sid) => {
          const s = series[sid];
          const n = s.values.length - 1;
          return (
            <KpiCard
              key={sid}
              label={s.label}
              value={s.values[n]}
              mom={s.mom[s.mom.length - 1]}
              yoy={s.yoy[s.yoy.length - 1]}
              color={s.color}
              date={s.dates[n]}
              isActive={selectedSid === sid}
              onClick={() => setSelectedSid(sid)}
            />
          );
        })}
      </div>

      {/* Range selector + series label */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: sel.color ?? "#6b7280", fontWeight: 600 }}>
          {sel.label ?? ""}
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

      {/* 2×2 chart grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Chart 1: MoM time series */}
        <div style={{ ...card, padding: "14px 8px 8px" }}>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8, paddingLeft: 8 }}>MoM % Change — Time Series</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={barData} margin={{ left: -10, right: 4, top: 0, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(55,65,81,0.35)" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false}
                interval={Math.max(0, Math.floor(barData.length / 8))} />
              <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} tickFormatter={(v) => v.toFixed(1) + "%"} />
              <Tooltip content={<BarTooltip />} />
              <ReferenceLine y={0} stroke="#374151" />
              <Bar dataKey="mom" name={sel.label} fill={sel.color} opacity={0.85}>
                {barData.map((d, i) => (
                  <Cell key={i} fill={(d.mom ?? 0) >= 0 ? "#ef4444" : "#3b82f6"} opacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 2: YoY time series */}
        <div style={{ ...card, padding: "14px 8px 8px" }}>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8, paddingLeft: 8 }}>YoY % Change — Time Series</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={barData} margin={{ left: -10, right: 4, top: 0, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(55,65,81,0.35)" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false}
                interval={Math.max(0, Math.floor(barData.length / 8))} />
              <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} tickFormatter={(v) => v.toFixed(1) + "%"} />
              <Tooltip content={<BarTooltip />} />
              <ReferenceLine y={0} stroke="#374151" />
              <ReferenceLine y={2} stroke="#dc2626" strokeDasharray="4 4" strokeWidth={1} label={{ value: "2%", fill: "#dc2626", fontSize: 10, position: "right" }} />
              <Bar dataKey="yoy" name={sel.label} fill={sel.color} opacity={0.85}>
                {barData.map((d, i) => (
                  <Cell key={i} fill={(d.yoy ?? 0) >= 2 ? "#ef4444" : (d.yoy ?? 0) >= 0 ? "#f59e0b" : "#3b82f6"} opacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 3: MoM distribution */}
        <div style={{ ...card, padding: "14px 8px 8px" }}>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8, paddingLeft: 8 }}>MoM % Distribution</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={momHist} margin={{ left: -10, right: 4, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(55,65,81,0.35)" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} allowDecimals={false} />
              <Tooltip content={<HistTooltip />} />
              <Bar dataKey="count" name="Months" fill="#60a5fa" opacity={0.8} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 4: YoY distribution */}
        <div style={{ ...card, padding: "14px 8px 8px" }}>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8, paddingLeft: 8 }}>YoY % Distribution</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={yoyHist} margin={{ left: -10, right: 4, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(55,65,81,0.35)" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} allowDecimals={false} />
              <Tooltip content={<HistTooltip />} />
              <Bar dataKey="count" name="Months" fill="#60a5fa" opacity={0.8} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── Components Tab ────────────────────────────────────────────────────────────

function ComponentsTab({ components }) {
  const [expanded, setExpanded] = useState({});
  const [selected, setSelected] = useState(null);

  const toggleExpand = (sid) => setExpanded((e) => ({ ...e, [sid]: !e[sid] }));

  // Split into top-level and children
  const topLevel  = Object.entries(components).filter(([, c]) => !c.parent);
  const childMap  = {};
  Object.entries(components).forEach(([sid, c]) => {
    if (c.parent) {
      if (!childMap[c.parent]) childMap[c.parent] = [];
      childMap[c.parent].push([sid, c]);
    }
  });

  const selectedComp = selected ? components[selected] : null;
  const chartDataset = selectedComp
    ? [{
        dates:       selectedComp.dates,
        data:        selectedComp.yoy,
        borderColor: "#3b82f6",
        borderWidth: 2,
        label:       selectedComp.label + " YoY%",
      }]
    : null;

  function ComponentRow({ sid, comp, isChild }) {
    const isSelected = selected === sid;
    const hasChildren = !!childMap[sid];
    const isOpen = expanded[sid];
    return (
      <tr
        onClick={() => setSelected(isSelected ? null : sid)}
        style={{
          background: isSelected ? "#0f2744" : isChild ? "#040a12" : "#060c18",
          cursor: "pointer",
          borderBottom: "1px solid #0d1829",
          transition: "background 0.1s",
        }}
        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#0a1628"; }}
        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = isChild ? "#040a12" : "#060c18"; }}
      >
        <td style={{ padding: "7px 12px", fontSize: 12, color: "#e5e7eb", whiteSpace: "nowrap" }}>
          {isChild ? (
            <span style={{ color: "#6b7280" }}>└ {comp.label}</span>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {hasChildren && (
                <span
                  style={{ color: "#4b5563", cursor: "pointer", fontSize: 10, minWidth: 12 }}
                  onClick={(e) => { e.stopPropagation(); toggleExpand(sid); }}
                >
                  {isOpen ? "▼" : "▶"}
                </span>
              )}
              <span style={{ fontWeight: 600 }}>{comp.label}</span>
            </span>
          )}
        </td>
        <td style={{ padding: "7px 12px", fontSize: 12, color: "#6b7280", textAlign: "right" }}>
          {comp.weight.toFixed(1)}%
        </td>
        <td style={{
          padding: "7px 12px", fontSize: 12, textAlign: "right", fontWeight: 600,
          color: "#e5e7eb",
          background: comp.latest_mom != null ? momColor(comp.latest_mom) + "55" : undefined,
        }}>
          {fmt1(comp.latest_mom)}
        </td>
        <td style={{
          padding: "7px 12px", fontSize: 12, textAlign: "right", fontWeight: 600,
          color: "#e5e7eb",
          background: comp.latest_yoy != null ? yoyColor(comp.latest_yoy) + "55" : undefined,
        }}>
          {fmt1(comp.latest_yoy)}
        </td>
        <td style={{ padding: "7px 12px", textAlign: "center" }}>
          {streakArrows(comp.streak ?? 0)}
        </td>
      </tr>
    );
  }

  return (
    <div>
      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1f2937" }}>
              {["Category", "Weight", "MoM%", "YoY%", "Trend"].map((h, i) => (
                <th key={h} style={{
                  padding: "10px 12px", fontSize: 11, fontWeight: 600, color: "#4b5563",
                  textTransform: "uppercase", letterSpacing: "0.07em",
                  textAlign: i <= 1 ? "left" : i === 4 ? "center" : "right",
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topLevel.map(([sid, comp]) => (
              <React.Fragment key={sid}>
                <ComponentRow sid={sid} comp={comp} isChild={false} />
                {expanded[sid] && (childMap[sid] ?? []).map(([csid, ccomp]) => (
                  <ComponentRow key={csid} sid={csid} comp={ccomp} isChild={true} />
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Selected series chart */}
      {selectedComp && chartDataset && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: "#9ca3af", marginBottom: 8 }}>
            {selectedComp.label} — YoY % Change
          </div>
          <div style={{ ...card, padding: "16px 8px 8px" }}>
            <LineChart dates={null} datasets={chartDataset} referenceLine={0} />
          </div>
        </div>
      )}
      {!selectedComp && (
        <div style={{ marginTop: 16, fontSize: 12, color: "#374151", textAlign: "center", padding: 16 }}>
          Click any row to view its time-series chart
        </div>
      )}
    </div>
  );
}

// ── Insights Tab ──────────────────────────────────────────────────────────────

function InsightBadge({ value, type }) {
  const color = type === "mom" ? momColor(value) : yoyColor(value);
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: 12, fontWeight: 700, color: "#e5e7eb", background: color,
    }}>
      {fmt1(value)}
    </span>
  );
}

function InsightCard({ title, icon, items, valueKey, type, emptyMsg }) {
  return (
    <div style={{ ...card, flex: "1 1 220px" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb", marginBottom: 12 }}>
        {icon} {title}
      </div>
      {!items.length && (
        <div style={{ fontSize: 12, color: "#374151" }}>{emptyMsg ?? "None currently"}</div>
      )}
      {items.map((e) => (
        <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 12, color: "#e5e7eb" }}>{e.label}</div>
            {e.parent && (
              <div style={{ fontSize: 10, color: "#4b5563" }}>{e.parent}</div>
            )}
          </div>
          <InsightBadge value={e[valueKey]} type={type} />
        </div>
      ))}
    </div>
  );
}

function InsightsTab({ insights }) {
  if (!insights) return <div style={{ color: "#4b5563", fontSize: 13 }}>Loading…</div>;

  const { biggest_movers, hot_spots, persistent_up, persistent_dn } = insights;

  // Enrich parent label display
  const compLabels = {};
  // (parent id → label mapping would need components, use id as fallback)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Biggest movers */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#9ca3af", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>
          Biggest Movers This Month
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <InsightCard
            title="Biggest Increases"
            icon="🔺"
            items={biggest_movers?.up ?? []}
            valueKey="mom"
            type="mom"
            emptyMsg="No data"
          />
          <InsightCard
            title="Biggest Decreases"
            icon="🔻"
            items={biggest_movers?.down ?? []}
            valueKey="mom"
            type="mom"
            emptyMsg="No data"
          />
        </div>
      </div>

      {/* Hot spots */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#9ca3af", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>
          Hot Spots (YoY &gt; 5%)
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {hot_spots?.length ? (
            <div style={{ ...card, minWidth: 280 }}>
              {hot_spots.map((e) => (
                <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "#e5e7eb" }}>{e.label}</span>
                  <InsightBadge value={e.yoy} type="yoy" />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#374151" }}>No components above 5% YoY</div>
          )}
        </div>
      </div>

      {/* Persistent trends */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#9ca3af", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>
          Persistent Trends (3+ consecutive months)
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <InsightCard
            title="Persistent Inflators"
            icon="↑"
            items={persistent_up ?? []}
            valueKey="mom"
            type="mom"
            emptyMsg="No persistent increases"
          />
          <InsightCard
            title="Persistent Deflators"
            icon="↓"
            items={persistent_dn ?? []}
            valueKey="mom"
            type="mom"
            emptyMsg="No persistent decreases"
          />
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CpiPpiPage() {
  const [tab,        setTab]        = useState("overview");
  const [series,     setSeries]     = useState({});
  const [components, setComponents] = useState({});
  const [insights,   setInsights]   = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/cpi-ppi/series`).then((r) => r.json()),
      fetch(`${API}/api/cpi-ppi/components`).then((r) => r.json()),
      fetch(`${API}/api/cpi-ppi/insights`).then((r) => r.json()),
    ])
      .then(([s, c, ins]) => {
        setSeries(s.series ?? {});
        setComponents(c.components ?? {});
        setInsights(ins);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  return (
    <div style={{ color: "#e5e7eb", maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#e5e7eb", marginBottom: 4 }}>
          CPI & PPI Dashboard
        </h1>
        <p style={{ color: "#6b7280", fontSize: 13 }}>
          Consumer & Producer Price Indices — BLS / BEA via FRED
        </p>
      </div>

      {loading && <div style={{ color: "#4b5563", fontSize: 14 }}>Loading data from FRED…</div>}
      {error   && <div style={{ color: "#f87171", fontSize: 14 }}>Error: {error}</div>}

      {!loading && !error && (
        <>
          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid #1f2937", marginBottom: 24 }}>
            {[
              { key: "overview",   label: "Overview" },
              { key: "components", label: "Components" },
              { key: "insights",   label: "Insights" },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setTab(key)} style={TAB_STYLE(tab === key)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "overview"   && Object.keys(series).length > 0     && <OverviewTab    series={series} />}
          {tab === "components" && Object.keys(components).length > 0 && <ComponentsTab  components={components} />}
          {tab === "insights"   &&                                        <InsightsTab    insights={insights} />}
        </>
      )}
    </div>
  );
}
