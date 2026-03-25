"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

const API = "http://localhost:8000";

const EMPTY_FORM = { name: "", positions: [{ ticker: "", side: "long", weight: "" }] };

export default function PortfolioManagerPage() {
  const [portfolios,   setPortfolios]   = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  // form state — null means "new", a portfolio id means "editing"
  const [editingId,    setEditingId]    = useState(null);
  const [form,         setForm]         = useState(EMPTY_FORM);
  const [saving,       setSaving]       = useState(false);
  const [saveError,    setSaveError]    = useState(null);

  const fetchPortfolios = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/portfolios`);
      setPortfolios(await res.json());
    } catch {
      setError("Could not load portfolios. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPortfolios(); }, [fetchPortfolios]);

  // ── Form helpers ─────────────────────────────────────────────────────────────

  function startNew() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
    // Scroll to form
    document.getElementById("portfolio-form")?.scrollIntoView({ behavior: "smooth" });
  }

  function startEdit(portfolio) {
    setEditingId(portfolio.id);
    setForm({
      name: portfolio.name,
      positions: portfolio.positions.map(p => ({ ...p, weight: String(p.weight) })),
    });
    setSaveError(null);
    document.getElementById("portfolio-form")?.scrollIntoView({ behavior: "smooth" });
  }

  function clearForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
  }

  function setFormName(name) {
    setForm(f => ({ ...f, name }));
  }

  function updatePosition(index, field, value) {
    setForm(f => {
      const positions = [...f.positions];
      positions[index] = { ...positions[index], [field]: value };
      return { ...f, positions };
    });
  }

  function addPosition() {
    setForm(f => ({ ...f, positions: [...f.positions, { ticker: "", side: "long", weight: "" }] }));
  }

  function removePosition(index) {
    setForm(f => ({ ...f, positions: f.positions.filter((_, i) => i !== index) }));
  }

  function validateForm() {
    if (!form.name.trim()) return "Portfolio name is required.";
    for (let i = 0; i < form.positions.length; i++) {
      const p = form.positions[i];
      if (!p.ticker.trim())           return `Row ${i + 1}: ticker is required.`;
      if (!p.weight || isNaN(Number(p.weight))) return `Row ${i + 1}: weight must be a number.`;
      if (!["long", "short"].includes(p.side))  return `Row ${i + 1}: side must be long or short.`;
    }
    return null;
  }

  async function savePortfolio() {
    const validationError = validateForm();
    if (validationError) { setSaveError(validationError); return; }

    setSaving(true);
    setSaveError(null);
    const body = {
      name: form.name.trim(),
      positions: form.positions.map(p => ({
        ticker: p.ticker.trim().toUpperCase(),
        side: p.side,
        weight: Number(p.weight),
      })),
    };

    try {
      const url = editingId ? `${API}/api/portfolios/${editingId}` : `${API}/api/portfolios`;
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        setSaveError(err.detail || "Save failed.");
        return;
      }
      clearForm();
      await fetchPortfolios();
    } catch {
      setSaveError("Network error. Is the backend running?");
    } finally {
      setSaving(false);
    }
  }

  async function deletePortfolio(id, name) {
    if (!confirm(`Delete portfolio "${name}"?`)) return;
    await fetch(`${API}/api/portfolios/${id}`, { method: "DELETE" });
    if (editingId === id) clearForm();
    await fetchPortfolios();
  }

  // ── Summary helpers ───────────────────────────────────────────────────────────

  function portfolioSummary(positions) {
    const longs  = positions.filter(p => p.side === "long").length;
    const shorts = positions.filter(p => p.side === "short").length;
    const gross  = positions.reduce((s, p) => s + Math.abs(Number(p.weight) || 0), 0);
    return { longs, shorts, gross };
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: "28px 32px", minHeight: "100vh", background: "#020617", color: "#e5e7eb" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f9fafb", margin: 0 }}>Portfolios</h1>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            Create and manage named portfolios. Load them into the backtester or heatmap.
          </p>
        </div>
        <button onClick={startNew} style={primaryBtn}>+ New Portfolio</button>
      </div>

      {/* ── Saved portfolios ──────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ color: "#4b5563", fontSize: 14, padding: "40px 0", textAlign: "center" }}>Loading…</div>
      )}
      {error && (
        <div style={{ background: "#1c0a0a", border: "1px solid #7f1d1d", borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#fca5a5" }}>
          {error}
        </div>
      )}

      {!loading && portfolios.length === 0 && !error && (
        <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 8, padding: "40px 24px", textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 14, color: "#4b5563" }}>No portfolios yet.</div>
          <div style={{ fontSize: 12, color: "#374151", marginTop: 6 }}>Use the form below to create your first portfolio.</div>
        </div>
      )}

      {portfolios.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14, marginBottom: 32 }}>
          {portfolios.map(p => {
            const { longs, shorts, gross } = portfolioSummary(p.positions);
            const isEditing = editingId === p.id;
            return (
              <div key={p.id} style={{
                background: "#080e1a",
                border: `1px solid ${isEditing ? "#2d5a8e" : "#1f2937"}`,
                borderRadius: 10,
                padding: "18px 20px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#f9fafb" }}>{p.name}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => startEdit(p)} style={iconBtn("#1e3a5f", "#93c5fd")}>Edit</button>
                    <button onClick={() => deletePortfolio(p.id, p.name)} style={iconBtn("#3f1d1d", "#fca5a5")}>Delete</button>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
                  <Stat label="Positions" value={p.positions.length} />
                  <Stat label="Longs"     value={longs}   color="#86efac" />
                  <Stat label="Shorts"    value={shorts}  color="#fca5a5" />
                  <Stat label="Gross"     value={`${(gross * 100).toFixed(0)}%`} />
                </div>

                <div style={{ fontSize: 11, color: "#374151", marginBottom: 14 }}>
                  Updated {new Date(p.updated_at).toLocaleDateString()}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <Link href="/portfolio/backtesting" style={{
                    fontSize: 12, color: "#60a5fa", textDecoration: "none",
                    padding: "5px 12px", border: "1px solid #1e3a5f", borderRadius: 5,
                  }}>
                    Open in Backtester →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create / Edit Form ────────────────────────────────────────────────── */}
      <div
        id="portfolio-form"
        style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 10, padding: "24px 28px" }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: "#3b4c6b", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 18 }}>
          {editingId ? "Edit Portfolio" : "New Portfolio"}
        </div>

        {/* Name */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 6 }}>Portfolio Name</label>
          <input
            value={form.name}
            onChange={e => setFormName(e.target.value)}
            placeholder="e.g. Long/Short Q1"
            style={{
              background: "#111827", border: "1px solid #1f2937", borderRadius: 6,
              padding: "8px 12px", fontSize: 14, color: "#e5e7eb", outline: "none", width: 280,
            }}
          />
        </div>

        {/* Positions table */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 8 }}>Positions</label>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ ...thStyle, width: "40%" }}>Ticker</th>
                <th style={{ ...thStyle, width: "20%" }}>Side</th>
                <th style={{ ...thStyle, width: "25%" }}>Weight</th>
                <th style={{ ...thStyle, width: "15%" }}></th>
              </tr>
            </thead>
            <tbody>
              {form.positions.map((pos, i) => (
                <tr key={i} style={{ borderTop: "1px solid #0d1829" }}>
                  <td style={tdStyle}>
                    <input
                      value={pos.ticker}
                      onChange={e => updatePosition(i, "ticker", e.target.value.toUpperCase())}
                      placeholder="AAPL"
                      style={cellInput}
                    />
                  </td>
                  <td style={tdStyle}>
                    <select
                      value={pos.side}
                      onChange={e => updatePosition(i, "side", e.target.value)}
                      style={cellInput}
                    >
                      <option value="long">Long</option>
                      <option value="short">Short</option>
                    </select>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="number" step="0.01" min="0" max="1"
                        value={pos.weight}
                        onChange={e => updatePosition(i, "weight", e.target.value)}
                        placeholder="0.10"
                        style={{ ...cellInput, width: "70px" }}
                      />
                      <span style={{ fontSize: 11, color: "#4b5563" }}>
                        {pos.weight && !isNaN(Number(pos.weight)) ? `${(Number(pos.weight) * 100).toFixed(0)}%` : ""}
                      </span>
                    </div>
                  </td>
                  <td style={tdStyle}>
                    {form.positions.length > 1 && (
                      <button
                        onClick={() => removePosition(i)}
                        style={{ background: "none", border: "none", color: "#4b5563", cursor: "pointer", fontSize: 16, padding: "2px 6px" }}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={addPosition} style={{ ...secondaryBtn, marginTop: 10, fontSize: 12 }}>
            + Add Position
          </button>
        </div>

        {/* Weight sum hint */}
        {(() => {
          const total = form.positions.reduce((s, p) => s + (Number(p.weight) || 0), 0);
          const pct = (total * 100).toFixed(0);
          const ok = Math.abs(total - 1) < 0.01;
          return total > 0 ? (
            <div style={{ fontSize: 12, color: ok ? "#86efac" : "#f59e0b", marginBottom: 14 }}>
              Total weight: {pct}% {ok ? "✓" : "(weights should sum to 100%)"}
            </div>
          ) : null;
        })()}

        {saveError && (
          <div style={{ fontSize: 13, color: "#fca5a5", background: "#1c0a0a", border: "1px solid #7f1d1d", borderRadius: 6, padding: "8px 12px", marginBottom: 14 }}>
            {saveError}
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={savePortfolio} disabled={saving} style={primaryBtn}>
            {saving ? "Saving…" : editingId ? "Save Changes" : "Save Portfolio"}
          </button>
          <button onClick={clearForm} style={secondaryBtn}>Clear</button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Stat({ label, value, color = "#e5e7eb" }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const primaryBtn = {
  background: "#1e3a5f", border: "1px solid #2d5a8e", borderRadius: 6,
  padding: "8px 18px", fontSize: 13, color: "#93c5fd", cursor: "pointer", fontWeight: 600,
};
const secondaryBtn = {
  background: "transparent", border: "1px solid #1f2937", borderRadius: 6,
  padding: "8px 14px", fontSize: 13, color: "#6b7280", cursor: "pointer",
};
function iconBtn(bg, color) {
  return {
    background: bg, border: "none", borderRadius: 5,
    padding: "4px 10px", fontSize: 11, color, cursor: "pointer", fontWeight: 600,
  };
}
const thStyle  = { fontSize: 11, color: "#4b5563", padding: "6px 8px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" };
const tdStyle  = { padding: "6px 8px" };
const cellInput = {
  width: "100%", background: "#111827", border: "1px solid #1f2937",
  borderRadius: 5, padding: "6px 10px", fontSize: 13, color: "#e5e7eb", outline: "none",
};
