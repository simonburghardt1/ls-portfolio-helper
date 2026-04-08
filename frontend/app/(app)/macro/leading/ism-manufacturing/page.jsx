"use client";

import { useEffect, useState } from "react";
import LineChart from "@/app/components/LineChart";

const API = "http://localhost:8000";

const COMPONENT_COLORS = {
  pmi:                   "#3b82f6",
  new_orders:            "#10b981",
  production:            "#f59e0b",
  employment:            "#8b5cf6",
  supplier_deliveries:   "#ef4444",
  inventories:           "#06b6d4",
  customers_inventories: "#f97316",
  prices:                "#ec4899",
  backlog_of_orders:     "#84cc16",
  new_export_orders:     "#a78bfa",
  imports:               "#fb923c",
};

const RANGES = [
  { label: "2Y",  years: 2 },
  { label: "5Y",  years: 5 },
  { label: "10Y", years: 10 },
  { label: "All", years: null },
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDate(d) {
  const [y, m] = d.split("-");
  return `${MONTHS[parseInt(m) - 1]}-${y.slice(2)}`;
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

export default function IsmManufacturingPage() {
  const [series, setSeries]   = useState(null);
  const [labels, setLabels]   = useState({});
  const [active, setActive]   = useState(new Set(["pmi", "new_orders", "production"]));
  const [range, setRange]     = useState("5Y");
  const [tab, setTab]         = useState("chart");
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // Rankings: map of component → API response, loaded on tab activation
  const [allRankings, setAllRankings]         = useState(null);
  const [rankingsLoading, setRankingsLoading] = useState(false);

  // Comments tab state
  const [commentsIndustryList, setCommentsIndustryList] = useState([]);
  const [commentsIndustry, setCommentsIndustry]         = useState(null);
  const [commentsComponent, setCommentsComponent]       = useState("pmi");
  const [commentsData, setCommentsData]                 = useState(null);
  const [commentsLoading, setCommentsLoading]           = useState(false);

  useEffect(() => {
    fetch(`${API}/api/ism/manufacturing/series`)
      .then((r) => r.json())
      .then((d) => { setSeries(d.series); setLabels(d.labels); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  const components = series ? Object.keys(series) : Object.keys(COMPONENT_COLORS);

  // Load industry list when tab opens or component changes
  useEffect(() => {
    if (tab !== "comments" || commentsIndustryList.length > 0) return;
    fetch(`${API}/api/ism/manufacturing/rankings?component=${commentsComponent}`)
      .then((r) => r.json())
      .then((d) => {
        const list = (d.industries || []).sort();
        setCommentsIndustryList(list);
        if (list.length > 0 && !commentsIndustry) setCommentsIndustry(list[0]);
      })
      .catch(() => {});
  }, [tab, commentsComponent, commentsIndustryList]);

  // Load history when industry or component changes
  useEffect(() => {
    if (tab !== "comments" || !commentsIndustry) return;
    setCommentsLoading(true);
    setCommentsData(null);
    fetch(`${API}/api/ism/manufacturing/industry-history?industry=${encodeURIComponent(commentsIndustry)}&component=${commentsComponent}`)
      .then((r) => r.json())
      .then((d) => { setCommentsData(d); setCommentsLoading(false); })
      .catch(() => setCommentsLoading(false));
  }, [tab, commentsIndustry, commentsComponent]);

  useEffect(() => {
    if (tab !== "rankings" || allRankings !== null) return;
    setRankingsLoading(true);
    Promise.all(
      components.map((col) =>
        fetch(`${API}/api/ism/manufacturing/rankings?component=${col}`)
          .then((r) => r.json())
          .then((d) => [col, d])
          .catch(() => [col, { dates: [], industries: [], scores: {} }])
      )
    ).then((results) => {
      const map = {};
      results.forEach(([col, d]) => { map[col] = d; });
      setAllRankings(map);
      setRankingsLoading(false);
    });
  }, [tab, allRankings, components]);

  function toggleComponent(col) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(col)) { if (next.size === 1) return prev; next.delete(col); }
      else next.add(col);
      return next;
    });
  }

  const datasets = series
    ? Object.entries(series)
        .filter(([col]) => active.has(col))
        .map(([col, s]) => ({
          dates:       s.dates,
          data:        s.values,
          borderColor: COMPONENT_COLORS[col],
          borderWidth: col === "pmi" ? 2.5 : 1.5,
          label:       labels[col] ?? col,
        }))
    : [];

  const visibleRange = rangeFrom(RANGES.find((r) => r.label === range)?.years);

  if (loading) return <PageShell><LoadingState /></PageShell>;
  if (error)   return <PageShell><div style={{ color: "#f87171" }}>Error: {error}</div></PageShell>;

  const hasData = series && Object.values(series).some((s) => s.dates.length > 0);

  return (
    <PageShell>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#e5e7eb", marginBottom: 4 }}>
          ISM Manufacturing Index
        </h1>
        <p style={{ color: "#6b7280", fontSize: 13 }}>
          Institute for Supply Management — Monthly PMI components
        </p>
      </div>

      {!hasData ? (
        <EmptyState />
      ) : (
        <>
          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid #1f2937" }}>
            {[["chart","Time Series"],["heatmap","Heatmap"],["rankings","Sector Rankings"],["comments","Industry Comments"]].map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)} style={{
                background: "transparent", border: "none", cursor: "pointer",
                padding: "8px 16px", fontSize: 13, fontWeight: 500,
                color: tab === t ? "#3b82f6" : "#6b7280",
                borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent",
                marginBottom: -1,
              }}>
                {label}
              </button>
            ))}
          </div>

          {/* ── Chart Tab ── */}
          {tab === "chart" && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                {components.map((col) => {
                  const on = active.has(col);
                  return (
                    <button key={col} onClick={() => toggleComponent(col)} style={{
                      padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                      border: `1px solid ${on ? COMPONENT_COLORS[col] : "#374151"}`,
                      background: on ? `${COMPONENT_COLORS[col]}22` : "transparent",
                      color: on ? COMPONENT_COLORS[col] : "#6b7280",
                      fontWeight: on ? 600 : 400,
                    }}>
                      {labels[col] ?? col}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
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

              <div style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 12, padding: "16px 8px 8px" }}>
                <LineChart dates={null} datasets={datasets} visibleRange={visibleRange} referenceLine={50} />
              </div>
            </>
          )}

          {/* ── Heatmap Tab ── */}
          {tab === "heatmap" && series && (
            <HeatmapView series={series} labels={labels} components={components} />
          )}

          {/* ── Rankings Tab ── */}
          {tab === "rankings" && (
            rankingsLoading
              ? <LoadingState />
              : <RankingsView allRankings={allRankings} labels={labels} components={components} />
          )}

          {/* ── Industry Comments Tab ── */}
          {tab === "comments" && (
            commentsLoading
              ? <LoadingState />
              : <IndustryCommentsView
                  industryList={commentsIndustryList}
                  selectedIndustry={commentsIndustry}
                  onIndustryChange={(ind) => { setCommentsIndustry(ind); setCommentsData(null); }}
                  components={components}
                  labels={labels}
                  selectedComponent={commentsComponent}
                  onComponentChange={(c) => { setCommentsComponent(c); setCommentsIndustryList([]); setCommentsData(null); }}
                  data={commentsData}
                />
          )}
        </>
      )}
    </PageShell>
  );
}

// ── Shared score color helper ──────────────────────────────────────────────────

function scoreColor(s) {
  if (!s) return "#ca8a04";
  if (s >= 10) return "#14532d";
  if (s >= 7)  return "#166534";
  if (s >= 4)  return "#16a34a";
  if (s >= 1)  return "#4ade80";
  if (s <= -10) return "#7f1d1d";
  if (s <= -7)  return "#991b1b";
  if (s <= -4)  return "#ef4444";
  return "#fca5a5";
}

function scoreTextColor(s) {
  if (!s) return "#e5e7eb";
  if (Math.abs(s) >= 4) return "#e5e7eb";
  return "#111827";
}

// ── Heatmap (dates = rows, components = columns) ───────────────────────────────

function HeatmapView({ series, labels, components }) {
  const allDates = [...new Set(
    Object.values(series).flatMap((s) => s.dates)
  )].sort((a, b) => (a > b ? -1 : 1)).slice(0, 36);

  const lookup = {};
  for (const [col, s] of Object.entries(series)) {
    lookup[col] = {};
    s.dates.forEach((d, i) => { lookup[col][d] = s.values[i]; });
  }

  function heatColor(val) {
    if (val == null) return "#1a1a2e";
    if (val >= 60)  return "#166534";
    if (val >= 55)  return "#15803d";
    if (val >= 52)  return "#16a34a";
    if (val >= 50)  return "#4ade80";
    if (val >= 48)  return "#fbbf24";
    if (val >= 45)  return "#f97316";
    if (val >= 40)  return "#ef4444";
    return "#991b1b";
  }

  function textColor(val) {
    if (val == null) return "#374151";
    if (val >= 52 || val < 45) return "#e5e7eb";
    return "#111827";
  }

  const cellW = 50;
  const rowH  = 26;
  const dateW = 56;

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: dateW + components.length * (cellW + 2) }}>
        {/* Column headers: component labels (angled) */}
        <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 6, paddingLeft: dateW }}>
          {components.map((col) => (
            <div key={col} style={{
              width: cellW, flexShrink: 0, marginRight: 2,
              height: 60, display: "flex", alignItems: "flex-end", justifyContent: "center",
            }}>
              <div style={{
                fontSize: 9, color: "#9ca3af", textAlign: "center",
                transform: "rotate(-35deg)", transformOrigin: "bottom center",
                whiteSpace: "nowrap", marginBottom: 4,
              }}>
                {labels[col] ?? col}
              </div>
            </div>
          ))}
        </div>

        {/* Data rows: one per date */}
        {allDates.map((d) => (
          <div key={d} style={{ display: "flex", alignItems: "center", marginBottom: 2 }}>
            <div style={{ width: dateW, flexShrink: 0, fontSize: 11, color: "#6b7280", paddingRight: 8, textAlign: "right", whiteSpace: "nowrap" }}>
              {fmtDate(d)}
            </div>
            {components.map((col) => {
              const val = lookup[col]?.[d];
              return (
                <div key={col} title={val != null ? `${labels[col]}: ${val}` : "No data"} style={{
                  width: cellW - 2, height: rowH, flexShrink: 0, marginRight: 2,
                  background: heatColor(val), borderRadius: 3,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, fontWeight: 600, color: textColor(val),
                }}>
                  {val != null ? val.toFixed(1) : ""}
                </div>
              );
            })}
          </div>
        ))}

        {/* Legend */}
        <div style={{ display: "flex", gap: 8, marginTop: 16, paddingLeft: dateW, flexWrap: "wrap" }}>
          {[
            ["≥60","#166534"], ["55–60","#15803d"], ["52–55","#16a34a"], ["50–52","#4ade80"],
            ["48–50","#fbbf24"], ["45–48","#f97316"], ["40–45","#ef4444"], ["<40","#991b1b"],
          ].map(([label, color]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 12, height: 12, background: color, borderRadius: 2 }} />
              <span style={{ fontSize: 10, color: "#6b7280" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Sector Rankings (one heatmap per component) ────────────────────────────────

function RankingsView({ allRankings, labels, components }) {
  if (!allRankings) return <LoadingState />;

  const anyData = components.some((col) => allRankings[col]?.dates?.length > 0);
  if (!anyData) {
    return (
      <div style={{ color: "#6b7280", fontSize: 13 }}>
        No rankings data available. Import ISM reports and re-import to populate sector rankings.
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: "#4b5563", marginBottom: 24 }}>
        Score = rank position in growth (positive) or contraction (negative) list. Industries not mentioned = 0.
      </p>
      {components.map((col) => {
        const data = allRankings[col];
        if (!data?.dates?.length) return null;
        return (
          <div key={col} style={{ marginBottom: 40 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COMPONENT_COLORS[col] ?? "#e5e7eb", marginBottom: 12 }}>
              {labels[col] ?? col}
            </div>
            <ComponentRankHeatmap data={data} />
          </div>
        );
      })}
    </div>
  );
}

function ComponentRankHeatmap({ data }) {
  const { dates, industries, scores } = data;

  // Show up to 24 most recent months (oldest → newest left to right)
  const recentDates = [...dates].slice(-24);

  if (!industries.length) return (
    <div style={{ fontSize: 12, color: "#374151" }}>No industry data for this component.</div>
  );

  const cellW = 36;
  const industryW = 210;

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: industryW + recentDates.length * (cellW + 1) }}>
        {/* Date header */}
        <div style={{ display: "flex", alignItems: "flex-end", paddingLeft: industryW, marginBottom: 4 }}>
          {recentDates.map((d) => (
            <div key={d} style={{
              width: cellW, flexShrink: 0, marginRight: 1,
              height: 48, display: "flex", alignItems: "flex-end", justifyContent: "center",
            }}>
              <div style={{
                fontSize: 8, color: "#4b5563",
                transform: "rotate(-40deg)", transformOrigin: "bottom center",
                whiteSpace: "nowrap", marginBottom: 2,
              }}>
                {fmtDate(d)}
              </div>
            </div>
          ))}
        </div>

        {/* Industry rows */}
        {industries.map((ind) => (
          <div key={ind} style={{ display: "flex", alignItems: "center", marginBottom: 1 }}>
            <div style={{
              width: industryW, flexShrink: 0,
              fontSize: 10, color: "#9ca3af",
              paddingRight: 8, textAlign: "right",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {ind}
            </div>
            {recentDates.map((d, j) => {
              const idx = dates.indexOf(d);
              const s = scores[ind]?.[idx] ?? 0;
              return (
                <div key={j} title={`${ind} ${fmtDate(d)}: ${s}`} style={{
                  width: cellW, height: 18, flexShrink: 0, marginRight: 1,
                  background: scoreColor(s), borderRadius: 2,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 8, color: scoreTextColor(s), fontWeight: 600,
                }}>
                  {s !== 0 ? s : "0"}
                </div>
              );
            })}
          </div>
        ))}

        {/* Score legend */}
        <div style={{ display: "flex", gap: 8, marginTop: 10, paddingLeft: industryW, flexWrap: "wrap" }}>
          {[
            ["+10+","#14532d"],["+7","#166534"],["+4","#16a34a"],["+1","#4ade80"],
            ["0","#ca8a04"],
            ["-1","#fca5a5"],["-4","#ef4444"],["-7","#991b1b"],["-10−","#7f1d1d"],
          ].map(([label, color]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <div style={{ width: 10, height: 10, background: color, borderRadius: 2 }} />
              <span style={{ fontSize: 9, color: "#6b7280" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Industry Comments Tab ──────────────────────────────────────────────────────

const SELECT_STYLE = {
  background: "#0f172a", border: "1px solid #374151", borderRadius: 6,
  color: "#e5e7eb", fontSize: 13, padding: "5px 10px", cursor: "pointer",
};

function ScoreBadge({ score, totalGrowing, totalContracting }) {
  if (score > 0) return (
    <span style={{ background: "#16a34a", color: "#fff", borderRadius: 4, padding: "2px 10px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
      Growing · {score}/{totalGrowing}
    </span>
  );
  if (score < 0) return (
    <span style={{ background: "#dc2626", color: "#fff", borderRadius: 4, padding: "2px 10px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
      Contracting · {Math.abs(score)}/{totalContracting}
    </span>
  );
  return <span style={{ color: "#374151", fontSize: 12 }}>—</span>;
}

function IndustryCommentsView({ industryList, selectedIndustry, onIndustryChange, components, labels, selectedComponent, onComponentChange, data }) {
  if (industryList.length === 0) {
    return (
      <div style={{ color: "#6b7280", fontSize: 13, padding: "40px 0" }}>
        No rankings data available. Fetch the latest ISM report from the admin page first.
      </div>
    );
  }

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <select value={selectedIndustry || ""} onChange={(e) => onIndustryChange(e.target.value)} style={SELECT_STYLE}>
          {industryList.map((ind) => (
            <option key={ind} value={ind}>{ind}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {!data ? (
        <div style={{ color: "#6b7280", fontSize: 13 }}>Loading…</div>
      ) : data.rows?.length === 0 ? (
        <div style={{ color: "#6b7280", fontSize: 13 }}>No data for this industry.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1f2937" }}>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "#6b7280", fontWeight: 600, width: 80 }}>Month</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "#6b7280", fontWeight: 600, width: 160 }}>PMI Score</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "#6b7280", fontWeight: 600 }}>Respondent Comment</th>
              </tr>
            </thead>
            <tbody>
              {(data.rows || []).map((row, i) => (
                <tr key={row.date} style={{ background: i % 2 === 0 ? "#0f172a" : "#111827" }}>
                  <td style={{ padding: "10px 12px", color: "#9ca3af", whiteSpace: "nowrap", verticalAlign: "top" }}>
                    {fmtDate(row.date)}
                  </td>
                  <td style={{ padding: "10px 12px", verticalAlign: "top" }}>
                    <ScoreBadge score={row.score} totalGrowing={row.total_growing} totalContracting={row.total_contracting} />
                  </td>
                  <td style={{ padding: "10px 12px", color: row.comment ? "#d1d5db" : "#374151", lineHeight: 1.5, verticalAlign: "top" }}>
                    {row.comment ? `"${row.comment}"` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 12, fontSize: 11, color: "#4b5563" }}>
            Comments available from March 2026 forward.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function PageShell({ children }) {
  return (
    <div style={{ color: "#e5e7eb", maxWidth: 1200, margin: "0 auto", padding: "28px 24px" }}>
      {children}
    </div>
  );
}

function LoadingState() {
  return <div style={{ color: "#4b5563", fontSize: 14, padding: "40px 0" }}>Loading…</div>;
}

function EmptyState() {
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 12, padding: "32px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 14, color: "#6b7280", marginBottom: 12 }}>No ISM data imported yet.</div>
      <div style={{ fontSize: 13, color: "#4b5563" }}>
        Go to <span style={{ color: "#3b82f6" }}>Admin → ISM Data Import</span> to load historical reports.
      </div>
    </div>
  );
}
