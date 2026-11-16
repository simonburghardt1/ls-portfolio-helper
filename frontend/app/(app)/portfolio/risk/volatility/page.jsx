"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import { fmtPct, signColor } from "@/app/lib/format";
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

// Covariance: orange (positive) / blue (negative) — not gain/loss, so not the green/red tokens
function covColor(val, maxAbs) {
  if (!maxAbs) return "transparent";
  const t = Math.min(Math.abs(val) / maxAbs, 1);
  if (val > 0) return `rgba(234,88,12,${0.1 + t * 0.5})`;
  if (val < 0) return `rgba(37,99,235,${0.1 + t * 0.5})`;
  return "transparent";
}

function corrColor(val) {
  const t = Math.min(Math.abs(val), 1);
  if (val > 0) return `rgba(22,163,74,${0.08 + t * 0.55})`;
  if (val < 0) return `rgba(220,38,38,${0.08 + t * 0.55})`;
  return "transparent";
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
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {ticker}
      <span style={{ fontSize: 9, fontWeight: 700, color: long ? "var(--positive)" : "var(--negative)" }}>{long ? "L" : "S"}</span>
    </span>
  );
}

function CorrMatrix({ data, avCorr, portfolioCorr }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={{ ...th, ...stickyCol, textAlign: "left" }}>Ticker</th>
            {data.tickers.map((t) => <th key={t} style={th}>{t}</th>)}
            <th style={{ ...th, borderLeft: "1px solid var(--border)" }}>Avg corr</th>
          </tr>
        </thead>
        <tbody>
          {data.tickers.map((ticker, i) => (
            <tr key={ticker}>
              <td style={{ ...td, ...stickyCol, textAlign: "left", fontFamily: "var(--font-family-sans)", fontWeight: 600 }}>
                <TickerLabel ticker={ticker} weight={data.weights[i]} />
              </td>
              {data.corr_matrix[i].map((val, j) => (
                <td key={j} style={{ ...td, background: i === j ? "var(--bg-elevated)" : corrColor(val), color: i === j ? "var(--text-disabled)" : "var(--text-primary)" }}>
                  {i === j ? "—" : pct(val, 0)}
                </td>
              ))}
              <td style={{ ...td, borderLeft: "1px solid var(--border)", color: signColor(avCorr[i]) }}>{pct(avCorr[i], 1)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...td, ...stickyCol, textAlign: "left", fontFamily: "var(--font-family-sans)", color: "var(--text-secondary)", borderTop: "1px solid var(--border)" }}>Portfolio</td>
            <td colSpan={data.tickers.length} style={{ ...td, borderTop: "1px solid var(--border)" }} />
            <td style={{ ...td, borderTop: "1px solid var(--border)", borderLeft: "1px solid var(--border)", fontWeight: 600, color: signColor(portfolioCorr) }}>{pct(portfolioCorr, 1)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CovMatrix({ data, isLive }) {
  const maxAbs = Math.max(0, ...data.cov_matrix.flat().map(Math.abs));
  const gross = isLive && data.allocations ? data.allocations.reduce((s, a) => s + Math.abs(a), 0) : null;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={{ ...th, ...stickyCol, textAlign: "left" }}>Ticker</th>
            {data.tickers.map((t) => <th key={t} style={th}>{t}</th>)}
            {isLive && <th style={{ ...th, borderLeft: "1px solid var(--border)" }}>Net alloc</th>}
            <th style={{ ...th, borderLeft: isLive ? undefined : "1px solid var(--border)" }}>Weight</th>
          </tr>
        </thead>
        <tbody>
          {data.tickers.map((ticker, i) => (
            <tr key={ticker}>
              <td style={{ ...td, ...stickyCol, textAlign: "left", fontFamily: "var(--font-family-sans)", fontWeight: 600 }}>
                <TickerLabel ticker={ticker} weight={data.weights[i]} />
              </td>
              {data.cov_matrix[i].map((val, j) => (
                <td key={j} style={{ ...td, background: covColor(val, maxAbs), fontWeight: i === j ? 600 : 400 }}>{val.toFixed(5)}</td>
              ))}
              {isLive && <td style={{ ...td, borderLeft: "1px solid var(--border)", color: signColor(data.allocations?.[i]) }}>{fmtUsd(data.allocations?.[i])}</td>}
              <td style={{ ...td, borderLeft: isLive ? undefined : "1px solid var(--border)", color: signColor(data.weights[i]) }}>{pct(data.weights[i], 1)}</td>
            </tr>
          ))}
          {gross != null && (
            <tr>
              <td colSpan={data.tickers.length + 1} style={{ ...td, textAlign: "left", fontFamily: "var(--font-family-sans)", color: "var(--text-secondary)", borderTop: "1px solid var(--border)" }}>Gross</td>
              <td style={{ ...td, borderTop: "1px solid var(--border)", borderLeft: "1px solid var(--border)", fontWeight: 600 }}>{fmtUsd(gross)}</td>
              <td style={{ ...td, borderTop: "1px solid var(--border)" }}>100%</td>
            </tr>
          )}
        </tbody>
      </table>
      <div style={{ marginTop: "var(--space-3)", fontSize: 12, color: "var(--text-secondary)" }}>
        Portfolio variance {data.portfolio_variance?.toFixed(6)} (weekly)
      </div>
    </div>
  );
}

function SharpeTable({ vol }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", marginBottom: "var(--space-3)" }}>
        Implied annual return
        <InfoTip text="Return = Sharpe × annualized portfolio volatility (risk-free rate ignored)." />
      </div>
      <table style={{ ...tableStyle, width: "auto", minWidth: 320 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Sharpe</th>
            <th style={th}>Volatility</th>
            <th style={th}>Return</th>
          </tr>
        </thead>
        <tbody>
          {SHARPES.map((s) => (
            <tr key={s}>
              <td style={{ ...td, textAlign: "left" }}>{s.toFixed(1)}</td>
              <td style={td}>{pct(vol)}</td>
              <td style={{ ...td, color: "var(--positive)" }}>{pct(s * vol)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const tableStyle = { borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" };
const th = {
  padding: "6px 8px", fontSize: 10.5, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase",
  letterSpacing: "0.05em", textAlign: "right", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", background: "var(--bg-surface)",
};
const td = { padding: "5px 8px", fontSize: 11.5, textAlign: "right", whiteSpace: "nowrap", fontFamily: "var(--font-family-mono)", minWidth: 64 };
const stickyCol = { position: "sticky", left: 0, background: "var(--bg-surface)", zIndex: 1 };
