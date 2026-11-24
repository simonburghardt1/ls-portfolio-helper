"use client";

import { useEffect, useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import LineChart from "@/app/components/LineChart";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import Tabs from "@/app/components/Tabs";
import Button from "@/app/components/Button";
import DataTable from "@/app/components/DataTable";
import StateMessage from "@/app/components/StateMessage";
import SeriesCards from "@/app/components/SeriesCards";
import InfoTip from "@/app/components/InfoTip";
import DistributionHistogram from "@/app/components/DistributionHistogram";
import DistributionStats from "@/app/components/DistributionStats";
import { authFetch } from "@/app/lib/api";
import { heatColor } from "@/app/lib/heat";
import { fmtMonth } from "@/app/lib/macro";

const API = "http://localhost:8000";

const RANGES = [
  { label: "5Y",  months: 60 },
  { label: "10Y", months: 120 },
  { label: "20Y", months: 240 },
  { label: "All", months: null },
];

// One colour rule for the whole page: amber = above the Fed's 2% target pace, blue = below.
// For a monthly change the target pace is (1.02)^(1/12) − 1 ≈ 0.165%.
const TARGET_YOY = 2;
const TARGET_MOM = (Math.pow(1 + TARGET_YOY / 100, 1 / 12) - 1) * 100;
const ABOVE = "var(--caution)";
const BELOW = "var(--chart-1)";
const PACE_INFO = "Amber = above the 2% inflation target (for monthly changes: above the 0.165% a month that compounds to 2% a year), blue = below.";

/** Text colour for a YoY % value: amber above target, blue below zero, else plain. */
function yoyColor(v) {
  if (v == null) return "var(--text-disabled)";
  if (v > TARGET_YOY) return ABOVE;
  if (v < 0) return BELOW;
  return "var(--text-primary)";
}

/** Text colour for a MoM % value, same rule at the monthly target pace. */
function momColor(v) {
  if (v == null) return "var(--text-disabled)";
  if (v > TARGET_MOM) return ABOVE;
  if (v < 0) return BELOW;
  return "var(--text-primary)";
}

/** "+0.30%" — values here are already in percent. */
function fmtP(v) {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

// ── Recharts pieces ───────────────────────────────────────────────────────────

const TIP_STYLE = { background: "var(--bg-elevated)", border: "1px solid var(--border)", padding: "8px 12px", fontSize: 12 };
const AXIS_TICK = { fontSize: 10, fill: "var(--text-secondary)" };
const GRID = "rgba(55,65,81,0.35)";

function BarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TIP_STYLE}>
      <div style={{ color: "var(--text-secondary)", marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: "var(--text-primary)" }}>
          {p.name}: <strong style={{ fontFamily: "var(--font-family-mono)" }}>{fmtP(p.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function TimeBars({ data, dataKey, name, colorOf, target }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ left: -10, right: 4, top: 0, bottom: 0 }} barCategoryGap="20%">
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
        <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} interval={Math.max(0, Math.floor(data.length / 8))} />
        <YAxis tick={AXIS_TICK} tickLine={false} tickFormatter={(v) => v.toFixed(1) + "%"} />
        <Tooltip content={<BarTooltip />} cursor={{ fill: "rgba(139,144,150,0.12)" }} />
        <ReferenceLine y={0} stroke="var(--border)" />
        {target != null && (
          <ReferenceLine y={target} stroke="var(--text-secondary)" strokeDasharray="4 4" label={{ value: "target", fill: "var(--text-secondary)", fontSize: 10, position: "insideTopRight" }} />
        )}
        <Bar dataKey={dataKey} name={name}>
          {data.map((d, i) => <Cell key={i} fill={colorOf(d[dataKey] ?? 0)} fillOpacity={0.8} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

const EMPTY = {};

function OverviewTab({ series }) {
  const seriesKeys = Object.keys(series);
  const [selectedSid, setSelectedSid] = useState(seriesKeys[0] ?? "CPIAUCSL");
  const [range, setRange] = useState("10Y");
  const [dist, setDist] = useState("mom");

  const sel = series[selectedSid] ?? EMPTY;

  // The selected range, shared by the bar charts and the distribution
  const span = useMemo(() => {
    const dates = sel.dates ?? [];
    const nMonths = RANGES.find((r) => r.label === range)?.months;
    const start = nMonths ? Math.max(0, dates.length - nMonths) : 0;
    const months = dates.slice(start).map((d) => d.slice(0, 7));
    return {
      months,
      mom: (sel.mom ?? []).slice(start),
      yoy: (sel.yoy ?? []).slice(start),
      bars: months.map((m, i) => ({ date: m, mom: sel.mom?.[start + i] ?? null, yoy: sel.yoy?.[start + i] ?? null })),
    };
  }, [sel, range]);

  const distValues = dist === "mom" ? span.mom : span.yoy;
  const latest = distValues.at(-1);

  return (
    <>
      {/* One card per index: latest YoY; click to show that index below */}
      <SeriesCards
        minWidth={170}
        items={seriesKeys.map((sid) => {
          const s = series[sid];
          return {
            key: sid, label: s.label, color: s.color,
            value: `${fmtP(s.yoy.at(-1))} YoY`,
            caption: `${fmtP(s.mom.at(-1))} MoM · ${fmtMonth(s.dates.at(-1))}`,
          };
        })}
        active={new Set([selectedSid])}
        onToggle={setSelectedSid}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginBottom: "var(--space-4)" }}>
        {RANGES.map((r) => (
          <Button key={r.label} variant="range-toggle" active={range === r.label} onClick={() => setRange(r.label)}>{r.label}</Button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "0 var(--space-4)" }}>
        <Panel title={`${sel.label ?? ""}, YoY %`} titleExtra={<InfoTip text={PACE_INFO} />}>
          <TimeBars data={span.bars} dataKey="yoy" name={sel.label} target={TARGET_YOY} colorOf={(v) => (v > TARGET_YOY ? ABOVE : BELOW)} />
        </Panel>
        <Panel title={`${sel.label ?? ""}, MoM %`}>
          <TimeBars data={span.bars} dataKey="mom" name={sel.label} target={TARGET_MOM} colorOf={(v) => (v > TARGET_MOM ? ABOVE : BELOW)} />
        </Panel>
      </div>

      <Panel
        title={`${sel.label ?? ""}, distribution of ${dist === "mom" ? "monthly" : "year-over-year"} changes`}
        actions={[["mom", "MoM"], ["yoy", "YoY"]].map(([k, l]) => (
          <Button key={k} variant="range-toggle" active={dist === k} onClick={() => setDist(k)}>{l}</Button>
        ))}
      >
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: "var(--space-6)" }}>
          <DistributionHistogram
            values={distValues}
            dates={span.months}
            format={(v) => `${v.toFixed(1)}%`}
            pivot={dist === "mom" ? TARGET_MOM : TARGET_YOY}
            colors={{ below: BELOW, above: ABOVE }}
            marker={latest != null ? { value: latest, label: `${fmtMonth(sel.dates?.at(-1))} ${fmtP(latest)}` } : undefined}
            height={360}
          />
          <DistributionStats values={distValues} dates={span.months} format={fmtP} periodLabel="month" />
        </div>
      </Panel>
    </>
  );
}

// ── Components Tab ────────────────────────────────────────────────────────────

function ComponentsTab({ components }) {
  const [expanded, setExpanded] = useState({});
  const [selected, setSelected] = useState(null);

  const childMap = useMemo(() => {
    const map = {};
    Object.entries(components).forEach(([sid, c]) => {
      if (c.parent) (map[c.parent] ??= []).push(sid);
    });
    return map;
  }, [components]);

  // Visible rows of the tree, depth-first, children only under expanded parents
  const rows = useMemo(() => {
    const out = [];
    const walk = (sid, depth) => {
      if (!components[sid]) return;
      out.push({ sid, depth, ...components[sid] });
      if (expanded[sid]) (childMap[sid] ?? []).forEach((c) => walk(c, depth + 1));
    };
    Object.keys(components).filter((sid) => !components[sid].parent).forEach((sid) => walk(sid, 0));
    return out;
  }, [components, childMap, expanded]);

  // The last 5 months, labelled from the first component
  const months = useMemo(() => {
    const first = Object.values(components)[0];
    return (first?.dates ?? []).slice(-5).map((d) => fmtMonth(d));
  }, [components]);

  const selectedComp = selected ? components[selected] : null;

  const columns = [
    {
      key: "label", label: "Category",
      render: (r) => (
        <span style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: r.depth * 20 }}>
          {childMap[r.sid] ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setExpanded((x) => ({ ...x, [r.sid]: !x[r.sid] })); }}
              aria-label={expanded[r.sid] ? `Collapse ${r.label}` : `Expand ${r.label}`}
              style={{ background: "transparent", border: "none", padding: 0, width: 12, color: "var(--text-secondary)", fontSize: 10, cursor: "pointer" }}
            >
              {expanded[r.sid] ? "▼" : "▶"}
            </button>
          ) : <span style={{ width: 12 }} />}
          <span style={{ fontWeight: r.depth === 0 ? 600 : 400, color: r.depth === 0 ? "var(--text-primary)" : "var(--text-secondary)" }}>{r.label}</span>
        </span>
      ),
    },
    { key: "weight", label: "Weight", numeric: true, format: (v) => `${v.toFixed(1)}%`, color: () => "var(--text-secondary)" },
    // Index level of each month, shaded by that month's change vs. the target pace (amber above, blue below)
    ...months.map((m, i) => ({
      key: `m${i}`, label: m, numeric: true,
      value: (r) => r.values.at(i - 5),
      format: (v) => (v != null ? v.toFixed(1) : "—"),
      cellStyle: (_, r) => ({ background: heatColor(r.mom.at(i - 5) - TARGET_MOM, 1, "diverging") }),
    })),
    { key: "latest_yoy", label: "YoY", numeric: true, format: fmtP, color: yoyColor },
  ];

  return (
    <>
      <Panel flush>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="sid"
          inset
          onRowClick={(r) => setSelected(selected === r.sid ? null : r.sid)}
          isRowSelected={(r) => r.sid === selected}
        />
      </Panel>

      {selectedComp ? (
        <Panel title={`${selectedComp.label}, YoY %`}>
          <LineChart
            dates={null}
            datasets={[{ dates: selectedComp.dates, data: selectedComp.yoy, borderColor: "var(--chart-1)", borderWidth: 2, label: `${selectedComp.label} YoY %` }]}
            referenceLine={TARGET_YOY}
          />
        </Panel>
      ) : (
        <StateMessage style={{ padding: "16px 0" }}>Click a row for its YoY chart.</StateMessage>
      )}
    </>
  );
}

// ── Insights Tab ──────────────────────────────────────────────────────────────

/** List of components with one value each (MoM or YoY). */
function InsightList({ title, items, valueKey, colorOf, empty, labelOf }) {
  return (
    <Panel title={title} style={{ marginBottom: 0 }}>
      {!items?.length && <div style={{ fontSize: 12, color: "var(--text-disabled)" }}>{empty}</div>}
      {items?.map((e) => (
        <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "5px 0" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: "var(--text-primary)" }}>{e.label}</div>
            {e.parent && <div style={{ fontSize: 11, color: "var(--text-disabled)" }}>{labelOf(e.parent)}</div>}
          </div>
          <span style={{ fontFamily: "var(--font-family-mono)", fontSize: 12.5, color: colorOf(e[valueKey]) }}>{fmtP(e[valueKey])}</span>
        </div>
      ))}
    </Panel>
  );
}

function InsightsTab({ insights, components }) {
  if (!insights) return <StateMessage kind="loading" />;
  const { biggest_movers, hot_spots, persistent_up, persistent_dn } = insights;
  // parent comes as a FRED series id; show its category name
  const labelOf = (sid) => components[sid]?.label ?? sid;
  const list = (props) => <InsightList labelOf={labelOf} {...props} />;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "var(--space-4)", alignItems: "start" }}>
      {list({ title: "Biggest increases this month", items: biggest_movers?.up, valueKey: "mom", colorOf: momColor, empty: "No data." })}
      {list({ title: "Biggest decreases this month", items: biggest_movers?.down, valueKey: "mom", colorOf: momColor, empty: "No data." })}
      {list({ title: "Hot spots (YoY > 5%)", items: hot_spots, valueKey: "yoy", colorOf: yoyColor, empty: "No components above 5% YoY." })}
      {list({ title: "Rising 3+ months in a row", items: persistent_up, valueKey: "mom", colorOf: momColor, empty: "No persistent increases." })}
      {list({ title: "Falling 3+ months in a row", items: persistent_dn, valueKey: "mom", colorOf: momColor, empty: "No persistent decreases." })}
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
      authFetch(`${API}/api/cpi-ppi/series`).then((r) => r.json()),
      authFetch(`${API}/api/cpi-ppi/components`).then((r) => r.json()),
      authFetch(`${API}/api/cpi-ppi/insights`).then((r) => r.json()),
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
    <Page>
      <PageHeader title="CPI & PPI" subtitle="Consumer and producer price indices. BLS / BEA via FRED." />

      <Tabs
        tabs={[
          { key: "overview",   label: "Overview" },
          { key: "components", label: "Components" },
          { key: "insights",   label: "Insights" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {loading && <StateMessage kind="loading" />}
      {error && <StateMessage kind="error">{error}</StateMessage>}

      {!loading && !error && (
        <>
          {tab === "overview"   && Object.keys(series).length > 0     && <OverviewTab series={series} />}
          {tab === "components" && Object.keys(components).length > 0 && <ComponentsTab components={components} />}
          {tab === "insights"   && <InsightsTab insights={insights} components={components} />}
        </>
      )}
    </Page>
  );
}
