"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import { fmtPct, fmtNum, signColor } from "@/app/lib/format";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import KpiCard from "@/app/components/KpiCard";
import Button from "@/app/components/Button";
import Tabs from "@/app/components/Tabs";
import InfoTip from "@/app/components/InfoTip";
import LineChart from "@/app/components/LineChart";
import Histogram from "@/app/components/Histogram";
import AssetSelector from "@/app/components/AssetSelector";
import StateMessage from "@/app/components/StateMessage";
import DataTable from "@/app/components/DataTable";

// One shared timeframe drives both ATR and the distribution of weekly returns
const PERIODS = [
  { key: "1y", label: "1Y", days: 365 },
  { key: "3y", label: "3Y", days: 1095 },
  { key: "5y", label: "5Y", days: 1825 },
  { key: "max", label: "Max", days: null },
];

const STAT_TABS = [
  { key: "summary", label: "Summary" },
  { key: "normal", label: "vs Normal" },
  { key: "updown", label: "Up / Down" },
  { key: "percentiles", label: "Percentiles" },
];

const pct = (v, dp = 2) => fmtPct(v, dp, { sign: false });

export default function VolatilityPage() {
  const [asset, setAsset] = useState({ type: "stock", id: "AAPL", label: "AAPL" });
  const [period, setPeriod] = useState("1y");
  const [selectedBin, setSelectedBin] = useState(null);
  const [statTab, setStatTab] = useState("summary");

  // A bin selection means nothing once the asset/period changes — reset during render
  const selectionKey = `${asset.type}:${asset.id}:${period}`;
  const [prevSelectionKey, setPrevSelectionKey] = useState(selectionKey);
  if (selectionKey !== prevSelectionKey) {
    setPrevSelectionKey(selectionKey);
    setSelectedBin(null);
  }

  const { data: baskets } = useQuery({ queryKey: ["baskets"], queryFn: () => api.get("/api/baskets") });
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

  const atrSliced = useMemo(() => {
    if (!atr?.dates?.length) return { dates: [], values: [] };
    const sel = PERIODS.find((r) => r.key === period);
    let startIdx = 0;
    if (sel?.days) {
      const from = new Date(atr.dates[atr.dates.length - 1]);
      from.setDate(from.getDate() - sel.days);
      startIdx = atr.dates.findIndex((d) => d >= from.toISOString().slice(0, 10));
    }
    if (startIdx === -1) return { dates: [], values: [] };
    return {
      dates: atr.dates.slice(startIdx),
      values: atr.values.slice(startIdx).map((v) => (v == null ? null : v * 100)),
    };
  }, [atr, period]);

  const priceMarkers = useMemo(() => {
    if (selectedBin == null || !dor?.bins?.[selectedBin]) return [];
    return dor.bins[selectedBin].dates.map((d) => ({ time: d, position: "inBar", color: "#f59e0b", shape: "circle" }));
  }, [selectedBin, dor]);

  const hasDor = dor && dor.bins?.length > 0;
  const up = dor?.breakdown?.positive;

  return (
    <Page>
      <PageHeader title="Volatility" subtitle="Average true range and weekly return distribution of an asset." actions={<AssetSelector label="Asset" baskets={baskets ?? []} selection={asset} onChange={setAsset} />} />

      <div style={{ display: "flex", gap: 4, marginBottom: "var(--space-5)" }}>
        {PERIODS.map((p) => (
          <Button key={p.key} variant="range-toggle" active={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</Button>
        ))}
      </div>

      {(atrLoading || dorLoading) && !atr && !dor && <StateMessage kind="loading" />}
      {atrError && <StateMessage kind="error">Could not load ATR data.</StateMessage>}
      {dorError && <StateMessage kind="error">Could not load the return distribution.</StateMessage>}

      {(atr || hasDor) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-3)", marginBottom: "var(--space-5)" }}>
          <KpiCard label="ATR (14W)" formatted={pct(atr?.current)} caption="of price" />
          <KpiCard label="Weekly σ" formatted={pct(dor?.stats?.stdev)} caption={dor?.stats?.count ? `${dor.stats.count} weeks` : undefined} />
          <KpiCard label="Up weeks" formatted={pct(up?.freq_pct, 0)} caption={up && dor?.stats?.count ? `${up.count} of ${dor.stats.count}` : undefined} />
          <KpiCard
            label="Worst / best week"
            formatted={`${fmtPct(dor?.stats?.min, 1)} / ${fmtPct(dor?.stats?.max, 1)}`}
          />
        </div>
      )}

      {atr && (
        <Panel title="Average true range (14W), % of price">
          {atrSliced.dates.length > 0 ? (
            <LineChart dates={atrSliced.dates} datasets={[{ dates: atrSliced.dates, data: atrSliced.values, borderColor: "#3b82f6", borderWidth: 1.5, label: "ATR %" }]} height={300} />
          ) : (
            <StateMessage>{atr.dates.length ? "Not enough price history for this timeframe." : "Not enough OHLC history to compute ATR for this asset."}</StateMessage>
          )}
        </Panel>
      )}

      {hasDor && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))", gap: "var(--space-5)" }}>
            <Panel style={{ minWidth: 0 }} title="Weekly returns" titleExtra={<InfoTip text="Click a bar to mark the weeks with that return in the price chart." />}>
              <Histogram bins={dor.bins} selectedIndex={selectedBin} onSelect={setSelectedBin} />
            </Panel>
            <Panel
              style={{ minWidth: 0 }}
              title="Price"
              titleExtra={selectedBin != null && (
                <span style={{ fontSize: 12, color: "var(--caution)" }}>{dor.bins[selectedBin].count} weeks marked</span>
              )}
            >
              {dor.prices?.dates?.length > 0 ? (
                <LineChart
                  dates={dor.prices.dates}
                  datasets={[{ dates: dor.prices.dates, data: dor.prices.values, borderColor: "#3b82f6", borderWidth: 1.5, label: asset.label }]}
                  markers={priceMarkers}
                  height={270}
                />
              ) : (
                <StateMessage>Not enough price history for this timeframe.</StateMessage>
              )}
            </Panel>
          </div>

          <Panel title="Statistics">
            <Tabs tabs={STAT_TABS} active={statTab} onChange={setStatTab} />
            {statTab === "summary" && <SummaryStats stats={dor.stats} />}
            {statTab === "normal" && (
              <DataTable
                autoWidth
                rowKey="sigma"
                rows={dor.normal_check}
                columns={[
                  { key: "sigma", label: "σ", format: (v) => `${v}σ` },
                  { key: "lower", label: "Lower", numeric: true, format: (v) => pct(v) },
                  { key: "upper", label: "Upper", numeric: true, format: (v) => pct(v) },
                  { key: "actual_pct", label: "Actual", numeric: true, format: (v) => pct(v) },
                  { key: "normal_pct", label: "Normal", numeric: true, format: (v) => pct(v) },
                ]}
              />
            )}
            {statTab === "updown" && (
              <DataTable
                autoWidth
                rowKey="label"
                rows={[["Up", dor.breakdown.positive], ["Down", dor.breakdown.negative], ["Flat", dor.breakdown.zero]].map(([label, g]) => ({ label, ...g }))}
                columns={[
                  { key: "label", label: "" },
                  { key: "avg", label: "Avg return", numeric: true, format: (v) => pct(v) },
                  { key: "count", label: "Weeks", numeric: true },
                  { key: "freq_pct", label: "Share", numeric: true, format: (v) => pct(v) },
                  { key: "freq_adjusted", label: "Weighted", numeric: true, format: (v) => pct(v) },
                ]}
              />
            )}
            {statTab === "percentiles" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: "var(--space-2) var(--space-5)" }}>
                {dor.percentiles.map((r) => (
                  <StatCell key={r.p} label={`P${r.p}`} value={pct(r.value)} color={signColor(r.value)} />
                ))}
              </div>
            )}
          </Panel>
        </>
      )}

      {dor && dor.bins?.length === 0 && !dorLoading && <StateMessage>Not enough weekly return history for this asset and timeframe.</StateMessage>}
    </Page>
  );
}

function SummaryStats({ stats: s }) {
  const items = [
    ["Mean", pct(s.mean)], ["Median", pct(s.median)], ["Std dev", pct(s.stdev)], ["Std error", pct(s.std_error)],
    ["Skewness", fmtNum(s.skewness)], ["Kurtosis", fmtNum(s.kurtosis)], ["Min", pct(s.min)], ["Max", pct(s.max)],
    ["Range", pct(s.range)], ["Sum", pct(s.sum)], ["Variance", fmtNum(s.variance, 5)], ["Weeks", s.count ?? "—"],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "var(--space-3) var(--space-5)" }}>
      {items.map(([label, value]) => <StatCell key={label} label={label} value={value} />)}
    </div>
  );
}

function StatCell({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-family-mono)", fontVariantNumeric: "tabular-nums", color: color ?? "var(--text-primary)" }}>{value}</span>
    </div>
  );
}
