"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineSeries,
  HistogramSeries,
} from "lightweight-charts";

const API = "http://localhost:8000";

const TABS = ["Live Portfolio", "Realized PnL", "Equity Curve"];

const PERIODS = [
  { label: "1Y",  years: 1  },
  { label: "3Y",  years: 3  },
  { label: "5Y",  years: 5  },
  { label: "ALL", years: null },
];

// ─── Shared styles ─────────────────────────────────────────────────────────────

const cellInput = {
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: 4,
  padding: "4px 6px",
  fontSize: 12,
  color: "#e5e7eb",
  outline: "none",
  width: "100%",
  fontVariantNumeric: "tabular-nums",
};

const btnBase = { borderRadius: 6, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "opacity 0.15s", border: "none" };
const btnPrimary  = { ...btnBase, background: "#1e3a5f", border: "1px solid #2d5a8e", color: "#93c5fd" };
const btnSecondary = { ...btnBase, background: "transparent", border: "1px solid #1f2937", color: "#6b7280" };

function fmtMoney(v, decimals = 0) {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const formatted = abs >= 1000
    ? (v / 1000).toFixed(1) + "K"
    : v.toFixed(decimals);
  return (v >= 0 ? "" : "-") + (v >= 0 ? formatted : Math.abs(v >= 1000 ? v / 1000 : v).toFixed(decimals) + (abs >= 1000 ? "K" : ""));
}

function fmtNum(v, d = 2) {
  return v == null ? "—" : Number(v).toFixed(d);
}

function pnlColor(v) {
  if (v == null) return "#6b7280";
  return v > 0 ? "#86efac" : v < 0 ? "#fca5a5" : "#6b7280";
}

function KpiCard({ label, value, valueColor = "#e5e7eb", small = false }) {
  return (
    <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 8, padding: small ? "10px 14px" : "14px 18px", minWidth: small ? 100 : 130 }}>
      <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: small ? 14 : 18, fontWeight: 700, color: valueColor, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function Th({ children, style = {} }) {
  return (
    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.07em", borderBottom: "1px solid #0d1829", whiteSpace: "nowrap", ...style }}>
      {children}
    </th>
  );
}

function DeleteBtn({ onClick }) {
  return (
    <button onClick={onClick} style={{ background: "none", border: "none", color: "#374151", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px" }}
      onMouseEnter={e => e.currentTarget.style.color = "#fca5a5"}
      onMouseLeave={e => e.currentTarget.style.color = "#374151"}>×</button>
  );
}

function SidePill({ side, onClick }) {
  const isLong = side === "long";
  return (
    <button onClick={onClick} style={{ padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", cursor: "pointer", border: "none", background: isLong ? "rgba(22,163,74,0.2)" : "rgba(220,38,38,0.2)", color: isLong ? "#86efac" : "#fca5a5", whiteSpace: "nowrap" }}>
      {isLong ? "LONG" : "SHORT"}
    </button>
  );
}

// ─── Debounce hook ─────────────────────────────────────────────────────────────
function useDebounce(fn, delay) {
  const timer = useRef(null);
  return useCallback((...args) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(...args), delay);
  }, [fn, delay]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab 1 — Live Portfolio
// ═══════════════════════════════════════════════════════════════════════════════

function LivePortfolioTab() {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState({});

  useEffect(() => { loadPositions(); }, []);

  async function loadPositions() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/track-record/positions`);
      setRows(await res.json());
    } finally {
      setLoading(false);
    }
  }

  async function addPosition() {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${API}/api/track-record/positions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: "NEW", entry_date: today, side: "long", shares: 0, avg_price_in: 0 }),
    });
    const row = await res.json();
    setRows(prev => [...prev, row]);
  }

  async function deletePosition(id) {
    await fetch(`${API}/api/track-record/positions/${id}`, { method: "DELETE" });
    setRows(prev => prev.filter(r => r.id !== id));
  }

  async function savePosition(row) {
    setSaving(prev => ({ ...prev, [row.id]: true }));
    try {
      const res = await fetch(`${API}/api/track-record/positions/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker:       row.ticker,
          company_name: row.company_name,
          entry_date:   row.entry_date,
          side:         row.side,
          shares:       Number(row.shares) || 0,
          avg_price_in: Number(row.avg_price_in) || 0,
          stop:         row.stop ? Number(row.stop) : null,
          target:       row.target ? Number(row.target) : null,
          notes:        row.notes || null,
        }),
      });
      const updated = await res.json();
      setRows(prev => prev.map(r => r.id === row.id ? updated : r));
    } finally {
      setSaving(prev => ({ ...prev, [row.id]: false }));
    }
  }

  async function onTickerBlur(row) {
    if (!row.ticker || row.ticker === "NEW") return;
    try {
      const res  = await fetch(`${API}/api/track-record/ticker-info/${row.ticker}`);
      const info = await res.json();
      const updated = {
        ...row,
        company_name:  info.company_name || row.company_name,
        current_price: info.current_price ?? row.current_price,
      };
      setRows(prev => prev.map(r => r.id === row.id ? updated : r));
    } catch {}
  }

  function updateRow(id, field, value) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  // KPI summary
  const gross_exp   = rows.reduce((s, r) => s + Math.abs(r.gross_exposure ?? 0), 0);
  const net_exp     = rows.reduce((s, r) => s + (r.net_exposure ?? 0), 0);
  const invested    = rows.reduce((s, r) => s + ((r.shares ?? 0) * (r.avg_price_in ?? 0)), 0);
  const total_pnl   = rows.reduce((s, r) => s + (r.pnl_dollar ?? 0), 0);
  const total_pnlp  = invested ? (total_pnl / invested * 100) : null;

  if (loading) return <div style={{ color: "#4b5563", fontSize: 13, padding: "24px 0" }}>Loading positions…</div>;

  return (
    <div>
      {/* KPI strip */}
      <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
        <KpiCard label="Gross Exposure" value={`$${(gross_exp / 1000).toFixed(1)}K`} />
        <KpiCard label="Net Exposure"   value={`$${(net_exp  / 1000).toFixed(1)}K`}  valueColor={pnlColor(net_exp)} />
        <KpiCard label="Invested Capital" value={`$${(invested / 1000).toFixed(1)}K`} />
        <KpiCard label="$ PnL"  value={`${total_pnl >= 0 ? "+" : ""}$${Math.abs(total_pnl).toFixed(0)}`} valueColor={pnlColor(total_pnl)} />
        <KpiCard label="% PnL"  value={total_pnlp != null ? `${total_pnlp >= 0 ? "+" : ""}${total_pnlp.toFixed(2)}%` : "—"} valueColor={pnlColor(total_pnlp)} />
      </div>

      {/* Buttons */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button onClick={addPosition} style={btnPrimary}>+ Add Position</button>
        <button onClick={loadPositions} style={btnSecondary}>↻ Refresh Prices</button>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <Th style={{ width: 30 }}>#</Th>
              <Th>Ticker</Th>
              <Th>Company</Th>
              <Th>Entry Date</Th>
              <Th style={{ textAlign: "center" }}>Days</Th>
              <Th style={{ textAlign: "center" }}>L/S</Th>
              <Th style={{ textAlign: "right" }}>Shares</Th>
              <Th style={{ textAlign: "right" }}>Avg In</Th>
              <Th style={{ textAlign: "right" }}>Current</Th>
              <Th style={{ textAlign: "right" }}>Stop</Th>
              <Th style={{ textAlign: "right" }}>Target</Th>
              <Th style={{ textAlign: "right" }}>R/R</Th>
              <Th style={{ textAlign: "right" }}>Gross Exp</Th>
              <Th style={{ textAlign: "right" }}>Net Exp</Th>
              <Th style={{ textAlign: "right" }}>$ PnL</Th>
              <Th style={{ textAlign: "right" }}>% PnL</Th>
              <Th style={{ width: 30 }}></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id}
                style={{ borderBottom: "1px solid #0d1829" }}
                onMouseEnter={e => e.currentTarget.style.background = "#0a1628"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <td style={{ padding: "6px 10px", fontSize: 11, color: "#374151", textAlign: "center" }}>{i + 1}</td>
                <td style={{ padding: "4px 6px" }}>
                  <input value={row.ticker} onChange={e => updateRow(row.id, "ticker", e.target.value.toUpperCase())}
                    onBlur={() => onTickerBlur(row)}
                    style={{ ...cellInput, fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "#f9fafb", width: 70 }} />
                </td>
                <td style={{ padding: "4px 6px" }}>
                  <input value={row.company_name || ""} onChange={e => updateRow(row.id, "company_name", e.target.value)}
                    onBlur={() => savePosition(row)}
                    style={{ ...cellInput, width: 140, color: "#9ca3af" }} />
                </td>
                <td style={{ padding: "4px 6px" }}>
                  <input type="date" value={row.entry_date || ""} onChange={e => updateRow(row.id, "entry_date", e.target.value)}
                    onBlur={() => savePosition(row)}
                    style={{ ...cellInput, width: 120, colorScheme: "dark" }} />
                </td>
                <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 12, color: "#6b7280", fontVariantNumeric: "tabular-nums" }}>
                  {row.days_in_trade ?? "—"}
                </td>
                <td style={{ padding: "4px 6px", textAlign: "center" }}>
                  <SidePill side={row.side} onClick={() => { updateRow(row.id, "side", row.side === "long" ? "short" : "long"); }} />
                </td>
                <td style={{ padding: "4px 6px" }}>
                  <input type="number" value={row.shares || ""} onChange={e => updateRow(row.id, "shares", e.target.value)}
                    onBlur={() => savePosition(row)}
                    style={{ ...cellInput, textAlign: "right", width: 70 }} />
                </td>
                <td style={{ padding: "4px 6px" }}>
                  <input type="number" value={row.avg_price_in || ""} onChange={e => updateRow(row.id, "avg_price_in", e.target.value)}
                    onBlur={() => savePosition(row)}
                    style={{ ...cellInput, textAlign: "right", width: 70 }} />
                </td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: "#e5e7eb", fontVariantNumeric: "tabular-nums" }}>
                  {row.current_price != null ? `$${row.current_price.toFixed(2)}` : "—"}
                </td>
                <td style={{ padding: "4px 6px" }}>
                  <input type="number" value={row.stop ?? ""} onChange={e => updateRow(row.id, "stop", e.target.value)}
                    onBlur={() => savePosition(row)}
                    style={{ ...cellInput, textAlign: "right", width: 70, color: "#fca5a5" }} />
                </td>
                <td style={{ padding: "4px 6px" }}>
                  <input type="number" value={row.target ?? ""} onChange={e => updateRow(row.id, "target", e.target.value)}
                    onBlur={() => savePosition(row)}
                    style={{ ...cellInput, textAlign: "right", width: 70, color: "#86efac" }} />
                </td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: "#9ca3af", fontVariantNumeric: "tabular-nums" }}>
                  {row.r_r != null ? row.r_r.toFixed(2) : "—"}
                </td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: "#6b7280", fontVariantNumeric: "tabular-nums" }}>
                  {row.gross_exposure != null ? `$${Math.abs(row.gross_exposure).toFixed(0)}` : "—"}
                </td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: pnlColor(row.net_exposure), fontVariantNumeric: "tabular-nums" }}>
                  {row.net_exposure != null ? `${row.net_exposure >= 0 ? "+" : ""}$${row.net_exposure.toFixed(0)}` : "—"}
                </td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, fontWeight: 600, color: pnlColor(row.pnl_dollar), fontVariantNumeric: "tabular-nums" }}>
                  {row.pnl_dollar != null ? `${row.pnl_dollar >= 0 ? "+" : ""}$${Math.abs(row.pnl_dollar).toFixed(0)}` : "—"}
                </td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, fontWeight: 600, color: pnlColor(row.pnl_pct), fontVariantNumeric: "tabular-nums" }}>
                  {row.pnl_pct != null ? `${row.pnl_pct >= 0 ? "+" : ""}${row.pnl_pct.toFixed(2)}%` : "—"}
                </td>
                <td style={{ padding: "4px 6px", textAlign: "center" }}>
                  <DeleteBtn onClick={() => deletePosition(row.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <div style={{ textAlign: "center", padding: "32px", color: "#374151", fontSize: 13 }}>
          No open positions. Click "+ Add Position" to get started.
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab 2 — Realized PnL
// ═══════════════════════════════════════════════════════════════════════════════

function RealizedPnlTab() {
  const [trades,  setTrades]  = useState([]);
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [tRes, sRes] = await Promise.all([
        fetch(`${API}/api/track-record/trades`),
        fetch(`${API}/api/track-record/trades/stats`),
      ]);
      setTrades(await tRes.json());
      setStats(await sRes.json());
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    const res = await fetch(`${API}/api/track-record/trades/stats`);
    setStats(await res.json());
  }

  async function addTrade() {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${API}/api/track-record/trades`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: "NEW", side: "long", shares: 0, avg_entry_price: 0, avg_exit_price: 0, entry_date: today, exit_date: today, win_score: 1 }),
    });
    const row = await res.json();
    setTrades(prev => [row, ...prev]);
    loadStats();
  }

  async function saveTrade(row) {
    const isNew = typeof row.id === "string" && row.id.startsWith("tmp");
    const method = isNew ? "POST" : "PUT";
    const url = isNew ? `${API}/api/track-record/trades` : `${API}/api/track-record/trades/${row.id}`;
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker:          row.ticker,
        company_name:    row.company_name || null,
        side:            row.side,
        shares:          Number(row.shares) || 0,
        avg_entry_price: Number(row.avg_entry_price) || 0,
        avg_exit_price:  Number(row.avg_exit_price)  || 0,
        entry_date:      row.entry_date,
        exit_date:       row.exit_date,
        win_score:       Number(row.win_score) || 1,
        comment:         row.comment || null,
      }),
    });
    const updated = await res.json();
    setTrades(prev => prev.map(r => r.id === row.id ? updated : r));
    loadStats();
  }

  async function deleteTrade(id) {
    await fetch(`${API}/api/track-record/trades/${id}`, { method: "DELETE" });
    setTrades(prev => prev.filter(r => r.id !== id));
    loadStats();
  }

  function updateRow(id, field, value) {
    setTrades(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  async function onTickerBlur(row) {
    if (!row.ticker || row.ticker === "NEW") return;
    let updatedRow = { ...row };
    try {
      const res = await fetch(`${API}/api/track-record/ticker-info/${row.ticker}`);
      const info = await res.json();
      if (info.company_name && !row.company_name) {
        updatedRow = { ...row, company_name: info.company_name };
        setTrades(prev => prev.map(r => r.id === row.id ? updatedRow : r));
      }
    } catch {}
    saveTrade(updatedRow);
  }

  const statItems = stats ? [
    { label: "Wins",         value: stats.wins,                      color: "#86efac" },
    { label: "Losses",       value: stats.losses,                    color: "#fca5a5" },
    { label: "Total",        value: stats.total,                     color: "#e5e7eb" },
    { label: "Win $",        value: `$${Math.abs(stats.win_dollars  || 0).toFixed(0)}`, color: "#86efac" },
    { label: "Loss $",       value: `$${Math.abs(stats.loss_dollars || 0).toFixed(0)}`, color: "#fca5a5" },
    { label: "Total $",      value: `${(stats.total_dollars || 0) >= 0 ? "+" : ""}$${Math.abs(stats.total_dollars || 0).toFixed(0)}`, color: pnlColor(stats.total_dollars) },
    { label: "Win %",        value: `${fmtNum(stats.win_rate, 1)}%`, color: "#86efac" },
    { label: "Loss %",       value: `${fmtNum(stats.loss_rate, 1)}%`,color: "#fca5a5" },
    { label: "R Score",      value: fmtNum(stats.r_score, 2),        color: pnlColor(stats.r_score) },
    { label: "Full Kelly %", value: `${fmtNum(stats.full_kelly, 2)}%`, color: pnlColor(stats.full_kelly) },
    { label: "Bet Kelly %",  value: `${fmtNum(stats.bet_kelly, 2)}%`,  color: pnlColor(stats.bet_kelly) },
  ] : [];

  if (loading) return <div style={{ color: "#4b5563", fontSize: 13, padding: "24px 0" }}>Loading trades…</div>;

  return (
    <div>
      {/* Stats strip */}
      {stats && (
        <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
          {statItems.map(s => (
            <KpiCard key={s.label} label={s.label} value={s.value} valueColor={s.color} small />
          ))}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <button onClick={addTrade} style={btnPrimary}>+ Add Trade</button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <Th style={{ width: 30 }}>#</Th>
              <Th>Ticker</Th>
              <Th>Company</Th>
              <Th style={{ textAlign: "center" }}>L/S</Th>
              <Th style={{ textAlign: "right" }}>Shares</Th>
              <Th style={{ textAlign: "right" }}>Avg Entry</Th>
              <Th style={{ textAlign: "right" }}>Avg Exit</Th>
              <Th>Entry Date</Th>
              <Th>Exit Date</Th>
              <Th style={{ textAlign: "center" }}>Days</Th>
              <Th style={{ textAlign: "right" }}>% PnL</Th>
              <Th style={{ textAlign: "right" }}>$ PnL</Th>
              <Th style={{ textAlign: "center" }}>W/L</Th>
              <Th>Comment</Th>
              <Th style={{ width: 30 }}></Th>
            </tr>
          </thead>
          <tbody>
            {trades.map((row, i) => {
              const days = row.entry_date && row.exit_date
                ? Math.round((new Date(row.exit_date) - new Date(row.entry_date)) / 86400000)
                : null;
              return (
                <tr key={row.id}
                  style={{ borderBottom: "1px solid #0d1829" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#0a1628"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <td style={{ padding: "6px 10px", fontSize: 11, color: "#374151", textAlign: "center" }}>{trades.length - i}</td>
                  <td style={{ padding: "4px 6px" }}>
                    <input value={row.ticker || ""} onChange={e => updateRow(row.id, "ticker", e.target.value.toUpperCase())}
                      onBlur={() => onTickerBlur(row)}
                      style={{ ...cellInput, fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "#f9fafb", width: 70 }} />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input value={row.company_name || ""} onChange={e => updateRow(row.id, "company_name", e.target.value)}
                      onBlur={() => saveTrade(row)}
                      style={{ ...cellInput, width: 130, color: "#9ca3af" }} />
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "center" }}>
                    <SidePill side={row.side} onClick={() => { updateRow(row.id, "side", row.side === "long" ? "short" : "long"); saveTrade({ ...row, side: row.side === "long" ? "short" : "long" }); }} />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input type="number" value={row.shares || ""} onChange={e => updateRow(row.id, "shares", e.target.value)}
                      onBlur={() => saveTrade(row)} style={{ ...cellInput, textAlign: "right", width: 70 }} />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input type="number" value={row.avg_entry_price || ""} onChange={e => updateRow(row.id, "avg_entry_price", e.target.value)}
                      onBlur={() => saveTrade(row)} style={{ ...cellInput, textAlign: "right", width: 70 }} />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input type="number" value={row.avg_exit_price || ""} onChange={e => updateRow(row.id, "avg_exit_price", e.target.value)}
                      onBlur={() => saveTrade(row)} style={{ ...cellInput, textAlign: "right", width: 70 }} />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input type="date" value={row.entry_date || ""} onChange={e => updateRow(row.id, "entry_date", e.target.value)}
                      onBlur={() => saveTrade(row)} style={{ ...cellInput, width: 120, colorScheme: "dark" }} />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input type="date" value={row.exit_date || ""} onChange={e => updateRow(row.id, "exit_date", e.target.value)}
                      onBlur={() => saveTrade(row)} style={{ ...cellInput, width: 120, colorScheme: "dark" }} />
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 12, color: "#6b7280", fontVariantNumeric: "tabular-nums" }}>
                    {days ?? "—"}
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, fontWeight: 600, color: pnlColor(row.pnl_pct), fontVariantNumeric: "tabular-nums" }}>
                    {row.pnl_pct != null ? `${row.pnl_pct >= 0 ? "+" : ""}${row.pnl_pct.toFixed(2)}%` : "—"}
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, fontWeight: 600, color: pnlColor(row.pnl_dollar), fontVariantNumeric: "tabular-nums" }}>
                    {row.pnl_dollar != null ? `${row.pnl_dollar >= 0 ? "+" : ""}$${Math.abs(row.pnl_dollar).toFixed(0)}` : "—"}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "center" }}>
                    <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", display: "inline-block", background: row.pnl_dollar >= 0 ? "rgba(22,163,74,0.2)" : "rgba(220,38,38,0.2)", color: row.pnl_dollar >= 0 ? "#86efac" : "#fca5a5" }}>
                      {row.pnl_dollar >= 0 ? "WIN" : "LOSS"}
                    </span>
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input value={row.comment || ""} onChange={e => updateRow(row.id, "comment", e.target.value)}
                      onBlur={() => saveTrade(row)}
                      style={{ ...cellInput, width: 180, color: "#6b7280" }} />
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "center" }}>
                    <DeleteBtn onClick={() => deleteTrade(row.id)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {trades.length === 0 && (
        <div style={{ textAlign: "center", padding: "32px", color: "#374151", fontSize: 13 }}>
          No realized trades yet. Click "+ Add Trade" to get started.
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab 3 — Equity Curve
// ═══════════════════════════════════════════════════════════════════════════════

function EquityCurveTab() {
  const [rows,    setRows]    = useState([]);
  const [perf,    setPerf]    = useState([]);
  const [stats,   setStats]   = useState(null);
  const [spy,     setSpy]     = useState(null);
  const [showSpy, setShowSpy] = useState(false);
  const [period,  setPeriod]  = useState("ALL");
  const [loading, setLoading] = useState(true);

  const mainRef  = useRef(null);
  const subRef   = useRef(null);
  const mainChart = useRef(null);
  const subChart  = useRef(null);
  const syncing   = useRef(false);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [rRes, sRes, spyRes, perfRes] = await Promise.all([
        fetch(`${API}/api/track-record/equity`),
        fetch(`${API}/api/track-record/equity/stats`),
        fetch(`${API}/api/track-record/equity/spy`),
        fetch(`${API}/api/track-record/equity/performance`),
      ]);
      setRows(await rRes.json());
      setStats(await sRes.json());
      setSpy(await spyRes.json());
      setPerf(await perfRes.json());
    } finally {
      setLoading(false);
    }
  }

  async function reloadRows() {
    const [rRes, sRes, perfRes] = await Promise.all([
      fetch(`${API}/api/track-record/equity`),
      fetch(`${API}/api/track-record/equity/stats`),
      fetch(`${API}/api/track-record/equity/performance`),
    ]);
    setRows(await rRes.json());
    setStats(await sRes.json());
    setPerf(await perfRes.json());
  }

  async function addRow() {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${API}/api/track-record/equity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: today, portfolio_value: 0 }),
    });
    await res.json();
    reloadRows();
  }

  async function saveRow(row) {
    const res = await fetch(`${API}/api/track-record/equity/${row.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date:            row.date,
        unrealized_pnl:  Number(row.unrealized_pnl) || 0,
        fees:            Number(row.fees)  || 0,
        deposit:         Number(row.deposit) || 0,
        withdrawal:      Number(row.withdrawal) || 0,
        portfolio_value: Number(row.portfolio_value) || 0,
      }),
    });
    const updated = await res.json();
    // PUT /equity/{id} returns full list
    if (Array.isArray(updated)) {
      setRows(updated);
    }
  }

  async function deleteRow(id) {
    await fetch(`${API}/api/track-record/equity/${id}`, { method: "DELETE" });
    reloadRows();
  }

  function updateRow(id, field, value) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  // Build chart when perf data changes
  useEffect(() => {
    if (!perf.length || !mainRef.current || !subRef.current) return;

    mainChart.current?.remove();
    subChart.current?.remove();

    const mc = createChart(mainRef.current, {
      layout:          { background: { type: ColorType.Solid, color: "#080e1a" }, textColor: "#6b7280" },
      grid:            { vertLines: { color: "rgba(31,41,55,0.5)" }, horzLines: { color: "rgba(31,41,55,0.5)" } },
      crosshair:       { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1f2937" },
      timeScale:       { borderColor: "#1f2937", timeVisible: false },
      width:           mainRef.current.clientWidth,
      height:          360,
    });
    mainChart.current = mc;

    // Cumulative PnL line (realized + unrealized)
    const pnlLine = mc.addSeries(LineSeries, {
      color: "#e5e7eb", lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: "Cum. PnL",
    });
    pnlLine.setData(perf.map(r => ({ time: r.date, value: r.cum_pnl })));

    // SPY overlay (dollar equivalent scaled to first cum_pnl — only shown if spy data exists)
    if (showSpy && spy?.dates?.length && perf.length) {
      const firstVal = perf[0].cum_pnl;
      mc.addSeries(LineSeries, {
        color: "#f59e0b", lineWidth: 1.5, lineStyle: 1, priceLineVisible: false, lastValueVisible: false, title: "SPY",
      }).setData(spy.dates.map((d, i) => ({ time: d, value: (spy.values[i] - 100) / 100 * Math.abs(firstVal || 10000) + firstVal })));
    }

    mc.timeScale().fitContent();

    // Sub chart — weekly PnL histogram
    const sc = createChart(subRef.current, {
      layout:          { background: { type: ColorType.Solid, color: "#080e1a" }, textColor: "#6b7280" },
      grid:            { vertLines: { color: "rgba(31,41,55,0.5)" }, horzLines: { visible: false } },
      crosshair:       { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1f2937", scaleMargins: { top: 0.05, bottom: 0.05 } },
      timeScale:       { borderColor: "#1f2937", timeVisible: true },
      width:           subRef.current.clientWidth,
      height:          120,
    });
    subChart.current = sc;

    const weeklyBar = sc.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, base: 0 });
    weeklyBar.setData(perf.map(r => ({
      time:  r.date,
      value: r.weekly_pnl,
      color: r.weekly_pnl >= 0 ? "rgba(22,163,74,0.7)" : "rgba(220,38,38,0.7)",
    })));
    sc.timeScale().fitContent();

    // Sync
    mc.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (syncing.current || !range) return;
      syncing.current = true;
      sc.timeScale().setVisibleRange(range);
      syncing.current = false;
    });
    sc.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (syncing.current || !range) return;
      syncing.current = true;
      mc.timeScale().setVisibleRange(range);
      syncing.current = false;
    });

    const ro = new ResizeObserver(() => {
      mc.applyOptions({ width: mainRef.current?.clientWidth ?? 600 });
      sc.applyOptions({ width: subRef.current?.clientWidth ?? 600 });
    });
    ro.observe(mainRef.current);

    return () => {
      ro.disconnect();
      mc.remove(); mainChart.current = null;
      sc.remove(); subChart.current  = null;
    };
  }, [perf, spy, showSpy]);

  // Period
  useEffect(() => {
    if (!mainChart.current) return;
    const sel = PERIODS.find(p => p.label === period);
    if (!sel?.years) {
      mainChart.current.timeScale().fitContent();
    } else {
      const to = new Date(), from = new Date();
      from.setFullYear(from.getFullYear() - sel.years);
      try {
        mainChart.current.timeScale().setVisibleRange({
          from: from.toISOString().slice(0, 10),
          to:   to.toISOString().slice(0, 10),
        });
      } catch {
        mainChart.current.timeScale().fitContent();
      }
    }
  }, [period, perf]);

  const statItems = stats ? [
    { label: "Mean Return (W)",  value: stats.mean_return_weekly  != null ? `${fmtNum(stats.mean_return_weekly, 3)}%`  : "—", color: pnlColor(stats.mean_return_weekly) },
    { label: "Mean Return (A)",  value: stats.mean_return_annual  != null ? `${fmtNum(stats.mean_return_annual, 2)}%`  : "—", color: pnlColor(stats.mean_return_annual) },
    { label: "Total Return",     value: stats.total_return        != null ? `${fmtNum(stats.total_return, 2)}%`        : "—", color: pnlColor(stats.total_return) },
    { label: "Std Dev (W)",      value: stats.std_weekly          != null ? `${fmtNum(stats.std_weekly, 3)}%`          : "—", color: "#9ca3af" },
    { label: "Std Dev (A)",      value: stats.std_annual          != null ? `${fmtNum(stats.std_annual, 2)}%`          : "—", color: "#9ca3af" },
    { label: "Max Drawdown",     value: stats.max_drawdown        != null ? `${fmtNum(stats.max_drawdown, 2)}%`        : "—", color: pnlColor(stats.max_drawdown) },
    { label: "Down Dev (W)",     value: stats.downside_dev_weekly != null ? `${fmtNum(stats.downside_dev_weekly, 3)}%` : "—", color: "#f59e0b" },
    { label: "Down Dev (A)",     value: stats.downside_dev_annual != null ? `${fmtNum(stats.downside_dev_annual, 2)}%` : "—", color: "#f59e0b" },
    { label: "Sharpe",           value: stats.sharpe  != null ? fmtNum(stats.sharpe, 2)  : "—", color: pnlColor(stats.sharpe) },
    { label: "Calmar",           value: stats.calmar  != null ? fmtNum(stats.calmar, 2)  : "—", color: pnlColor(stats.calmar) },
    { label: "Sortino",          value: stats.sortino != null ? fmtNum(stats.sortino, 2) : "—", color: pnlColor(stats.sortino) },
  ] : [];

  if (loading) return <div style={{ color: "#4b5563", fontSize: 13, padding: "24px 0" }}>Loading equity data…</div>;

  return (
    <div>
      {/* Stats strip */}
      {stats && (
        <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
          {statItems.map(s => (
            <KpiCard key={s.label} label={s.label} value={s.value} valueColor={s.color} small />
          ))}
        </div>
      )}

      {/* Chart controls */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        {PERIODS.map(p => (
          <button key={p.label} onClick={() => setPeriod(p.label)} style={{
            padding: "5px 10px", fontSize: 12, borderRadius: 5,
            background: period === p.label ? "#1e3a5f" : "transparent",
            border: period === p.label ? "1px solid #2d5a8e" : "1px solid #1f2937",
            color: period === p.label ? "#93c5fd" : "#6b7280",
            cursor: "pointer",
          }}>{p.label}</button>
        ))}
        <button onClick={() => setShowSpy(s => !s)} style={{
          padding: "5px 12px", fontSize: 12, borderRadius: 5,
          background: showSpy ? "rgba(245,158,11,0.15)" : "transparent",
          border: showSpy ? "1px solid rgba(245,158,11,0.5)" : "1px solid #1f2937",
          color: showSpy ? "#f59e0b" : "#6b7280",
          cursor: "pointer",
        }}>◈ SPY</button>
      </div>

      {/* Charts */}
      {perf.length > 0 ? (
        <>
          <div ref={mainRef} style={{ width: "100%" }} />
          <div style={{ fontSize: 10, color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 4, marginBottom: 2 }}>Weekly PnL</div>
          <div ref={subRef} style={{ width: "100%" }} />
        </>
      ) : (
        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#374151", fontSize: 13, border: "1px dashed #1f2937", borderRadius: 8 }}>
          Add realized trades to see the equity curve
        </div>
      )}

      {/* Equity Table */}
      <div style={{ marginTop: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.08em" }}>Portfolio Data</div>
          <button onClick={addRow} style={btnPrimary}>+ Add Row</button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th style={{ textAlign: "right" }}>Unrealized PnL</Th>
                <Th style={{ textAlign: "right" }}>Realized PnL</Th>
                <Th style={{ textAlign: "right" }}>Fees</Th>
                <Th style={{ textAlign: "right" }}>Deposit</Th>
                <Th style={{ textAlign: "right" }}>Withdrawal</Th>
                <Th style={{ textAlign: "right" }}>Cum. Deposit</Th>
                <Th style={{ textAlign: "right" }}>Portfolio Value</Th>
                <Th style={{ textAlign: "right" }}>Return %</Th>
                <Th style={{ textAlign: "right" }}>Index</Th>
                <Th style={{ textAlign: "right" }}>Drawdown</Th>
                <Th style={{ width: 30 }}></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}
                  style={{ borderBottom: "1px solid #0d1829" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#0a1628"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <td style={{ padding: "4px 6px" }}>
                    <input type="date" value={row.date || ""} onChange={e => updateRow(row.id, "date", e.target.value)}
                      onBlur={() => saveRow(row)} style={{ ...cellInput, width: 120, colorScheme: "dark" }} />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input type="number" value={row.unrealized_pnl ?? ""} onChange={e => updateRow(row.id, "unrealized_pnl", e.target.value)}
                      onBlur={() => saveRow(row)} style={{ ...cellInput, textAlign: "right", width: 90, color: pnlColor(row.unrealized_pnl) }} />
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: pnlColor(row.realized_pnl), fontVariantNumeric: "tabular-nums" }}>
                    {row.realized_pnl != null ? `${row.realized_pnl >= 0 ? "+" : ""}$${Math.abs(row.realized_pnl).toFixed(0)}` : "—"}
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input type="number" value={row.fees ?? ""} onChange={e => updateRow(row.id, "fees", e.target.value)}
                      onBlur={() => saveRow(row)} style={{ ...cellInput, textAlign: "right", width: 70 }} />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input type="number" value={row.deposit ?? ""} onChange={e => updateRow(row.id, "deposit", e.target.value)}
                      onBlur={() => saveRow(row)} style={{ ...cellInput, textAlign: "right", width: 80, color: "#86efac" }} />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input type="number" value={row.withdrawal ?? ""} onChange={e => updateRow(row.id, "withdrawal", e.target.value)}
                      onBlur={() => saveRow(row)} style={{ ...cellInput, textAlign: "right", width: 80, color: "#fca5a5" }} />
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: "#9ca3af", fontVariantNumeric: "tabular-nums" }}>
                    {row.cumulative_deposit != null ? `$${row.cumulative_deposit.toFixed(0)}` : "—"}
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input type="number" value={row.portfolio_value ?? ""} onChange={e => updateRow(row.id, "portfolio_value", e.target.value)}
                      onBlur={() => saveRow(row)} style={{ ...cellInput, textAlign: "right", width: 90, color: "#e5e7eb", fontWeight: 600 }} />
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, fontWeight: 600, color: pnlColor(row.return_pct), fontVariantNumeric: "tabular-nums" }}>
                    {row.return_pct != null ? `${row.return_pct >= 0 ? "+" : ""}${row.return_pct.toFixed(2)}%` : "—"}
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: "#e5e7eb", fontVariantNumeric: "tabular-nums" }}>
                    {row.index != null ? row.index.toFixed(1) : "—"}
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: pnlColor(row.drawdown), fontVariantNumeric: "tabular-nums" }}>
                    {row.drawdown != null ? `${row.drawdown.toFixed(2)}%` : "—"}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "center" }}>
                    <DeleteBtn onClick={() => deleteRow(row.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <div style={{ textAlign: "center", padding: "32px", color: "#374151", fontSize: 13 }}>
            No equity entries yet. Click "+ Add Row" to get started.
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════════════════════

export default function TrackRecordPage() {
  const [tab, setTab] = useState("Live Portfolio");

  return (
    <div style={{ padding: "28px 32px", minHeight: "100vh", background: "#020617", color: "#e5e7eb" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f9fafb", margin: 0 }}>Trading Track Record</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
          Live positions, realized trades, and equity curve analytics.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 28, borderBottom: "1px solid #1f2937" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 18px",
            fontSize: 13,
            cursor: "pointer",
            background: "transparent",
            border: "none",
            borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent",
            color: tab === t ? "#e5e7eb" : "#6b7280",
            marginBottom: -1,
            fontWeight: tab === t ? 600 : 400,
          }}>{t}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 10, padding: "24px 28px" }}>
        {tab === "Live Portfolio" && <LivePortfolioTab />}
        {tab === "Realized PnL"  && <RealizedPnlTab  />}
        {tab === "Equity Curve"  && <EquityCurveTab  />}
      </div>
    </div>
  );
}
