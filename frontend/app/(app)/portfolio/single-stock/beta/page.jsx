"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import PageHeader from "@/app/components/PageHeader";
import KpiCard from "@/app/components/KpiCard";
import LineChart from "@/app/components/LineChart";
import AssetSelector from "@/app/components/AssetSelector";

const WINDOWS = [
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "6m", label: "6M" },
  { key: "1y", label: "1Y" },
  { key: "5y", label: "5Y" },
];

// Colors follow the app's standard chart-series order (--chart-1..5 in globals.css)
const WINDOW_COLORS = {
  "1m": "#a78bfa",
  "3m": "#3b82f6",
  "6m": "#10b981",
  "1y": "#f59e0b",
  "5y": "#ef4444",
};

function fmtBeta(v) {
  if (v == null || isNaN(v)) return "—";
  return v.toFixed(2);
}

export default function BetaPage() {
  const [asset, setAsset] = useState({ type: "stock", id: "AAPL", label: "AAPL" });
  const [benchmark, setBenchmark] = useState({ type: "stock", id: "SPY", label: "SPY" });
  const [activeWindows, setActiveWindows] = useState(new Set(["1y", "5y"]));

  const { data: baskets } = useQuery({
    queryKey: ["baskets"],
    queryFn: () => api.get("/api/baskets"),
  });

  const ready = Boolean(asset.id && benchmark.id);

  const { data: beta, isLoading, isError } = useQuery({
    queryKey: ["beta", asset.type, asset.id, benchmark.type, benchmark.id],
    queryFn: () => api.get(
      `/api/beta?asset_type=${asset.type}&asset_id=${encodeURIComponent(asset.id)}` +
      `&benchmark_type=${benchmark.type}&benchmark_id=${encodeURIComponent(benchmark.id)}`
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
        title="Beta"
        subtitle="Rolling beta of any asset against a benchmark — stocks, commodities, ETFs, or Baskets."
      />

      <div style={{ display: "flex", gap: 24, marginBottom: 24, flexWrap: "wrap" }}>
        <AssetSelector label="Asset" baskets={baskets ?? []} selection={asset} onChange={setAsset} />
        <AssetSelector label="Benchmark" baskets={baskets ?? []} selection={benchmark} onChange={setBenchmark} />
      </div>

      {isLoading && (
        <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>Loading…</div>
      )}
      {isError && (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--negative)", padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "var(--negative)" }}>
          Could not load beta data.
        </div>
      )}

      {beta && Object.values(beta.windows).some((w) => w.dates.length > 0) && (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 }}>
            Rolling Beta — {asset.label} vs {benchmark.label}
          </div>
          <div style={{ display: "flex", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
            {WINDOWS.map((w) => (
              <KpiCard
                key={w.key}
                label={w.label}
                formatted={fmtBeta(beta.current[w.key])}
                small
              />
            ))}
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
              dates={beta.windows["1y"].dates}
              datasets={WINDOWS.filter((w) => activeWindows.has(w.key)).map((w) => ({
                dates: beta.windows[w.key].dates,
                data: beta.windows[w.key].values,
                borderColor: WINDOW_COLORS[w.key],
                borderWidth: 1.5,
                label: w.label,
              }))}
              referenceLine={1}
            />
          </div>
        </>
      )}

      {beta && !Object.values(beta.windows).some((w) => w.dates.length > 0) && (
        <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
          Not enough overlapping price history for these two assets.
        </div>
      )}
    </div>
  );
}
