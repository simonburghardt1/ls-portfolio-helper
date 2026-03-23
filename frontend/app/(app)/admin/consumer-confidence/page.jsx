"use client";

import { useState } from "react";

const API = "http://localhost:8000";

const SERIES_OPTIONS = [
  { id: "UMICH_ICC", label: "Current Conditions (ICC)" },
  { id: "UMICH_ICE", label: "Consumer Expectations (ICE)" },
];

export default function ConsumerConfidenceAdminPage() {
  const [seriesId, setSeriesId] = useState("UMICH_ICC");
  const [csvText, setCsvText]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);

  async function handleImport() {
    if (!csvText.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API}/api/consumer-confidence/import`, {
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

  return (
    <div style={{ color: "#e5e7eb", maxWidth: 800, margin: "0 auto", padding: "28px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>
        Consumer Confidence — Data Import
      </h1>
      <p style={{ color: "#9ca3af", fontSize: 14, marginBottom: 24 }}>
        Import historical ICC or ICE data from investing.com or any CSV source.
      </p>

      {/* Series selector */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>Series to import</div>
        <div style={{ display: "flex", gap: 8 }}>
          {SERIES_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setSeriesId(opt.id)}
              style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                border: `1px solid ${seriesId === opt.id ? "#3b82f6" : "#374151"}`,
                background: seriesId === opt.id ? "#1e3a5f" : "transparent",
                color: seriesId === opt.id ? "#93c5fd" : "#6b7280",
                fontWeight: seriesId === opt.id ? 600 : 400,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Instructions */}
      <div style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: "#6b7280" }}>
        <strong style={{ color: "#9ca3af" }}>Accepted formats (auto-detected):</strong>
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3, fontFamily: "monospace" }}>
          <span style={{ color: "#4b5563" }}># Any of these column formats work:</span>
          <span>2026-03-01, 57.9</span>
          <span>Mar 2026, 57.9</span>
          <span>Mar 01, 2026, 57.9</span>
          <span>03/2026, 57.9</span>
        </div>
        <div style={{ marginTop: 8 }}>
          From investing.com: download historical data CSV and paste the full file — headers and extra columns are ignored automatically.
        </div>
      </div>

      {/* CSV textarea */}
      <textarea
        value={csvText}
        onChange={(e) => setCsvText(e.target.value)}
        placeholder={"Date,Price,Open,High,Low,Change %\nMar 2026,57.9,57.0,57.9,57.0,1.58%\nFeb 2026,64.7,71.7,71.7,64.7,-9.76%\n..."}
        style={{
          width: "100%", height: 260, background: "#0f172a", border: "1px solid #374151",
          borderRadius: 10, padding: 14, color: "#e5e7eb", fontSize: 12,
          fontFamily: "monospace", resize: "vertical", boxSizing: "border-box",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14 }}>
        <button
          onClick={handleImport}
          disabled={loading || !csvText.trim()}
          style={{
            background: loading ? "#1e3a5f" : "#2563eb", color: "white",
            border: "none", borderRadius: 10, padding: "10px 20px",
            cursor: loading ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 14,
          }}
        >
          {loading ? "Importing…" : "Import Data"}
        </button>
      </div>

      {result?.ok && (
        <div style={{ marginTop: 20, background: "#0f172a", border: "1px solid #14532d", borderRadius: 10, padding: "14px 18px" }}>
          <div style={{ color: "#4ade80", fontWeight: 700, marginBottom: 6 }}>✓ Import successful</div>
          <div style={{ fontSize: 13, color: "#9ca3af", display: "flex", gap: 24 }}>
            <span>Saved: <strong style={{ color: "#e5e7eb" }}>{result.saved}</strong> rows</span>
            <span>Range: <strong style={{ color: "#e5e7eb" }}>{result.earliest}</strong> → <strong style={{ color: "#e5e7eb" }}>{result.latest}</strong></span>
          </div>
        </div>
      )}

      {result && !result.ok && (
        <div style={{ marginTop: 16, color: "#f87171", background: "#1a0a0a", border: "1px solid #3a1a1a", borderRadius: 8, padding: 12 }}>
          Error: {result.detail}
        </div>
      )}
    </div>
  );
}
