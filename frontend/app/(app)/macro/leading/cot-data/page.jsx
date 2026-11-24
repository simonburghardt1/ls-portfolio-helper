"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import { signColor } from "@/app/lib/format";
import { heatColor } from "@/app/lib/heat";
import { rangeFrom } from "@/app/lib/macro";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import Button from "@/app/components/Button";
import Select from "@/app/components/Select";
import InfoTip from "@/app/components/InfoTip";
import DataTable from "@/app/components/DataTable";
import LineChart from "@/app/components/LineChart";
import SeriesLegend from "@/app/components/SeriesLegend";
import Sparkline from "@/app/components/Sparkline";
import StateMessage from "@/app/components/StateMessage";

const ASSET_CLASSES = [
  ["energy", "Energy"],
  ["precious_metals", "Precious Metals"],
  ["commodities", "Agriculture"],
  ["industrial_metals", "Industrial Metals"],
  ["currencies", "Currencies"],
  ["indices", "Indices"],
  ["crypto", "Crypto"],
];
const CLASS_LABEL = Object.fromEntries(ASSET_CLASSES);

const RANGES = [
  { label: "1Y", years: 1 },
  { label: "3Y", years: 3 },
  { label: "5Y", years: 5 },
  { label: "10Y", years: 10 },
  { label: "All", years: null },
];

const NET_COLOR = "var(--chart-1)";
const PRICE_COLOR = "var(--caution)";
const POSITION_SERIES = [
  { key: "long_pos", label: "Long", color: "var(--positive)" },
  { key: "short_pos", label: "Short", color: "var(--negative)" },
  { key: "open_interest", label: "Open interest", color: "var(--chart-4)" },
];

const NET_INFO =
  "Net position (long − short) as a share of total open interest. Managed Money (Disaggregated report) for commodities, Asset Managers (TFF report) for currencies, indices and crypto.";
const INDEX_INFO =
  "Where the latest net % sits in its own 3-year range: 0 = most short, 100 = most long of the last 156 reports.";

const fmtSignedPct = (v, dp = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(dp)}%`);
const fmtPp = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)} pp`);
const fmtK = (v) => {
  if (v == null) return "—";
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toLocaleString("en-US");
};
/** Axis labels for contract counts: 1250000 → "1.25M", 750000 → "750K" */
const fmtAxisCount = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${+(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(0)}K`;
  return `${+v.toFixed(0)}`;
};
const fmtSignedK = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${fmtK(v)}`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-03" → "3 Nov 2026" */
const fmtDate = (d) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`;
};

export default function CotDataPage() {
  const [selected, setSelected] = useState("gold");
  const [range, setRange] = useState("5Y");
  const [showPrice, setShowPrice] = useState(false);
  const [hiddenPositions, setHiddenPositions] = useState(() => new Set());

  const { data: overview, isError: ovError } = useQuery({ queryKey: ["cot-overview"], queryFn: () => api.get("/api/cot/overview") });
  const { data: contracts } = useQuery({ queryKey: ["cot-contracts"], queryFn: () => api.get("/api/cot/contracts") });
  const { data: series, isError: serError } = useQuery({
    queryKey: ["cot-series", selected],
    queryFn: () => api.get(`/api/cot/series/${selected}`),
    placeholderData: (prev) => prev,
  });
  const { data: price, isFetching: priceLoading } = useQuery({
    queryKey: ["cot-price", selected],
    queryFn: () => api.get(`/api/cot/price/${selected}`),
    enabled: showPrice,
    staleTime: 60 * 60 * 1000,
  });

  const current = series?.contract === selected ? series : null;
  const visibleRange = useMemo(() => rangeFrom(RANGES.find((r) => r.label === range)?.years), [range]);
  const reportDate = overview?.length ? overview.reduce((m, r) => (r.date > m ? r.date : m), "") : null;

  // ── Net % chart (+ optional price on the left axis) ──────────────────────────
  const hasPrice = showPrice && price?.dates?.length > 0;
  const netDatasets = useMemo(() => {
    if (!current?.dates?.length) return null;
    const ds = [{ dates: current.dates, data: current.net_pct, borderColor: NET_COLOR, borderWidth: 2, label: "Net %" }];
    if (hasPrice) {
      ds.push({ dates: price.dates, data: price.prices, borderColor: PRICE_COLOR, borderWidth: 1.5, label: price.ticker ?? "Price", priceScaleId: "left" });
    }
    return ds;
  }, [current, hasPrice, price]);

  const positionDatasets = useMemo(() => {
    if (!current?.dates?.length) return null;
    const showOi = !hiddenPositions.has("open_interest");
    return POSITION_SERIES.filter((s) => !hiddenPositions.has(s.key)).map((s) =>
      s.key === "open_interest"
        ? { dates: current.dates, data: current[s.key], borderColor: s.color, opacity: 0.4, label: "", type: "histogram", priceScaleId: "oi", scaleMargins: { top: 0.7, bottom: 0 } }
        : { dates: current.dates, data: current[s.key], borderColor: s.color, borderWidth: 1.5, label: s.label, scaleMargins: { top: 0.05, bottom: showOi ? 0.34 : 0.05 } },
    );
  }, [current, hiddenPositions]);

  // Weekly table, newest first, with the change in net % vs. the prior report
  const weeklyRows = useMemo(() => {
    if (!current?.dates?.length) return [];
    return current.dates
      .map((date, i) => ({
        date,
        long_pos: current.long_pos[i],
        short_pos: current.short_pos[i],
        net_pos: current.net_pos[i],
        open_interest: current.open_interest[i],
        net_pct: current.net_pct[i],
        change: i > 0 && current.net_pct[i] != null && current.net_pct[i - 1] != null ? current.net_pct[i] - current.net_pct[i - 1] : null,
      }))
      .reverse();
  }, [current]);

  const latest = weeklyRows[0];
  const posLatest = (key) => latest?.[key];

  const togglePosition = (key) =>
    setHiddenPositions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (POSITION_SERIES.length - next.size > 1) next.add(key); // keep one line visible
      return next;
    });

  const rangeButtons = RANGES.map((r) => (
    <Button key={r.label} variant="range-toggle" active={range === r.label} onClick={() => setRange(r.label)}>{r.label}</Button>
  ));

  const contractSelect = (
    <Select ariaLabel="Contract" value={selected} onChange={setSelected} width={200} style={{ marginRight: "var(--space-3)" }}>
      {ASSET_CLASSES.map(([ac, label]) => {
        const items = Object.entries(contracts ?? {}).filter(([, m]) => m.asset_class === ac);
        if (!items.length) return null;
        return (
          <optgroup key={ac} label={label}>
            {items.map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
          </optgroup>
        );
      })}
    </Select>
  );

  return (
    <Page>
      <PageHeader
        title="COT Positioning"
        subtitle="CFTC Commitments of Traders, weekly. Managed Money for commodities, Asset Managers for financial futures."
      />

      {ovError && <StateMessage kind="error">Could not load the COT overview.</StateMessage>}

      {/* ── Overview: every contract, latest report ───────────────────────────── */}
      <Panel
        title="Positioning"
        titleExtra={reportDate && <span style={{ fontSize: 12, color: "var(--text-disabled)" }}>Report of {fmtDate(reportDate)}</span>}
        flush
      >
        {!overview ? (
          !ovError && <StateMessage kind="loading" />
        ) : (
          <DataTable
            inset
            rowKey="contract"
            rows={overview}
            groupBy={(r) => r.asset_class}
            groupHeader={(ac, rows) => (
              <>
                {CLASS_LABEL[ac] ?? ac}
                <span style={{ marginLeft: 8, fontWeight: 400, letterSpacing: 0, color: "var(--text-disabled)" }}>{rows.length}</span>
              </>
            )}
            onRowClick={(r) => setSelected(r.contract)}
            isRowSelected={(r) => r.contract === selected}
            columns={[
              { key: "label", label: "Contract", sortable: true },
              {
                key: "net_pct", label: <>Net % of OI <InfoTip text={NET_INFO} /></>, sortable: true, numeric: true, width: 240,
                render: (r) => <NetBar value={r.net_pct} />,
              },
              { key: "change_1w", label: "1W change", sortable: true, numeric: true, format: fmtPp, color: signColor },
              {
                key: "cot_index", label: <>COT index 3Y <InfoTip text={INDEX_INFO} /></>, sortable: true, numeric: true, width: 150,
                render: (r) => <IndexGauge value={r.cot_index} />,
              },
              {
                key: "spark", label: "Net %, 1Y", width: 140,
                render: (r) => (r.spark?.length > 1 ? <div style={{ height: 24, width: 120 }}><Sparkline values={r.spark} color={NET_COLOR} /></div> : "—"),
              },
              {
                key: "date", label: "Report", numeric: true,
                format: (v) => fmtDate(v),
                color: (v) => (v === reportDate ? "var(--text-disabled)" : "var(--caution)"),
              },
            ]}
          />
        )}
      </Panel>

      {serError && <StateMessage kind="error">Could not load this contract.</StateMessage>}

      {/* ── Selected contract ─────────────────────────────────────────────────── */}
      {!current ? (
        !serError && <StateMessage kind="loading" />
      ) : !current.dates?.length ? (
        <StateMessage>No COT data for {current.label}.</StateMessage>
      ) : (
        <>
          <Panel
            title="Net % of open interest"
            titleExtra={
              <SeriesLegend
                items={[
                  { key: "net", label: "Net %", color: NET_COLOR, value: <span style={{ color: signColor(latest?.net_pct) }}>{fmtSignedPct(latest?.net_pct, 2)}</span> },
                  { key: "price", label: priceLoading && showPrice ? "Price (loading…)" : price?.ticker ? `Price ${price.ticker}` : "Price", color: PRICE_COLOR },
                ]}
                active={new Set(showPrice ? ["net", "price"] : ["net"])}
                onToggle={(k) => k === "price" && setShowPrice((v) => !v)}
                asOf={fmtDate(latest?.date)}
              />
            }
            actions={<>{contractSelect}{rangeButtons}</>}
          >
            <LineChart dates={current.dates} datasets={netDatasets} visibleRange={visibleRange} referenceLine={0} height={360} />
          </Panel>

          <Panel
            title={`${current.label} positions, contracts`}
            titleExtra={
              <SeriesLegend
                items={POSITION_SERIES.map((s) => ({ key: s.key, label: s.label, color: s.color, value: fmtK(posLatest(s.key)) }))}
                active={new Set(POSITION_SERIES.map((s) => s.key).filter((k) => !hiddenPositions.has(k)))}
                onToggle={togglePosition}
              />
            }
          >
            <LineChart dates={current.dates} datasets={positionDatasets} visibleRange={visibleRange} priceFormatter={fmtAxisCount} height={300} />
          </Panel>

          <Panel title="Weekly reports" flush>
            <DataTable
              inset
              stickyHeader
              maxHeight={440}
              rowKey="date"
              rows={weeklyRows}
              columns={[
                { key: "date", label: "Report", format: fmtDate },
                { key: "long_pos", label: "Long", numeric: true, format: fmtK },
                { key: "short_pos", label: "Short", numeric: true, format: fmtK },
                { key: "net_pos", label: "Net", numeric: true, format: fmtSignedK, color: signColor },
                { key: "open_interest", label: "Open interest", numeric: true, format: fmtK },
                { key: "net_pct", label: "Net %", numeric: true, format: (v) => fmtSignedPct(v, 2), color: signColor },
                { key: "change", label: "1W change", numeric: true, format: fmtPp, color: signColor },
              ]}
            />
          </Panel>
        </>
      )}
    </Page>
  );
}

/**
 * COT index 0–100 as a tick on a track. The outer fifths (≤20 most short, ≥80 most long of
 * the 3 years) are shaded, and a value inside them gets the diverging heat colour.
 */
function IndexGauge({ value }) {
  if (value == null) return "—";
  const extreme = value <= 20 || value >= 80;
  const tone = heatColor(value - 50, 50, "diverging");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
      <div style={{ position: "relative", width: 80, height: 8, background: "var(--bg-elevated)" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "20%", background: "rgba(37,99,235,0.18)" }} />
        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "20%", background: "rgba(234,88,12,0.18)" }} />
        <div
          style={{
            position: "absolute", top: -3, bottom: -3, width: 3, left: `calc(${value}% - 1.5px)`,
            background: extreme ? tone.replace(/,[\d.]+\)$/, ",1)") : "var(--text-secondary)",
          }}
        />
      </div>
      <span style={{ width: 24, textAlign: "right", fontFamily: "var(--font-family-mono)", fontVariantNumeric: "tabular-nums", color: "var(--text-primary)" }}>
        {value.toFixed(0)}
      </span>
    </div>
  );
}

/** Net % as a bar centred on zero (±100% at the ends) with the value beside it. */
function NetBar({ value }) {
  const w = value == null ? 0 : Math.min(Math.abs(value), 100) / 2; // % of the full track
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
      <div style={{ position: "relative", width: 140, height: 8, background: "var(--bg-elevated)" }}>
        <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "var(--border)" }} />
        {value != null && (
          <div
            style={{
              position: "absolute", top: 0, bottom: 0, width: `${w}%`,
              ...(value >= 0 ? { left: "50%" } : { right: "50%" }),
              background: value >= 0 ? "var(--positive)" : "var(--negative)", opacity: 0.8,
            }}
          />
        )}
      </div>
      <span style={{ width: 56, textAlign: "right", fontFamily: "var(--font-family-mono)", fontVariantNumeric: "tabular-nums", color: signColor(value) }}>{fmtSignedPct(value)}</span>
    </div>
  );
}
