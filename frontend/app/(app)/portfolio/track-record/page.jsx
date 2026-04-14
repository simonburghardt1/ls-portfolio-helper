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
function tradingDays(start, end) {
  let n = 0, d = new Date(start), e = new Date(end);
  while (d < e) { const w = d.getDay(); if (w && w < 6) n++; d.setDate(d.getDate() + 1); }
  return n;
}

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
  const [rows,     setRows]     = useState([]);
  const [cashRows, setCashRows] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState({});

  useEffect(() => { loadPositions(); }, []);

  async function loadPositions() {
    setLoading(true);
    try {
      const [posRes, cashRes] = await Promise.all([
        fetch(`${API}/api/track-record/positions`),
        fetch(`${API}/api/track-record/cash-positions`),
      ]);
      setRows(await posRes.json());
      if (cashRes.ok) setCashRows(await cashRes.json());
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
      const res  = await fetch(`${API}/api/track-record/ticker-info/${encodeURIComponent(row.ticker)}`);
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

  // KPI summary (include FX PnL from cash positions)
  const gross_exp   = rows.reduce((s, r) => s + Math.abs(r.gross_exposure ?? 0), 0);
  const net_exp     = rows.reduce((s, r) => s + (r.net_exposure ?? 0), 0);
  const invested    = rows.reduce((s, r) => s + ((r.shares ?? 0) * (r.avg_price_in ?? 0)), 0);
  const fx_pnl      = cashRows.reduce((s, r) => s + (r.fx_pnl ?? 0), 0);
  const total_pnl   = rows.reduce((s, r) => s + (r.pnl_dollar ?? 0), 0) + fx_pnl;
  const total_pnlp  = invested ? (total_pnl / invested * 100) : null;
  const cash_eur    = cashRows.reduce((s, r) => s + (r.eur_value ?? 0), 0);
  const account_val = cash_eur + net_exp;

  if (loading) return <div style={{ color: "#4b5563", fontSize: 13, padding: "24px 0" }}>Loading positions…</div>;

  return (
    <div>
      {/* KPI strip */}
      <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
        <KpiCard label="Account Value"    value={`€${(account_val / 1000).toFixed(1)}K`} valueColor="#e5e7eb" />
        <KpiCard label="Gross Exposure"   value={`$${(gross_exp / 1000).toFixed(1)}K`} />
        <KpiCard label="Net Exposure"     value={`${net_exp >= 0 ? "+" : "-"}$${Math.abs(net_exp / 1000).toFixed(1)}K`}  valueColor={pnlColor(net_exp)} />
        <KpiCard label="Invested Capital" value={`$${(invested / 1000).toFixed(1)}K`} />
        <KpiCard label="$ PnL"  value={`${total_pnl >= 0 ? "+" : "-"}$${Math.abs(total_pnl).toFixed(0)}`} valueColor={pnlColor(total_pnl)} />
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
                  {row.net_exposure != null ? `${row.net_exposure >= 0 ? "+" : "-"}$${Math.abs(row.net_exposure).toFixed(0)}` : "—"}
                </td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, fontWeight: 600, color: pnlColor(row.pnl_dollar), fontVariantNumeric: "tabular-nums" }}>
                  {row.pnl_dollar != null ? `${row.pnl_dollar >= 0 ? "+" : "-"}$${Math.abs(row.pnl_dollar).toFixed(0)}` : "—"}
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
          {cashRows.length > 0 && (
            <tbody>
              <tr>
                <td colSpan={17} style={{ padding: "6px 10px", fontSize: 10, color: "#374151", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", borderTop: "1px solid #1e3a5f" }}>
                  Cash Positions
                </td>
              </tr>
              {cashRows.map(cr => (
                <tr key={cr.currency}
                  style={{ borderBottom: "1px solid #0d1829" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#0a1628"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  {/* col 1: # */}
                  <td style={{ padding: "6px 10px", fontSize: 11, color: "#374151", textAlign: "center" }}>—</td>
                  {/* col 2: Ticker */}
                  <td style={{ padding: "4px 6px", fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "#f9fafb" }}>{cr.currency}</td>
                  {/* col 3: Company */}
                  <td style={{ padding: "4px 6px", fontSize: 12, color: "#9ca3af" }}>Cash</td>
                  {/* col 4+5+6: Entry Date + Days + L/S */}
                  <td colSpan={3} style={{ padding: "6px 10px", fontSize: 12, color: "#6b7280", textAlign: "center" }}>—</td>
                  {/* col 7: Shares → cash amount in native currency */}
                  <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: "#e5e7eb", fontVariantNumeric: "tabular-nums" }}>
                    {cr.amount != null ? cr.amount.toLocaleString("de-DE", { maximumFractionDigits: 2 }) : "—"}
                  </td>
                  {/* col 8+9+10+11+12: Avg In + Current + Stop + Target + R/R */}
                  <td colSpan={5} style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: "#6b7280" }}>—</td>
                  {/* col 13: Gross Exp → EUR equivalent */}
                  <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: "#e5e7eb", fontVariantNumeric: "tabular-nums" }}>
                    {cr.eur_value != null ? `€${cr.eur_value.toLocaleString("de-DE", { maximumFractionDigits: 0 })}` : "—"}
                  </td>
                  {/* col 14: Net Exp → — */}
                  <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: "#6b7280" }}>—</td>
                  {/* col 15: $ PnL → FX PnL */}
                  <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: pnlColor(cr.fx_pnl), fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                    {cr.fx_pnl != null ? `${cr.fx_pnl >= 0 ? "+" : "-"}€${Math.abs(cr.fx_pnl).toFixed(0)}` : "—"}
                  </td>
                  {/* col 16+17: % PnL + actions */}
                  <td colSpan={2}></td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
      {rows.length === 0 && cashRows.length === 0 && (
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
      const res = await fetch(`${API}/api/track-record/ticker-info/${encodeURIComponent(row.ticker)}`);
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
                ? tradingDays(row.entry_date, row.exit_date)
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
                    {row.pnl_dollar != null ? `${row.pnl_dollar >= 0 ? "+" : "-"}$${Math.abs(row.pnl_dollar).toFixed(0)}` : "—"}
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
  const [perf,        setPerf]        = useState([]);
  const [stats,       setStats]       = useState(null);
  const [spy,         setSpy]         = useState(null);
  const [showCapital, setShowCapital] = useState(false);
  const [period,      setPeriod]      = useState("ALL");
  const [loading,     setLoading]     = useState(true);
  const [capDate,     setCapDate]     = useState(() => new Date().toISOString().slice(0, 10));
  const [capAmount,   setCapAmount]   = useState("");

  const chart1Ref = useRef(null); const chart1 = useRef(null);
  const chart2Ref = useRef(null); const chart2 = useRef(null);
  const chart3Ref = useRef(null); const chart3 = useRef(null);
  const syncing   = useRef(false);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [sRes, spyRes, perfRes] = await Promise.all([
        fetch(`${API}/api/track-record/equity/stats`),
        fetch(`${API}/api/track-record/equity/spy`),
        fetch(`${API}/api/track-record/equity/performance`),
      ]);
      setStats(await sRes.json());
      setSpy(await spyRes.json());
      setPerf(await perfRes.json());
    } finally {
      setLoading(false);
    }
  }

  async function reloadPerf() {
    const [sRes, perfRes] = await Promise.all([
      fetch(`${API}/api/track-record/equity/stats`),
      fetch(`${API}/api/track-record/equity/performance`),
    ]);
    setStats(await sRes.json());
    setPerf(await perfRes.json());
  }

  async function addCapital(type) {
    const amount = parseFloat(capAmount);
    if (!amount || amount <= 0) return;
    await fetch(`${API}/api/track-record/equity/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: capDate, amount }),
    });
    setCapAmount("");
    reloadPerf();
  }

  // Helper: find closest SPY price for a given date string (handles market holidays ±3 days)
  function spyForDate(spyMap, dateStr) {
    for (const offset of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
      const d = new Date(dateStr + "T12:00:00");
      d.setDate(d.getDate() + offset);
      const s = d.toISOString().slice(0, 10);
      if (spyMap[s] != null) return spyMap[s];
    }
    return null;
  }

  // Apply period range to all 3 charts
  function applyPeriod(sel) {
    const charts = [chart1.current, chart2.current, chart3.current].filter(Boolean);
    if (!sel?.years) {
      charts.forEach(c => c.timeScale().fitContent());
    } else {
      const to = new Date(), from = new Date();
      from.setFullYear(from.getFullYear() - sel.years);
      const range = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
      charts.forEach(c => { try { c.timeScale().setVisibleRange(range); } catch { c.timeScale().fitContent(); } });
    }
  }

  // Build all 3 charts when perf / spy change
  useEffect(() => {
    if (!perf.length || !chart1Ref.current || !chart2Ref.current || !chart3Ref.current) return;

    chart1.current?.remove(); chart1.current = null;
    chart2.current?.remove(); chart2.current = null;
    chart3.current?.remove(); chart3.current = null;

    const spyMap = {};
    if (spy?.dates) spy.dates.forEach((d, i) => { spyMap[d] = spy.values[i]; });

    const chartOpts = (el) => ({
      layout:          { background: { type: ColorType.Solid, color: "#080e1a" }, textColor: "#6b7280" },
      grid:            { vertLines: { color: "rgba(31,41,55,0.5)" }, horzLines: { color: "rgba(31,41,55,0.5)" } },
      crosshair:       { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1f2937" },
      timeScale:       { borderColor: "#1f2937", timeVisible: false },
      width:           el.clientWidth,
      height:          220,
    });

    // ── Chart 1: Portfolio Value + Cumulative Deposit ──
    const c1 = createChart(chart1Ref.current, chartOpts(chart1Ref.current));
    chart1.current = c1;
    c1.addSeries(LineSeries, { color: "#60a5fa", lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: "Portfolio Value" })
      .setData(perf.map(r => ({ time: r.date, value: r.account_value })));
    c1.addSeries(LineSeries, { color: "#374151", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, title: "Cum. Deposit" })
      .setData(perf.map(r => ({ time: r.date, value: r.capital })));
    c1.timeScale().fitContent();

    // ── Chart 2: Portfolio Index vs SPX Index (both = 100 at week 0) ──
    const c2 = createChart(chart2Ref.current, chartOpts(chart2Ref.current));
    chart2.current = c2;
    const firstAV   = perf.find(r => (r.account_value ?? 0) > 0)?.account_value ?? 1;
    const firstDate = perf.find(r => (r.account_value ?? 0) > 0)?.date;
    c2.addSeries(LineSeries, { color: "#60a5fa", lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: "Portfolio" })
      .setData(perf.filter(r => r.account_value != null).map(r => ({ time: r.date, value: Math.round(r.account_value / firstAV * 10000) / 100 })));
    const spxAtFirst = firstDate ? spyForDate(spyMap, firstDate) : null;
    if (spxAtFirst) {
      c2.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: "SPX" })
        .setData(perf.map(r => { const v = spyForDate(spyMap, r.date); return v != null ? { time: r.date, value: Math.round(v / spxAtFirst * 10000) / 100 } : null; }).filter(Boolean));
    }
    c2.timeScale().fitContent();

    // ── Chart 3: Realized PnL (cumulative, realized only) ──
    const c3 = createChart(chart3Ref.current, chartOpts(chart3Ref.current));
    chart3.current = c3;
    // Split into positive and negative segments for coloring
    c3.addSeries(LineSeries, { color: "#f97316", lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: "Realized PnL" })
      .setData(perf.map(r => ({ time: r.date, value: r.cum_realized })));
    c3.timeScale().fitContent();

    // ── Sync all 3 time scales ──
    const allCharts = [c1, c2, c3];
    allCharts.forEach((src) => {
      src.timeScale().subscribeVisibleTimeRangeChange((range) => {
        if (syncing.current || !range) return;
        syncing.current = true;
        allCharts.forEach(dst => { if (dst !== src) { try { dst.timeScale().setVisibleRange(range); } catch {} } });
        syncing.current = false;
      });
    });

    // ── ResizeObserver ──
    const ro = new ResizeObserver(() => {
      c1.applyOptions({ width: chart1Ref.current?.clientWidth ?? 400 });
      c2.applyOptions({ width: chart2Ref.current?.clientWidth ?? 400 });
      c3.applyOptions({ width: chart3Ref.current?.clientWidth ?? 400 });
    });
    ro.observe(chart1Ref.current);

    return () => {
      ro.disconnect();
      c1.remove(); chart1.current = null;
      c2.remove(); chart2.current = null;
      c3.remove(); chart3.current = null;
    };
  }, [perf, spy]);

  // Period selector
  useEffect(() => {
    applyPeriod(PERIODS.find(p => p.label === period));
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

  const lastPerf   = perf.length ? perf[perf.length - 1] : null;
  const netCapital = lastPerf?.capital ?? 0;
  const totalPnl   = lastPerf?.cum_pnl ?? 0;
  const totalDep   = perf.reduce((s, r) => s + (r.cap_delta > 0 ? r.cap_delta : 0), 0);
  const totalWit   = perf.reduce((s, r) => s + (r.cap_delta < 0 ? Math.abs(r.cap_delta) : 0), 0);
  const retPct     = netCapital > 0 ? (totalPnl / netCapital * 100) : null;

  // Compute full analytics table client-side (oldest → newest, then reverse for display)
  // spyIdxMap: date → indexed value (100-based), spyRawMap: date → actual ETF price
  const spyIdxMap = {};
  const spyRawMap = {};
  if (spy?.dates) {
    spy.dates.forEach((d, i) => {
      spyIdxMap[d] = spy.values[i];
      if (spy.raw) spyRawMap[d] = spy.raw[i];
    });
  }

  let portIdx    = null;
  let spxIdx0    = null;
  let peakPort   = 100;
  let peakSpx    = 100;

  const tableRows = perf.map((r, i) => {
    const prevAV     = i > 0 ? perf[i - 1].account_value : null;
    const portReturn = prevAV && prevAV !== 0 ? r.account_value / prevAV - 1 : null;

    portIdx = portIdx === null ? 100 : portIdx * (1 + (portReturn ?? 0));
    peakPort = Math.max(peakPort, portIdx);
    const drawdown = portIdx / peakPort - 1;

    // SPY indexed value (already 100-based from backend); re-index from first perf week so both start at 100
    const spyIdxRaw = spyForDate(spyIdxMap, r.date);
    const spyPrice  = spyForDate(spyRawMap, r.date);
    let spxIdxVal = null;
    if (spyIdxRaw != null) {
      if (spxIdx0 === null) spxIdx0 = spyIdxRaw;
      spxIdxVal = spyIdxRaw / spxIdx0 * 100;
      peakSpx = Math.max(peakSpx, spxIdxVal);
    }
    const spxDD = spxIdxVal != null ? spxIdxVal / peakSpx - 1 : null;

    return {
      ...r,
      port_return:  portReturn,
      port_index:   portIdx,
      drawdown,
      spx_price:    spyPrice,
      spx_index:    spxIdxVal,
      spx_drawdown: spxDD,
      deposit:    r.cap_delta > 0 ? r.cap_delta : 0,
      withdrawal: r.cap_delta < 0 ? Math.abs(r.cap_delta) : 0,
    };
  }).reverse();

  const fmtPct  = (v, dp = 2) => v != null ? `${(v * 100).toFixed(dp)}%` : "—";
  const fmtIdx  = (v) => v != null ? v.toFixed(2) : "—";
  const fmtUsd  = (v, showSign = false) => {
    if (v == null || v === 0) return "—";
    const s = showSign && v > 0 ? "+" : "";
    return `${s}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  };

  return (
    <div>
      {/* Capital Account — collapsible */}
      <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 10, marginBottom: 20, overflow: "hidden" }}>
        <button
          onClick={() => setShowCapital(p => !p)}
          style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.08em" }}>Capital Account</span>
            <span style={{ fontSize: 12, color: "#e5e7eb" }}>${(netCapital + totalPnl).toFixed(0)}</span>
            {retPct != null && <span style={{ fontSize: 12, color: pnlColor(retPct) }}>{retPct >= 0 ? "+" : ""}{retPct.toFixed(2)}%</span>}
          </div>
          <span style={{ fontSize: 12 }}>{showCapital ? "▲" : "▼"}</span>
        </button>
        {showCapital && (
          <div style={{ padding: "0 20px 16px" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <KpiCard label="Net Capital"     value={`$${netCapital.toFixed(0)}`}                                     valueColor="#e5e7eb" small />
              <KpiCard label="Total Deposited" value={`$${totalDep.toFixed(0)}`}                                       valueColor="#86efac" small />
              <KpiCard label="Total Withdrawn" value={`$${totalWit.toFixed(0)}`}                                       valueColor="#fca5a5" small />
              <KpiCard label="Total PnL"       value={`${totalPnl >= 0 ? "+" : ""}$${Math.abs(totalPnl).toFixed(0)}`} valueColor={pnlColor(totalPnl)} small />
              <KpiCard label="Account Value"   value={`$${(netCapital + totalPnl).toFixed(0)}`}                        valueColor="#e5e7eb" small />
              {retPct != null && <KpiCard label="Return %" value={`${retPct >= 0 ? "+" : ""}${retPct.toFixed(2)}%`}   valueColor={pnlColor(retPct)} small />}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input type="date" value={capDate} onChange={e => setCapDate(e.target.value)}
                style={{ ...cellInput, width: 130, colorScheme: "dark", border: "1px solid #1f2937" }} />
              <input type="number" placeholder="Amount" value={capAmount} onChange={e => setCapAmount(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addCapital("deposit"); }}
                style={{ ...cellInput, width: 110, border: "1px solid #1f2937", textAlign: "right" }} />
              <button onClick={() => addCapital("deposit")}  style={{ ...btnBase, background: "rgba(22,163,74,0.15)",  border: "1px solid rgba(22,163,74,0.3)",  color: "#86efac",  padding: "7px 16px" }}>+ Deposit</button>
              <button onClick={() => addCapital("withdraw")} style={{ ...btnBase, background: "rgba(220,38,38,0.10)", border: "1px solid rgba(220,38,38,0.3)", color: "#fca5a5", padding: "7px 16px" }}>− Withdraw</button>
            </div>
          </div>
        )}
      </div>

      {/* Stats strip */}
      {stats && (
        <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
          {statItems.map(s => (
            <KpiCard key={s.label} label={s.label} value={s.value} valueColor={s.color} small />
          ))}
        </div>
      )}

      {/* Period selector */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
        {PERIODS.map(p => (
          <button key={p.label} onClick={() => setPeriod(p.label)} style={{
            padding: "5px 10px", fontSize: 12, borderRadius: 5, cursor: "pointer",
            background: period === p.label ? "#0f2040" : "transparent",
            border:     period === p.label ? "1px solid #1e3a5f" : "1px solid #1f2937",
            color:      period === p.label ? "#60a5fa" : "#6b7280",
          }}>{p.label}</button>
        ))}
      </div>

      {/* 3 Charts side by side */}
      {perf.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Portfolio Value</div>
            <div ref={chart1Ref} style={{ width: "100%" }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Portfolio Index</div>
            <div ref={chart2Ref} style={{ width: "100%" }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Realized PnL</div>
            <div ref={chart3Ref} style={{ width: "100%" }} />
          </div>
        </div>
      ) : (
        <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "#374151", fontSize: 13, border: "1px dashed #1f2937", borderRadius: 8, marginBottom: 28 }}>
          Add realized trades to see the equity curve
        </div>
      )}

      {/* Portfolio Data table */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Portfolio Data</div>
        {tableRows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px", color: "#374151", fontSize: 13 }}>No performance data yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr>
                  <Th>Week</Th>
                  <Th style={{ textAlign: "right" }}>Unrealized</Th>
                  <Th style={{ textAlign: "right" }}>Realized (Cum.)</Th>
                  <Th style={{ textAlign: "right" }}>Deposit</Th>
                  <Th style={{ textAlign: "right" }}>Withdrawal</Th>
                  <Th style={{ textAlign: "right" }}>Net Capital</Th>
                  <Th style={{ textAlign: "right" }}>Portfolio Value</Th>
                  <Th style={{ textAlign: "right" }}>Return %</Th>
                  <Th style={{ textAlign: "right" }}>Index</Th>
                  <Th style={{ textAlign: "right" }}>Drawdown</Th>
                  <Th style={{ textAlign: "right" }}>SPX</Th>
                  <Th style={{ textAlign: "right" }}>SPX Index</Th>
                  <Th style={{ textAlign: "right" }}>SPX DD</Th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, i) => (
                  <tr key={row.date}
                    style={{ borderBottom: "1px solid #0d1829", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#0a1628"}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)"}
                  >
                    <td style={{ padding: "4px 8px", color: "#6b7280", whiteSpace: "nowrap" }}>{row.date}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: pnlColor(row.weekly_unrealized) }}>{fmtUsd(row.weekly_unrealized, true)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: pnlColor(row.cum_realized) }}>{fmtUsd(row.cum_realized, true)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: "#86efac" }}>{fmtUsd(row.deposit)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: "#fca5a5" }}>{fmtUsd(row.withdrawal)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: "#9ca3af" }}>{fmtUsd(row.capital)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: "#e5e7eb", fontWeight: 600 }}>{fmtUsd(row.account_value)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: pnlColor(row.port_return) }}>{fmtPct(row.port_return)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: row.port_index != null ? (row.port_index >= 100 ? "#86efac" : "#fca5a5") : "#6b7280" }}>{fmtIdx(row.port_index)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: row.drawdown < -0.0001 ? "#fca5a5" : "#4b5563" }}>{row.drawdown < -0.0001 ? fmtPct(row.drawdown) : "—"}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: "#6b7280" }}>{row.spx_price != null ? row.spx_price.toFixed(2) : "—"}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: row.spx_index != null ? (row.spx_index >= 100 ? "#86efac" : "#fca5a5") : "#6b7280" }}>{fmtIdx(row.spx_index)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: row.spx_drawdown != null && row.spx_drawdown < -0.0001 ? "#fca5a5" : "#4b5563" }}>{row.spx_drawdown != null && row.spx_drawdown < -0.0001 ? fmtPct(row.spx_drawdown) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// IBKR Import Panel
// ═══════════════════════════════════════════════════════════════════════════════

function IbkrImportPanel({ onImported }) {
  const [open,     setOpen]     = useState(false);
  const [preview,  setPreview]  = useState(null);
  const [result,   setResult]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(null); setResult(null); setError(null);
    setLoading(true);
    try {
      const text = await file.text();
      const res  = await fetch(`${API}/api/track-record/ibkr/preview`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ csv_text: text }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setPreview({ ...data, _raw: text });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
    // reset file input
    e.target.value = "";
  }

  async function handleConfirm() {
    if (!preview?._raw) return;
    setLoading(true);
    try {
      const res  = await fetch(`${API}/api/track-record/ibkr/confirm`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ csv_text: preview._raw }),
      });
      const data = await res.json();
      setResult(data);
      setPreview(null);
      onImported();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    setPreview(null); setResult(null); setError(null);
  }

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Toggle bar */}
      <button onClick={() => { setOpen(o => !o); handleClear(); }} style={{
        background: "transparent", border: "1px solid #1f2937", borderRadius: 8,
        color: "#6b7280", fontSize: 12, fontWeight: 600, cursor: "pointer",
        padding: "7px 14px", letterSpacing: "0.05em",
      }}>
        {open ? "▲" : "▼"} Import IBKR CSV
      </button>

      {open && (
        <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 10, padding: "20px 24px", marginTop: 8 }}>

          {/* File input row */}
          {!preview && !result && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <label style={{ ...btnBase, background: "#1e3a5f", border: "1px solid #2d5a8e", color: "#93c5fd", cursor: "pointer" }}>
                {loading ? "Parsing…" : "Choose CSV file"}
                <input type="file" accept=".csv" onChange={handleFile} style={{ display: "none" }} disabled={loading} />
              </label>
              <span style={{ fontSize: 11, color: "#4b5563" }}>IBKR activity statement (German or English)</span>
              <button onClick={async () => {
                if (!window.confirm("Delete ALL trades, positions, and equity entries? This cannot be undone.")) return;
                await fetch(`${API}/api/track-record/clear-all`, { method: "DELETE" });
                onImported();
              }} style={{ ...btnBase, background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)", color: "#fca5a5", marginLeft: "auto" }}>
                🗑 Clear All Data
              </button>
            </div>
          )}

          {error && (
            <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 10 }}>Error: {error}</div>
          )}

          {/* Preview */}
          {preview && (
            <div>
              {/* Summary strip */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                <KpiCard label="Period"       value={`${preview.period_start} → ${preview.period_end}`} valueColor="#e5e7eb" small />
                <KpiCard label="Trades found" value={preview.trades.length}                             valueColor="#86efac" small />
                <KpiCard label="Open pos."    value={preview.open_positions.length}                     valueColor="#93c5fd" small />
                {preview.equity_entry && (
                  <KpiCard label="Account NAV" value={`€${(preview.equity_entry.portfolio_value / 1000).toFixed(1)}K`} valueColor="#e5e7eb" small />
                )}
                {preview.equity_entry && (
                  <KpiCard label="Fees" value={`€${preview.equity_entry.fees.toFixed(2)}`} valueColor="#fca5a5" small />
                )}
              </div>

              {/* Trades table */}
              {preview.trades.length > 0 && (
                <div style={{ marginBottom: 16, overflowX: "auto" }}>
                  <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Realized Trades</div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {["Ticker","Side","Shares","Avg Entry","Avg Exit","Entry","Exit","PnL (€)"].map(h => (
                          <Th key={h} style={{ textAlign: h.includes("PnL") || h.includes("Avg") || h.includes("Shares") ? "right" : "left" }}>{h}</Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.trades.map((t, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #0d1829" }}>
                          <td style={{ padding: "5px 10px", fontSize: 12, fontFamily: "monospace", fontWeight: 700 }}>{t.ticker}</td>
                          <td style={{ padding: "5px 10px", fontSize: 11 }}>
                            <span style={{ padding: "2px 8px", borderRadius: 20, background: t.side === "long" ? "rgba(22,163,74,0.2)" : "rgba(220,38,38,0.2)", color: t.side === "long" ? "#86efac" : "#fca5a5", fontWeight: 700, fontSize: 10 }}>{t.side.toUpperCase()}</span>
                          </td>
                          <td style={{ padding: "5px 10px", fontSize: 12, textAlign: "right" }}>{t.shares}</td>
                          <td style={{ padding: "5px 10px", fontSize: 12, textAlign: "right" }}>{t.avg_entry_price.toFixed(4)}</td>
                          <td style={{ padding: "5px 10px", fontSize: 12, textAlign: "right" }}>{t.avg_exit_price.toFixed(4)}</td>
                          <td style={{ padding: "5px 10px", fontSize: 11, color: "#6b7280" }}>{t.entry_date}</td>
                          <td style={{ padding: "5px 10px", fontSize: 11, color: "#6b7280" }}>{t.exit_date}</td>
                          <td style={{ padding: "5px 10px", fontSize: 12, fontWeight: 700, textAlign: "right", color: pnlColor(t.pnl_dollar) }}>
                            {t.pnl_dollar >= 0 ? "+" : ""}€{Math.abs(t.pnl_dollar).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Open positions preview */}
              {preview.open_positions.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Open Positions</div>
                  {preview.open_positions.map((p, i) => (
                    <span key={i} style={{ marginRight: 8, fontSize: 12 }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{p.ticker}</span>
                      <span style={{ color: "#6b7280", marginLeft: 4 }}>{p.side} {p.shares} @ {p.avg_price_in}</span>
                    </span>
                  ))}
                </div>
              )}

              {preview.parse_warnings?.length > 0 && (
                <div style={{ color: "#f59e0b", fontSize: 11, marginBottom: 12 }}>
                  {preview.parse_warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleConfirm} disabled={loading} style={{ ...btnBase, background: "#1e3a5f", border: "1px solid #2d5a8e", color: "#93c5fd" }}>
                  {loading ? "Importing…" : "Confirm Import"}
                </button>
                <button onClick={handleClear} style={btnSecondary}>Clear</button>
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#86efac", fontWeight: 600 }}>✓ Import complete</span>
              <KpiCard label="Trades imported" value={result.trades_imported}    valueColor="#86efac" small />
              <KpiCard label="Skipped (dup)"   value={result.trades_skipped}     valueColor="#6b7280" small />
              <KpiCard label="Positions"        value={result.positions_imported} valueColor="#93c5fd" small />
              <button onClick={handleClear} style={{ ...btnSecondary, marginLeft: 8 }}>Clear</button>
            </div>
          )}

        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════════════════════

export default function TrackRecordPage() {
  const [tab,        setTab]       = useState("Live Portfolio");
  const [importKey,  setImportKey] = useState(0);

  return (
    <div style={{ padding: "28px 32px", minHeight: "100vh", background: "#020617", color: "#e5e7eb" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f9fafb", margin: 0 }}>Trading Track Record</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
          Live positions, realized trades, and equity curve analytics.
        </p>
      </div>

      {/* IBKR Import Panel */}
      <IbkrImportPanel onImported={() => setImportKey(k => k + 1)} />

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

      {/* Content — importKey forces remount of active tab after CSV import */}
      <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 10, padding: "24px 28px" }}>
        {tab === "Live Portfolio" && <LivePortfolioTab key={`lp-${importKey}`} />}
        {tab === "Realized PnL"  && <RealizedPnlTab   key={`rp-${importKey}`} />}
        {tab === "Equity Curve"  && <EquityCurveTab   key={`ec-${importKey}`} />}
      </div>
    </div>
  );
}
