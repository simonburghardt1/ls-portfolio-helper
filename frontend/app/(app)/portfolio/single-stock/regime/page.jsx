"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import { fmtPct, signColor } from "@/app/lib/format";
import { scoreToRegime, lastNonNull, getCurrentRegimeInfo } from "@/app/lib/regime";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import Button from "@/app/components/Button";
import InfoTip from "@/app/components/InfoTip";
import DataTable from "@/app/components/DataTable";
import StateMessage from "@/app/components/StateMessage";
import RegimeChart, { REGIME_CONFIG } from "@/app/components/RegimeChart";

// Same scale and thresholds as the Basket regime (score01 0–100; components ~[-1, 1])
const THRESHOLDS = { up: 60, down: 40 };

const PERIODS = [
  { label: "6M", days: 182 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 1095 },
  { label: "5Y", days: 1825 },
  { label: "All", days: null },
];

const COMPONENTS = [
  { key: "bmsb", label: "BMSB", color: "var(--chart-1)" },
  { key: "vol", label: "Realized Vol", color: "var(--chart-3)" },
  { key: "relative_strength", label: "Relative Strength", color: "var(--chart-4)" },
  { key: "sector", label: "Sector Strength", color: "var(--chart-2)" },
];

const METHOD_INFO =
  "Four components, 25% each, 2-week smoothed into a 0–100 score (≥60 Uptrend, ≤40 Downtrend). " +
  "BMSB: price vs. the EMA-21W / SMA-20W band. Realized Vol: 30-day vol within its own 52-week range (low is good). " +
  "Relative Strength: stock/SPY vs. its 10-week average. Sector Strength: the sector's SPDR ETF/SPY vs. its 10-week average. " +
  "A component without data (no sector, or before the ETF existed) drops out and the rest are re-weighted.";

function visibleRangeFor(label) {
  const p = PERIODS.find((x) => x.label === label);
  if (!p?.days) return null;
  const to = new Date(), from = new Date();
  from.setDate(from.getDate() - p.days);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const fmtScore = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`);
const fmtPrice = (v) => (v == null ? "—" : v.toFixed(2));

export default function StockRegimePage() {
  const [input, setInput] = useState("AAPL");
  const [ticker, setTicker] = useState("AAPL");
  const [period, setPeriod] = useState("1Y");

  const { data, isFetching, error } = useQuery({
    queryKey: ["stock-regime", ticker],
    queryFn: () => api.get(`/api/stocks/${encodeURIComponent(ticker)}/regime`),
    enabled: Boolean(ticker),
    retry: false,
    staleTime: 30 * 60 * 1000,
  });
  const current = data?.ticker === ticker ? data : null;

  function submit(e) {
    e.preventDefault();
    const t = input.trim().toUpperCase();
    if (t) setTicker(t);
  }

  const chart = useMemo(() => {
    if (!current?.dates?.length) return null;
    return {
      dates: current.dates,
      price: { data: current.prices, label: current.ticker },
      overlays: [
        { key: "ema21", label: "EMA-21W", color: "var(--chart-10)", data: current.ema21 },
        { key: "sma20", label: "SMA-20W", color: "var(--chart-11)", data: current.sma20 },
      ],
      regimes: current.score01.map((s) => scoreToRegime(s, THRESHOLDS)),
      composite: { data: current.score01, domain: [0, 100], thresholds: THRESHOLDS },
      components: COMPONENTS.map((c) => ({ ...c, weight: current.weights?.[c.key], data: current.components?.[c.key] })),
    };
  }, [current]);

  const visibleRange = useMemo(() => visibleRangeFor(period), [period]);
  const score = lastNonNull(current?.score01);
  const regimeInfo = chart ? getCurrentRegimeInfo(chart.regimes, chart.dates) : null;
  const regimeCfg = regimeInfo ? REGIME_CONFIG[regimeInfo.regime] : null;

  return (
    <Page>
      <PageHeader
        title={current ? `${current.ticker} Regime` : "Stock Regime"}
        badges={regimeCfg && score != null && (
          <span
            title="Regime score (0-100): ≥60 Uptrend, ≤40 Downtrend, otherwise Ranging"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px",
              borderRadius: "var(--radius-full)", fontSize: 12, fontWeight: 600,
              color: regimeCfg.color, border: `1px solid ${regimeCfg.color}`, background: `${regimeCfg.color}1f`,
            }}
          >
            {regimeCfg.label}
            <span style={{ fontFamily: "var(--font-family-mono)", opacity: 0.85 }}>{Math.round(score)}</span>
          </span>
        )}
        meta={current && (
          <span>
            {[current.name, current.sector, current.sector_etf && `vs. ${current.sector_etf}`].filter(Boolean).join(" · ")}
            {regimeInfo && ` · ${regimeCfg.label.toLowerCase()} for ${regimeInfo.periods} trading days`}
          </span>
        )}
        actions={
          <form onSubmit={submit} style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-2)" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Ticker</span>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="e.g. AAPL"
                spellCheck={false}
                style={{
                  background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
                  color: "var(--text-primary)", fontFamily: "var(--font-family-mono)", fontSize: 13,
                  padding: "6px 10px", width: 140, textTransform: "uppercase",
                }}
              />
            </label>
            <Button type="submit" variant="secondary">Load</Button>
          </form>
        }
      />

      {error && <StateMessage kind="error">{error.message || `Could not load ${ticker}.`}</StateMessage>}
      {!current && !error && isFetching && <StateMessage kind="loading">Computing the regime for {ticker}…</StateMessage>}

      {current && chart && (
        <>
          <Panel
            title="Regime"
            titleExtra={<InfoTip text={METHOD_INFO} />}
            actions={PERIODS.map((p) => (
              <Button key={p.label} variant="range-toggle" active={period === p.label} onClick={() => setPeriod(p.label)}>{p.label}</Button>
            ))}
          >
            <RegimeChart
              dates={chart.dates}
              price={chart.price}
              overlays={chart.overlays}
              regimes={chart.regimes}
              composite={chart.composite}
              components={chart.components}
              visibleRange={visibleRange}
              sectionTitles={{ composite: "Regime Score (0-100)" }}
            />
          </Panel>

          <ComponentsPanel data={current} />
        </>
      )}
    </Page>
  );
}

/** Latest component scores, their share of the composite and the inputs behind them. */
function ComponentsPanel({ data }) {
  const d = data.details ?? {};
  const latest = (key) => lastNonNull(data.components?.[key]);

  const basis = {
    bmsb: () => {
      if (d.price == null || d.ema21 == null || d.sma20 == null) return "—";
      const lo = Math.min(d.ema21, d.sma20), hi = Math.max(d.ema21, d.sma20);
      const where = d.price > hi ? "above" : d.price < lo ? "below" : "inside";
      return `Price ${fmtPrice(d.price)} ${where} band ${fmtPrice(lo)}–${fmtPrice(hi)}${d.ema21 > d.sma20 ? ", EMA above SMA" : ", EMA below SMA"}`;
    },
    vol: () => (d.realized_vol == null ? "—" : `30D ${fmtPct(d.realized_vol, 1, { sign: false })} in 52W range ${fmtPct(d.vol_min_52w, 1, { sign: false })}–${fmtPct(d.vol_max_52w, 1, { sign: false })}`),
    relative_strength: () => (d.rs_vs_ma == null ? "—" : `${data.ticker}/SPY ${fmtPct(d.rs_vs_ma, 1)} vs. 10W average`),
    sector: () => (!data.sector_etf ? "No sector, left out" : d.sector_vs_ma == null ? "—" : `${data.sector_etf}/SPY ${fmtPct(d.sector_vs_ma, 1)} vs. 10W average`),
  };

  const scored = COMPONENTS.map((c) => ({ ...c, score: latest(c.key), weight: data.weights?.[c.key] ?? 0 }));
  const totalWeight = scored.reduce((a, r) => a + (r.score != null ? r.weight : 0), 0);
  const rows = scored.map((r) => ({
    ...r,
    contribution: r.score != null && totalWeight ? (r.score * r.weight) / totalWeight : null,
    basis: basis[r.key](),
  }));
  const composite = rows.reduce((a, r) => a + (r.contribution ?? 0), 0);

  return (
    <Panel
      title="Components"
      titleExtra={<span style={{ fontSize: 12, color: "var(--text-disabled)" }}>latest day</span>}
      flush
    >
      <DataTable
        inset
        rowKey="key"
        rows={rows}
        columns={[
          {
            key: "label", label: "Component",
            render: (r) => (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 10, height: 2, background: r.color, display: "inline-block" }} />
                {r.label}
              </span>
            ),
          },
          { key: "score", label: "Score", numeric: true, format: fmtScore, color: signColor },
          { key: "weight", label: "Weight", numeric: true, format: (v, r) => (r.score == null ? "—" : `${Math.round((v / totalWeight) * 100)}%`) },
          { key: "contribution", label: "Contribution", numeric: true, format: fmtScore, color: signColor },
          { key: "basis", label: "Basis", color: () => "var(--text-secondary)" },
        ]}
        footerRows={[{
          __strong: true, key: "composite", label: "Composite", score: null, weight: null, contribution: composite,
          basis: `Score ${Math.round(lastNonNull(data.score01) ?? 0)} / 100 after 2-week smoothing`,
        }]}
      />
      <div style={{ padding: "var(--space-3) var(--space-4)", fontSize: 12, color: "var(--text-secondary)" }}>
        {d.implied_vol_30d != null ? (
          <>Implied vol 30D <span style={{ fontFamily: "var(--font-family-mono)", color: "var(--text-primary)" }}>{fmtPct(d.implied_vol_30d, 1, { sign: false })}</span>
            {d.iv_rv != null && <> · IV/RV <span style={{ fontFamily: "var(--font-family-mono)", color: "var(--text-primary)" }}>{d.iv_rv.toFixed(2)}</span></>}
            {" "}· live options snapshot, not part of the score</>
        ) : (
          "Implied vol unavailable right now (option quotes only while the market trades)."
        )}
      </div>
    </Panel>
  );
}
