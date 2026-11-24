"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import LineChart from "@/app/components/LineChart";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import Tabs from "@/app/components/Tabs";
import Button from "@/app/components/Button";
import Select from "@/app/components/Select";
import InfoTip from "@/app/components/InfoTip";
import DataTable from "@/app/components/DataTable";
import StateMessage from "@/app/components/StateMessage";
import SeriesLegend from "@/app/components/SeriesLegend";
import { toggleKeepOne } from "@/app/components/SeriesCards";
import { authFetch } from "@/app/lib/api";
import { latestLegend } from "@/app/lib/macro";

/**
 * ISM Manufacturing and ISM Services share this page; `config` holds what differs:
 *   kind          "manufacturing" | "services" (API path segment)
 *   title, subtitle
 *   colors        { component → line colour }
 *   defaultActive components shown in the time-series chart at first
 *   invertedCol   component where a reading below 50 is the bullish one (heatmap colours it mirrored)
 *   invertedNote  legend note for that column
 *   name          "ISM" / "ISM Services" (empty-state copy)
 *   adminHref     admin import page
 */

const API = "http://localhost:8000";

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
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);
  return { from: from.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };
}

export default function IsmDashboard({ config }) {
  const { kind } = config;
  const base = `${API}/api/ism/${kind}`;

  const [series, setSeries]   = useState(null);
  const [labels, setLabels]   = useState({});
  const [active, setActive]   = useState(() => new Set(config.defaultActive));
  const [range, setRange]     = useState("5Y");
  const [tab, setTab]         = useState("chart");
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // Rankings: map of component → API response, loaded on first visit of the tab
  const [allRankings, setAllRankings] = useState(null);

  useEffect(() => {
    authFetch(`${base}/series`)
      .then((r) => r.json())
      .then((d) => { setSeries(d.series); setLabels(d.labels); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [base]);

  const components = series ? Object.keys(series) : Object.keys(config.colors);

  useEffect(() => {
    if (tab !== "rankings" || allRankings !== null) return;
    Promise.all(
      components.map((col) =>
        authFetch(`${base}/rankings?component=${col}`)
          .then((r) => r.json())
          .then((d) => [col, d])
          .catch(() => [col, { dates: [], industries: [], scores: {} }])
      )
    ).then((results) => setAllRankings(Object.fromEntries(results)));
  }, [tab, allRankings, components, base]);

  if (loading) return <Page><StateMessage kind="loading" /></Page>;
  if (error)   return <Page><StateMessage kind="error">{error}</StateMessage></Page>;

  const hasData = series && Object.values(series).some((s) => s.dates.length > 0);
  const seriesOf = (col) => ({ ...series[col], label: labels[col] ?? col, color: config.colors[col] });

  const datasets = components
    .filter((col) => active.has(col) && series[col]?.dates?.length)
    .map((col) => ({
      dates: series[col].dates, data: series[col].values, borderColor: config.colors[col],
      borderWidth: col === "pmi" ? 2.5 : 1.5, label: labels[col] ?? col,
    }));

  return (
    <Page>
      <PageHeader title={config.title} subtitle={config.subtitle} />

      {!hasData ? (
        <StateMessage>
          No {config.name} data imported yet. Load historical reports under{" "}
          <Link href={config.adminHref} style={{ color: "var(--text-primary)" }}>Admin → {config.name} Data Import</Link>.
        </StateMessage>
      ) : (
        <>
          <Tabs
            tabs={[
              { key: "chart",    label: "Time Series" },
              { key: "heatmap",  label: "Heatmap" },
              { key: "rankings", label: "Sector Rankings" },
              { key: "comments", label: "Industry Comments" },
              { key: "report",   label: "Full Report" },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === "chart" && (
            <Panel
              titleExtra={
                <SeriesLegend
                  {...latestLegend(components.filter((c) => series[c]?.dates?.length).map((c) => [c, seriesOf(c)]), { dp: 1 })}
                  active={active}
                  onToggle={(k) => setActive((p) => toggleKeepOne(p, k))}
                />
              }
              actions={RANGES.map((r) => (
                <Button key={r.label} variant="range-toggle" active={range === r.label} onClick={() => setRange(r.label)}>{r.label}</Button>
              ))}
            >
              <LineChart dates={null} datasets={datasets} visibleRange={rangeFrom(RANGES.find((r) => r.label === range)?.years)} referenceLine={50} />
            </Panel>
          )}

          {tab === "heatmap" && <HeatmapView series={series} labels={labels} components={components} config={config} />}

          {tab === "rankings" && (
            allRankings === null
              ? <StateMessage kind="loading" />
              : <RankingsView allRankings={allRankings} labels={labels} components={components} />
          )}

          {tab === "comments" && <IndustryCommentsView base={base} components={components} />}

          {tab === "report" && <FullReportView base={base} />}
        </>
      )}
    </Page>
  );
}

// ── Heatmap (dates = rows, components = columns) ───────────────────────────────

// ISM readings: 50 = no change; green expanding, amber/red contracting
const PMI_SCALE = [
  [60, "#166534", "≥60"], [55, "#15803d", "55–60"], [52, "#16a34a", "52–55"], [50, "#4ade80", "50–52"],
  [48, "#fbbf24", "48–50"], [45, "#f97316", "45–48"], [40, "#ef4444", "40–45"], [-Infinity, "#991b1b", "<40"],
];

function pmiColor(val) {
  if (val == null) return "var(--bg-surface)";
  return PMI_SCALE.find(([min]) => val >= min)[1];
}

function pmiTextColor(val) {
  if (val == null) return "var(--text-disabled)";
  return val >= 52 || val < 45 ? "#e5e7eb" : "#111827"; // dark text on the light middle shades
}

function HeatmapView({ series, labels, components, config }) {
  const allDates = [...new Set(Object.values(series).flatMap((s) => s.dates))].sort((a, b) => (a > b ? -1 : 1));

  const lookup = {};
  for (const [col, s] of Object.entries(series)) {
    lookup[col] = {};
    s.dates.forEach((d, i) => { lookup[col][d] = s.values[i]; });
  }

  const cellW = 76;
  const rowH  = 28;
  const dateW = 64;
  const gridW = dateW + components.length * cellW;

  const gridRef   = useRef(null);
  const headerRef = useRef(null);
  const [pinnedLeft, setPinnedLeft] = useState(null); // set while the in-flow header is off-screen

  // The page scrolls on the window, but the app layout's <main> has overflow: auto — that's what
  // a CSS-sticky header would bind to, and <main> never scrolls itself. So a fixed copy of the
  // header is shown at the top of the window while the grid is on screen but its header isn't.
  useEffect(() => {
    function update() {
      const grid = gridRef.current, header = headerRef.current;
      if (!grid || !header) return;
      const g = grid.getBoundingClientRect();
      const next = g.top < 0 && g.bottom > header.offsetHeight ? Math.round(g.left) : null;
      setPinnedLeft((prev) => (prev === next ? prev : next)); // no re-render of ~10k cells per scroll event
    }
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const header = (
    <div style={{ display: "flex", alignItems: "flex-end", padding: `8px 0 8px ${dateW}px` }}>
      {components.map((col) => (
        <div key={col} style={{
          width: cellW - 2, flexShrink: 0, marginRight: 2, textAlign: "center",
          fontSize: 12, fontWeight: 600, lineHeight: 1.25, color: "var(--text-primary)", overflowWrap: "anywhere",
        }}>
          {labels[col] ?? col}
        </div>
      ))}
    </div>
  );

  return (
    <div ref={gridRef} style={{ minWidth: gridW }}>
      {/* Column headers — in place, plus a copy pinned to the window top while scrolled past */}
      <div ref={headerRef}>{header}</div>
      {pinnedLeft !== null && (
        <div style={{
          position: "fixed", top: 0, left: pinnedLeft, width: gridW, zIndex: 10,
          background: "var(--bg-base)", borderBottom: "1px solid var(--border)",
        }}>
          {header}
        </div>
      )}

      {allDates.map((d) => (
        <div key={d} style={{ display: "flex", alignItems: "center", marginBottom: 2 }}>
          <div style={{ width: dateW, flexShrink: 0, fontSize: 12, color: "var(--text-secondary)", paddingRight: 8, textAlign: "right", whiteSpace: "nowrap" }}>
            {fmtDate(d)}
          </div>
          {components.map((col) => {
            const val = lookup[col]?.[d];
            const colorVal = val != null && col === config.invertedCol ? 100 - val : val;
            return (
              <div key={col} title={val != null ? `${labels[col]}: ${val}` : "No data"} style={{
                width: cellW - 2, height: rowH, flexShrink: 0, marginRight: 2,
                background: pmiColor(colorVal), borderRadius: 3,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 600, color: pmiTextColor(colorVal),
              }}>
                {val != null ? val.toFixed(1) : ""}
              </div>
            );
          })}
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 16, paddingLeft: dateW, flexWrap: "wrap", alignItems: "center" }}>
        {PMI_SCALE.map(([, color, label]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 12, height: 12, background: color, borderRadius: 2 }} />
            <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>{label}</span>
          </div>
        ))}
        <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>· {config.invertedNote}</span>
      </div>
    </div>
  );
}

// ── Sector Rankings (one heatmap per component) ────────────────────────────────

// Score = rank in the growth (+) or contraction (−) list
const SCORE_SCALE = [
  ["+10+", "#14532d"], ["+7", "#166534"], ["+4", "#16a34a"], ["+1", "#4ade80"],
  ["0", "#ca8a04"],
  ["-1", "#fca5a5"], ["-4", "#ef4444"], ["-7", "#991b1b"], ["-10−", "#7f1d1d"],
];

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
  if (!s || Math.abs(s) >= 4) return "#e5e7eb";
  return "#111827";
}

const RANKINGS_INFO = "Score = an industry's rank in that month's growth list (positive) or contraction list (negative). Industries not mentioned = 0.";

function RankingsView({ allRankings, labels, components }) {
  const shown = components.filter((col) => allRankings[col]?.dates?.length > 0);
  if (!shown.length) return <StateMessage>No rankings data yet. Re-import the ISM reports to fill the sector rankings.</StateMessage>;

  return shown.map((col, i) => (
    <Panel key={col} title={labels[col] ?? col} titleExtra={i === 0 && <InfoTip text={RANKINGS_INFO} />}>
      <ComponentRankHeatmap data={allRankings[col]} />
    </Panel>
  ));
}

const RANK_VISIBLE_MONTHS = 24;

function ComponentRankHeatmap({ data }) {
  const { dates, industries, scores } = data;
  const scrollRef = useRef(null);

  // All months, oldest → newest left to right. The viewport is sized to 24 months and opens
  // scrolled to the newest end; older months are reached via the horizontal scrollbar.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [dates]);

  if (!industries.length) return <div style={{ fontSize: 12, color: "var(--text-disabled)" }}>No industry data for this component.</div>;

  const cellW = 36;
  const industryW = 210;
  // Industry labels stay pinned while the month columns scroll underneath them.
  const pinned = { position: "sticky", left: 0, zIndex: 1, background: "var(--bg-surface)" };

  return (
    <div>
      <div ref={scrollRef} style={{ overflowX: "auto", maxWidth: industryW + RANK_VISIBLE_MONTHS * (cellW + 1) }}>
        <div style={{ width: industryW + dates.length * (cellW + 1) }}>
          <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 4 }}>
            <div style={{ ...pinned, width: industryW, flexShrink: 0, alignSelf: "stretch" }} />
            {dates.map((d) => (
              <div key={d} style={{ width: cellW, flexShrink: 0, marginRight: 1, height: 48, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                <div style={{ fontSize: 8, color: "var(--text-secondary)", transform: "rotate(-40deg)", transformOrigin: "bottom center", whiteSpace: "nowrap", marginBottom: 2 }}>
                  {fmtDate(d)}
                </div>
              </div>
            ))}
          </div>

          {industries.map((ind) => (
            <div key={ind} style={{ display: "flex", alignItems: "center", marginBottom: 1 }}>
              <div style={{
                ...pinned,
                width: industryW, flexShrink: 0,
                height: 18, lineHeight: "18px", // full row height so scrolled cells can't peek out
                fontSize: 10, color: "var(--text-secondary)",
                paddingRight: 8, textAlign: "right",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>
                {ind}
              </div>
              {dates.map((d, j) => {
                const s = scores[ind]?.[j] ?? 0;
                return (
                  <div key={j} title={`${ind} ${fmtDate(d)}: ${s}`} style={{
                    width: cellW, height: 18, flexShrink: 0, marginRight: 1,
                    background: scoreColor(s), borderRadius: 2,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 8, color: scoreTextColor(s), fontWeight: 600,
                  }}>
                    {s}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Score legend — outside the scroller so it doesn't move with the months */}
      <div style={{ display: "flex", gap: 8, marginTop: 10, paddingLeft: industryW, flexWrap: "wrap" }}>
        {SCORE_SCALE.map(([label, color]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <div style={{ width: 10, height: 10, background: color, borderRadius: 2 }} />
            <span style={{ fontSize: 9, color: "var(--text-secondary)" }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Industry Comments Tab ──────────────────────────────────────────────────────

function IndustryCommentsView({ base }) {
  const [industries, setIndustries] = useState(null);
  const [industry, setIndustry]     = useState(null);
  const [history, setHistory]       = useState(null); // { industry, rows }

  // Industry list from the PMI rankings
  useEffect(() => {
    authFetch(`${base}/rankings?component=pmi`)
      .then((r) => r.json())
      .then((d) => {
        const list = (d.industries || []).sort();
        setIndustries(list);
        setIndustry((prev) => prev ?? list[0] ?? null);
      })
      .catch(() => setIndustries([]));
  }, [base]);

  useEffect(() => {
    if (!industry) return;
    authFetch(`${base}/industry-history?industry=${encodeURIComponent(industry)}&component=pmi`)
      .then((r) => r.json())
      .then((d) => setHistory({ industry, rows: d.rows ?? [] }))
      .catch(() => setHistory({ industry, rows: [] }));
  }, [base, industry]);

  if (industries === null) return <StateMessage kind="loading" />;
  if (industries.length === 0) return <StateMessage>No rankings data yet. Fetch the latest ISM report on the admin page first.</StateMessage>;

  const loadingRows = history?.industry !== industry;

  return (
    <Panel
      flush
      actions={<Select ariaLabel="Industry" width={320} value={industry} onChange={setIndustry} options={industries.map((i) => ({ value: i, label: i }))} />}
      title="Respondent comments"
    >
      {loadingRows ? <StateMessage kind="loading" /> : (
        <DataTable
          inset
          rows={history.rows}
          rowKey="date"
          empty="No data for this industry."
          columns={[
            { key: "date", label: "Month", width: 90, format: fmtDate, color: () => "var(--text-secondary)" },
            {
              key: "score", label: "PMI rank", width: 170,
              render: (r) => r.score > 0 ? <span style={{ color: "var(--positive)" }}>Growing · {r.score}/{r.total_growing}</span>
                : r.score < 0 ? <span style={{ color: "var(--negative)" }}>Contracting · {Math.abs(r.score)}/{r.total_contracting}</span>
                : <span style={{ color: "var(--text-disabled)" }}>—</span>,
            },
            {
              key: "comment", label: "Comment",
              render: (r) => (
                <div style={{ whiteSpace: "normal", lineHeight: 1.5, color: r.comment ? "var(--text-primary)" : "var(--text-disabled)" }}>
                  {r.comment ? `"${r.comment}"` : "—"}
                </div>
              ),
            },
          ]}
        />
      )}
    </Panel>
  );
}

// ── Full Report Tab ────────────────────────────────────────────────────────────

function fmtMonthLong(d) {
  const [y, m] = d.split("-");
  return `${["January","February","March","April","May","June","July","August","September","October","November","December"][parseInt(m) - 1]} ${y}`;
}

function FullReportView({ base }) {
  const [dates, setDates]       = useState(null);
  const [selected, setSelected] = useState(null);
  const [report, setReport]     = useState(null); // { date, html, source_url } or { date, error }
  const [error, setError]       = useState(null);

  useEffect(() => {
    authFetch(`${base}/reports`)
      .then((r) => r.json())
      .then((d) => {
        setDates(d.dates || []);
        if (d.dates?.length) setSelected(d.dates[0]); // newest first
      })
      .catch((e) => setError(e.message));
  }, [base]);

  useEffect(() => {
    if (!selected) return;
    authFetch(`${base}/reports/${selected}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setReport({ ...d, date: selected }))
      .catch((e) => setReport({ date: selected, error: e.message }));
  }, [base, selected]);

  if (error) return <StateMessage kind="error">{error}</StateMessage>;
  if (dates === null) return <StateMessage kind="loading" />;
  if (dates.length === 0) return <StateMessage>No full reports stored yet. Import ISM reports on the admin page first.</StateMessage>;

  const current = report?.date === selected ? report : null;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <Select ariaLabel="Report month" value={selected} onChange={setSelected} options={dates.map((d) => ({ value: d, label: fmtMonthLong(d) }))} />
        {current?.source_url && (
          <a href={current.source_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Open on PRNewswire ↗
          </a>
        )}
      </div>

      {!current && <StateMessage kind="loading" />}
      {current?.error && <StateMessage kind="error">Could not load the report: {current.error}</StateMessage>}

      {current?.html && (
        <>
          <style>{`
            .ism-full-report { max-width: 920px; overflow-x: auto; font-size: 14px; line-height: 1.6; color: var(--text-primary); }
            .ism-full-report p { margin: 0 0 12px; }
            .ism-full-report ul, .ism-full-report ol { margin: 0 0 12px; padding-left: 22px; }
            .ism-full-report table { border-collapse: collapse; margin: 8px 0 20px; font-size: 12px; width: 100%; }
            .ism-full-report td, .ism-full-report th { border: 1px solid var(--border); padding: 4px 8px; vertical-align: top; }
            .ism-full-report tr:first-child td { color: var(--text-secondary); }
          `}</style>
          {/* report.html is whitelist-sanitized server-side (ism_scraper._extract_report_html) */}
          <div className="ism-full-report" dangerouslySetInnerHTML={{ __html: current.html }} />
        </>
      )}
    </>
  );
}
