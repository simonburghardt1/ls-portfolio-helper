"use client";

import { useEffect, useState } from "react";
import { authFetch, api } from "@/app/lib/api";
import { fmtPct, signColor } from "@/app/lib/format";
import { usePortfolioSelectionStore } from "@/app/store/portfolioSelectionStore";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import KpiCard from "@/app/components/KpiCard";
import Button from "@/app/components/Button";
import Chip from "@/app/components/Chip";
import InfoTip from "@/app/components/InfoTip";
import Popover, { MenuItem } from "@/app/components/Popover";
import DataTable from "@/app/components/DataTable";
import StateMessage from "@/app/components/StateMessage";
import LineChart from "@/app/components/LineChart";
import PortfolioPicker from "@/app/components/PortfolioPicker";
import CellInput from "@/app/components/CellInput";
import SideTag from "@/app/components/SideTag";

const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

const DEFAULT_POSITIONS = [
  { ticker: "MSTR", weight: 0.10, side: "short" },
  { ticker: "BMBL", weight: 0.10, side: "short" },
  { ticker: "HUBS", weight: 0.10, side: "short" },
  { ticker: "LLY", weight: 0.10, side: "long" },
  { ticker: "NBIS", weight: 0.10, side: "long" },
  { ticker: "ONDS", weight: 0.10, side: "long" },
  { ticker: "GPRE", weight: 0.10, side: "long" },
  { ticker: "SOFI", weight: 0.10, side: "short" },
  { ticker: "DKNG", weight: 0.10, side: "short" },
  { ticker: "SEZL", weight: 0.10, side: "long" },
];

const DEFAULT_REGIME_TARGETS = { up: 0.5, ranging: 0.0, down: -0.5 };

const PERIODS = ["1W", "1M", "3M", "6M", "12M"];
// Trading days per window — same as backend services/portfolio.py summary_returns
const TF_DAYS = { "1W": 5, "1M": 21, "3M": 63, "6M": 126, "12M": 252 };

const COLORS = { portfolio: "#3b82f6", benchmark: "#f59e0b", compare: "#10b981", regime: "#a78bfa" };

const pct = (v, dp = 2) => fmtPct(v, dp);

// ── Pure helpers ───────────────────────────────────────────────────────────────

function cleanPositions(positions) {
  return positions
    .filter((p) => p.ticker && p.side && p.weight !== 0 && p.weight !== "")
    .map((p) => ({ ticker: p.ticker.trim().toUpperCase(), weight: Number(p.weight), side: p.side }));
}

// Comparable form of the book (ignores the typed weightText and float noise) — used to tell
// whether anything differs from the starting point.
function bookKey(positions, targets) {
  return JSON.stringify({
    p: positions.map((p) => [String(p.ticker ?? "").trim().toUpperCase(), p.side, p.weight === "" ? "" : Math.round(Number(p.weight) * 1e6)]),
    t: [Number(targets.up), Number(targets.ranging), Number(targets.down)],
  });
}

function validate(positions) {
  const errs = [];
  positions.forEach((p, i) => {
    if (!p.ticker?.trim()) errs.push(`Row ${i + 1}: ticker required`);
    if (p.weight === "" || Number.isNaN(Number(p.weight))) errs.push(`Row ${i + 1}: weight must be a number`);
  });
  return errs;
}

function summarize(positions) {
  const clean = positions.filter((p) => p.ticker && p.weight !== "" && !Number.isNaN(Number(p.weight)));
  return {
    count: clean.length,
    gross: clean.reduce((s, p) => s + Math.abs(Number(p.weight) || 0), 0),
    // rounded: equal long/short weights sum to ±1e-17, which would read as a tiny net short
    net: Math.round(clean.reduce((s, p) => s + (p.side === "short" ? -1 : 1) * (Number(p.weight) || 0), 0) * 1e6) / 1e6,
    longs: clean.filter((p) => p.side === "long").length,
    shorts: clean.filter((p) => p.side === "short").length,
  };
}

/**
 * Window of the cumulative series, rebased to 0 at the window start. Uses days + 1 points
 * (= `days` daily returns), the same reference close the backend's period returns use — so the
 * 12M chart ends exactly at the 12M figure in the returns table.
 */
function windowed(result, timeframe, compareResult) {
  if (!result?.series) return null;
  const { dates, portfolio, benchmark, regime_adjusted } = result.series;
  const start = Math.max(0, dates.length - (TF_DAYS[timeframe] ?? 252) - 1);
  const d = dates.slice(start);
  const rebase = (arr) => arr.slice(start).map((v, _, a) => ((1 + v) / (1 + a[0]) - 1) * 100);
  const port = rebase(portfolio);

  let comparison = null;
  if (compareResult?.series) {
    const map = Object.fromEntries(compareResult.series.dates.map((dt, i) => [dt, compareResult.series.portfolio[i]]));
    const first = d.find((dt) => map[dt] != null);
    if (first != null) comparison = d.map((dt) => (map[dt] != null ? ((1 + map[dt]) / (1 + map[first]) - 1) * 100 : null));
  }

  // Drawdown within the window (peak since the window start), not since the backtest start
  let peak = -Infinity;
  const drawdown = port.map((v) => { const level = 1 + v / 100; peak = Math.max(peak, level); return (level / peak - 1) * 100; });

  return { dates: d, portfolio: port, benchmark: rebase(benchmark), regime: regime_adjusted ? rebase(regime_adjusted) : null, comparison, drawdown };
}

function tableRows(result, frequency) {
  if (!result?.daily) return [];
  if (frequency === "daily") return [...result.daily].reverse();
  const weekly = [];
  let week = null, weekStartCum = 0, last = null;
  for (const row of result.daily) {
    const d = new Date(row.date);
    const wk = `${d.getUTCFullYear()}-${Math.floor((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 604800000)}`;
    if (week === null) { week = wk; last = row; continue; }
    if (wk !== week) {
      weekly.push({ date: last.date, daily_return: (1 + last.cumulative_return) / (1 + weekStartCum) - 1, cumulative_return: last.cumulative_return });
      week = wk; weekStartCum = last.cumulative_return;
    }
    last = row;
  }
  if (last) weekly.push({ date: last.date, daily_return: (1 + last.cumulative_return) / (1 + weekStartCum) - 1, cumulative_return: last.cumulative_return });
  return weekly.reverse();
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function BacktestingPage() {
  const [positions, setPositions] = useState(DEFAULT_POSITIONS);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | running | done | error
  const [errors, setErrors] = useState([]);
  const [timeframe, setTimeframe] = useState("12M");
  const [frequency, setFrequency] = useState("daily");

  const [betas, setBetas] = useState({});
  const [portfolioBeta, setPortfolioBeta] = useState(null);
  const [portfolioCorr, setPortfolioCorr] = useState(null);
  const [analyticsStatus, setAnalyticsStatus] = useState("idle"); // auto β/corr refresh
  const [betaStatus, setBetaStatus] = useState("idle");           // the Beta-adjust action
  // Snapshots of the positions before each Beta-adjust, so it can be undone step by step
  // Starting point (loaded portfolio or the defaults); ↶ resets to it whenever anything differs
  const [baseline, setBaseline] = useState({ positions: DEFAULT_POSITIONS, regimeTargets: DEFAULT_REGIME_TARGETS });

  const [regimeOpen, setRegimeOpen] = useState(false);
  const [regimeTargets, setRegimeTargets] = useState(DEFAULT_REGIME_TARGETS);
  const [regimeStatus, setRegimeStatus] = useState("idle");

  const { selectedPortfolioId, setSelectedPortfolio } = usePortfolioSelectionStore();
  const [savedPortfolios, setSavedPortfolios] = useState([]);
  const [loadedId, setLoadedId] = useState(null);

  const [compare, setCompare] = useState(null); // { id, name, result }
  const [compareStatus, setCompareStatus] = useState("idle");

  useEffect(() => {
    api.get("/api/portfolios").then(setSavedPortfolios).catch(() => {});
  }, []);

  // Auto-load the portfolio picked on another page (shared selection store)
  useEffect(() => {
    if (!selectedPortfolioId || !savedPortfolios.length || loadedId != null) return;
    const p = savedPortfolios.find((x) => x.id === selectedPortfolioId);
    if (p) applyPortfolio(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedPortfolios, selectedPortfolioId]);

  async function fetchAnalytics(list) {
    if (!cleanPositions(list).length) return;
    setAnalyticsStatus("loading");
    try {
      const res = await authFetch(`${API}/api/portfolio/analytics`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ positions: cleanPositions(list) }),
      });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setBetas(json.betas); setPortfolioBeta(json.portfolio_beta); setPortfolioCorr(json.correlation); setAnalyticsStatus("done");
    } catch {
      setAnalyticsStatus("error");
    }
  }

  // Portfolio β and correlation follow the book: recomputed shortly after any edit (weights,
  // sides, tickers, Beta-adjust, undo, loading). Per-ticker betas stay visible meanwhile.
  useEffect(() => {
    const t = setTimeout(() => fetchAnalytics(positions), 600);
    return () => clearTimeout(t);
  }, [positions]);

  function applyPortfolio(p) {
    const loaded = p.positions.map((pos) => ({ ...pos }));
    setPositions(loaded);
    setLoadedId(p.id);
    setBaseline({ positions: loaded, regimeTargets: DEFAULT_REGIME_TARGETS });
    setRegimeTargets(DEFAULT_REGIME_TARGETS);
    setResult(null); setStatus("idle"); setErrors([]); setRegimeStatus("idle"); setBetaStatus("idle");
  }

  function selectPortfolio(id, name) {
    const p = savedPortfolios.find((x) => x.id === id);
    if (!p) return;
    setSelectedPortfolio(id, name);
    applyPortfolio(p);
  }

  // ── Position editing ──
  function update(index, field, value) {
    // weightText keeps exactly what is typed ("2", "2.", "25") — formatting the number on every
    // keystroke turned "25" into "2.005". The numeric weight is derived from it.
    setPositions((prev) => prev.map((p, i) => (i !== index ? p : field === "weight"
      ? { ...p, weightText: value, weight: value === "" ? "" : Number(value) / 100 }
      : { ...p, [field]: value })));
  }
  const toggleSide = (i) => update(i, "side", positions[i].side === "long" ? "short" : "long");
  const addRow = () => setPositions((prev) => [...prev, { ticker: "", weight: 0.10, side: "long" }]);
  function removeRow(index) { setPositions((prev) => prev.filter((_, i) => i !== index)); }

  // ── Actions ──
  async function betaAdjust() {
    const errs = validate(positions);
    if (errs.length) { setErrors(errs); return; }
    setErrors([]); setBetaStatus("loading");
    try {
      const res = await authFetch(`${API}/api/portfolio/beta-adjust`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ positions: cleanPositions(positions) }),
      });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setPositions(json.positions); setBetas(json.betas); setPortfolioBeta(json.portfolio_beta); setPortfolioCorr(json.correlation ?? null);
      setBetaStatus("done");
    } catch {
      setBetaStatus("error");
    }
  }

  function resetToStart() {
    setPositions(baseline.positions.map((p) => ({ ...p })));
    setRegimeTargets(baseline.regimeTargets);
    setBetaStatus("idle");
    clearRegime();
  }

  async function runBacktest() {
    const errs = validate(positions);
    setErrors(errs);
    if (errs.length) return;
    setStatus("running"); setRegimeStatus("idle");
    try {
      const res = await authFetch(`${API}/api/portfolio/backtest`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ positions: cleanPositions(positions) }),
      });
      const json = await res.json();
      if (!res.ok) { setErrors([json.detail || `Server error ${res.status}`]); setStatus("error"); return; }
      setResult(json); setStatus("done");
    } catch (e) {
      setErrors([e.message || "Request failed"]); setStatus("error");
    }
  }

  async function runRegimeComparison() {
    setRegimeStatus("loading");
    try {
      const res = await authFetch(`${API}/api/portfolio/backtest`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positions: cleanPositions(positions),
          regime_adjust: true,
          regime_targets: { up: Number(regimeTargets.up), ranging: Number(regimeTargets.ranging), down: Number(regimeTargets.down) },
        }),
      });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setResult((prev) => ({ ...prev, series: { ...prev.series, regime_adjusted: json.series.regime_adjusted }, summary_regime: json.summary_regime }));
      setRegimeStatus("done");
    } catch {
      setRegimeStatus("error");
    }
  }

  function clearRegime() {
    setResult((prev) => {
      if (!prev) return prev;
      const { regime_adjusted: _drop, ...series } = prev.series;
      return { ...prev, series, summary_regime: undefined };
    });
    setRegimeStatus("idle");
  }

  async function runCompare(p) {
    setCompareStatus("loading");
    try {
      const res = await authFetch(`${API}/api/portfolio/backtest`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ positions: p.positions }),
      });
      if (!res.ok) throw new Error();
      setCompare({ id: p.id, name: p.name, result: await res.json() });
      setCompareStatus("done");
    } catch {
      setCompareStatus("error");
    }
  }

  const sum = summarize(positions);
  const hasBetas = Object.keys(betas).length > 0;
  const chart = windowed(result, timeframe, compare?.result);
  const rows = tableRows(result, frequency);
  const loadedName = savedPortfolios.find((p) => p.id === loadedId)?.name;
  const isDirty = bookKey(positions, regimeTargets) !== bookKey(baseline.positions, baseline.regimeTargets);

  return (
    <Page>
      <PageHeader
        title="Portfolio Backtester"
        subtitle={loadedName ? `Backtesting ${loadedName}` : "Build a long/short portfolio and backtest its historical performance."}
        actions={<PortfolioPicker value={loadedId} onChange={selectPortfolio} />}
      />

      {/* ── Builder ── */}
      <Panel
        title="Positions"
        titleExtra={
          <span style={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: "var(--font-family-mono)" }}>
            {sum.count} · {sum.longs} L / {sum.shorts} S · gross {fmtPct(sum.gross, 0, { sign: false })} · net <span style={{ color: signColor(sum.net) }}>{pct(sum.net, 0)}</span>
            {" · "}β {analyticsStatus === "loading" ? "…" : portfolioBeta != null ? portfolioBeta.toFixed(2) : "—"}
            {" · "}corr {analyticsStatus === "loading" ? "…" : portfolioCorr != null ? portfolioCorr.toFixed(2) : "—"}
          </span>
        }
        actions={
          <>
            {isDirty && (
              <Button variant="secondary" onClick={resetToStart} title={`Reset to ${loadedName ?? "the starting positions"}`} aria-label="Reset to start">↶</Button>
            )}
            <Button variant="secondary" onClick={addRow}>+ Add</Button>
            <Button variant="secondary" onClick={betaAdjust} disabled={betaStatus === "loading"}>{betaStatus === "loading" ? "Fetching betas…" : "Beta-adjust"}</Button>
            {/* Toggle variant for the on/off state, but at the regular button size */}
            <Button variant="range-toggle" active={regimeOpen} onClick={() => { setRegimeOpen((v) => !v); clearRegime(); }} style={{ padding: "8px 16px" }}>Regime-adjust</Button>
            <Button variant="primary" onClick={runBacktest} disabled={status === "running"}>{status === "running" ? "Running…" : "Run backtest"}</Button>
          </>
        }
      >
        <DataTable
          rows={positions.map((p, i) => ({ ...p, __i: i }))}
          rowKey="__i"
          columns={[
            { key: "__n", label: "#", numeric: true, value: (r) => r.__i + 1, color: () => "var(--text-disabled)", width: 36 },
            { key: "ticker", label: "Ticker", render: (r) => <CellInput value={r.ticker} onChange={(v) => update(r.__i, "ticker", v)} width={110} mono upper placeholder="AAPL" invalid={!r.ticker?.trim()} /> },
            { key: "side", label: "Side", render: (r) => <SideTag side={r.side} onToggle={() => toggleSide(r.__i)} /> },
            {
              key: "weight", label: "Weight", align: "right",
              render: (r) => (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <CellInput type="number" step="0.01" value={r.weightText ?? (r.weight === "" ? "" : (Number(r.weight) * 100).toFixed(2))} onChange={(v) => update(r.__i, "weight", v)} width={80} align="right" mono invalid={r.weight === "" || Number.isNaN(Number(r.weight))} />
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>%</span>
                </span>
              ),
            },
            ...(hasBetas ? [{ key: "beta", label: "Beta", numeric: true, value: (r) => betas[r.ticker?.toUpperCase()], format: (v) => (v == null ? "—" : v.toFixed(2)) }] : []),
            {
              key: "remove", label: "", align: "right", width: 40,
              render: (r) => <button type="button" onClick={() => removeRow(r.__i)} aria-label={`Remove ${r.ticker || "row"}`} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 16 }}>×</button>,
            },
          ]}
          empty="No positions — add one."
        />

        {betaStatus === "done" && hasBetas && (
          <div style={{ marginTop: "var(--space-3)", fontSize: 12, color: "var(--text-secondary)" }}>Weights beta-adjusted. Run the backtest to see the effect.</div>
        )}
        {betaStatus === "error" && <StateMessage kind="error" style={{ marginTop: "var(--space-3)", marginBottom: 0 }}>Could not fetch betas. Check the tickers.</StateMessage>}

        {regimeOpen && (
          <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", fontSize: 12 }}>
            <span style={{ color: "var(--text-secondary)" }}>Target β by regime</span>
            <InfoTip text="Scales the book's net beta to the target for the market regime of each day (Up / Ranging / Down) and shows the result as an extra line next to the static portfolio." />
            {[["up", "Up"], ["ranging", "Ranging"], ["down", "Down"]].map(([k, label]) => (
              <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {label}
                <CellInput type="number" step="0.1" value={regimeTargets[k]} onChange={(v) => { setRegimeTargets((t) => ({ ...t, [k]: v })); clearRegime(); }} width={64} align="right" mono />
              </label>
            ))}
            <Button variant="secondary" onClick={runRegimeComparison} disabled={status !== "done" || regimeStatus === "loading"} style={{ marginLeft: "auto" }}>
              {regimeStatus === "loading" ? "Comparing…" : status !== "done" ? "Run the backtest first" : regimeStatus === "done" ? "↻ Recompare" : "Compare regime-adjusted"}
            </Button>
            {regimeStatus === "error" && <span style={{ color: "var(--negative)" }}>Failed</span>}
          </div>
        )}
      </Panel>

      {errors.length > 0 && <StateMessage kind="error">{errors.map((e, i) => <div key={i}>{e}</div>)}</StateMessage>}

      {/* ── Results ── */}
      {result && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--space-3)", marginBottom: "var(--space-5)" }}>
            <KpiCard label="Sharpe" formatted={result.risk_metrics?.sharpe?.toFixed(2) ?? "—"} valueColor={signColor(result.risk_metrics?.sharpe)} caption="Full backtest" />
            <KpiCard label="Sortino" formatted={result.risk_metrics?.sortino?.toFixed(2) ?? "—"} valueColor={signColor(result.risk_metrics?.sortino)} caption="Full backtest" />
            <KpiCard label="Max drawdown" formatted={pct(result.risk_metrics?.max_dd)} valueColor="var(--negative)" caption="Full backtest" />
            <KpiCard label="Volatility" formatted={fmtPct(result.risk_metrics?.ann_vol, 2, { sign: false })} caption="Annualized" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))", gap: "var(--space-5)" }}>
            <Panel title="Returns" flush style={{ minWidth: 0 }}>
              <DataTable
                inset
                rowKey="name"
                rows={[
                  { name: "Portfolio", color: COLORS.portfolio, ...result.summary },
                  { name: "S&P 500", color: COLORS.benchmark, ...result.benchmark_summary },
                  ...(compare ? [{ name: compare.name, color: COLORS.compare, ...compare.result.summary }] : []),
                  ...(result.summary_regime ? [{ name: "Regime-adjusted", color: COLORS.regime, ...result.summary_regime }] : []),
                ]}
                columns={[
                  { key: "name", label: "", render: (r) => <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 2, background: r.color }} />{r.name}</span> },
                  ...PERIODS.map((p) => ({ key: p, label: p, numeric: true, format: (v) => pct(v), color: (v) => signColor(v) })),
                ]}
              />
            </Panel>
            {result.contributions && Object.keys(result.contributions).length > 0 && (
              <Panel title="Contribution" titleExtra={<InfoTip text="Each position's share of the portfolio return over the full backtest." />} style={{ minWidth: 0 }}>
                <Contributions contributions={result.contributions} positions={positions} />
              </Panel>
            )}
          </div>

          <Panel
            title="Cumulative performance"
            titleExtra={
              <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap", fontSize: 12, color: "var(--text-secondary)" }}>
                <Legend color={COLORS.portfolio}>Portfolio</Legend>
                <Legend color={COLORS.benchmark}>S&P 500</Legend>
                {compare && <Chip color={COLORS.compare} onRemove={() => { setCompare(null); setCompareStatus("idle"); }}>{compare.name}</Chip>}
                {result.series?.regime_adjusted && <Chip color={COLORS.regime} onRemove={clearRegime}>Regime-adjusted</Chip>}
                <Popover width={220} maxHeight={320} trigger={(t) => <Button variant="secondary" onClick={t} style={{ padding: "3px 10px", fontSize: 12 }}>{compareStatus === "loading" ? "Loading…" : "+ Compare"}</Button>}>
                  {(close) => savedPortfolios.filter((p) => p.id !== loadedId).map((p) => (
                    <MenuItem key={p.id} onClick={() => { close(); runCompare(p); }}>{p.name}</MenuItem>
                  ))}
                </Popover>
                {compareStatus === "error" && <span style={{ color: "var(--negative)" }}>Compare failed</span>}
              </span>
            }
            actions={
              <div style={{ display: "flex", gap: 4 }}>
                {PERIODS.map((p) => <Button key={p} variant="range-toggle" active={timeframe === p} onClick={() => setTimeframe(p)}>{p}</Button>)}
              </div>
            }
          >
            {chart && (
              <>
                <LineChart
                  dates={chart.dates}
                  height={340}
                  referenceLine={0}
                  datasets={[
                    { label: "Portfolio", data: chart.portfolio, borderColor: COLORS.portfolio, borderWidth: 2 },
                    { label: "S&P 500", data: chart.benchmark, borderColor: COLORS.benchmark, borderWidth: 2 },
                    ...(chart.comparison ? [{ label: compare.name, data: chart.comparison, borderColor: COLORS.compare, borderWidth: 2 }] : []),
                    ...(chart.regime ? [{ label: "Regime-adj.", data: chart.regime, borderColor: COLORS.regime, borderWidth: 2 }] : []),
                  ]}
                />
                <div style={{ borderTop: "1px solid var(--border)", marginTop: "var(--space-2)", paddingTop: "var(--space-3)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                    Drawdown ({timeframe})
                  </div>
                  <LineChart dates={chart.dates} height={150} referenceLine={0} datasets={[{ label: "Drawdown %", data: chart.drawdown, borderColor: "#f2585c", borderWidth: 1.5 }]} />
                </div>
              </>
            )}
          </Panel>

          <Panel
            title={frequency === "daily" ? "Daily returns" : "Weekly returns"}
            flush
            actions={
              <div style={{ display: "flex", gap: 4 }}>
                {["daily", "weekly"].map((f) => <Button key={f} variant="range-toggle" active={frequency === f} onClick={() => setFrequency(f)}>{f === "daily" ? "Daily" : "Weekly"}</Button>)}
              </div>
            }
          >
            <DataTable
              inset
              stickyHeader
              maxHeight={420}
              rowKey="date"
              rows={rows}
              columns={[
                { key: "date", label: "Date", render: (r) => <span style={{ fontFamily: "var(--font-family-mono)", color: "var(--text-secondary)" }}>{r.date}</span> },
                { key: "daily_return", label: frequency === "daily" ? "Return" : "Weekly return", numeric: true, format: (v) => pct(v), color: (v) => signColor(v) },
                { key: "cumulative_return", label: `Cumulative since ${result.daily?.[0]?.date ?? "start"}`, numeric: true, format: (v) => pct(v), color: (v) => signColor(v) },
              ]}
            />
          </Panel>
        </>
      )}
    </Page>
  );
}

// ── Small pieces ───────────────────────────────────────────────────────────────

function Legend({ color, children }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 14, height: 2, background: color }} />
      {children}
    </span>
  );
}

function Contributions({ contributions, positions }) {
  const entries = Object.entries(contributions).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const max = Math.max(...entries.map(([, v]) => Math.abs(v)), 1e-9);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.map(([ticker, v]) => {
        const pos = positions.find((p) => p.ticker?.toUpperCase() === ticker);
        return (
          <div key={ticker} style={{ display: "grid", gridTemplateColumns: "64px 54px 1fr 72px", alignItems: "center", gap: "var(--space-2)", fontSize: 12 }}>
            <span style={{ fontFamily: "var(--font-family-mono)", fontWeight: 600 }}>{ticker}</span>
            <span style={{ color: pos?.side === "short" ? "var(--negative)" : "var(--positive)", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em" }}>
              {pos ? `${pos.side === "short" ? "S" : "L"} ${(pos.weight * 100).toFixed(0)}%` : ""}
            </span>
            <div style={{ height: 6, background: "var(--bg-elevated)" }}>
              <div style={{ height: "100%", width: `${(Math.abs(v) / max) * 100}%`, background: v >= 0 ? "var(--positive)" : "var(--negative)", opacity: 0.8 }} />
            </div>
            <span style={{ fontFamily: "var(--font-family-mono)", textAlign: "right", color: signColor(v) }}>{fmtPct(v)}</span>
          </div>
        );
      })}
    </div>
  );
}
