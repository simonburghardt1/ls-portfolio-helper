"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import PageHeader from "@/app/components/PageHeader";
import KpiCard from "@/app/components/KpiCard";
import LineChart from "@/app/components/LineChart";
import Button from "@/app/components/Button";
import AssetSelector from "@/app/components/AssetSelector";
import Histogram from "@/app/components/Histogram";

// One shared timeframe drives both ATR and Distribution of Returns — both are computed
// from weekly data now, so a single set of windows applies cleanly to each.
const PERIODS = [
  { key: "1y", label: "1Y", days: 365 },
  { key: "3y", label: "3Y", days: 1095 },
  { key: "5y", label: "5Y", days: 1825 },
  { key: "max", label: "Max", days: null },
];

function fmtPct(v, dp = 2) {
  if (v == null || isNaN(v)) return "—";
  return `${(v * 100).toFixed(dp)}%`;
}

function fmtNum(v, dp = 2) {
  if (v == null || isNaN(v)) return "—";
  return v.toFixed(dp);
}

const cellBase = { padding: "6px 10px", textAlign: "right", fontSize: 12, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const rowLabel = { padding: "6px 10px", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", whiteSpace: "nowrap", textAlign: "left" };
const thStyle = { padding: "6px 10px", fontSize: 10.5, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "right", borderBottom: "1px solid var(--border)" };
const thRowLabel = { ...thStyle, textAlign: "left" };
const sectionTitle = { fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 };
const panel = { background: "var(--bg-surface)", border: "1px solid var(--border)", padding: 16, marginBottom: 20 };

export default function VolatilityPage() {
  const [asset, setAsset] = useState({ type: "stock", id: "AAPL", label: "AAPL" });
  const [period, setPeriod] = useState("1y");
  const [selectedBin, setSelectedBin] = useState(null);

  // A previous bin selection no longer means anything once the asset/period changes —
  // reset during render (React's recommended pattern for state that should track a
  // prop/derived-value change) rather than in an effect, to avoid an extra render pass.
  const selectionKey = `${asset.type}:${asset.id}:${period}`;
  const [prevSelectionKey, setPrevSelectionKey] = useState(selectionKey);
  if (selectionKey !== prevSelectionKey) {
    setPrevSelectionKey(selectionKey);
    setSelectedBin(null);
  }

  const { data: baskets } = useQuery({
    queryKey: ["baskets"],
    queryFn: () => api.get("/api/baskets"),
  });

  const ready = Boolean(asset.id);

  const { data: atr, isLoading: atrLoading, isError: atrError } = useQuery({
    queryKey: ["volatility-atr", asset.type, asset.id],
    queryFn: () => api.get(`/api/volatility/atr?asset_type=${asset.type}&asset_id=${encodeURIComponent(asset.id)}`),
    enabled: ready,
  });

  const { data: dor, isLoading: dorLoading, isError: dorError } = useQuery({
    queryKey: ["volatility-distribution", asset.type, asset.id, period],
    queryFn: () => api.get(`/api/volatility/distribution?asset_type=${asset.type}&asset_id=${encodeURIComponent(asset.id)}&window=${period}`),
    enabled: ready,
  });

  const atrStart = useMemo(() => {
    const sel = PERIODS.find((r) => r.key === period);
    if (!atr?.dates?.length || !sel?.days) return null; // "Max"
    const to = new Date(atr.dates[atr.dates.length - 1]);
    to.setDate(to.getDate() - sel.days);
    return to.toISOString().slice(0, 10);
  }, [period, atr]);

  const atrSliced = useMemo(() => {
    if (!atr?.dates?.length) return { dates: [], values: [] };
    const startIdx = atrStart ? atr.dates.findIndex((d) => d >= atrStart) : 0;
    if (startIdx === -1) return { dates: [], values: [] };
    return {
      dates: atr.dates.slice(startIdx),
      values: atr.values.slice(startIdx).map((v) => (v == null ? null : v * 100)), // decimal -> percent, matches correlation/beta's axis convention
    };
  }, [atr, atrStart]);

  const priceMarkers = useMemo(() => {
    if (selectedBin == null || !dor?.bins?.[selectedBin]) return [];
    return dor.bins[selectedBin].dates.map((d) => ({ time: d, position: "inBar", color: "#f59e0b", shape: "circle" }));
  }, [selectedBin, dor]);

  return (
    <div style={{ padding: "28px 32px", minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <PageHeader
        title="Volatility"
        subtitle="Average True Range and Distribution of Returns for any asset — stocks, commodities, ETFs, or Baskets."
      />

      <div style={{ display: "flex", gap: 24, marginBottom: 16, flexWrap: "wrap" }}>
        <AssetSelector label="Asset" baskets={baskets ?? []} selection={asset} onChange={setAsset} />
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
        {PERIODS.map((p) => (
          <Button key={p.key} variant="range-toggle" active={period === p.key} onClick={() => setPeriod(p.key)}>
            {p.label}
          </Button>
        ))}
      </div>

      {atrLoading && (
        <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>Loading…</div>
      )}
      {atrError && (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--negative)", padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "var(--negative)" }}>
          Could not load ATR data.
        </div>
      )}

      {atr && atr.dates.length > 0 && (
        <>
          <div style={sectionTitle}>Average True Range (14W) — {asset.label}</div>
          <div style={{ marginBottom: 16 }}>
            <KpiCard label="Current ATR" formatted={fmtPct(atr.current)} small />
          </div>
          <div style={panel}>
            {atrSliced.dates.length > 0 ? (
              <LineChart
                dates={atrSliced.dates}
                datasets={[{ dates: atrSliced.dates, data: atrSliced.values, borderColor: "#3b82f6", borderWidth: 1.5, label: "ATR %" }]}
              />
            ) : (
              <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
                Not enough price history for this timeframe.
              </div>
            )}
          </div>
        </>
      )}

      {atr && atr.dates.length === 0 && (
        <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center", marginBottom: 20 }}>
          Not enough OHLC history to compute ATR for this asset.
        </div>
      )}

      {dorError && (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--negative)", padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "var(--negative)" }}>
          Could not load Distribution of Returns data.
        </div>
      )}

      {dor && dor.bins?.length > 0 && (
        <>
          <div style={sectionTitle}>Distribution of Returns (Weekly) — {asset.label}</div>

          <div style={panel}>
            <Histogram bins={dor.bins} selectedIndex={selectedBin} onSelect={setSelectedBin} />
          </div>

          <div style={panel}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
              <div style={{ ...sectionTitle, marginBottom: 0 }}>Price History — {asset.label}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
                {selectedBin == null ? "Click a bar above to highlight matching weeks" : `${dor.bins[selectedBin].count} matching weeks highlighted`}
              </div>
            </div>
            {dor.prices?.dates?.length > 0 ? (
              <LineChart
                dates={dor.prices.dates}
                datasets={[{ dates: dor.prices.dates, data: dor.prices.values, borderColor: "#3b82f6", borderWidth: 1.5, label: asset.label }]}
                markers={priceMarkers}
              />
            ) : (
              <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
                Not enough price history for this timeframe.
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 20 }}>
            <div style={{ ...panel, flex: "1 1 320px", margin: 0 }}>
              <div style={sectionTitle}>Descriptive Statistics</div>
              <StatRow label="Mean" value={fmtPct(dor.stats.mean)} />
              <StatRow label="Standard Error" value={fmtPct(dor.stats.std_error)} />
              <StatRow label="Median" value={fmtPct(dor.stats.median)} />
              <StatRow label="Mode" value={dor.stats.mode == null ? "—" : fmtPct(dor.stats.mode)} />
              <StatRow label="Standard Deviation" value={fmtPct(dor.stats.stdev)} />
              <StatRow label="Sample Variance" value={fmtNum(dor.stats.variance, 5)} />
              <StatRow label="Kurtosis" value={fmtNum(dor.stats.kurtosis)} />
              <StatRow label="Skewness" value={fmtNum(dor.stats.skewness)} />
              <StatRow label="Range" value={fmtPct(dor.stats.range)} />
              <StatRow label="Minimum" value={fmtPct(dor.stats.min)} />
              <StatRow label="Maximum" value={fmtPct(dor.stats.max)} />
              <StatRow label="Sum" value={fmtPct(dor.stats.sum)} />
              <StatRow label="Count" value={dor.stats.count ?? "—"} last />
            </div>

            <div style={{ ...panel, flex: "1 1 380px", margin: 0 }}>
              <div style={sectionTitle}>vs. Normal Distribution</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thRowLabel}>σ</th>
                    <th style={thStyle}>Lower</th>
                    <th style={thStyle}>Upper</th>
                    <th style={thStyle}>Actual %</th>
                    <th style={thStyle}>Normal %</th>
                  </tr>
                </thead>
                <tbody>
                  {dor.normal_check.map((row) => (
                    <tr key={row.sigma}>
                      <td style={rowLabel}>{row.sigma}σ</td>
                      <td style={cellBase}>{fmtPct(row.lower)}</td>
                      <td style={cellBase}>{fmtPct(row.upper)}</td>
                      <td style={cellBase}>{fmtPct(row.actual_pct)}</td>
                      <td style={cellBase}>{fmtPct(row.normal_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 20 }}>
            <div style={{ ...panel, flex: "1 1 320px", margin: 0 }}>
              <div style={sectionTitle}>Positive / Negative / Zero Breakdown</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thRowLabel}></th>
                    <th style={thStyle}>Avg Return</th>
                    <th style={thStyle}>Count</th>
                    <th style={thStyle}>Freq %</th>
                    <th style={thStyle}>Freq-Adj. Return</th>
                  </tr>
                </thead>
                <tbody>
                  {[["Positive", dor.breakdown.positive], ["Negative", dor.breakdown.negative], ["Zero", dor.breakdown.zero]].map(([label, g]) => (
                    <tr key={label}>
                      <td style={rowLabel}>{label}</td>
                      <td style={cellBase}>{fmtPct(g?.avg)}</td>
                      <td style={cellBase}>{g?.count ?? "—"}</td>
                      <td style={cellBase}>{fmtPct(g?.freq_pct)}</td>
                      <td style={cellBase}>{fmtPct(g?.freq_adjusted)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ ...panel, flex: "1 1 240px", margin: 0, maxHeight: 320, overflowY: "auto" }}>
              <div style={sectionTitle}>Percentiles</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thRowLabel}>Percentile</th>
                    <th style={thStyle}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {dor.percentiles.map((row) => (
                    <tr key={row.p}>
                      <td style={rowLabel}>{row.p}%</td>
                      <td style={cellBase}>{fmtPct(row.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {dor && dor.bins?.length === 0 && !dorLoading && (
        <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
          Not enough weekly return history for this asset/timeframe.
        </div>
      )}
    </div>
  );
}

function StatRow({ label, value, last }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: last ? "none" : "1px solid var(--border)", fontSize: 12.5 }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{value}</span>
    </div>
  );
}
