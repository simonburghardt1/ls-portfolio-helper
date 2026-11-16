"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode, LineSeries } from "lightweight-charts";
import { authFetch } from "@/app/lib/api";
import { signColor } from "@/app/lib/format";
import Panel from "@/app/components/Panel";
import KpiCard from "@/app/components/KpiCard";
import Button from "@/app/components/Button";
import DataTable from "@/app/components/DataTable";
import StateMessage from "@/app/components/StateMessage";
import { API, CellInput, fmtUsd } from "./shared";

const PERIODS = [
  { label: "1Y", years: 1 },
  { label: "3Y", years: 3 },
  { label: "5Y", years: 5 },
  { label: "All", years: null },
];

const num = (v, d = 2) => (v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(d));
const pctPts = (v, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(d)}%`);
const pctFrac = (v, d = 2) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);

// Closest SPY value for a date (±5 days covers weekends and market holidays)
function nearest(map, dateStr) {
  for (const off of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
    const d = new Date(dateStr + "T12:00:00");
    d.setDate(d.getDate() + off);
    const v = map[d.toISOString().slice(0, 10)];
    if (v != null) return v;
  }
  return null;
}

export default function EquityCurveTab() {
  const [perf, setPerf] = useState([]);
  const [stats, setStats] = useState(null);
  const [spy, setSpy] = useState(null);
  const [showCapital, setShowCapital] = useState(false);
  const [period, setPeriod] = useState("All");
  const [loading, setLoading] = useState(true);
  const [capDate, setCapDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [capAmount, setCapAmount] = useState("");

  const refs = [useRef(null), useRef(null), useRef(null)];
  const charts = useRef([]);
  const syncing = useRef(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [sRes, spyRes, perfRes] = await Promise.all([
        authFetch(`${API}/api/track-record/equity/stats`),
        authFetch(`${API}/api/track-record/equity/spy`),
        authFetch(`${API}/api/track-record/equity/performance`),
      ]);
      setStats(await sRes.json());
      setSpy(await spyRes.json());
      setPerf(await perfRes.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadAll(); }, []);

  async function reloadPerf() {
    const [sRes, perfRes] = await Promise.all([
      authFetch(`${API}/api/track-record/equity/stats`),
      authFetch(`${API}/api/track-record/equity/performance`),
    ]);
    setStats(await sRes.json());
    setPerf(await perfRes.json());
  }

  async function addCapital(type) {
    const amount = parseFloat(capAmount);
    if (!amount || amount <= 0) return;
    await authFetch(`${API}/api/track-record/equity/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: capDate, amount }),
    });
    setCapAmount("");
    reloadPerf();
  }

  // Build the three synced charts
  useEffect(() => {
    if (!perf.length || refs.some((r) => !r.current)) return;
    const spyMap = {};
    if (spy?.dates) spy.dates.forEach((d, i) => { spyMap[d] = spy.values[i]; });

    const opts = (el) => ({
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#9ca3af" },
      grid: { vertLines: { color: "rgba(55,65,81,0.35)" }, horzLines: { color: "rgba(55,65,81,0.35)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: { borderColor: "#374151", timeVisible: false },
      width: el.clientWidth,
      height: 240,
    });
    const line = (chart, color, data, extra = {}) =>
      chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, ...extra }).setData(data);

    const [c1, c2, c3] = refs.map((r) => createChart(r.current, opts(r.current)));

    // 1 — portfolio value vs cumulative deposits
    line(c1, "#3b82f6", perf.map((r) => ({ time: r.date, value: r.account_value })), { title: "Value" });
    line(c1, "#6b7280", perf.map((r) => ({ time: r.date, value: r.capital })), { lineWidth: 1, lineStyle: 2, lastValueVisible: false, title: "Deposits" });

    // 2 — portfolio vs SPX, both indexed to 100 at the first funded week
    const first = perf.find((r) => (r.account_value ?? 0) > 0);
    if (first) {
      line(c2, "#3b82f6", perf.filter((r) => r.account_value != null).map((r) => ({ time: r.date, value: Math.round((r.account_value / first.account_value) * 10000) / 100 })), { title: "Portfolio" });
      const spx0 = nearest(spyMap, first.date);
      if (spx0) {
        line(c2, "#f59e0b", perf.map((r) => { const v = nearest(spyMap, r.date); return v != null ? { time: r.date, value: Math.round((v / spx0) * 10000) / 100 } : null; }).filter(Boolean), { title: "SPX" });
      }
    }

    // 3 — cumulative realized PnL
    line(c3, "#f97316", perf.map((r) => ({ time: r.date, value: r.cum_realized })), { title: "Realized" });

    const all = [c1, c2, c3];
    charts.current = all;
    all.forEach((c) => c.timeScale().fitContent());
    all.forEach((src) => src.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (syncing.current || !range) return;
      syncing.current = true;
      all.forEach((dst) => { if (dst !== src) { try { dst.timeScale().setVisibleRange(range); } catch {} } });
      syncing.current = false;
    }));

    const ro = new ResizeObserver(() => all.forEach((c, i) => c.applyOptions({ width: refs[i].current?.clientWidth ?? 400 })));
    refs.forEach((r) => ro.observe(r.current));
    return () => { ro.disconnect(); all.forEach((c) => c.remove()); charts.current = []; };
    // refs are stable objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perf, spy]);

  // Period → visible range on all charts
  useEffect(() => {
    const sel = PERIODS.find((p) => p.label === period);
    charts.current.forEach((c) => {
      if (!sel?.years) { c.timeScale().fitContent(); return; }
      const to = new Date(), from = new Date();
      from.setFullYear(from.getFullYear() - sel.years);
      try { c.timeScale().setVisibleRange({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }); } catch { c.timeScale().fitContent(); }
    });
  }, [period, perf]);

  if (loading) return <StateMessage kind="loading">Loading equity data…</StateMessage>;

  const last = perf.length ? perf[perf.length - 1] : null;
  const netCapital = last?.capital ?? 0;
  const totalPnl = last?.cum_pnl ?? 0;
  const totalDep = perf.reduce((s, r) => s + (r.cap_delta > 0 ? r.cap_delta : 0), 0);
  const totalWit = perf.reduce((s, r) => s + (r.cap_delta < 0 ? Math.abs(r.cap_delta) : 0), 0);
  const retPct = netCapital > 0 ? (totalPnl / netCapital) * 100 : null;

  // Weekly table (newest first), portfolio + SPX indices and drawdowns
  const spyIdx = {}, spyRaw = {};
  if (spy?.dates) spy.dates.forEach((d, i) => { spyIdx[d] = spy.values[i]; if (spy.raw) spyRaw[d] = spy.raw[i]; });
  let portIdx = null, spx0 = null, peakPort = 100, peakSpx = 100;
  const tableRows = perf.map((r, i) => {
    const prevAV = i > 0 ? perf[i - 1].account_value : null;
    const ret = prevAV ? r.account_value / prevAV - 1 : null;
    portIdx = portIdx === null ? 100 : portIdx * (1 + (ret ?? 0));
    peakPort = Math.max(peakPort, portIdx);
    const spxRawIdx = nearest(spyIdx, r.date);
    let spxIndex = null;
    if (spxRawIdx != null) { if (spx0 === null) spx0 = spxRawIdx; spxIndex = (spxRawIdx / spx0) * 100; peakSpx = Math.max(peakSpx, spxIndex); }
    return {
      ...r,
      port_return: ret, port_index: portIdx, drawdown: portIdx / peakPort - 1,
      spx_price: nearest(spyRaw, r.date), spx_index: spxIndex, spx_drawdown: spxIndex != null ? spxIndex / peakSpx - 1 : null,
      deposit: r.cap_delta > 0 ? r.cap_delta : null, withdrawal: r.cap_delta < 0 ? Math.abs(r.cap_delta) : null,
    };
  }).reverse();

  const dd = (v) => (v != null && v < -0.0001 ? pctFrac(v) : "—");
  const idxColor = (v) => (v == null ? undefined : v >= 100 ? "var(--positive)" : "var(--negative)");

  return (
    <>
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "var(--space-3)", marginBottom: "var(--space-5)" }}>
          <KpiCard label="Total return" formatted={pctPts(stats.total_return)} valueColor={signColor(stats.total_return)} />
          <KpiCard label="Annual return" formatted={pctPts(stats.mean_return_annual)} valueColor={signColor(stats.mean_return_annual)} caption={`Weekly ${pctPts(stats.mean_return_weekly, 3)}`} />
          <KpiCard label="Volatility" formatted={`${num(stats.std_annual)}%`} caption={`Downside ${num(stats.downside_dev_annual)}%`} />
          <KpiCard label="Max drawdown" formatted={pctPts(stats.max_drawdown)} valueColor={signColor(stats.max_drawdown)} />
          <KpiCard label="Sharpe" formatted={num(stats.sharpe)} valueColor={signColor(stats.sharpe)} />
          <KpiCard label="Sortino" formatted={num(stats.sortino)} valueColor={signColor(stats.sortino)} />
          <KpiCard label="Calmar" formatted={num(stats.calmar)} valueColor={signColor(stats.calmar)} />
        </div>
      )}

      <Panel
        title="Capital account"
        titleExtra={
          <span style={{ fontFamily: "var(--font-family-mono)", fontSize: 12, color: "var(--text-primary)" }}>
            {fmtUsd(netCapital + totalPnl)}{" "}
            {retPct != null && <span style={{ color: signColor(retPct) }}>{pctPts(retPct)}</span>}
          </span>
        }
        actions={<Button variant="secondary" onClick={() => setShowCapital((p) => !p)}>{showCapital ? "Hide" : "Deposits & withdrawals"}</Button>}
        style={showCapital ? undefined : { paddingBottom: 4 }}
      >
        {showCapital && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
              <KpiCard small label="Net capital" formatted={fmtUsd(netCapital)} />
              <KpiCard small label="Deposited" formatted={fmtUsd(totalDep)} />
              <KpiCard small label="Withdrawn" formatted={fmtUsd(totalWit)} />
              <KpiCard small label="Total PnL" formatted={fmtUsd(totalPnl, { sign: true })} valueColor={signColor(totalPnl)} />
            </div>
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
              <CellInput type="date" value={capDate} onChange={setCapDate} width={140} />
              <CellInput type="number" value={capAmount} onChange={setCapAmount} width={120} align="right" mono placeholder="Amount" />
              <Button variant="secondary" onClick={() => addCapital("deposit")} style={{ color: "var(--positive)" }}>+ Deposit</Button>
              <Button variant="secondary" onClick={() => addCapital("withdraw")} style={{ color: "var(--negative)" }}>− Withdraw</Button>
            </div>
          </>
        )}
      </Panel>

      {perf.length > 0 ? (
        <>
          <div style={{ display: "flex", gap: 4, marginBottom: "var(--space-3)" }}>
            {PERIODS.map((p) => (
              <Button key={p.label} variant="range-toggle" active={period === p.label} onClick={() => setPeriod(p.label)}>{p.label}</Button>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-4)" }}>
            {["Portfolio value", "Portfolio vs SPX (indexed)", "Realized PnL (cumulative)"].map((title, i) => (
              <Panel key={title} title={title} style={{ minWidth: 0 }}>
                <div ref={refs[i]} style={{ width: "100%" }} />
              </Panel>
            ))}
          </div>
        </>
      ) : (
        <StateMessage>Add realized trades to see the equity curve.</StateMessage>
      )}

      <Panel title="Weekly data" flush>
        <DataTable
          dense
          inset
          stickyHeader
          maxHeight="60vh"
          rowKey="date"
          rows={tableRows}
          empty="No performance data yet."
          columns={[
            { key: "date", label: "Week", render: (r) => <span style={{ fontFamily: "var(--font-family-mono)", color: "var(--text-secondary)" }}>{r.date}</span> },
            { key: "weekly_unrealized", label: "Unrealized", numeric: true, format: (v) => (v ? fmtUsd(v, { sign: true }) : "—"), color: signColor },
            { key: "cum_realized", label: "Realized (cum.)", numeric: true, format: (v) => (v ? fmtUsd(v, { sign: true }) : "—"), color: signColor },
            { key: "deposit", label: "Deposit", numeric: true, format: (v) => (v ? fmtUsd(v) : "—") },
            { key: "withdrawal", label: "Withdrawal", numeric: true, format: (v) => (v ? fmtUsd(v) : "—") },
            { key: "capital", label: "Net capital", numeric: true, format: (v) => fmtUsd(v), color: () => "var(--text-secondary)" },
            { key: "account_value", label: "Value", numeric: true, format: (v) => fmtUsd(v) },
            { key: "port_return", label: "Return", numeric: true, format: (v) => pctFrac(v), color: signColor },
            { key: "port_index", label: "Index", numeric: true, format: (v) => num(v), color: idxColor },
            { key: "drawdown", label: "Drawdown", numeric: true, format: dd, color: (v) => (v < -0.0001 ? "var(--negative)" : "var(--text-disabled)") },
            { key: "spx_price", label: "SPX", numeric: true, divider: true, format: (v) => num(v), color: () => "var(--text-secondary)" },
            { key: "spx_index", label: "SPX index", numeric: true, format: (v) => num(v), color: idxColor },
            { key: "spx_drawdown", label: "SPX DD", numeric: true, format: dd, color: (v) => (v != null && v < -0.0001 ? "var(--negative)" : "var(--text-disabled)") },
          ]}
        />
      </Panel>
    </>
  );
}
