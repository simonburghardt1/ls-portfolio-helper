"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import KpiCard from "@/app/components/KpiCard";
import Button from "@/app/components/Button";
import Popover from "@/app/components/Popover";
import PortfolioPicker from "@/app/components/PortfolioPicker";
import StateMessage from "@/app/components/StateMessage";
import { usePortfolioSelectionStore } from "@/app/store/portfolioSelectionStore";

// Same table-style convention as portfolio/risk/volatility's cov/corr matrices and the
// Seasonality page's monthly-returns table.
const cellBase = { padding: "6px 10px", textAlign: "right", fontSize: 12.5, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-family-mono)" };
const rowLabel = { padding: "6px 10px", fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", textAlign: "left" };
const thStyle = { padding: "6px 10px", fontSize: 10.5, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right", borderBottom: "1px solid var(--border)" };
const thRowLabel = { ...thStyle, textAlign: "left" };
const INPUT_STYLE = {
  background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
  color: "var(--text-primary)", fontSize: 12.5, padding: "4px 6px", width: 72, textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const TICKER_INPUT_STYLE = { ...INPUT_STYLE, width: 96, textAlign: "left", textTransform: "uppercase", fontWeight: 600 };

const REMOVE_BTN_STYLE = {
  background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer",
  fontSize: 15, padding: "0 6px", lineHeight: 1,
};

function fmtPct(v) {
  if (v == null || isNaN(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtBeta(v) {
  if (v == null || isNaN(v)) return "—";
  return v.toFixed(2);
}

function summarize(rows) {
  const weight = rows.reduce((s, r) => s + r.weight, 0);
  const weighted_beta = rows.reduce((s, r) => s + (r.beta != null ? r.weight * r.beta : 0), 0);
  return { weight, weighted_beta };
}

// Pure client-side port of the backend's _beta_neutralize_weights (services/portfolio.py)
// — same two-step algorithm (inverse-beta reweight within each side, then a side-level
// scale that cancels net beta), run instantly against the live draft rows (including any
// ticker swaps / weight edits / added / removed rows already made) rather than
// round-tripping to the server with a now-stale copy of the positions.
function betaNeutralize(rows) {
  const adjusted = rows.map((r) => ({ ...r }));
  for (const side of ["long", "short"]) {
    // Rows with no resolved beta yet (a ticker still being typed, or one that failed to
    // resolve) are left completely untouched — neither redistributed within the side nor
    // scaled in step 2 below — rather than silently assuming beta=1 for something the
    // user hasn't finished entering.
    const idxs = adjusted.map((r, i) => (r.side === side && r.beta != null ? i : -1)).filter((i) => i !== -1);
    if (!idxs.length) continue;
    const sideTotal = idxs.reduce((s, i) => s + adjusted[i].weight, 0);
    const invBetas = idxs.map((i) => 1 / Math.max(adjusted[i].beta, 0.1));
    const invTotal = invBetas.reduce((a, b) => a + b, 0);
    idxs.forEach((i, k) => { adjusted[i].weight = (invBetas[k] / invTotal) * sideTotal; });
  }

  const longBetaExp = adjusted.filter((r) => r.side === "long" && r.beta != null).reduce((s, r) => s + r.weight * r.beta, 0);
  const shortBetaExp = adjusted.filter((r) => r.side === "short" && r.beta != null).reduce((s, r) => s + r.weight * r.beta, 0);
  if (longBetaExp <= 0 || shortBetaExp <= 0) return adjusted;

  const gross = rows.reduce((s, r) => s + r.weight, 0);
  const longGross = adjusted.filter((r) => r.side === "long").reduce((s, r) => s + r.weight, 0);
  const shortGross = adjusted.filter((r) => r.side === "short").reduce((s, r) => s + r.weight, 0);
  const ratio = shortBetaExp / longBetaExp;
  const kS = gross / (ratio * longGross + shortGross);
  const kL = ratio * kS;

  return adjusted.map((r) => (
    r.beta == null ? r : { ...r, weight: r.weight * (r.side === "long" ? kL : kS) }
  ));
}

function EditableBetaTable({ rows, summary, loadingIds, onUpdateWeight, onTickerBlur, onTickerType, onRemoveRow, onAddRow }) {
  return (
    <>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thRowLabel}>Ticker</th>
            <th style={thStyle}>Weight</th>
            <th style={thStyle}>Beta</th>
            <th style={thStyle}>Weighted</th>
            <th style={{ ...thStyle, width: 24 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ padding: "4px 10px" }}>
                <input
                  value={r.ticker}
                  onChange={(e) => onTickerType(r.id, e.target.value)}
                  onBlur={(e) => onTickerBlur(r.id, e.target.value)}
                  placeholder="e.g. AAPL"
                  style={TICKER_INPUT_STYLE}
                />
              </td>
              <td style={{ padding: "4px 10px", textAlign: "right" }}>
                <input
                  type="number"
                  step="0.1"
                  value={Math.round(r.weight * 1000) / 10}
                  onChange={(e) => onUpdateWeight(r.id, (Number(e.target.value) || 0) / 100)}
                  style={INPUT_STYLE}
                />
              </td>
              <td style={cellBase}>{loadingIds.has(r.id) ? "…" : fmtBeta(r.beta)}</td>
              <td style={cellBase}>{r.beta == null ? "—" : fmtBeta(r.weight * r.beta)}</td>
              <td style={{ textAlign: "center" }}>
                <button onClick={() => onRemoveRow(r.id)} style={REMOVE_BTN_STYLE} title="Remove position">×</button>
              </td>
            </tr>
          ))}
          <tr>
            <td style={{ ...rowLabel, borderTop: "1px solid var(--border)" }}>Subtotal</td>
            <td style={{ ...cellBase, borderTop: "1px solid var(--border)", fontWeight: 600 }}>{fmtPct(summary.weight)}</td>
            <td style={{ ...cellBase, borderTop: "1px solid var(--border)" }}></td>
            <td style={{ ...cellBase, borderTop: "1px solid var(--border)", fontWeight: 600 }}>{fmtBeta(summary.weighted_beta)}</td>
            <td style={{ borderTop: "1px solid var(--border)" }}></td>
          </tr>
        </tbody>
      </table>
      <div style={{ marginTop: 10 }}>
        <Button variant="secondary" onClick={onAddRow} style={{ padding: "4px 12px" }}>+ Add</Button>
      </div>
    </>
  );
}

export default function PortfolioBetaPage() {
  const { selectedPortfolioId, setSelectedPortfolio } = usePortfolioSelectionStore();
  const [portfolioId, setPortfolioId] = useState(selectedPortfolioId ?? null);
  const [draftRows, setDraftRows] = useState([]);
  const [seededFor, setSeededFor] = useState(null);
  const [loadingIds, setLoadingIds] = useState(new Set());
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();

  function selectPortfolio(id, name) {
    setPortfolioId(id);
    setSaved(false);
    setSelectedPortfolio(id, name);
  }

  const ready = Boolean(portfolioId);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["portfolio-beta", portfolioId],
    queryFn: () => api.get(`/api/portfolios/${portfolioId}/beta`),
    enabled: ready,
  });

  function seedFrom(rows) {
    setDraftRows(rows.map((r) => ({ ...r, id: crypto.randomUUID() })));
  }

  // Reset the editable draft whenever a fresh fetch lands for the (possibly newly)
  // selected portfolio — adjust during render (React's documented pattern for "state
  // that should track a prop/derived value"), not an Effect, mirroring the Basket detail
  // page's own per-id reset convention.
  if (data && seededFor !== portfolioId) {
    setSeededFor(portfolioId);
    seedFrom(data.rows);
  }

  function updateWeight(id, weight) {
    setDraftRows((prev) => prev.map((r) => (r.id === id ? { ...r, weight } : r)));
  }

  function tickerType(id, value) {
    setDraftRows((prev) => prev.map((r) => (r.id === id ? { ...r, ticker: value.toUpperCase() } : r)));
  }

  async function tickerBlur(id, rawValue) {
    const ticker = rawValue.trim().toUpperCase();
    if (!ticker) {
      setDraftRows((prev) => prev.map((r) => (r.id === id ? { ...r, ticker: "", beta: null } : r)));
      return;
    }
    setLoadingIds((prev) => new Set(prev).add(id));
    try {
      const result = await api.get(`/api/portfolios/beta/lookup?ticker=${encodeURIComponent(ticker)}`);
      setDraftRows((prev) => prev.map((r) => (r.id === id ? { ...r, ticker, beta: result.beta } : r)));
    } catch {
      setDraftRows((prev) => prev.map((r) => (r.id === id ? { ...r, beta: null } : r)));
    } finally {
      setLoadingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  function removeRow(id) {
    setDraftRows((prev) => prev.filter((r) => r.id !== id));
  }

  function addRow(side) {
    setDraftRows((prev) => [...prev, { id: crypto.randomUUID(), ticker: "", side, weight: 0, beta: null }]);
  }

  function resetDraft() {
    if (data) seedFrom(data.rows);
  }

  function applyBetaNeutral() {
    setDraftRows((prev) => betaNeutralize(prev));
  }

  async function saveAsNew() {
    setSaving(true);
    setSaveError(null);
    try {
      const positions = draftRows
        .filter((r) => r.ticker)
        .map((r) => ({ ticker: r.ticker, side: r.side, weight: r.weight }));
      await api.post("/api/portfolios", { name: saveName.trim(), positions });
      queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      setSaveName("");
      setSaved(true);
      return true;
    } catch (e) {
      setSaveError(e.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  const longRows = draftRows.filter((r) => r.side === "long");
  const shortRows = draftRows.filter((r) => r.side === "short");
  const longSummary = summarize(longRows);
  const shortSummary = summarize(shortRows);
  const netWeight = longSummary.weight - shortSummary.weight;
  const portfolioBeta = longSummary.weighted_beta - shortSummary.weighted_beta;

  return (
    <Page>
      <PageHeader
        title="Portfolio Beta"
        subtitle="Per-position beta against the S&P 500, from one year of weekly returns."
        actions={<PortfolioPicker value={portfolioId} onChange={selectPortfolio} />}
      />

      {!ready && <StateMessage>Select a portfolio.</StateMessage>}
      {isLoading && <StateMessage kind="loading" />}
      {isError && <StateMessage kind="error">Could not load beta data for this portfolio.</StateMessage>}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--space-3)", marginBottom: "var(--space-5)" }}>
            <KpiCard label="Portfolio beta" formatted={fmtBeta(portfolioBeta)} />
            <KpiCard label="Net weight" formatted={fmtPct(netWeight)} />
            <KpiCard label="Long beta" formatted={fmtBeta(longSummary.weighted_beta)} caption={`${fmtPct(longSummary.weight)} gross`} />
            <KpiCard label="Short beta" formatted={fmtBeta(shortSummary.weighted_beta)} caption={`${fmtPct(shortSummary.weight)} gross`} />
          </div>

          <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-5)", flexWrap: "wrap", alignItems: "center" }}>
            <Button variant="primary" onClick={applyBetaNeutral}>Make beta neutral</Button>
            <Button variant="secondary" onClick={resetDraft}>Reset</Button>
            <Popover
              width={300}
              padded
              trigger={(toggle) => <Button variant="secondary" onClick={() => { setSaveError(null); toggle(); }}>Save as new…</Button>}
            >
              {(close) => (
                <form
                  onSubmit={async (e) => { e.preventDefault(); if (await saveAsNew()) close(); }}
                  style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
                >
                  <input
                    autoFocus
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="Portfolio name"
                    style={{ ...INPUT_STYLE, width: "100%", textAlign: "left", fontWeight: 400, padding: "6px 8px" }}
                  />
                  {saveError && <span style={{ fontSize: 12, color: "var(--negative)" }}>{saveError}</span>}
                  <Button variant="primary" type="submit" disabled={!saveName.trim() || saving}>{saving ? "Saving…" : "Save"}</Button>
                </form>
              )}
            </Popover>
            {saved && <span style={{ fontSize: 12, color: "var(--positive)" }}>Saved.</span>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "var(--space-5)" }}>
            {[["Long", longRows, longSummary, "long"], ["Short", shortRows, shortSummary, "short"]].map(([title, rows, summary, side]) => (
              <Panel key={side} title={title} style={{ minWidth: 0 }}>
                <EditableBetaTable
                  rows={rows}
                  summary={summary}
                  loadingIds={loadingIds}
                  onUpdateWeight={updateWeight}
                  onTickerType={tickerType}
                  onTickerBlur={tickerBlur}
                  onRemoveRow={removeRow}
                  onAddRow={() => addRow(side)}
                />
              </Panel>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
