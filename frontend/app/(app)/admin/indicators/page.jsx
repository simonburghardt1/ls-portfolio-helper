"use client";

import { useState, useEffect } from "react";

const API = "http://localhost:8000";

// Consumer Confidence shows all 3 sub-series in the status strip
const INDICATORS = [
  {
    key:         "consumer-confidence",
    label:       "Consumer Confidence",
    description: "FRED (UMCSENT history) + UoM website scrape (latest UMCSENT, ICC, ICE). "
               + "FRED often lags 1–2 months; the UoM scrape fills the gap.",
    statusUrl:   `${API}/api/consumer-confidence/status`,
    refreshUrl:  `${API}/api/consumer-confidence/refresh`,
    // status returns { UMCSENT: {...}, UMICH_ICC: {...}, UMICH_ICE: {...} }
    statusSeries: [
      { key: "UMCSENT",   label: "Consumer Sentiment" },
      { key: "UMICH_ICC", label: "Current Conditions" },
      { key: "UMICH_ICE", label: "Consumer Expectations" },
    ],
  },
  {
    key:         "building-permits",
    label:       "US Building Permits",
    description: "PERMIT, HOUST, COMPUTSA via FRED API.",
    statusUrl:   `${API}/api/building-permits/status`,
    refreshUrl:  `${API}/api/building-permits/refresh`,
    statusSeries: [
      { key: "PERMIT",   label: "Building Permits" },
      { key: "HOUST",    label: "Housing Starts" },
      { key: "COMPUTSA", label: "Completions" },
    ],
  },
  {
    key:         "nfib",
    label:       "NFIB Optimism",
    description: "NFIB Small Business Optimism Index and 10 components via NFIB API.",
    statusUrl:   `${API}/api/nfib/status`,
    refreshUrl:  `${API}/api/nfib/refresh`,
    // status is a flat object (not keyed by series)
    statusSeries: null,
  },
  {
    key:         "cot",
    label:       "COT Data",
    description: "CFTC Commitments of Traders — 21 contracts via Socrata REST API (Disaggregated + TFF reports). Weekly cadence, updated each Friday.",
    statusUrl:   `${API}/api/cot/status`,
    refreshUrl:  `${API}/api/cot/refresh`,
    // status returns {contract_key: {label, asset_class, latest_date}} — use cot-specific renderer
    statusSeries: null,
    isCot:       true,
  },
];

export default function IndicatorsAdminPage() {
  const [statuses, setStatuses] = useState({});
  const [fetching, setFetching] = useState({});
  const [results,  setResults]  = useState({});

  useEffect(() => {
    INDICATORS.forEach(ind => loadStatus(ind));
  }, []);

  async function loadStatus(ind) {
    try {
      const res  = await fetch(ind.statusUrl);
      const json = await res.json();
      setStatuses(prev => ({ ...prev, [ind.key]: json }));
    } catch {
      setStatuses(prev => ({ ...prev, [ind.key]: null }));
    }
  }

  async function fetchIndicator(ind) {
    setFetching(prev => ({ ...prev, [ind.key]: true }));
    setResults(prev => ({ ...prev, [ind.key]: null }));
    try {
      const res  = await fetch(ind.refreshUrl, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      setResults(prev => ({ ...prev, [ind.key]: { ok: true, data: json } }));
      await loadStatus(ind);
    } catch (e) {
      setResults(prev => ({ ...prev, [ind.key]: { ok: false, error: e.message } }));
    } finally {
      setFetching(prev => ({ ...prev, [ind.key]: false }));
    }
  }

  return (
    <div style={{ background: "#020617", minHeight: "100vh", color: "#e5e7eb" }}>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 32px 60px" }}>

        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f9fafb", margin: 0 }}>Indicator Data Refresh</h1>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            Manually trigger a data fetch for each economic indicator.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {INDICATORS.map(ind => {
            const status  = statuses[ind.key];
            const loading = fetching[ind.key];
            const result  = results[ind.key];

            return (
              <div key={ind.key} style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 10, padding: 24 }}>

                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#f9fafb", marginBottom: 4 }}>{ind.label}</div>
                    <div style={{ fontSize: 12, color: "#4b5563", maxWidth: 600 }}>{ind.description}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {ind.isCot && (
                      <button
                        onClick={() => fetchIndicator({ ...ind, refreshUrl: `${API}/api/cot/seed` })}
                        disabled={loading}
                        style={loading ? btnDisabled : { ...btnFetch, background: "#1a1a2e", borderColor: "#312e81", color: "#a78bfa" }}
                      >
                        {loading ? "Seeding…" : "↓ Seed All"}
                      </button>
                    )}
                    <button onClick={() => fetchIndicator(ind)} disabled={loading} style={loading ? btnDisabled : btnFetch}>
                      {loading ? "Fetching…" : "↓ Fetch Data"}
                    </button>
                  </div>
                </div>

                {/* COT status — compact contract grid */}
                {ind.isCot && status ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 6 }}>
                    {Object.entries(status).map(([key, info]) => (
                      <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "#0a1628", borderRadius: 6 }}>
                        <span style={{ fontSize: 12, color: "#6b7280" }}>{info.label}</span>
                        <span style={{ fontSize: 12, color: info.latest_date ? "#9ca3af" : "#374151", fontVariantNumeric: "tabular-nums" }}>
                          {info.latest_date ?? "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : ind.isCot ? (
                  <div style={{ fontSize: 12, color: "#374151" }}>No data yet — run Seed to fetch full history.</div>
                ) : null}

                {/* Per-series status rows */}
                {!ind.isCot && ind.statusSeries ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {ind.statusSeries.map(s => {
                      const row = status?.[s.key];
                      return (
                        <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 20, padding: "8px 12px", background: "#0a1628", borderRadius: 6 }}>
                          <span style={{ fontSize: 12, color: "#6b7280", width: 180, flexShrink: 0 }}>{s.label}</span>
                          <StatusPill label="pts"    value={row?.count      ?? "—"} />
                          <StatusPill label="latest" value={row?.latest_date ?? "—"} />
                          <StatusPill
                            label="value"
                            value={row?.latest_value != null ? row.latest_value.toFixed(1) : "—"}
                            valueColor={row?.latest_value != null ? "#f9fafb" : "#374151"}
                          />
                          <StatusPill
                            label="fetched"
                            value={row?.fetched_at ? formatRelative(row.fetched_at) : "never"}
                            valueColor={row?.fetched_at ? "#6b7280" : "#f59e0b"}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : !ind.isCot ? (
                  // Flat status (NFIB)
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                    <StatusItem label="Data Points" value={status?.count      ?? "—"} />
                    <StatusItem label="Latest Date"  value={status?.latest_date ?? "—"} />
                    <StatusItem label="Latest Value" value={status?.latest_value != null ? status.latest_value.toFixed(1) : "—"} />
                    <StatusItem
                      label="Last Fetched"
                      value={status?.fetched_at ? formatRelative(status.fetched_at) : "Never"}
                      valueColor={status?.fetched_at ? "#6b7280" : "#f59e0b"}
                    />
                  </div>
                ) : null}

                {/* Result after fetch */}
                {result && (
                  <div style={{
                    marginTop: 14,
                    padding: "12px 16px",
                    borderRadius: 8,
                    background: result.ok ? "rgba(22,163,74,0.08)" : "rgba(220,38,38,0.08)",
                    border: `1px solid ${result.ok ? "rgba(22,163,74,0.25)" : "rgba(220,38,38,0.25)"}`,
                    fontSize: 13,
                  }}>
                    {result.ok ? <ResultSuccess data={result.data} /> : (
                      <span style={{ color: "#fca5a5" }}>Error: {result.error}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ResultSuccess({ data }) {
  const entries = data.refreshed
    ? Object.entries(data.refreshed)
    : data.series_id
      ? [[data.series_id, data]]
      : [];

  const warnings = [data.fred_warning, data.scrape_warning].filter(Boolean);

  return (
    <div>
      <div style={{ color: "#86efac", marginBottom: warnings.length ? 6 : 0 }}>
        ✓ Fetched{data.scrape_period ? ` · period: ${data.scrape_period}` : ""}{" — "}
        {entries.map(([id, info], i) => (
          <span key={id}>
            <strong>{info.label ?? id}</strong>
            {info.count != null ? `: ${info.count} pts` : ""}
            {info.latest_date  ? `, latest ${info.latest_date}` : ""}
            {info.latest_value != null ? ` (${info.latest_value.toFixed(1)})` : ""}
            {i < entries.length - 1 ? " · " : ""}
          </span>
        ))}
        {/* NFIB flat response */}
        {!entries.length && data.refreshed && (
          <span>{JSON.stringify(data.refreshed).slice(0, 120)}</span>
        )}
      </div>
      {warnings.map((w, i) => (
        <div key={i} style={{ color: "#f59e0b", fontSize: 12 }}>⚠ {w}</div>
      ))}
    </div>
  );
}

function StatusPill({ label, value, valueColor = "#9ca3af" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: valueColor, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function StatusItem({ label, value, valueColor = "#9ca3af" }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: valueColor, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function formatRelative(isoString) {
  const diff = (Date.now() - new Date(isoString).getTime()) / 1000;
  if (diff < 60)    return "just now";
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const btnBase     = { borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", transition: "opacity 0.15s" };
const btnFetch    = { ...btnBase, background: "#1e3a5f", border: "1px solid #2d5a8e", color: "#93c5fd" };
const btnDisabled = { ...btnBase, background: "transparent", border: "1px solid #1f2937", color: "#374151", cursor: "default" };
