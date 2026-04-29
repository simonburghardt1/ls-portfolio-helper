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
    key:         "market-regime",
    label:       "Market Regime",
    description: "Daily regime model: BMSB (30%), Market Breadth (28%), VIX (17%), Credit Spreads (25%). "
               + "Uses SPY, RSP, ^VIX, HYG, LQD from yfinance (daily bars). "
               + "Auto-refreshes daily at 22:00 UTC (after US market close). "
               + "Use 'Seed' to do a full re-download from 1998 (needed after switching weekly→daily).",
    statusUrl:   `${API}/api/market/regime/status`,
    refreshUrl:  `${API}/api/market/regime/refresh`,
    statusSeries: null,
    isRegime:    true,
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
  {
    key:         "cpi-ppi",
    label:       "CPI & PPI",
    description: "21 FRED series: CPI All Items, Core CPI, PCE, Core PCE, PPI, and 16 CPI subcategories. Monthly data — cache TTL is 32 days; use Fetch Data to force a refresh after new monthly releases.",
    statusUrl:   `${API}/api/cpi-ppi/status`,
    refreshUrl:  `${API}/api/cpi-ppi/refresh`,
    statusSeries: null,
    isCpiPpi:    true,
  },
];

const DEFAULT_WEIGHTS_A = { bmsb: "0.30", breadth: "0.28", vix: "0.17", credit: "0.25" };
const DEFAULT_WEIGHTS_B = { bmsb: "0.35", breadth: "0.30", vix: "0.20", credit: "0.15" };

export default function IndicatorsAdminPage() {
  const [statuses, setStatuses] = useState({});
  const [fetching, setFetching] = useState({});
  const [results,  setResults]  = useState({});

  const [compareOpen,    setCompareOpen]    = useState(false);
  const [compareWeights, setCompareWeights] = useState({ a: DEFAULT_WEIGHTS_A, b: DEFAULT_WEIGHTS_B });
  const [compareResult,  setCompareResult]  = useState(null);
  const [comparing,      setComparing]      = useState(false);

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

  async function runCompare() {
    setComparing(true);
    setCompareResult(null);
    try {
      const toNum = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, parseFloat(v) || 0]));
      const res = await fetch(`${API}/api/market/regime/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config_a: toNum(compareWeights.a), config_b: toNum(compareWeights.b) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `HTTP ${res.status}`);
      setCompareResult(await res.json());
    } catch (e) {
      setCompareResult({ error: e.message });
    } finally {
      setComparing(false);
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
                    {ind.isRegime && (
                      <button
                        onClick={() => fetchIndicator({ ...ind, refreshUrl: `${API}/api/market/regime/seed` })}
                        disabled={loading}
                        style={loading ? btnDisabled : { ...btnFetch, background: "#1a1a2e", borderColor: "#312e81", color: "#a78bfa" }}
                      >
                        {loading ? "Seeding…" : "↓ Full Reseed"}
                      </button>
                    )}
                    <button onClick={() => fetchIndicator(ind)} disabled={loading} style={loading ? btnDisabled : btnFetch}>
                      {loading ? "Fetching…" : "↓ Fetch Data"}
                    </button>
                  </div>
                </div>

                {/* Market Regime status */}
                {ind.isRegime && (
                  <div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {[
                        { label: "Rows",     value: status?.count         ?? "—" },
                        { label: "From",     value: status?.earliest_date ?? "—" },
                        { label: "Latest",   value: status?.latest_date   ?? "—" },
                        { label: "Interval", value: status?.interval      ?? "—" },
                      ].map(({ label, value }) => (
                        <div key={label} style={{ padding: "6px 12px", background: "#0a1628", borderRadius: 6 }}>
                          <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
                          <div style={{ fontSize: 13, color: "#9ca3af", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{value}</div>
                        </div>
                      ))}
                      {!status && <div style={{ fontSize: 12, color: "#374151" }}>No data yet — run Full Reseed.</div>}
                    </div>

                    {/* Weight Comparison toggle */}
                    <button
                      onClick={() => setCompareOpen(o => !o)}
                      style={{ marginTop: 14, fontSize: 12, color: "#60a5fa", background: "transparent", border: "1px solid #1e3a5f", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}
                    >
                      {compareOpen ? "▲ Hide Weight Comparison" : "▼ Weight Comparison"}
                    </button>

                    {compareOpen && (
                      <RegimeWeightCompare
                        weights={compareWeights}
                        setWeights={setCompareWeights}
                        onCompare={runCompare}
                        comparing={comparing}
                        result={compareResult}
                      />
                    )}
                  </div>
                )}

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

                {/* CPI/PPI status */}
                {ind.isCpiPpi && (
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                    <StatusItem
                      label="Series Cached"
                      value={status ? `${status.count} / ${status.total_series}` : "—"}
                      valueColor={status?.count === status?.total_series ? "#9ca3af" : "#f59e0b"}
                    />
                    <StatusItem label="Data Through"  value={status?.latest_date ?? "—"} />
                    <StatusItem
                      label="Last Fetched"
                      value={status?.fetched_at ? formatRelative(status.fetched_at) : "Never"}
                      valueColor={status?.fetched_at ? "#6b7280" : "#f59e0b"}
                    />
                  </div>
                )}

                {/* Per-series status rows */}
                {!ind.isCot && !ind.isCpiPpi && ind.statusSeries ? (
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
                ) : !ind.isCot && !ind.isCpiPpi ? (
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
                ) : null }


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

const COMP_META = [
  { key: "bmsb",    label: "BMSB" },
  { key: "breadth", label: "Breadth" },
  { key: "vix",     label: "VIX" },
  { key: "credit",  label: "Credit" },
];

const REGIME_COLORS = { up: "#22c55e", ranging: "#f59e0b", down: "#ef4444" };

function RegimeWeightCompare({ weights, setWeights, onCompare, comparing, result }) {
  function setW(cfg, key, val) {
    setWeights(prev => ({ ...prev, [cfg]: { ...prev[cfg], [key]: val } }));
  }

  function weightSum(cfg) {
    return Object.values(weights[cfg]).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  }

  return (
    <div style={{ marginTop: 16, padding: 16, background: "#0a1628", borderRadius: 8, border: "1px solid #1e2d3d" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 12 }}>
        Weight Comparison
      </div>

      {/* Inputs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {["a", "b"].map(cfg => (
          <div key={cfg}>
            <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Config {cfg.toUpperCase()}
            </div>
            {COMP_META.map(({ key, label }) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "#6b7280", width: 60 }}>{label}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={weights[cfg][key]}
                  onChange={e => setW(cfg, key, e.target.value)}
                  style={{ width: 70, padding: "3px 7px", background: "#0f1d2e", border: "1px solid #1e2d3d", borderRadius: 4, color: "#e2e8f0", fontSize: 12, fontVariantNumeric: "tabular-nums" }}
                />
              </div>
            ))}
            <div style={{ fontSize: 11, color: Math.abs(weightSum(cfg) - 1) < 0.001 ? "#22c55e" : "#f59e0b", marginTop: 4 }}>
              Sum: {weightSum(cfg).toFixed(2)} {Math.abs(weightSum(cfg) - 1) > 0.001 ? "(≠ 1, will be normalized)" : ""}
            </div>
          </div>
        ))}
      </div>

      {/* Compare button */}
      <button
        onClick={onCompare}
        disabled={comparing}
        style={{ marginTop: 14, padding: "7px 18px", background: comparing ? "transparent" : "#1e3a5f", border: "1px solid #2d5a8e", borderRadius: 6, color: comparing ? "#374151" : "#93c5fd", fontSize: 12, fontWeight: 600, cursor: comparing ? "default" : "pointer" }}
      >
        {comparing ? "Comparing…" : "Compare"}
      </button>

      {/* Results */}
      {result?.error && (
        <div style={{ marginTop: 12, color: "#fca5a5", fontSize: 12 }}>Error: {result.error}</div>
      )}

      {result && !result.error && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 8 }}>
            {result.row_count} trading days · {result.date_range?.[0]} – {result.date_range?.[1]}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={thStyle}>Regime</th>
                <th style={thStyle}>% Time A</th>
                <th style={thStyle}>Avg Daily Ret A</th>
                <th style={thStyle}>% Time B</th>
                <th style={thStyle}>Avg Daily Ret B</th>
              </tr>
            </thead>
            <tbody>
              {["up", "ranging", "down"].map(regime => {
                const a = result.config_a;
                const b = result.config_b;
                return (
                  <tr key={regime}>
                    <td style={{ ...tdStyle, color: REGIME_COLORS[regime], fontWeight: 600, textTransform: "capitalize" }}>{regime}</td>
                    <td style={tdStyle}>{a.pct_time[regime]}%</td>
                    <td style={{ ...tdStyle, color: a.avg_daily_return_pct[regime] >= 0 ? "#22c55e" : "#ef4444" }}>
                      {a.avg_daily_return_pct[regime] != null ? `${a.avg_daily_return_pct[regime] >= 0 ? "+" : ""}${a.avg_daily_return_pct[regime].toFixed(3)}%` : "—"}
                    </td>
                    <td style={tdStyle}>{b.pct_time[regime]}%</td>
                    <td style={{ ...tdStyle, color: b.avg_daily_return_pct[regime] >= 0 ? "#22c55e" : "#ef4444" }}>
                      {b.avg_daily_return_pct[regime] != null ? `${b.avg_daily_return_pct[regime] >= 0 ? "+" : ""}${b.avg_daily_return_pct[regime].toFixed(3)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td style={{ ...tdStyle, color: "#6b7280" }}>Transitions</td>
                <td style={tdStyle} colSpan={2}>{result.config_a.transitions}</td>
                <td style={tdStyle} colSpan={2}>{result.config_b.transitions}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 10, fontSize: 11, color: "#4b5563", fontStyle: "italic" }}>
            ⚠ In-sample metrics only. Higher avg return in "up" regime may reflect data snooping rather than genuine predictive power. Prefer configs with fewer transitions and economically motivated weights.
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle = { padding: "5px 10px", textAlign: "left", fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #1e2d3d" };
const tdStyle = { padding: "6px 10px", color: "#9ca3af", fontVariantNumeric: "tabular-nums", borderBottom: "1px solid #0f1d2e" };

const btnBase     = { borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", transition: "opacity 0.15s" };
const btnFetch    = { ...btnBase, background: "#1e3a5f", border: "1px solid #2d5a8e", color: "#93c5fd" };
const btnDisabled = { ...btnBase, background: "transparent", border: "1px solid #1f2937", color: "#374151", cursor: "default" };
