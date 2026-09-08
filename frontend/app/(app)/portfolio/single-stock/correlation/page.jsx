"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import PageHeader from "@/app/components/PageHeader";
import KpiCard from "@/app/components/KpiCard";
import LineChart from "@/app/components/LineChart";

const WINDOWS = [
  { key: "3m", label: "3M" },
  { key: "6m", label: "6M" },
  { key: "1y", label: "1Y" },
  { key: "2y", label: "2Y" },
  { key: "5y", label: "5Y" },
];

// Colors follow the app's standard chart-series order (--chart-1..5 in globals.css)
const WINDOW_COLORS = {
  "3m": "#3b82f6",
  "6m": "#10b981",
  "1y": "#f59e0b",
  "2y": "#a78bfa",
  "5y": "#ef4444",
};

const SELECT_STYLE = {
  background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
  color: "#e5e7eb", fontSize: 13, padding: "6px 10px", cursor: "pointer", width: 220,
};

// Page-local for now — the architecture spine flags the *shared* Universal Asset
// Selector as still needing its own UX design pass (no dropdown/combobox precedent
// exists yet in this app's design system beyond range-toggles and tabs). This is a
// pragmatic, working selector for this page, not the final cross-page component.
const CUSTOM_VALUE = "__custom__";

function AssetSelector({ label, baskets, selection, onChange }) {
  const isCustom = selection.type === "stock";
  const [customTicker, setCustomTicker] = useState(isCustom ? selection.id : "");
  const selectValue = isCustom ? CUSTOM_VALUE : `${selection.type}:${selection.id}`;

  function handleSelectChange(e) {
    const v = e.target.value;
    if (v === CUSTOM_VALUE) {
      const t = customTicker.trim().toUpperCase();
      onChange({ type: "stock", id: t, label: t || "—" });
      return;
    }
    const [type, id] = v.split(":");
    const b = baskets.find((x) => String(x.id) === id);
    onChange({ type, id, label: b?.name ?? id });
  }

  function handleTickerChange(e) {
    const t = e.target.value;
    setCustomTicker(t);
    onChange({ type: "stock", id: t.trim().toUpperCase(), label: t.trim().toUpperCase() || "—" });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </label>
      <select value={selectValue} onChange={handleSelectChange} style={SELECT_STYLE}>
        <option value={CUSTOM_VALUE}>Custom Ticker…</option>
        <optgroup label="Baskets">
          {baskets.map((b) => (
            <option key={b.id} value={`${b.id === -1 ? "hbm" : "basket"}:${b.id}`}>{b.name}</option>
          ))}
        </optgroup>
      </select>
      {isCustom && (
        <input
          type="text"
          value={customTicker}
          onChange={handleTickerChange}
          placeholder="e.g. AAPL"
          style={{ ...SELECT_STYLE, cursor: "text" }}
        />
      )}
    </div>
  );
}

// Correlation is unitless (-1..1) but shown as a "%" for consistency with this app's
// existing rolling-correlation precedent (GDP ↔ Market Correlation tab), which uses
// the same *100 + "%" display convention.
function fmtCorr(v) {
  if (v == null || isNaN(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export default function CorrelationPage() {
  const [assetA, setAssetA] = useState({ type: "stock", id: "AAPL", label: "AAPL" });
  const [assetB, setAssetB] = useState({ type: "stock", id: "MSFT", label: "MSFT" });
  const [activeWindows, setActiveWindows] = useState(new Set(WINDOWS.map((w) => w.key)));

  const { data: baskets } = useQuery({
    queryKey: ["baskets"],
    queryFn: () => api.get("/api/baskets"),
  });

  const ready = Boolean(assetA.id && assetB.id);

  const { data: corr, isLoading, isError } = useQuery({
    queryKey: ["correlation", assetA.type, assetA.id, assetB.type, assetB.id],
    queryFn: () => api.get(
      `/api/correlation?type_a=${assetA.type}&id_a=${encodeURIComponent(assetA.id)}` +
      `&type_b=${assetB.type}&id_b=${encodeURIComponent(assetB.id)}`
    ),
    enabled: ready,
  });

  function toggleWindow(key) {
    setActiveWindows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size === 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <div style={{ padding: "28px 32px", minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <PageHeader
        title="Correlation"
        subtitle="Rolling correlation between any two assets — stocks, commodities, ETFs, or Baskets."
      />

      <div style={{ display: "flex", gap: 24, marginBottom: 24, flexWrap: "wrap" }}>
        <AssetSelector label="Asset A" baskets={baskets ?? []} selection={assetA} onChange={setAssetA} />
        <AssetSelector label="Asset B" baskets={baskets ?? []} selection={assetB} onChange={setAssetB} />
      </div>

      {isLoading && (
        <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>Loading…</div>
      )}
      {isError && (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--negative)", padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "var(--negative)" }}>
          Could not load correlation data.
        </div>
      )}

      {corr && corr.dates.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
            {WINDOWS.map((w) => (
              <KpiCard
                key={w.key}
                label={w.label}
                formatted={fmtCorr(corr.current[w.key])}
                valueColor={corr.current[w.key] == null ? undefined : corr.current[w.key] >= 0 ? "var(--positive)" : "var(--negative)"}
                small
              />
            ))}
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 }}>
            Rolling Correlation — {assetA.label} vs {assetB.label}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {WINDOWS.map((w) => {
              const on = activeWindows.has(w.key);
              return (
                <button
                  key={w.key}
                  onClick={() => toggleWindow(w.key)}
                  style={{
                    padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                    border: `1px solid ${on ? WINDOW_COLORS[w.key] : "var(--border)"}`,
                    background: on ? `${WINDOW_COLORS[w.key]}22` : "transparent",
                    color: on ? WINDOW_COLORS[w.key] : "var(--text-secondary)",
                    fontWeight: on ? 600 : 400,
                  }}
                >
                  {w.label}
                </button>
              );
            })}
          </div>
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", padding: "16px 8px 8px", marginBottom: 28 }}>
            <LineChart
              dates={corr.dates}
              datasets={WINDOWS.filter((w) => activeWindows.has(w.key)).map((w) => ({
                dates: corr.dates,
                data: corr.windows[w.key].map((v) => (v == null ? null : v * 100)),
                borderColor: WINDOW_COLORS[w.key],
                borderWidth: 1.5,
                label: w.label,
              }))}
              referenceLine={0}
            />
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 }}>
            Price Comparison (indexed to 100)
          </div>
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", padding: "16px 8px 8px", marginBottom: 28 }}>
            <LineChart
              dates={corr.dates}
              datasets={[
                { dates: corr.dates, data: corr.prices.a, borderColor: "#3b82f6", borderWidth: 2, label: assetA.label },
                { dates: corr.dates, data: corr.prices.b, borderColor: "#f59e0b", borderWidth: 2, label: assetB.label },
              ]}
              referenceLine={100}
            />
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 }}>
            Spread — {assetA.label} vs {assetB.label}
          </div>
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", padding: "16px 8px 8px" }}>
            <LineChart
              dates={corr.dates}
              datasets={[
                {
                  dates: corr.dates,
                  data: corr.prices.a.map((v, i) => (v == null || corr.prices.b[i] == null ? null : (v / corr.prices.b[i]) * 100)),
                  borderColor: "#3b82f6", borderWidth: 2, label: "Ratio (A/B)", priceScaleId: "right",
                },
                {
                  dates: corr.dates,
                  data: corr.prices.a.map((v, i) => (v == null || corr.prices.b[i] == null ? null : v - corr.prices.b[i])),
                  borderColor: "#f59e0b", borderWidth: 2, label: "Diff (A−B, pp)", priceScaleId: "left",
                },
              ]}
            />
          </div>
        </>
      )}

      {corr && corr.dates.length === 0 && (
        <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
          Not enough overlapping price history for these two assets.
        </div>
      )}
    </div>
  );
}
