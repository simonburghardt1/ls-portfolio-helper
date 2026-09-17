"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import PageHeader from "@/app/components/PageHeader";
import KpiCard from "@/app/components/KpiCard";
import Button from "@/app/components/Button";
import { usePortfolioSelectionStore } from "@/app/store/portfolioSelectionStore";

// Same table-style convention as portfolio/risk/volatility's cov/corr matrices and the
// Seasonality page's monthly-returns table.
const cellBase = { padding: "6px 10px", textAlign: "right", fontSize: 12.5, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const rowLabel = { padding: "6px 10px", fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", textAlign: "left" };
const thStyle = { padding: "6px 10px", fontSize: 10.5, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right", borderBottom: "1px solid var(--border)" };
const thRowLabel = { ...thStyle, textAlign: "left" };
const sectionTitle = { fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 };
const panel = { background: "var(--bg-surface)", border: "1px solid var(--border)", padding: 16, marginBottom: 24 };

const SELECT_STYLE = {
  background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
  color: "#e5e7eb", fontSize: 13, padding: "6px 10px", cursor: "pointer", width: 260,
};

const INPUT_STYLE = {
  background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
  color: "var(--text-primary)", fontSize: 12.5, padding: "4px 6px", width: "100%", textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const TICKER_INPUT_STYLE = { ...INPUT_STYLE, textAlign: "left", textTransform: "uppercase", fontWeight: 600 };

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
            <th style={thStyle}>Weighted Beta</th>
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
              <td style={{ padding: "4px 10px" }}>
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
        <Button variant="secondary" onClick={onAddRow}>+ Add Position</Button>
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
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();

  const { data: portfolios } = useQuery({
    queryKey: ["portfolios"],
    queryFn: () => api.get("/api/portfolios"),
  });

  function selectPortfolio(id) {
    setPortfolioId(id);
    setSaved(false);
    const p = (portfolios ?? []).find((x) => x.id === id);
    setSelectedPortfolio(id, p?.name ?? null);
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
      setSaveOpen(false);
      setSaveName("");
      setSaved(true);
    } catch (e) {
      setSaveError(e.message);
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
    <div style={{ padding: "28px 32px", minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <PageHeader
        title="Beta"
        subtitle="Per-position beta for a saved Portfolio — always 1Y, weekly returns, vs the S&P 500 (^GSPC). Edit tickers/weights below to explore what-if scenarios."
      />

      <div style={{ marginBottom: 24 }}>
        <label style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
          Portfolio
        </label>
        <select
          value={portfolioId ?? ""}
          onChange={(e) => selectPortfolio(Number(e.target.value))}
          style={SELECT_STYLE}
        >
          <option value="" disabled>— select —</option>
          {(portfolios ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {!ready && (
        <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
          Select a Portfolio above.
        </div>
      )}
      {isLoading && (
        <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>Loading…</div>
      )}
      {isError && (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--negative)", padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "var(--negative)" }}>
          Could not load beta data for this Portfolio.
        </div>
      )}

      {data && draftRows.length >= 0 && (
        <>
          <div style={{ display: "flex", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
            <KpiCard label="Portfolio Beta" formatted={fmtBeta(portfolioBeta)} small />
            <KpiCard label="Net Weight" formatted={fmtPct(netWeight)} small />
            <KpiCard label="Long Weighted Beta" formatted={fmtBeta(longSummary.weighted_beta)} small />
            <KpiCard label="Short Weighted Beta" formatted={fmtBeta(shortSummary.weighted_beta)} small />
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
            <Button variant="primary" onClick={applyBetaNeutral}>Make Beta Neutral</Button>
            <Button variant="secondary" onClick={resetDraft}>Reset</Button>
            <Button variant="secondary" onClick={() => setSaveOpen((v) => !v)}>Save as New Portfolio</Button>
            {saved && <span style={{ fontSize: 12, color: "var(--positive)" }}>Saved.</span>}
          </div>

          {saveOpen && (
            <div style={{ ...panel, display: "flex", gap: 10, alignItems: "center" }}>
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="New portfolio name"
                style={{ ...INPUT_STYLE, textAlign: "left", textTransform: "none", fontWeight: 400, width: 260 }}
              />
              <Button variant="primary" onClick={saveAsNew} disabled={!saveName.trim() || saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button variant="secondary" onClick={() => { setSaveOpen(false); setSaveError(null); }}>Cancel</Button>
              {saveError && <span style={{ fontSize: 12, color: "var(--negative)" }}>{saveError}</span>}
            </div>
          )}

          <div style={sectionTitle}>Long Positions</div>
          <div style={panel}>
            <EditableBetaTable
              rows={longRows}
              summary={longSummary}
              loadingIds={loadingIds}
              onUpdateWeight={updateWeight}
              onTickerType={tickerType}
              onTickerBlur={tickerBlur}
              onRemoveRow={removeRow}
              onAddRow={() => addRow("long")}
            />
          </div>

          <div style={sectionTitle}>Short Positions</div>
          <div style={panel}>
            <EditableBetaTable
              rows={shortRows}
              summary={shortSummary}
              loadingIds={loadingIds}
              onUpdateWeight={updateWeight}
              onTickerType={tickerType}
              onTickerBlur={tickerBlur}
              onRemoveRow={removeRow}
              onAddRow={() => addRow("short")}
            />
          </div>
        </>
      )}
    </div>
  );
}
