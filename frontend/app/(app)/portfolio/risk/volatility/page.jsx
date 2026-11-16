"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import { fmtPct, signColor } from "@/app/lib/format";
import { heatColor } from "@/app/lib/heat";
import { usePortfolioSelectionStore } from "@/app/store/portfolioSelectionStore";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import KpiCard from "@/app/components/KpiCard";
import Button from "@/app/components/Button";
import Tabs from "@/app/components/Tabs";
import InfoTip from "@/app/components/InfoTip";
import PortfolioPicker from "@/app/components/PortfolioPicker";
import StateMessage from "@/app/components/StateMessage";
import DataTable from "@/app/components/DataTable";

const PERIODS = [
  { label: "13W", weeks: 13 },
  { label: "26W", weeks: 26 },
  { label: "52W", weeks: 52 },
  { label: "104W", weeks: 104 },
];

const MATRIX_TABS = [
  { key: "corr", label: "Correlation" },
  { key: "cov", label: "Covariance" },
  { key: "sharpe", label: "Sharpe scenarios" },
];

const SHARPES = [0.5, 1.0, 1.5, 2.0];

const pct = (v, dp = 2) => fmtPct(v, dp, { sign: false });

function fmtUsd(v) {
  if (v == null) return "—";
  const abs = Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return `${v < 0 ? "−" : ""}$${abs}`;
}

export default function PortfolioVolatilityPage() {
  const { selectedPortfolioId, setSelectedPortfolio } = usePortfolioSelectionStore();
  const [source, setSource] = useState(selectedPortfolioId ?? "live");
  const [weeks, setWeeks] = useState(52);
  const [tab, setTab] = useState("corr");

  function selectSource(value, name) {
    setSource(value);
    if (value !== "live") setSelectedPortfolio(value, name);
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ["portfolio-volatility", source, weeks],
    queryFn: async () => {
      const json = await api.get(
        source === "live"
          ? `/api/track-record/positions/volatility?weeks=${weeks}`
          : `/api/portfolios/${source}/volatility?weeks=${weeks}`
      );
      if (json.error) throw new Error(json.error);
      return json;
    },
    retry: false,
  });

  const isLive = source === "live";

  // Average correlation per ticker (mean of its off-diagonal row, sign-adjusted for shorts),
  // and the portfolio figure = mean of those
  const avCorr = data
    ? data.tickers.map((_, i) => {
        const vals = data.corr_matrix[i].filter((_, j) => j !== i);
        if (!vals.length) return null;
        return (data.weights[i] >= 0 ? 1 : -1) * (vals.reduce((s, v) => s + v, 0) / vals.length);
      })
    : [];
  const avVals = avCorr.filter((v) => v != null);
  const portfolioCorr = avVals.length ? avVals.reduce((s, v) => s + v, 0) / avVals.length : null;

  return (
    <Page>
      <PageHeader
        title="Volatility & Correlation"
        subtitle="Covariance and correlation of weekly returns across portfolio positions."
        actions={<PortfolioPicker value={source} onChange={selectSource} allowLive />}
      />

      <div style={{ display: "flex", gap: 4, marginBottom: "var(--space-5)" }}>
        {PERIODS.map((p) => (
          <Button key={p.label} variant="range-toggle" active={weeks === p.weeks} onClick={() => setWeeks(p.weeks)}>{p.label}</Button>
        ))}
      </div>

      {isLoading && <StateMessage kind="loading" />}
      {error && <StateMessage kind="error">{error.message}</StateMessage>}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-3)", marginBottom: "var(--space-5)" }}>
            <KpiCard label="Portfolio volatility" formatted={pct(data.portfolio_std_annual)} caption={`Annualized · ${pct(data.portfolio_std_weekly)} weekly`} />
            <KpiCard label="Avg correlation" formatted={pct(portfolioCorr)} valueColor={signColor(portfolioCorr)} caption="Sign-adjusted for shorts" />
            <KpiCard label="Avg asset volatility" formatted={pct(data.av_asset_std_annual)} caption={`Annualized · ${pct(data.av_asset_std_weekly)} weekly`} />
          </div>

          <Panel
            title="Matrices"
            titleExtra={
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {data.weeks_used} weeks{data.skipped?.length > 0 && ` · excluded ${data.skipped.join(", ")}`}
              </span>
            }
          >
            <Tabs tabs={MATRIX_TABS} active={tab} onChange={setTab} />
            {tab === "corr" && <CorrMatrix data={data} avCorr={avCorr} portfolioCorr={portfolioCorr} />}
            {tab === "cov" && <CovMatrix data={data} isLive={isLive} />}
            {tab === "sharpe" && <SharpeTable vol={data.portfolio_std_annual} />}
          </Panel>
        </>
      )}
    </Page>
  );
}

function TickerLabel({ ticker, weight }) {
  const long = weight >= 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
      {ticker}
      <span style={{ fontSize: 9, fontWeight: 700, color: long ? "var(--positive)" : "var(--negative)" }}>{long ? "L" : "S"}</span>
    </span>
  );
}

// Rows of a square matrix → objects the DataTable can read (one field per ticker column)
function matrixRows(data, matrix, extra) {
  return data.tickers.map((ticker, i) => ({ ticker, i, weight: data.weights[i], cells: matrix[i], ...extra?.(i) }));
}

function tickerColumn() {
  return {
    key: "ticker", label: "Ticker",
    render: (r) => (r.__footer ? <span style={{ color: "var(--text-secondary)" }}>{r.label}</span> : <TickerLabel ticker={r.ticker} weight={r.weight} />),
  };
}

function CorrMatrix({ data, avCorr, portfolioCorr }) {
  const columns = [
    tickerColumn(),
    ...data.tickers.map((t, j) => ({
      key: `c${j}`, label: t, numeric: true,
      value: (r) => r.cells?.[j],
      format: (v, r) => (r.__footer ? "" : r.i === j ? "—" : pct(v, 0)),
      color: (v, r) => (r.i === j ? "var(--text-disabled)" : "var(--text-primary)"),
      cellStyle: (v, r) => (r.__footer ? {} : r.i === j ? { background: "var(--bg-elevated)" } : { background: heatColor(v, 1) }),
    })),
    { key: "avg", label: "Avg corr", numeric: true, divider: true, format: (v) => pct(v, 1), color: (v) => signColor(v) },
  ];
  return (
    <DataTable
      dense
      autoWidth
      stickyFirstColumn
      columns={columns}
      rows={matrixRows(data, data.corr_matrix, (i) => ({ avg: avCorr[i] }))}
      rowKey="ticker"
      footerRows={[{ __footer: true, __strong: true, label: "Portfolio", avg: portfolioCorr }]}
    />
  );
}

function CovMatrix({ data, isLive }) {
  const cap = Math.max(0, ...data.cov_matrix.flat().map(Math.abs));
  const gross = isLive && data.allocations ? data.allocations.reduce((s, a) => s + Math.abs(a), 0) : null;
  const columns = [
    tickerColumn(),
    ...data.tickers.map((t, j) => ({
      key: `c${j}`, label: t, numeric: true,
      value: (r) => r.cells?.[j],
      format: (v, r) => (r.__footer ? "" : v.toFixed(5)),
      cellStyle: (v, r) => (r.__footer ? {} : { background: heatColor(v, cap, "diverging"), fontWeight: r.i === j ? 600 : 400 }),
    })),
    ...(isLive ? [{ key: "alloc", label: "Net alloc", numeric: true, divider: true, format: (v) => fmtUsd(v), color: (v, r) => (r.__footer ? undefined : signColor(v)) }] : []),
    { key: "weight", label: "Weight", numeric: true, divider: !isLive, format: (v, r) => (r.__footer ? "100%" : pct(v, 1)), color: (v, r) => (r.__footer ? undefined : signColor(v)) },
  ];
  return (
    <>
      <DataTable
        dense
        autoWidth
        stickyFirstColumn
        columns={columns}
        rows={matrixRows(data, data.cov_matrix, (i) => ({ alloc: data.allocations?.[i] }))}
        rowKey="ticker"
        footerRows={gross != null ? [{ __footer: true, __strong: true, label: "Gross", alloc: gross }] : undefined}
      />
      <div style={{ marginTop: "var(--space-3)", fontSize: 12, color: "var(--text-secondary)" }}>
        Portfolio variance {data.portfolio_variance?.toFixed(6)} (weekly)
      </div>
    </>
  );
}

function SharpeTable({ vol }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", marginBottom: "var(--space-3)" }}>
        Implied annual return
        <InfoTip text="Return = Sharpe × annualized portfolio volatility (risk-free rate ignored)." />
      </div>
      <DataTable
        autoWidth
        columns={[
          { key: "sharpe", label: "Sharpe", numeric: true, align: "left", format: (v) => v.toFixed(1) },
          { key: "vol", label: "Volatility", numeric: true, format: (v) => pct(v) },
          { key: "ret", label: "Return", numeric: true, format: (v) => pct(v), color: () => "var(--positive)" },
        ]}
        rows={SHARPES.map((s) => ({ sharpe: s, vol, ret: s * vol }))}
        rowKey="sharpe"
      />
    </div>
  );
}
