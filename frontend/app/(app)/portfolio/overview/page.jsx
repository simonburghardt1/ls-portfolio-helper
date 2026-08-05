"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/app/components/PageHeader";
import KpiCard from "@/app/components/KpiCard";
import { usePortfolioSelectionStore } from "@/app/store/portfolioSelectionStore";

const API = "http://localhost:8000";

function portfolioSummary(positions) {
  const longs  = positions.filter(p => p.side === "long").length;
  const shorts = positions.filter(p => p.side === "short").length;
  const gross  = positions.reduce((s, p) => s + Math.abs(Number(p.weight) || 0), 0);
  return { longs, shorts, gross };
}

export default function PortfolioOverviewPage() {
  const { selectedPortfolioId, setSelectedPortfolio } = usePortfolioSelectionStore();
  const [portfolios, setPortfolios] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [vol,        setVol]        = useState(null);
  const [volLoading, setVolLoading] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/portfolios`)
      .then(r => r.json())
      .then(setPortfolios)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const selected = portfolios.find(p => p.id === selectedPortfolioId) ?? null;

  useEffect(() => {
    if (!selected) { setVol(null); return; }
    setVolLoading(true);
    setVol(null);
    fetch(`${API}/api/portfolios/${selected.id}/volatility`)
      .then(r => r.json())
      .then(d => setVol(d.error ? null : d))
      .catch(() => setVol(null))
      .finally(() => setVolLoading(false));
  }, [selected?.id]);

  function handleSelect(e) {
    const id = e.target.value ? Number(e.target.value) : null;
    const p = portfolios.find(p => p.id === id) ?? null;
    setSelectedPortfolio(id, p?.name ?? null);
  }

  const summary = selected ? portfolioSummary(selected.positions) : null;

  return (
    <div style={{ color: "#e5e7eb", maxWidth: 1200, margin: "0 auto", padding: "28px 24px" }}>
      <PageHeader
        title="Portfolio Overview"
        subtitle="Select a portfolio, then jump into any analysis view — the selection follows you across pages."
      />

      {/* Portfolio selector */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 8 }}>
          Active Portfolio
        </label>
        <select
          value={selectedPortfolioId ?? ""}
          onChange={handleSelect}
          disabled={loading}
          style={{
            background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
            color: "#e5e7eb", fontSize: 13, padding: "8px 12px", width: 320, cursor: "pointer",
          }}
        >
          <option value="">— select a portfolio —</option>
          {portfolios.map(p => (
            <option key={p.id} value={p.id}>{p.name} ({p.positions.length} pos)</option>
          ))}
        </select>

        {!loading && portfolios.length === 0 && (
          <div style={{ fontSize: 12, color: "#4b5563", marginTop: 8 }}>
            No portfolios yet. Create one under <Link href="/portfolio" style={{ color: "#60a5fa" }}>Portfolio Construction</Link>.
          </div>
        )}
      </div>

      {/* KPI row */}
      {selected && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 36 }}>
          <KpiCard label="Positions"      value={selected.positions.length} />
          <KpiCard label="Longs"          value={summary.longs} />
          <KpiCard label="Shorts"         value={summary.shorts} />
          <KpiCard label="Gross Exposure" formatted={`${(summary.gross * 100).toFixed(1)}%`} />
          <KpiCard
            label="Annualized Volatility"
            formatted={volLoading ? "…" : vol ? `${(vol.portfolio_std_annual * 100).toFixed(1)}%` : "—"}
          />
        </div>
      )}

      {!selected && !loading && (
        <div style={{
          background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
          padding: "24px", textAlign: "center", color: "#6b7280", fontSize: 13, marginBottom: 36,
        }}>
          Select a portfolio above to see its KPIs.
        </div>
      )}
    </div>
  );
}
