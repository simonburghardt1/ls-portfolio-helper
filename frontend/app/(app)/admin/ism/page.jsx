"use client";

import { useState } from "react";

export default function IsmAdminPage() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchStatus, setFetchStatus] = useState(null);

  async function handleFetchLatest() {
    setFetchLoading(true);
    setFetchStatus(null);
    try {
      const res = await fetch("http://localhost:8000/api/ism/manufacturing/fetch-latest", { method: "POST" });
      const data = await res.json();
      if (data.status === "ok") {
        setFetchStatus({ ok: true, message: `${data.message} (${data.components_found} components)` });
      } else {
        setFetchStatus({ ok: false, message: data.message || "Unknown error." });
      }
    } catch (e) {
      setFetchStatus({ ok: false, message: e.message });
    } finally {
      setFetchLoading(false);
    }
  }

  async function handleImport() {
    const urls = text
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => u.startsWith("http"));

    if (!urls.length) return;
    setLoading(true);
    setResults(null);

    try {
      const res = await fetch("http://localhost:8000/api/ism/manufacturing/load-urls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const data = await res.json();
      setResults(data);
    } catch (e) {
      setResults({ error: e.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ color: "#e5e7eb", fontFamily: "Arial, sans-serif", maxWidth: 900, margin: "0 auto", padding: "28px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>ISM Manufacturing — Data Import</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {fetchStatus && (
            <span style={{ fontSize: 13, color: fetchStatus.ok ? "#4ade80" : "#f87171" }}>
              {fetchStatus.message}
            </span>
          )}
          <button
            onClick={handleFetchLatest}
            disabled={fetchLoading}
            style={{
              background: fetchLoading ? "#1e3a5f" : "#0f3460", color: "#93c5fd",
              border: "1px solid #1e3a5f", borderRadius: 8, padding: "8px 16px",
              cursor: fetchLoading ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 13,
            }}
          >
            {fetchLoading ? "Fetching…" : "Fetch Latest"}
          </button>
        </div>
      </div>
      <p style={{ color: "#9ca3af", fontSize: 14, marginBottom: 24 }}>
        Paste PRNewswire URLs (one per line). Find them by searching Google for:<br />
        <code style={{ background: "#0f172a", border: "1px solid #1f2937", padding: "4px 8px", borderRadius: 6, color: "#93c5fd", display: "inline-block", marginTop: 6 }}>
          site:prnewswire.com "ism manufacturing pmi report"
        </code>
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"https://www.prnewswire.com/news-releases/manufacturing-pmi-at-52-4-february-2026-ism-manufacturing-pmi-report-302699883.html\nhttps://www.prnewswire.com/news-releases/..."}
        style={{
          width: "100%", height: 220, background: "#0f172a", border: "1px solid #374151",
          borderRadius: 10, padding: 14, color: "#e5e7eb", fontSize: 12,
          fontFamily: "monospace", resize: "vertical", boxSizing: "border-box",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14 }}>
        <button
          onClick={handleImport}
          disabled={loading || !text.trim()}
          style={{
            background: loading ? "#1e3a5f" : "#2563eb", color: "white",
            border: "none", borderRadius: 10, padding: "10px 20px",
            cursor: loading ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 14,
          }}
        >
          {loading ? "Importing…" : "Import URLs"}
        </button>
        {text.trim() && (
          <span style={{ color: "#6b7280", fontSize: 13 }}>
            {text.split("\n").filter((l) => l.trim().startsWith("http")).length} URLs detected
          </span>
        )}
      </div>

      {results && !results.error && (
        <div style={{ marginTop: 24 }}>
          <div style={{
            background: "#0f172a", border: "1px solid #1f2937", borderRadius: 12,
            padding: "14px 18px", marginBottom: 16, display: "flex", gap: 24,
          }}>
            <Stat label="Saved" value={results.saved} color="#4ade80" />
            <Stat label="Failed" value={results.total - results.saved} color={results.total - results.saved > 0 ? "#f87171" : "#6b7280"} />
            <Stat label="Total" value={results.total} color="#e5e7eb" />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {results.results?.map((r, i) => (
              <div key={i} style={{
                background: "#0f172a", border: `1px solid ${r.status === "ok" ? "#1a3a1a" : "#3a1a1a"}`,
                borderRadius: 8, padding: "10px 14px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: r.status === "ok" ? 6 : 0 }}>
                  <span style={{ color: r.status === "ok" ? "#4ade80" : "#f87171", fontSize: 12, fontWeight: 700 }}>
                    {r.status === "ok" ? "✓" : "✗"}
                  </span>
                  <span style={{ color: "#6b7280", fontSize: 11, fontFamily: "monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.url}
                  </span>
                  {r.date && <span style={{ color: "#93c5fd", fontSize: 12, flexShrink: 0 }}>{r.date}</span>}
                </div>
                {r.status === "ok" && r.components && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingLeft: 20 }}>
                    {Object.entries(r.components).map(([k, v]) => (
                      <span key={k} style={{ fontSize: 11, color: "#9ca3af", background: "#111827", padding: "2px 6px", borderRadius: 4 }}>
                        {k.replace(/_/g, " ")}: <span style={{ color: "#e5e7eb" }}>{v}</span>
                      </span>
                    ))}
                  </div>
                )}
                {r.reason && <div style={{ color: "#f87171", fontSize: 11, paddingLeft: 20 }}>{r.reason}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {results?.error && (
        <div style={{ marginTop: 16, color: "#f87171", background: "#1a0a0a", border: "1px solid #3a1a1a", borderRadius: 8, padding: 12 }}>
          Error: {results.error}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
