"use client";

import { useEffect, useRef, useState } from "react";
import PageHeader from "@/app/components/PageHeader";

const API = "http://localhost:8000";

export default function HighBetaMomentumAdminPage() {
  const [status, setStatus]   = useState(null);
  const [building, setBuilding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState(null);
  const pollRef = useRef(null);

  function loadStatus() {
    return fetch(`${API}/api/high-beta-momentum/status`)
      .then((r) => r.json())
      .then((d) => {
        setStatus(d);
        setBuilding(d.running);
        return d;
      })
      .catch(() => {});
  }

  useEffect(() => {
    loadStatus();
    return () => clearInterval(pollRef.current);
  }, []);

  function startPolling() {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const d = await loadStatus();
      if (d && !d.running) clearInterval(pollRef.current);
    }, 5000);
  }

  async function handleBuild() {
    setMessage(null);
    try {
      const res = await fetch(`${API}/api/high-beta-momentum/build`, { method: "POST" });
      if (res.status === 409) {
        setMessage({ ok: false, text: "A build is already running." });
        return;
      }
      setBuilding(true);
      startPolling();
    } catch (e) {
      setMessage({ ok: false, text: e.message });
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setMessage(null);
    try {
      const res = await fetch(`${API}/api/high-beta-momentum/refresh`, { method: "POST" });
      const data = await res.json();
      setStatus(data);
      setMessage({ ok: true, text: "Incremental refresh complete." });
    } catch (e) {
      setMessage({ ok: false, text: e.message });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div style={{ color: "#e5e7eb", maxWidth: 820, margin: "0 auto", padding: "28px 24px" }}>
      <PageHeader
        title="High Beta Momentum — Build"
        subtitle="Full historical rebuild (screens the universe, downloads ~5+ years of prices for ~2000 candidates, computes every monthly rebalance). Takes 10-40 minutes."
      />

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <button
          onClick={handleBuild}
          disabled={building}
          style={{
            background: building ? "#1e3a5f" : "#2563eb", color: "white",
            border: "none", borderRadius: 8, padding: "10px 20px",
            cursor: building ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 14,
          }}
        >
          {building ? "Building…" : "Build / Rebuild (5Y History)"}
        </button>

        <button
          onClick={handleRefresh}
          disabled={building || refreshing}
          style={{
            background: (building || refreshing) ? "#1e3a5f" : "#0f3460", color: "#93c5fd",
            border: "1px solid #1e3a5f", borderRadius: 8, padding: "10px 20px",
            cursor: (building || refreshing) ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 14,
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh Now (single month)"}
        </button>
      </div>

      {message && (
        <div style={{ marginBottom: 16, fontSize: 13, color: message.ok ? "#4ade80" : "#f87171" }}>
          {message.text}
        </div>
      )}

      {status && (
        <div style={{
          background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
          padding: "16px 20px", fontSize: 13, color: "#9ca3af",
        }}>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginBottom: status.running ? 10 : 0 }}>
            <div>Status: <strong style={{ color: status.running ? "#f59e0b" : "#e5e7eb" }}>
              {status.running ? `Running (${status.phase})` : (status.phase ?? "idle")}
            </strong></div>
            <div>NAV rows: <strong style={{ color: "#e5e7eb" }}>{status.row_count ?? 0}</strong></div>
            <div>Range: <strong style={{ color: "#e5e7eb" }}>{status.earliest ?? "—"}</strong> → <strong style={{ color: "#e5e7eb" }}>{status.latest ?? "—"}</strong></div>
          </div>
          {status.running && (
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Started: {status.started_at ? new Date(status.started_at).toLocaleString() : "—"} — this page polls every 5s.
            </div>
          )}
          {status.error && (
            <div style={{ marginTop: 10, color: "#f87171" }}>Last error: {status.error}</div>
          )}
        </div>
      )}
    </div>
  );
}
