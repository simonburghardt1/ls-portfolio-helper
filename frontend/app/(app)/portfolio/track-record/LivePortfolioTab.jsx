"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/app/lib/api";
import { signColor } from "@/app/lib/format";
import Panel from "@/app/components/Panel";
import KpiCard from "@/app/components/KpiCard";
import Button from "@/app/components/Button";
import DataTable from "@/app/components/DataTable";
import InfoTip from "@/app/components/InfoTip";
import StateMessage from "@/app/components/StateMessage";
import {
  API, MONO, CellInput, EditActions, SideTag, fmtCompact, fmtDate, fmtEur, fmtPctPoints, fmtPrice, fmtUsd,
  lookupTicker, useRowEditor,
} from "./shared";

export default function LivePortfolioTab() {
  const [rows, setRows] = useState([]);
  const [cashRows, setCashRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load({ quiet = false } = {}) {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const [posRes, cashRes] = await Promise.all([
        authFetch(`${API}/api/track-record/positions`),
        authFetch(`${API}/api/track-record/cash-positions`),
      ]);
      setRows(await posRes.json());
      if (cashRes.ok) setCashRows(await cashRes.json());
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function persist(row) {
    const res = await authFetch(`${API}/api/track-record/positions/${row.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker: row.ticker,
        company_name: row.company_name,
        entry_date: row.entry_date,
        side: row.side,
        shares: Number(row.shares) || 0,
        avg_price_in: Number(row.avg_price_in) || 0,
        stop: row.stop !== "" && row.stop != null ? Number(row.stop) : null,
        target: row.target !== "" && row.target != null ? Number(row.target) : null,
        notes: row.notes || null,
      }),
    });
    const updated = await res.json();
    setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
  }
  const editor = useRowEditor(persist);

  async function addPosition() {
    const today = new Date().toISOString().slice(0, 10);
    const res = await authFetch(`${API}/api/track-record/positions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: "NEW", entry_date: today, side: "long", shares: 0, avg_price_in: 0 }),
    });
    const row = await res.json();
    setRows((prev) => [...prev, row]);
    editor.start(row);
  }

  async function deletePosition(id) {
    if (!window.confirm("Delete this position?")) return;
    await authFetch(`${API}/api/track-record/positions/${id}`, { method: "DELETE" });
    editor.cancel();
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function onTickerBlur() {
    const info = await lookupTicker(editor.draft?.ticker);
    if (info?.company_name) editor.set("company_name", info.company_name);
  }

  // ── KPIs (positions only; FX PnL on cash is in € and shown separately) ──
  const sum = (f) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);
  const grossExp = sum((r) => Math.abs(r.gross_exposure ?? 0));
  const netExp = sum((r) => r.net_exposure);
  const invested = sum((r) => r.invested_capital);
  const posPnl = sum((r) => r.pnl_dollar);
  const posPnlPct = invested ? (posPnl / invested) * 100 : null;
  const fxPnl = cashRows.reduce((s, r) => s + (r.fx_pnl ?? 0), 0);
  const cashEur = cashRows.reduce((s, r) => s + (r.eur_value ?? 0), 0);
  const unpriced = rows.filter((r) => r.current_price == null).length;
  const expired = rows.filter((r) => r.expired).length;

  if (loading) return <StateMessage kind="loading" />;

  const e = editor.draft;
  const editing = (r) => e && r.id === e.id;

  const columns = [
    {
      key: "ticker", label: "Ticker", sortable: true,
      render: (r) => editing(r)
        ? <CellInput value={e.ticker} onChange={(v) => editor.set("ticker", v)} onBlur={onTickerBlur} width={150} mono upper autoFocus />
        : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, ...MONO, fontWeight: 600 }}>
            {r.ticker}
            {r.expired && <span title={`Expired ${fmtDate(r.expiry)}`} style={{ fontSize: 9, fontWeight: 700, color: "var(--caution)", fontFamily: "var(--font-family-sans)" }}>EXPIRED</span>}
          </span>
        ),
    },
    {
      key: "company_name", label: "Company",
      render: (r) => editing(r)
        ? <CellInput value={e.company_name} onChange={(v) => editor.set("company_name", v)} width={160} />
        : <span style={{ color: "var(--text-secondary)" }}>{r.company_name || "—"}</span>,
    },
    {
      key: "entry_date", label: "Entry", sortable: true,
      render: (r) => editing(r)
        ? <CellInput type="date" value={e.entry_date} onChange={(v) => editor.set("entry_date", v)} width={130} />
        : <span style={MONO}>{fmtDate(r.entry_date)}</span>,
    },
    { key: "days_in_trade", label: "Days", numeric: true, sortable: true },
    {
      key: "side", label: "L/S", align: "center",
      render: (r) => <SideTag side={editing(r) ? e.side : r.side} onToggle={editing(r) ? () => editor.set("side", e.side === "long" ? "short" : "long") : undefined} />,
    },
    {
      key: "shares", label: "Qty", align: "right", sortable: true,
      render: (r) => editing(r)
        ? <CellInput type="number" value={e.shares} onChange={(v) => editor.set("shares", v)} width={80} align="right" mono />
        : <span style={MONO}>{r.shares}</span>,
    },
    {
      key: "avg_price_in", label: "Avg in", align: "right",
      render: (r) => editing(r)
        ? <CellInput type="number" value={e.avg_price_in} onChange={(v) => editor.set("avg_price_in", v)} width={90} align="right" mono />
        : <span style={MONO}>{fmtPrice(r.avg_price_in)}</span>,
    },
    { key: "current_price", label: "Current", numeric: true, format: (v) => fmtPrice(v) },
    {
      key: "stop", label: "Stop", align: "right",
      render: (r) => editing(r)
        ? <CellInput type="number" value={e.stop} onChange={(v) => editor.set("stop", v)} width={80} align="right" mono />
        : <span style={{ ...MONO, color: r.stop != null ? "var(--negative)" : undefined }}>{fmtPrice(r.stop)}</span>,
    },
    {
      key: "target", label: "Target", align: "right",
      render: (r) => editing(r)
        ? <CellInput type="number" value={e.target} onChange={(v) => editor.set("target", v)} width={80} align="right" mono />
        : <span style={{ ...MONO, color: r.target != null ? "var(--positive)" : undefined }}>{fmtPrice(r.target)}</span>,
    },
    { key: "r_r", label: "R/R", numeric: true, format: (v) => (v == null ? "—" : v.toFixed(2)) },
    { key: "net_exposure", label: "Net exp", numeric: true, sortable: true, format: (v) => fmtUsd(v, { sign: true }), color: (v) => signColor(v) },
    { key: "pnl_dollar", label: "$ PnL", numeric: true, sortable: true, format: (v) => fmtUsd(v, { sign: true }), color: (v) => signColor(v) },
    { key: "pnl_pct", label: "% PnL", numeric: true, sortable: true, format: (v) => fmtPctPoints(v), color: (v) => signColor(v) },
    {
      key: "actions", label: "", align: "right",
      render: (r) => editing(r)
        ? <EditActions onSave={editor.save} onCancel={editor.cancel} onDelete={() => deletePosition(r.id)} saving={editor.saving} />
        : null,
    },
  ];

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "var(--space-3)", marginBottom: "var(--space-5)" }}>
        <KpiCard label="Account value" formatted={fmtCompact(cashEur + netExp, "€")} caption="Cash + net exposure" />
        <KpiCard label="Gross exposure" formatted={fmtCompact(grossExp)} />
        <KpiCard label="Net exposure" formatted={fmtCompact(netExp, "$", { sign: true })} valueColor={signColor(netExp)} />
        <KpiCard label="Invested capital" formatted={fmtCompact(invested)} />
        <KpiCard label="$ PnL" formatted={fmtUsd(posPnl, { sign: true })} valueColor={signColor(posPnl)} caption={`FX on cash ${fmtEur(fxPnl, { sign: true })}`} />
        <KpiCard label="% PnL" formatted={fmtPctPoints(posPnlPct)} valueColor={signColor(posPnlPct)} caption="Of invested capital" />
      </div>

      <Panel
        title="Positions"
        titleExtra={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {(unpriced > 0 || expired > 0) && (
              <span style={{ fontSize: 12, color: "var(--caution)" }}>
                {expired > 0 ? `${expired} expired` : ""}{expired > 0 && unpriced > expired ? " · " : ""}{unpriced > expired ? `${unpriced - expired} without price` : ""}
              </span>
            )}
            <InfoTip text="Click a row to edit it: Enter or ✓ saves, Esc or ✕ discards. Options are counted with a ×100 contract multiplier. Expired options can't be priced any more and add nothing to exposure or PnL." />
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => load({ quiet: true })} disabled={refreshing}>{refreshing ? "Refreshing…" : "↻ Refresh prices"}</Button>
            <Button variant="primary" onClick={addPosition}>+ Add position</Button>
          </>
        }
      >
        <div onKeyDown={editor.keyDown}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey="id"
            onRowClick={editor.start}
            isRowClickable={(r) => !editing(r)}
            isRowSelected={editing}
            empty="No open positions."
          />
        </div>
      </Panel>

      {cashRows.length > 0 && (
        <Panel title="Cash">
          <DataTable
            autoWidth
            rowKey="currency"
            rows={cashRows}
            columns={[
              { key: "currency", label: "Currency", render: (r) => <span style={{ ...MONO, fontWeight: 600 }}>{r.currency}</span> },
              { key: "amount", label: "Amount", numeric: true, format: (v) => (v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 2 })) },
              { key: "live_rate", label: "Rate (€)", numeric: true, format: (v) => (v == null ? "—" : v.toFixed(4)) },
              { key: "eur_value", label: "Value", numeric: true, format: (v) => fmtEur(v) },
              { key: "fx_pnl", label: "FX PnL", numeric: true, format: (v) => fmtEur(v, { sign: true }), color: (v) => signColor(v) },
            ]}
            footerRows={[{ __strong: true, currency: "Total", eur_value: cashEur, fx_pnl: fxPnl }]}
          />
        </Panel>
      )}
    </>
  );
}
