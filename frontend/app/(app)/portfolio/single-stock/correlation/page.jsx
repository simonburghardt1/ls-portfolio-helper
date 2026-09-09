"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import PageHeader from "@/app/components/PageHeader";
import KpiCard from "@/app/components/KpiCard";
import LineChart from "@/app/components/LineChart";
import Button from "@/app/components/Button";

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

const PRICE_RANGES = [
  { key: "1m", label: "1M", days: 30 },
  { key: "3m", label: "3M", days: 90 },
  { key: "6m", label: "6M", days: 180 },
  { key: "1y", label: "1Y", days: 365 },
  { key: "3y", label: "3Y", days: 1095 },
  { key: "5y", label: "5Y", days: 1825 },
  { key: "max", label: "Max", days: null },
];

// Rebases a series to 100 at the first date >= fromDate (fromDate == null → "Max", left
// as-is, already indexed to 100 at the full fetched window's own start by the backend).
// Mirrors the Basket detail page's own rebase() — same "indexed to 100 for the selected
// period" semantics, so a shorter timeframe reads its own relative move, not whatever
// value the 11-year-backtest series happens to be at by that point.
function rebase(dates, values, fromDate) {
  if (!fromDate) return { dates, values };
  const startIdx = dates.findIndex((d) => d >= fromDate);
  if (startIdx === -1) return { dates: [], values: [] };
  const base = values[startIdx];
  if (!base) return { dates: [], values: [] };
  return {
    dates: dates.slice(startIdx),
    values: values.slice(startIdx).map((v) => (v == null ? null : (v / base) * 100)),
  };
}

const SELECT_STYLE = {
  background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
  color: "#e5e7eb", fontSize: 13, padding: "6px 10px", cursor: "pointer", width: 220,
};

// Page-local for now — the architecture spine flags the *shared* Universal Asset
// Selector as still needing its own UX design pass (no dropdown/combobox precedent
// exists yet in this app's design system beyond range-toggles and tabs). This is a
// pragmatic, working selector for this page, not the final cross-page component.
function AssetSelector({ label, baskets, selection, onChange }) {
  const [mode, setMode] = useState(selection.type === "stock" ? "ticker" : "basket");
  const [tickerText, setTickerText] = useState(selection.type === "stock" ? selection.id : "");

  function handleModeChange(newMode) {
    setMode(newMode);
    if (newMode === "ticker") {
      const t = tickerText.trim().toUpperCase();
      onChange({ type: "stock", id: t, label: t || "—" });
    } else if (baskets[0]) {
      const b = baskets[0];
      onChange({ type: b.id === -1 ? "hbm" : "basket", id: b.id, label: b.name });
    }
  }

  function handleTickerChange(e) {
    const t = e.target.value;
    setTickerText(t);
    onChange({ type: "stock", id: t.trim().toUpperCase(), label: t.trim().toUpperCase() || "—" });
  }

  function handleBasketChange(e) {
    const [type, id] = e.target.value.split(":");
    const b = baskets.find((x) => String(x.id) === id);
    onChange({ type, id, label: b?.name ?? id });
  }

  const basketValue = selection.type !== "stock" ? `${selection.type}:${selection.id}` : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </label>
      <div style={{ display: "flex", gap: 4 }}>
        <Button variant="range-toggle" active={mode === "ticker"} onClick={() => handleModeChange("ticker")}>Ticker</Button>
        <Button variant="range-toggle" active={mode === "basket"} onClick={() => handleModeChange("basket")}>Basket</Button>
      </div>
      {mode === "ticker" ? (
        <input
          type="text"
          value={tickerText}
          onChange={handleTickerChange}
          placeholder="e.g. AAPL"
          style={{ ...SELECT_STYLE, cursor: "text" }}
        />
      ) : (
        <select value={basketValue} onChange={handleBasketChange} style={SELECT_STYLE}>
          {baskets.map((b) => (
            <option key={b.id} value={`${b.id === -1 ? "hbm" : "basket"}:${b.id}`}>{b.name}</option>
          ))}
        </select>
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
  const [priceRange, setPriceRange] = useState("1y");
  const [spreadMode, setSpreadMode] = useState(false);
  const [spreadType, setSpreadType] = useState("ratio"); // "ratio" | "diff"

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

  const priceStart = useMemo(() => {
    const sel = PRICE_RANGES.find((r) => r.key === priceRange);
    if (!sel?.days || !corr?.dates?.length) return null; // "Max" (days: null) → no rebase
    const to = new Date(corr.dates[corr.dates.length - 1]);
    to.setDate(to.getDate() - sel.days);
    return to.toISOString().slice(0, 10);
  }, [priceRange, corr]);

  // Rebase both series to 100 at the selected period's own start (not the full 11-year
  // fetch window's start) — so a shorter timeframe shows its own relative move.
  const rebasedA = useMemo(() => (corr ? rebase(corr.dates, corr.prices.a, priceStart) : { dates: [], values: [] }), [corr, priceStart]);
  const rebasedB = useMemo(() => (corr ? rebase(corr.dates, corr.prices.b, priceStart) : { dates: [], values: [] }), [corr, priceStart]);

  const priceDatasets = useMemo(() => {
    const { dates } = rebasedA;
    const a = rebasedA.values, b = rebasedB.values;
    if (!spreadMode) {
      return [
        { dates, data: a, borderColor: "#3b82f6", borderWidth: 2, label: assetA.label },
        { dates, data: b, borderColor: "#f59e0b", borderWidth: 2, label: assetB.label },
      ];
    }
    if (spreadType === "ratio") {
      return [{
        dates,
        data: a.map((v, i) => (v == null || b[i] == null ? null : (v / b[i]) * 100)),
        borderColor: "#3b82f6", borderWidth: 2, label: `${assetA.label}/${assetB.label}`,
      }];
    }
    return [{
      dates,
      data: a.map((v, i) => (v == null || b[i] == null ? null : v - b[i])),
      borderColor: "#f59e0b", borderWidth: 2, label: `${assetA.label}-${assetB.label}`,
    }];
  }, [rebasedA, rebasedB, spreadMode, spreadType, assetA.label, assetB.label]);

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
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 }}>
            Rolling Correlation — {assetA.label} vs {assetB.label}
          </div>
          <div style={{ display: "flex", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
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

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
              {spreadMode ? `Spread — ${assetA.label} vs ${assetB.label}` : `Price Comparison — ${assetA.label} vs ${assetB.label}`}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {PRICE_RANGES.map((r) => (
                <Button key={r.key} variant="range-toggle" active={priceRange === r.key} onClick={() => setPriceRange(r.key)}>
                  {r.label}
                </Button>
              ))}
              <div style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
              <Button variant="range-toggle" active={spreadMode} onClick={() => setSpreadMode((v) => !v)}>Spread</Button>
              {spreadMode && (
                <>
                  <Button variant="range-toggle" active={spreadType === "ratio"} onClick={() => setSpreadType("ratio")}>Ratio</Button>
                  <Button variant="range-toggle" active={spreadType === "diff"} onClick={() => setSpreadType("diff")}>Diff</Button>
                </>
              )}
            </div>
          </div>
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", padding: "16px 8px 8px" }}>
            {rebasedA.dates.length > 0 ? (
              <LineChart
                dates={rebasedA.dates}
                datasets={priceDatasets}
                referenceLine={spreadMode && spreadType === "diff" ? 0 : 100}
              />
            ) : (
              <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
                Not enough price history for this timeframe.
              </div>
            )}
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
