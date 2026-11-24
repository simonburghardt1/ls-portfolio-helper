"use client";

import { useEffect, useState } from "react";
import LineChart from "@/app/components/LineChart";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import Tabs from "@/app/components/Tabs";
import Button from "@/app/components/Button";
import Select from "@/app/components/Select";
import InfoTip from "@/app/components/InfoTip";
import Page from "@/app/components/Page";
import StateMessage from "@/app/components/StateMessage";
import SeriesLegend from "@/app/components/SeriesLegend";
import { toggleKeepOne } from "@/app/components/SeriesCards";
import { authFetch } from "@/app/lib/api";
import { MACRO_RANGES, rangeFrom, latestLegend } from "@/app/lib/macro";
import { useAuthStore } from "@/app/store/authStore";

const API = "http://localhost:8000";

const TABS = ["Components", "Industries", "Regions"];

const LEADING_COLOR = "var(--chart-7)";
const LEADING_INFO =
  "Leading Indicator (dashed): z-score average of the five forward-looking components (good time to expand, " +
  "hiring, inventory and sales plans, expected economy), scaled so its mean is 100 and one standard deviation is 10 points. " +
  "Only months where all five are reported.";

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

// ── Shared UI ──────────────────────────────────────────────────────────────────

/** Range buttons, plus the data refresh for admins (the refresh endpoints are admin-only). */
function Toolbar({ range, onRange, onRefresh, refreshing }) {
  const isAdmin = useAuthStore((s) => !!s.user?.is_admin);
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, marginBottom: "var(--space-4)" }}>
      {MACRO_RANGES.map((r) => (
        <Button key={r.label} variant="range-toggle" active={range === r.label} onClick={() => onRange(r.label)}>{r.label}</Button>
      ))}
      {isAdmin && (
        <Button variant="secondary" onClick={onRefresh} disabled={refreshing} title="Fetch the latest data from NFIB" style={{ marginLeft: 8, padding: "3px 10px" }}>
          {refreshing ? "…" : "↻"}
        </Button>
      )}
    </div>
  );
}

/** Empty state before the first fetch; the fetch button only for admins. */
function EmptyState({ message, onFetch, fetching }) {
  const isAdmin = useAuthStore((s) => !!s.user?.is_admin);
  return (
    <StateMessage>
      <div style={{ marginBottom: isAdmin ? 12 : 0 }}>{message}</div>
      {isAdmin && <Button variant="primary" onClick={onFetch} disabled={fetching}>{fetching ? "Fetching…" : "Fetch from NFIB"}</Button>}
    </StateMessage>
  );
}

const toDatasets = (series, ids) =>
  ids.map((id) => ({ dates: series[id].dates, data: series[id].values, borderColor: series[id].color, borderWidth: 2, label: series[id].label }));

// ── Components tab ─────────────────────────────────────────────────────────────

function ComponentsTab() {
  const [series, setSeries]           = useState({});
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [range, setRange]             = useState("10Y");
  const [active, setActive]           = useState(null); // null = all components shown
  const [showLeading, setShowLeading] = useState(true);
  const [refreshing, setRefreshing]   = useState(false);

  function load() {
    return authFetch(`${API}/api/nfib/components`)
      .then((r) => r.json())
      .then((d) => { setSeries(d.series ?? {}); setActive(null); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await authFetch(`${API}/api/nfib/refresh`, { method: "POST" });
      if (!res.ok) throw new Error("Refresh failed");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <StateMessage kind="loading" />;
  if (error)   return <StateMessage kind="error">{error}</StateMessage>;
  if (!Object.keys(series).length) return <EmptyState message="No data yet." onFetch={handleRefresh} fetching={refreshing} />;

  const indexSeries   = series[INDEX_ID];
  const componentKeys = Object.keys(series).filter((k) => k !== INDEX_ID);
  const shown         = active ?? new Set(componentKeys);
  const leading       = computeLeadingIndicator(series);
  const visibleRange  = rangeFrom(MACRO_RANGES.find((r) => r.label === range)?.years);

  const indexDatasets = [
    ...(indexSeries ? toDatasets(series, [INDEX_ID]) : []),
    ...(leading && showLeading ? [{
      dates: leading.dates, data: leading.values, borderColor: LEADING_COLOR, borderWidth: 2, lineStyle: 2, label: "NFIB Leading Indicator",
    }] : []),
  ];

  return (
    <>
      <Toolbar range={range} onRange={setRange} onRefresh={handleRefresh} refreshing={refreshing} />

      {indexSeries && (
        <Panel
          titleExtra={
            <>
              <SeriesLegend
                {...latestLegend([
                  [INDEX_ID, indexSeries],
                  ...(leading ? [["leading", { ...leading, label: "Leading Indicator", color: LEADING_COLOR }]] : []),
                ], { dp: 1 })}
                active={new Set([INDEX_ID, ...(showLeading ? ["leading"] : [])])}
                onToggle={(k) => k === "leading" && setShowLeading((v) => !v)}
              />
              {leading && <InfoTip text={LEADING_INFO} />}
            </>
          }
        >
          <LineChart dates={null} datasets={indexDatasets} visibleRange={visibleRange} referenceLine={100} />
        </Panel>
      )}

      <Panel
        titleExtra={
          <SeriesLegend
            {...latestLegend(componentKeys.map((id) => [id, series[id]]), { dp: 1, unit: "%" })}
            active={shown}
            onToggle={(k) => setActive(toggleKeepOne(shown, k))}
          />
        }
      >
        <LineChart dates={null} datasets={toDatasets(series, componentKeys.filter((id) => shown.has(id)))} visibleRange={visibleRange} />
      </Panel>
    </>
  );
}

// ── Shared geo breakdown tab (used by both Industries and Regions) ─────────────
//
// Props:
//   indexUrl      – endpoint returning {series: {id → {dates,values,label,color}}}
//   componentsUrl – function(selectedId) → endpoint returning same shape
//   refreshUrl    – POST endpoint to force re-fetch
//   emptyMessage  – string shown before first fetch
//   groupLabel    – "Industry" / "Region"

function GeoBreakdownTab({ indexUrl, componentsUrl, refreshUrl, emptyMessage, groupLabel }) {
  const [series, setSeries]         = useState({});
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [range, setRange]           = useState("10Y");
  const [active, setActive]         = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [selected, setSelected]       = useState(null);
  const [compSeries, setCompSeries]   = useState({});
  const [compActive, setCompActive]   = useState(null);
  const [compLoading, setCompLoading] = useState(true);
  const [compError, setCompError]     = useState(null);

  function load() {
    return authFetch(indexUrl)
      .then((r) => r.json())
      .then((d) => {
        const s = d.series ?? {};
        setSeries(s);
        setActive(null);
        setSelected((prev) => prev ?? Object.keys(s)[0] ?? null);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  function select(id) {
    setSelected(id);
    setCompLoading(true);
    setCompError(null);
  }

  useEffect(() => {
    if (!selected) return;
    authFetch(componentsUrl(selected))
      .then((r) => r.json())
      .then((d) => { setCompSeries(d.series ?? {}); setCompActive(null); setCompLoading(false); })
      .catch((e) => { setCompError(e.message); setCompLoading(false); });
  }, [selected]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await authFetch(refreshUrl, { method: "POST" });
      if (!res.ok) throw new Error("Refresh failed");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <StateMessage kind="loading" />;
  if (error)   return <StateMessage kind="error">{error}</StateMessage>;
  if (!Object.keys(series).length) return <EmptyState message={emptyMessage} onFetch={handleRefresh} fetching={refreshing} />;

  const ids          = Object.keys(series);
  const shown        = active ?? new Set(ids);
  const compIds      = Object.keys(compSeries);
  const compShown    = compActive ?? new Set(compIds);
  const visibleRange = rangeFrom(MACRO_RANGES.find((r) => r.label === range)?.years);

  return (
    <>
      <Toolbar range={range} onRange={setRange} onRefresh={handleRefresh} refreshing={refreshing} />

      <Panel
        titleExtra={
          <SeriesLegend
            {...latestLegend(ids.map((id) => [id, series[id]]), { dp: 1 })}
            active={shown}
            onToggle={(k) => setActive(toggleKeepOne(shown, k))}
          />
        }
      >
        <LineChart dates={null} datasets={toDatasets(series, ids.filter((id) => shown.has(id)))} visibleRange={visibleRange} referenceLine={100} />
      </Panel>

      <Panel
        title="Component Breakdown"
        actions={
          <Select
            ariaLabel={groupLabel}
            value={selected}
            onChange={select}
            options={ids.map((id) => ({ value: id, label: series[id].label }))}
          />
        }
      >
        {compLoading ? <StateMessage kind="loading" /> : compError ? <StateMessage kind="error">{compError}</StateMessage> : compIds.length > 0 && (
          <>
            <div style={{ marginBottom: "var(--space-3)" }}>
              <SeriesLegend
                {...latestLegend(compIds.map((id) => [id, compSeries[id]]), { dp: 1, unit: "%" })}
                active={compShown}
                onToggle={(k) => setCompActive(toggleKeepOne(compShown, k))}
              />
            </div>
            <LineChart dates={null} datasets={toDatasets(compSeries, compIds.filter((id) => compShown.has(id)))} visibleRange={visibleRange} />
          </>
        )}
      </Panel>
    </>
  );
}

// ── Industries + Regions tabs (thin wrappers around GeoBreakdownTab) ───────────

function IndustriesTab() {
  return (
    <GeoBreakdownTab
      indexUrl={`${API}/api/nfib/industries`}
      componentsUrl={(id) => `${API}/api/nfib/industries/${id}/components`}
      refreshUrl={`${API}/api/nfib/refresh-industries`}
      emptyMessage="No industry data yet."
      groupLabel="Industry"
    />
  );
}

function RegionsTab() {
  return (
    <GeoBreakdownTab
      indexUrl={`${API}/api/nfib/regions`}
      componentsUrl={(id) => `${API}/api/nfib/regions/${id}/components`}
      refreshUrl={`${API}/api/nfib/refresh-regions`}
      emptyMessage="No regional data yet."
      groupLabel="Region"
    />
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function NfibPage() {
  const [tab, setTab] = useState("Components");

  return (
    <Page>
      <PageHeader
        title="NFIB Small Business Confidence"
        subtitle="National Federation of Independent Business, Survey of Small Business Economic Trends."
      />

      <Tabs
        tabs={TABS.map((t) => ({ key: t, label: t }))}
        active={tab}
        onChange={setTab}
      />

      {tab === "Components" && <ComponentsTab />}
      {tab === "Regions"    && <RegionsTab />}
      {tab === "Industries" && <IndustriesTab />}
    </Page>
  );
}
