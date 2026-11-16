"use client";

import { useState } from "react";
import { authFetch } from "@/app/lib/api";
import { signColor } from "@/app/lib/format";
import Panel from "@/app/components/Panel";
import KpiCard from "@/app/components/KpiCard";
import Button from "@/app/components/Button";
import DataTable from "@/app/components/DataTable";
import StateMessage from "@/app/components/StateMessage";
import { API, MONO, SideTag, fmtPrice } from "./shared";

/** IBKR activity-statement import: choose CSV → preview → confirm. Rendered when opened from the page header. */
export default function IbkrImport({ onImported, onClose }) {
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(null); setResult(null); setError(null); setLoading(true);
    try {
      const text = await file.text();
      const res = await authFetch(`${API}/api/track-record/ibkr/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv_text: text }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setPreview({ ...data, _raw: text });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }

  async function confirm() {
    if (!preview?._raw) return;
    setLoading(true);
    try {
      const res = await authFetch(`${API}/api/track-record/ibkr/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv_text: preview._raw }),
      });
      setResult(await res.json());
      setPreview(null);
      onImported();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function clearAll() {
    if (!window.confirm("Delete ALL trades, positions and equity entries? This cannot be undone.")) return;
    await authFetch(`${API}/api/track-record/clear-all`, { method: "DELETE" });
    onImported();
  }

  const reset = () => { setPreview(null); setResult(null); setError(null); };

  return (
    <Panel title="Import IBKR CSV" actions={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {error && <StateMessage kind="error">{error}</StateMessage>}

      {!preview && !result && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <label style={{ display: "inline-block", padding: "8px 16px", border: "1px solid var(--text-primary)", background: "var(--text-primary)", color: "var(--bg-base)", fontSize: "var(--font-base)", fontWeight: 600, cursor: loading ? "default" : "pointer" }}>
            {loading ? "Parsing…" : "Choose CSV file"}
            <input type="file" accept=".csv" onChange={handleFile} style={{ display: "none" }} disabled={loading} />
          </label>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>IBKR activity statement (German or English)</span>
          <Button variant="secondary" onClick={clearAll} style={{ marginLeft: "auto", color: "var(--negative)" }}>Clear all data</Button>
        </div>
      )}

      {preview && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
            <KpiCard small label="Period" formatted={`${preview.period_start} → ${preview.period_end}`} />
            <KpiCard small label="Trades" formatted={String(preview.trades.length)} />
            <KpiCard small label="Open positions" formatted={String(preview.open_positions.length)} />
            {preview.equity_entry && <KpiCard small label="Account NAV" formatted={`€${(preview.equity_entry.portfolio_value / 1000).toFixed(1)}K`} />}
            {preview.equity_entry && <KpiCard small label="Fees" formatted={`€${preview.equity_entry.fees.toFixed(2)}`} />}
          </div>

          {preview.trades.length > 0 && (
            <div style={{ marginBottom: "var(--space-4)" }}>
              <DataTable
                stickyHeader
                maxHeight={320}
                rowKey={(t) => `${t.ticker}-${t.entry_date}-${t.exit_date}-${t.shares}-${t.avg_entry_price}`}
                rows={preview.trades}
                columns={[
                  { key: "ticker", label: "Ticker", render: (t) => <span style={{ ...MONO, fontWeight: 600 }}>{t.ticker}</span> },
                  { key: "side", label: "Side", render: (t) => <SideTag side={t.side} /> },
                  { key: "shares", label: "Qty", numeric: true },
                  { key: "avg_entry_price", label: "Entry px", numeric: true, format: (v) => fmtPrice(v) },
                  { key: "avg_exit_price", label: "Exit px", numeric: true, format: (v) => fmtPrice(v) },
                  { key: "entry_date", label: "Entry" },
                  { key: "exit_date", label: "Exit" },
                  { key: "pnl_dollar", label: "PnL (€)", numeric: true, format: (v) => `${v >= 0 ? "+" : "−"}€${Math.abs(v).toFixed(2)}`, color: signColor },
                ]}
              />
            </div>
          )}

          {preview.open_positions.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: "var(--space-3)" }}>
              Open positions:{" "}
              {preview.open_positions.map((p, i) => (
                <span key={i} style={{ marginRight: 10 }}>
                  <span style={{ ...MONO, color: "var(--text-primary)" }}>{p.ticker}</span> {p.side} {p.shares} @ {p.avg_price_in}
                </span>
              ))}
            </div>
          )}

          {preview.parse_warnings?.length > 0 && (
            <div style={{ color: "var(--caution)", fontSize: 12, marginBottom: "var(--space-3)" }}>
              {preview.parse_warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button variant="primary" onClick={confirm} disabled={loading}>{loading ? "Importing…" : "Confirm import"}</Button>
            <Button variant="secondary" onClick={reset}>Discard</Button>
          </div>
        </>
      )}

      {result && (
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
          <span style={{ color: "var(--positive)", fontWeight: 600 }}>✓ Import complete</span>
          <span>{result.trades_imported} trades imported</span>
          <span style={{ color: "var(--text-secondary)" }}>{result.trades_skipped} duplicates skipped</span>
          <span>{result.positions_imported} positions</span>
          <Button variant="secondary" onClick={reset}>Import another</Button>
        </div>
      )}
    </Panel>
  );
}
