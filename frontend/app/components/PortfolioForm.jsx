"use client";

import { useState } from "react";
import Link from "next/link";
import { signColor, fmtPct } from "@/app/lib/format";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import Button from "@/app/components/Button";
import DataTable from "@/app/components/DataTable";
import CellInput from "@/app/components/CellInput";
import SideTag from "@/app/components/SideTag";
import StateMessage from "@/app/components/StateMessage";

/**
 * Portfolio name + long/short positions form — the Portfolio counterpart of BasketForm, used by
 * the New, Copy and Edit pages. Weights are entered in percent (like the Backtester) and sent
 * to the API as fractions. The caller owns the mutation; this owns form state and validation.
 *
 * Props: title, subtitle, initialName, initialPositions ([{ticker, side, weight}] with weight
 * as a fraction), submitLabel, savingLabel, onSubmit({name, positions, disambiguations}),
 * isPending, serverError (a 409 with detail.ambiguous renders the stock/crypto picker),
 * cancelHref.
 */
function toRows(positions) {
  const rows = (positions ?? []).map((p) => ({ ticker: p.ticker, side: p.side, weightText: String(+(Number(p.weight) * 100).toFixed(4)) }));
  return rows.length ? rows : [{ ticker: "", side: "long", weightText: "" }];
}

// Saved positions are already resolved: a bare symbol was the stock, "-USD" the crypto
function storedDisambiguations(positions) {
  return Object.fromEntries((positions ?? []).map((p) => [p.ticker, p.ticker.endsWith("-USD") ? "crypto" : "stock"]));
}

export default function PortfolioForm({
  title, subtitle, initialName = "", initialPositions, submitLabel = "Save portfolio", savingLabel = "Saving…",
  onSubmit, isPending = false, serverError = null, cancelHref = "/portfolio",
}) {
  const [name, setName] = useState(initialName);
  const [rows, setRows] = useState(() => toRows(initialPositions));
  const [validationError, setValidationError] = useState(null);
  const [disambiguations, setDisambiguations] = useState(() => storedDisambiguations(initialPositions));

  const ambiguous = serverError?.status === 409 ? serverError.detail?.ambiguous : null;
  const errorMessage = typeof serverError === "string" ? serverError : serverError?.message;

  const update = (i, field, value) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  const addRow = () => setRows((prev) => [...prev, { ticker: "", side: "long", weightText: "" }]);
  const removeRow = (i) => setRows((prev) => prev.filter((_, j) => j !== i));

  const weightOf = (r) => (r.weightText === "" || Number.isNaN(Number(r.weightText)) ? null : Number(r.weightText) / 100);
  const gross = rows.reduce((s, r) => s + Math.abs(weightOf(r) ?? 0), 0);
  const net = Math.round(rows.reduce((s, r) => s + (r.side === "short" ? -1 : 1) * (weightOf(r) ?? 0), 0) * 1e4) / 1e4; // to 0.01%: stored weights carry rounding noise
  const longs = rows.filter((r) => r.side === "long").length;

  function validate() {
    if (!name.trim()) return "Portfolio name is required.";
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].ticker.trim()) return `Row ${i + 1}: ticker is required.`;
      if (weightOf(rows[i]) == null || weightOf(rows[i]) <= 0) return `Row ${i + 1}: weight must be a positive number.`;
    }
    const tickers = rows.map((r) => r.ticker.trim().toUpperCase());
    if (new Set(tickers).size !== tickers.length) return "Duplicate tickers are not allowed.";
    return null;
  }

  function submit() {
    const err = validate();
    setValidationError(err);
    if (err) return;
    onSubmit({
      name: name.trim(),
      positions: rows.map((r) => ({ ticker: r.ticker.trim().toUpperCase(), side: r.side, weight: weightOf(r) })),
      disambiguations,
    });
  }

  const grossOk = Math.abs(gross - 1) < 0.005;

  return (
    <Page>
      <PageHeader title={title} subtitle={subtitle} back={{ href: cancelHref, label: "Portfolios" }} />

      <div style={{ maxWidth: 760 }}>
        <Panel title="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Long/Short Q1"
            style={{ background: "var(--bg-base)", border: "1px solid var(--border)", padding: "8px 12px", fontSize: 14, color: "var(--text-primary)", outline: "none", width: "100%", maxWidth: 360 }}
          />
        </Panel>

        <Panel
          title="Positions"
          titleExtra={
            <span style={{ fontSize: 12, fontFamily: "var(--font-family-mono)", color: "var(--text-secondary)" }}>
              {rows.length} · {longs} L / {rows.length - longs} S · gross <span style={{ color: grossOk ? "var(--positive)" : "var(--caution)" }}>{fmtPct(gross, 0, { sign: false })}</span> · net <span style={{ color: signColor(net) }}>{fmtPct(net, 0)}</span>
            </span>
          }
          actions={<Button variant="secondary" onClick={addRow}>+ Add</Button>}
        >
          <DataTable
            rows={rows.map((r, i) => ({ ...r, __i: i }))}
            rowKey="__i"
            columns={[
              { key: "__n", label: "#", numeric: true, value: (r) => r.__i + 1, color: () => "var(--text-disabled)", width: 36 },
              { key: "ticker", label: "Ticker", render: (r) => <CellInput value={r.ticker} onChange={(v) => update(r.__i, "ticker", v)} width={130} mono upper placeholder="AAPL" /> },
              { key: "side", label: "Side", render: (r) => <SideTag side={r.side} onToggle={() => update(r.__i, "side", r.side === "long" ? "short" : "long")} /> },
              {
                key: "weight", label: "Weight", align: "right",
                render: (r) => (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <CellInput type="number" step="0.01" value={r.weightText} onChange={(v) => update(r.__i, "weightText", v)} width={80} align="right" mono placeholder="10" />
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>%</span>
                  </span>
                ),
              },
              {
                key: "remove", label: "", align: "right", width: 40,
                render: (r) => rows.length > 1 && (
                  <button type="button" onClick={() => removeRow(r.__i)} aria-label={`Remove ${r.ticker || "row"}`} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 16 }}>×</button>
                ),
              },
            ]}
          />
          {!grossOk && gross > 0 && (
            <div style={{ marginTop: "var(--space-3)", fontSize: 12, color: "var(--caution)" }}>
              Gross weight is {fmtPct(gross, 1, { sign: false })}; it is usually 100%.
            </div>
          )}
        </Panel>

        {(validationError || (!ambiguous && errorMessage)) && <StateMessage kind="error">{validationError || errorMessage}</StateMessage>}

        {ambiguous && Object.keys(ambiguous).length > 0 && (
          <Panel title="Which one did you mean?">
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {Object.entries(ambiguous).map(([ticker, { stock, crypto }]) => (
                <div key={ticker} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap", fontSize: 13 }}>
                  <strong style={{ fontFamily: "var(--font-family-mono)", minWidth: 70 }}>{ticker}</strong>
                  <Button variant="range-toggle" active={disambiguations[ticker] === "stock"} onClick={() => setDisambiguations((d) => ({ ...d, [ticker]: "stock" }))}>{stock.name} (Stock)</Button>
                  <Button variant="range-toggle" active={disambiguations[ticker] === "crypto"} onClick={() => setDisambiguations((d) => ({ ...d, [ticker]: "crypto" }))}>{crypto.name} (Crypto)</Button>
                </div>
              ))}
            </div>
          </Panel>
        )}

        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button variant="primary" onClick={submit} disabled={isPending}>{isPending ? savingLabel : submitLabel}</Button>
          <Link href={cancelHref}><Button variant="secondary">Cancel</Button></Link>
        </div>
      </div>
    </Page>
  );
}
