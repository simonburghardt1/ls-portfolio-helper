"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/app/lib/api";
import { signColor } from "@/app/lib/format";
import Panel from "@/app/components/Panel";
import KpiCard from "@/app/components/KpiCard";
import Button from "@/app/components/Button";
import Badge from "@/app/components/Badge";
import DataTable from "@/app/components/DataTable";
import InfoTip from "@/app/components/InfoTip";
import StateMessage from "@/app/components/StateMessage";
import {
  API, MONO, CellInput, EditActions, SideTag, fmtDate, fmtPctPoints, fmtPrice, fmtUsd, lookupTicker, tradingDays, useRowEditor,
} from "./shared";

const num = (v, d = 2) => (v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(d));

export default function RealizedPnlTab() {
  const [trades, setTrades] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadStats() {
    const res = await authFetch(`${API}/api/track-record/trades/stats`);
    setStats(await res.json());
  }
  async function loadAll() {
    setLoading(true);
    try {
      const [tRes, sRes] = await Promise.all([
        authFetch(`${API}/api/track-record/trades`),
        authFetch(`${API}/api/track-record/trades/stats`),
      ]);
      setTrades(await tRes.json());
      setStats(await sRes.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadAll(); }, []);

  async function persist(row) {
    const res = await authFetch(`${API}/api/track-record/trades/${row.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker: row.ticker,
        company_name: row.company_name || null,
        side: row.side,
        shares: Number(row.shares) || 0,
        avg_entry_price: Number(row.avg_entry_price) || 0,
        avg_exit_price: Number(row.avg_exit_price) || 0,
        entry_date: row.entry_date,
        exit_date: row.exit_date,
        win_score: Number(row.win_score) || 1,
        comment: row.comment || null,
      }),
    });
    const updated = await res.json();
    setTrades((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
    loadStats();
  }
  const editor = useRowEditor(persist);

  async function addTrade() {
    const today = new Date().toISOString().slice(0, 10);
    const res = await authFetch(`${API}/api/track-record/trades`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: "NEW", side: "long", shares: 0, avg_entry_price: 0, avg_exit_price: 0, entry_date: today, exit_date: today, win_score: 1 }),
    });
    const row = await res.json();
    setTrades((prev) => [row, ...prev]);
    editor.start(row);
    loadStats();
  }

  async function deleteTrade(id) {
    if (!window.confirm("Delete this trade?")) return;
    await authFetch(`${API}/api/track-record/trades/${id}`, { method: "DELETE" });
    editor.cancel();
    setTrades((prev) => prev.filter((r) => r.id !== id));
    loadStats();
  }

  async function onTickerBlur() {
    const d = editor.draft;
    if (d?.company_name) return;
    const info = await lookupTicker(d?.ticker);
    if (info?.company_name) editor.set("company_name", info.company_name);
  }

  if (loading) return <StateMessage kind="loading" />;

  const e = editor.draft;
  const editing = (r) => e && r.id === e.id;
  const total = trades.length;
  const numbered = trades.map((t, i) => ({ ...t, __n: total - i }));

  const columns = [
    { key: "__n", label: "#", numeric: true, sortable: true, color: () => "var(--text-disabled)" },
    {
      key: "ticker", label: "Ticker", sortable: true,
      render: (r) => editing(r)
        ? <CellInput value={e.ticker} onChange={(v) => editor.set("ticker", v)} onBlur={onTickerBlur} width={110} mono upper autoFocus />
        : <span style={{ ...MONO, fontWeight: 600 }}>{r.ticker}</span>,
    },
    {
      key: "company_name", label: "Company",
      render: (r) => editing(r)
        ? <CellInput value={e.company_name} onChange={(v) => editor.set("company_name", v)} width={150} />
        : <span title={r.company_name || ""} style={{ display: "inline-block", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "bottom", color: "var(--text-secondary)" }}>{r.company_name || "—"}</span>,
    },
    {
      key: "side", label: "L/S", align: "center", sortable: true,
      render: (r) => <SideTag side={editing(r) ? e.side : r.side} onToggle={editing(r) ? () => editor.set("side", e.side === "long" ? "short" : "long") : undefined} />,
    },
    {
      key: "shares", label: "Qty", align: "right", sortable: true,
      render: (r) => editing(r)
        ? <CellInput type="number" value={e.shares} onChange={(v) => editor.set("shares", v)} width={80} align="right" mono />
        : <span style={MONO}>{r.shares}</span>,
    },
    {
      key: "avg_entry_price", label: "Entry px", align: "right",
      render: (r) => editing(r)
        ? <CellInput type="number" value={e.avg_entry_price} onChange={(v) => editor.set("avg_entry_price", v)} width={90} align="right" mono />
        : <span style={MONO}>{fmtPrice(r.avg_entry_price)}</span>,
    },
    {
      key: "avg_exit_price", label: "Exit px", align: "right",
      render: (r) => editing(r)
        ? <CellInput type="number" value={e.avg_exit_price} onChange={(v) => editor.set("avg_exit_price", v)} width={90} align="right" mono />
        : <span style={MONO}>{fmtPrice(r.avg_exit_price)}</span>,
    },
    {
      key: "entry_date", label: "Entry", sortable: true,
      render: (r) => editing(r)
        ? <CellInput type="date" value={e.entry_date} onChange={(v) => editor.set("entry_date", v)} width={130} />
        : <span style={MONO}>{fmtDate(r.entry_date)}</span>,
    },
    {
      key: "exit_date", label: "Exit", sortable: true,
      render: (r) => editing(r)
        ? <CellInput type="date" value={e.exit_date} onChange={(v) => editor.set("exit_date", v)} width={130} />
        : <span style={MONO}>{fmtDate(r.exit_date)}</span>,
    },
    {
      key: "days", label: "Days", numeric: true, sortable: true,
      value: (r) => (r.entry_date && r.exit_date ? tradingDays(r.entry_date, r.exit_date) : null),
      color: () => "var(--text-secondary)",
    },
    { key: "pnl_pct", label: "% PnL", numeric: true, sortable: true, format: (v) => fmtPctPoints(v), color: (v) => signColor(v) },
    { key: "pnl_dollar", label: "$ PnL", numeric: true, sortable: true, format: (v) => fmtUsd(v, { sign: true }), color: (v) => signColor(v) },
    {
      key: "result", label: "W/L", align: "center",
      value: (r) => r.pnl_dollar,
      render: (r) => (r.pnl_dollar == null ? "—" : <Badge variant={r.pnl_dollar >= 0 ? "positive" : "negative"}>{r.pnl_dollar >= 0 ? "WIN" : "LOSS"}</Badge>),
    },
    {
      key: "comment", label: "Comment",
      render: (r) => editing(r)
        ? <CellInput value={e.comment} onChange={(v) => editor.set("comment", v)} width={180} />
        : <span title={r.comment || ""} style={{ display: "inline-block", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "bottom", color: "var(--text-secondary)" }}>{r.comment || ""}</span>,
    },
    {
      key: "actions", label: "", align: "right",
      render: (r) => editing(r) ? <EditActions onSave={editor.save} onCancel={editor.cancel} onDelete={() => deleteTrade(r.id)} saving={editor.saving} /> : null,
    },
  ];

  return (
    <>
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--space-3)", marginBottom: "var(--space-5)" }}>
          <KpiCard label="Trades" formatted={String(stats.total ?? 0)} caption={`${stats.wins ?? 0} won · ${stats.losses ?? 0} lost`} />
          <KpiCard label="Win rate" formatted={`${num(stats.win_rate, 1)}%`} caption={`Loss rate ${num(stats.loss_rate, 1)}%`} />
          <KpiCard
            label="Total PnL"
            formatted={fmtUsd(stats.total_dollars, { sign: true })}
            valueColor={signColor(stats.total_dollars)}
            caption={`Won ${fmtUsd(Math.abs(stats.win_dollars || 0))} · lost ${fmtUsd(Math.abs(stats.loss_dollars || 0))}`}
          />
          <KpiCard label="R score" formatted={num(stats.r_score)} valueColor={signColor(stats.r_score)} caption="Total won / total lost" />
          <KpiCard label="Kelly" formatted={`${num(stats.full_kelly)}%`} caption={`Bet Kelly ${num(stats.bet_kelly)}%`} />
        </div>
      )}

      <Panel
        title="Trades"
        titleExtra={<InfoTip text="Click a row to edit it: Enter or ✓ saves, Esc or ✕ discards. Click a column header to sort." />}
        actions={<Button variant="primary" onClick={addTrade}>+ Add trade</Button>}
      >
        <div onKeyDown={editor.keyDown}>
          <DataTable
            stickyHeader
            maxHeight="70vh"
            columns={columns}
            rows={numbered}
            rowKey="id"
            onRowClick={editor.start}
            isRowClickable={(r) => !editing(r)}
            isRowSelected={editing}
            empty="No realized trades yet."
          />
        </div>
      </Panel>
    </>
  );
}
