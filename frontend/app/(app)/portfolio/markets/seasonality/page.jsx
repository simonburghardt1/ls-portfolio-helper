"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import PageHeader from "@/app/components/PageHeader";
import Button from "@/app/components/Button";
import LineChart from "@/app/components/LineChart";
import AssetSelector from "@/app/components/AssetSelector";

const MAX_YEARS = 8;

// A fixed reference year purely so every real year's 52 week-indexed values can be plotted
// on lightweight-charts' real calendar time-scale and overlay each other — see
// backend/app/services/seasonality.py's module docstring for why week-number (not calendar
// date) is the shared index between years in the first place.
const REF_YEAR = 2001;

function weekIndexDates() {
  const start = new Date(Date.UTC(REF_YEAR, 0, 1));
  return Array.from({ length: 52 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i * 7);
    return d.toISOString().slice(0, 10);
  });
}

const COHORTS = [
  { key: "all", label: "All Years" },
  { key: "election", label: "Election" },
  { key: "pre_election", label: "Pre-Election" },
  { key: "midterm", label: "Midterm" },
  { key: "post_election", label: "Post-Election" },
];

// Same 8-color rotation the Basket detail page's multi-compare uses, minus the purple slot
// (reserved elsewhere in this app as "the selected asset's own line" — not needed here since
// there's no separate "this asset" baseline line, every year is a peer).
const YEAR_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#ec4899", "#84cc16"];
const COHORT_AVG_COLOR = "#f59e0b";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pct(v, dp = 2) {
  if (v == null || isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`;
}

// Same green/red heat-map convention as portfolio/risk/volatility's corrColor — alpha scaled
// by magnitude relative to the observed max in the table, not fixed thresholds.
function heatColor(val, maxAbs) {
  if (val == null || !maxAbs) return "transparent";
  const t = Math.min(Math.abs(val) / maxAbs, 1);
  if (val > 0) return `rgba(22,163,74,${0.1 + t * 0.55})`;
  if (val < 0) return `rgba(220,38,38,${0.1 + t * 0.55})`;
  return "transparent";
}

const cellBase = { padding: "5px 8px", textAlign: "right", fontSize: 11.5, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const rowLabel = { padding: "5px 10px", fontSize: 11.5, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", textAlign: "left" };
const thStyle = { padding: "6px 8px", fontSize: 10, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right", borderBottom: "1px solid var(--border)" };
const thRowLabel = { ...thStyle, textAlign: "left" };
const sectionTitle = { fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 };
const panel = { background: "var(--bg-surface)", border: "1px solid var(--border)", padding: 16, marginBottom: 20 };

export default function SeasonalityPage() {
  const [asset, setAsset] = useState({ type: "stock", id: "SPY", label: "SPY" });
  const [mode, setMode] = useState("compare"); // "compare" | "cohort"
  const [selectedYears, setSelectedYears] = useState([]);
  const [cohort, setCohort] = useState("all");

  // A year selection from one asset means nothing for another — reset during render (same
  // pattern the Basket detail page uses for its own per-id reset), not in an Effect.
  const assetKey = `${asset.type}:${asset.id}`;
  const [prevAssetKey, setPrevAssetKey] = useState(assetKey);
  if (assetKey !== prevAssetKey) {
    setPrevAssetKey(assetKey);
    setSelectedYears([]);
  }

  const { data: baskets } = useQuery({
    queryKey: ["baskets"],
    queryFn: () => api.get("/api/baskets"),
  });

  const ready = Boolean(asset.id);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["seasonality", asset.type, asset.id],
    queryFn: () => api.get(`/api/seasonality?asset_type=${asset.type}&asset_id=${encodeURIComponent(asset.id)}`),
    enabled: ready,
  });

  const years = useMemo(() => data?.years ?? [], [data]);
  const yearsDesc = useMemo(() => [...years].sort((a, b) => b.year - a.year), [years]);

  function toggleYear(year) {
    setSelectedYears((prev) => {
      if (prev.includes(year)) return prev.filter((y) => y !== year);
      if (prev.length >= MAX_YEARS) return prev;
      return [...prev, year];
    });
  }

  const refDates = useMemo(() => weekIndexDates(), []);

  const compareDatasets = useMemo(() => {
    return selectedYears
      .map((year, i) => {
        const y = years.find((yy) => yy.year === year);
        if (!y) return null;
        return {
          dates: refDates,
          data: y.week_cum_return.map((v) => (v == null ? null : v * 100)),
          borderColor: YEAR_COLORS[i % YEAR_COLORS.length],
          borderWidth: 1.5,
          label: String(year),
        };
      })
      .filter(Boolean);
  }, [selectedYears, years, refDates]);

  const cohortYears = useMemo(
    () => years.filter((y) => cohort === "all" || y.cycle_phase === cohort),
    [years, cohort]
  );

  const cohortAverageDataset = useMemo(() => {
    if (!cohortYears.length) return null;
    const avg = Array.from({ length: 52 }, (_, i) => {
      const vals = cohortYears.map((y) => y.week_cum_return[i]).filter((v) => v != null);
      return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) * 100 : null;
    });
    const label = COHORTS.find((c) => c.key === cohort)?.label ?? cohort;
    return {
      dates: refDates,
      data: avg,
      borderColor: COHORT_AVG_COLOR,
      borderWidth: 2.5,
      label: `${label} avg (${cohortYears.length} yrs)`,
    };
  }, [cohortYears, cohort, refDates]);

  const monthly = data?.monthly_returns;
  const maxAbsReturn = useMemo(() => {
    if (!monthly) return 0;
    let max = 0;
    for (const row of monthly.rows) {
      for (const m of row.months) if (m != null) max = Math.max(max, Math.abs(m));
    }
    for (const a of monthly.avg_by_month) if (a != null) max = Math.max(max, Math.abs(a));
    return max;
  }, [monthly]);

  const chartDatasets = mode === "compare" ? compareDatasets : cohortAverageDataset ? [cohortAverageDataset] : [];

  return (
    <div style={{ padding: "28px 32px", minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <PageHeader
        title="Seasonality"
        subtitle="Weekly year-over-year return pattern and a monthly returns heatmap, for any asset."
      />

      <div style={{ display: "flex", gap: 24, marginBottom: 24, flexWrap: "wrap" }}>
        <AssetSelector label="Asset" baskets={baskets ?? []} selection={asset} onChange={setAsset} />
      </div>

      {isLoading && (
        <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>Loading…</div>
      )}
      {isError && (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--negative)", padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "var(--negative)" }}>
          Could not load seasonality data.
        </div>
      )}

      {data && years.length > 0 && (
        <>
          <div style={sectionTitle}>Weekly Seasonality — {asset.label}</div>

          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            <Button variant="range-toggle" active={mode === "compare"} onClick={() => setMode("compare")}>Compare Years</Button>
            <Button variant="range-toggle" active={mode === "cohort"} onClick={() => setMode("cohort")}>Cohort Average</Button>
          </div>

          {mode === "compare" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Years
              </span>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {yearsDesc.map((y) => (
                  <Button key={y.year} variant="range-toggle" active={selectedYears.includes(y.year)} onClick={() => toggleYear(y.year)}>
                    {y.year}
                  </Button>
                ))}
              </div>
              {selectedYears.length >= MAX_YEARS && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  {MAX_YEARS} selected — remove one to add another.
                </span>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Cohort
              </span>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {COHORTS.map((c) => (
                  <Button key={c.key} variant="range-toggle" active={cohort === c.key} onClick={() => setCohort(c.key)}>
                    {c.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div style={panel}>
            {chartDatasets.length > 0 ? (
              <LineChart dates={refDates} datasets={chartDatasets} referenceLine={0} />
            ) : (
              <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
                {mode === "compare" ? "Select at least one year above." : "No years match this cohort."}
              </div>
            )}
          </div>

          {monthly && monthly.rows.length > 0 && (
            <>
              <div style={sectionTitle}>Monthly Returns — {asset.label}</div>
              <div style={{ ...panel, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={thRowLabel}>Year</th>
                      {MONTH_LABELS.map((m) => <th key={m} style={thStyle}>{m}</th>)}
                      <th style={thStyle}>Year</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...monthly.rows].reverse().map((row) => (
                      <tr key={row.year}>
                        <td style={rowLabel}>{row.year}</td>
                        {row.months.map((m, i) => (
                          <td key={i} style={{ ...cellBase, background: heatColor(m, maxAbsReturn) }}>{pct(m)}</td>
                        ))}
                        <td style={{ ...cellBase, fontWeight: 600, background: heatColor(row.total, maxAbsReturn) }}>{pct(row.total)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ ...rowLabel, borderTop: "1px solid var(--border)" }}>Avg</td>
                      {monthly.avg_by_month.map((a, i) => (
                        <td key={i} style={{ ...cellBase, borderTop: "1px solid var(--border)", background: heatColor(a, maxAbsReturn) }}>{pct(a)}</td>
                      ))}
                      <td style={{ ...cellBase, borderTop: "1px solid var(--border)" }}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {data && years.length === 0 && (
        <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
          Not enough price history for this asset.
        </div>
      )}
    </div>
  );
}
