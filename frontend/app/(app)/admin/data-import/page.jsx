"use client";

import { useState } from "react";
import PageHeader from "@/app/components/PageHeader";
import Button from "@/app/components/Button";

const API = "http://localhost:8000";

const SERIES_GROUPS = [
  {
    group: "Consumer Confidence",
    items: [
      { id: "UMCSENT",   label: "Consumer Sentiment",    note: "Extends FRED data (back to 1952)" },
      { id: "UMICH_ICC", label: "Current Conditions" },
      { id: "UMICH_ICE", label: "Consumer Expectations" },
    ],
  },
  {
    group: "ISM Manufacturing",
    items: [
      { id: "pmi",                   label: "PMI" },
      { id: "new_orders",            label: "New Orders" },
      { id: "production",            label: "Production" },
      { id: "employment",            label: "Employment" },
      { id: "supplier_deliveries",   label: "Supplier Deliveries" },
      { id: "inventories",           label: "Inventories" },
      { id: "customers_inventories", label: "Customers' Inventories" },
      { id: "prices",                label: "Prices" },
      { id: "backlog_of_orders",     label: "Backlog of Orders" },
      { id: "new_export_orders",     label: "New Export Orders" },
      { id: "imports",               label: "Imports" },
    ],
  },
  {
    group: "ISM Services",
    items: [
      { id: "svc_pmi",                  label: "PMI" },
      { id: "svc_business_activity",    label: "Business Activity/Production" },
      { id: "svc_new_orders",           label: "New Orders" },
      { id: "svc_employment",           label: "Employment" },
      { id: "svc_supplier_deliveries",  label: "Supplier Deliveries" },
      { id: "svc_inventories",          label: "Inventories" },
      { id: "svc_prices",               label: "Prices" },
      { id: "svc_backlog_of_orders",    label: "Backlog of Orders" },
      { id: "svc_new_export_orders",    label: "New Export Orders" },
      { id: "svc_imports",              label: "Imports" },
      { id: "svc_inventory_sentiment",  label: "Inventory Sentiment" },
    ],
  },
];

const ALL_ITEMS = SERIES_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })));

export default function DataImportPage() {
  const [seriesId, setSeriesId] = useState("UMCSENT");
  const [csvText, setCsvText]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);

  const selected = ALL_ITEMS.find((i) => i.id === seriesId);

  async function handleImport() {
    if (!csvText.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API}/api/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ series_id: seriesId, csv_text: csvText }),
      });
      const data = await res.json();
      setResult(res.ok ? { ok: true, ...data } : { ok: false, detail: data.detail });
    } catch (e) {
      setResult({ ok: false, detail: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleClearCache() {
    try {
      const res = await fetch(`${API}/api/import/clear-cache`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ series_id: seriesId }),
      });
      const data = await res.json();
      setResult({ ok: true, cleared: true, ...data });
    } catch (e) {
      setResult({ ok: false, detail: e.message });
    }
  }

  return (
    <div style={{ color: "#e5e7eb", maxWidth: 820, margin: "0 auto", padding: "28px 24px" }}>
      <PageHeader
        title="Data Import"
        subtitle="Paste historical time-series data for any indicator. One row per month."
      />

      {/* Series selector */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 8 }}>
          Series
        </label>
        <select
          value={seriesId}
          onChange={(e) => { setSeriesId(e.target.value); setResult(null); }}
          style={{
            background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
            color: "#e5e7eb", fontSize: 13, padding: "8px 12px", width: 320, cursor: "pointer",
          }}
        >
          {SERIES_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </optgroup>
          ))}
        </select>

        {selected?.note && (
          <div style={{ fontSize: 11, color: "#4b5563", marginTop: 6 }}>ℹ {selected.note}</div>
        )}
      </div>

      {/* Format hint */}
      <div style={{
        background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
        padding: "10px 14px", marginBottom: 14, fontSize: 11, color: "#4b5563",
      }}>
        <span style={{ color: "#6b7280", fontWeight: 600 }}>Accepted formats · </span>
        one value per line, date + value separated by comma or semicolon:
        <span style={{ fontFamily: "monospace", color: "#374151", marginLeft: 8 }}>
          Jan 26;57.9 &nbsp;·&nbsp; 2026-01-01,57.9 &nbsp;·&nbsp; 01/2026;57.9 &nbsp;·&nbsp; Jan 2026,57.9
        </span>
        <br />
        Extra columns (Open, High, Low, Change%) are ignored automatically.
      </div>

      {/* Paste area */}
      <textarea
        value={csvText}
        onChange={(e) => setCsvText(e.target.value)}
        placeholder={"Jan 26;57.9\nFeb 26;56.6\nMrz 26;57.8\n...\n\nor:\n\nDate,Price\n2026-01-01,57.9\n2025-12-01,74.0"}
        style={{
          width: "100%", height: 280, background: "var(--bg-surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-none)", padding: 14, color: "#e5e7eb", fontSize: 12,
          fontFamily: "monospace", resize: "vertical", boxSizing: "border-box",
        }}
      />

      {/* Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
        <button
          onClick={handleImport}
          disabled={loading || !csvText.trim()}
          style={{
            background: loading ? "#1e3a5f" : "#2563eb", color: "white",
            border: "none", borderRadius: 8, padding: "9px 20px",
            cursor: loading ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 13,
          }}
        >
          {loading ? "Importing…" : `Import — ${selected?.label}`}
        </button>

        {/* Clear cache only for MacroCache-backed series */}
        {["UMCSENT", "UMICH_ICC", "UMICH_ICE"].includes(seriesId) && (
          <Button variant="secondary" onClick={handleClearCache}>
            Clear cache (re-fetch from FRED)
          </Button>
        )}

        {csvText.trim() && (
          <span style={{ color: "#4b5563", fontSize: 12 }}>
            {csvText.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length} lines detected
          </span>
        )}
      </div>

      {/* Result */}
      {result?.ok && !result.cleared && (
        <div style={{ marginTop: 20, background: "var(--bg-surface)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: "var(--radius-none)", padding: "14px 18px" }}>
          <div style={{ color: "#4ade80", fontWeight: 700, marginBottom: 6 }}>✓ Imported successfully</div>
          <div style={{ fontSize: 13, color: "#9ca3af", display: "flex", gap: 28, flexWrap: "wrap" }}>
            <span>Series: <strong style={{ color: "#e5e7eb" }}>{result.label}</strong></span>
            <span>Rows: <strong style={{ color: "#e5e7eb" }}>{result.saved}</strong></span>
            <span>Range: <strong style={{ color: "#e5e7eb" }}>{result.earliest}</strong> → <strong style={{ color: "#e5e7eb" }}>{result.latest}</strong></span>
          </div>
        </div>
      )}

      {result?.ok && result.cleared && (
        <div style={{ marginTop: 16, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)", padding: "12px 16px", color: "#9ca3af", fontSize: 13 }}>
          Cache cleared for <strong style={{ color: "#e5e7eb" }}>{result.series_id}</strong>. Data will be re-fetched from FRED on next page load.
        </div>
      )}

      {result && !result.ok && (
        <div style={{ marginTop: 16, color: "#f87171", background: "#1a0a0a", border: "1px solid rgba(242,88,92,0.3)", borderRadius: 8, padding: 12, fontSize: 13 }}>
          Error: {result.detail}
        </div>
      )}
    </div>
  );
}
