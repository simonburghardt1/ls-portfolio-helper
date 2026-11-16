"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import { fmtPct, signColor } from "@/app/lib/format";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import Button from "@/app/components/Button";
import LineChart from "@/app/components/LineChart";
import AssetSelector from "@/app/components/AssetSelector";
import RollingWindows from "@/app/components/RollingWindows";
import StateMessage from "@/app/components/StateMessage";

const PRICE_RANGES = [
  { key: "1m", label: "1M", days: 30 },
  { key: "3m", label: "3M", days: 90 },
  { key: "ytd", label: "YTD", ytd: true },
  { key: "1y", label: "1Y", days: 365 },
  { key: "3y", label: "3Y", days: 1095 },
  { key: "5y", label: "5Y", days: 1825 },
  { key: "max", label: "Max", days: null },
];

const PRICE_MODES = [
  { key: "prices", label: "Prices" },
  { key: "ratio", label: "Ratio" },
  { key: "diff", label: "Diff" },
];

// Rebases a series to 100 at the first date >= fromDate (fromDate == null → "Max", already
// indexed to 100 at the fetched window's start by the backend) — same semantics as the
// Basket detail page's rebase(), so a shorter timeframe reads its own relative move.
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

// Correlation is unitless (-1..1), shown as "%" like the GDP ↔ Market correlation tab
const fmtCorr = (v) => fmtPct(v, 1, { sign: false });

export default function CorrelationPage() {
  const [assetA, setAssetA] = useState({ type: "stock", id: "AAPL", label: "AAPL" });
  const [assetB, setAssetB] = useState({ type: "stock", id: "MSFT", label: "MSFT" });
  const [priceRange, setPriceRange] = useState("1y");
  const [priceMode, setPriceMode] = useState("prices");

  const { data: baskets } = useQuery({ queryKey: ["baskets"], queryFn: () => api.get("/api/baskets") });

  const { data: corr, isLoading, isError } = useQuery({
    queryKey: ["correlation", assetA.type, assetA.id, assetB.type, assetB.id],
    queryFn: () => api.get(
      `/api/correlation?type_a=${assetA.type}&id_a=${encodeURIComponent(assetA.id)}` +
      `&type_b=${assetB.type}&id_b=${encodeURIComponent(assetB.id)}`
    ),
    enabled: Boolean(assetA.id && assetB.id),
  });

  const priceStart = useMemo(() => {
    const sel = PRICE_RANGES.find((r) => r.key === priceRange);
    if (!corr?.dates?.length) return null;
    const to = new Date(corr.dates[corr.dates.length - 1]);
    if (sel?.ytd) return `${to.getFullYear()}-01-01`;
    if (!sel?.days) return null; // Max
    to.setDate(to.getDate() - sel.days);
    return to.toISOString().slice(0, 10);
  }, [priceRange, corr]);

  const rebasedA = useMemo(() => (corr ? rebase(corr.dates, corr.prices.a, priceStart) : { dates: [], values: [] }), [corr, priceStart]);
  const rebasedB = useMemo(() => (corr ? rebase(corr.dates, corr.prices.b, priceStart) : { dates: [], values: [] }), [corr, priceStart]);

  const priceDatasets = useMemo(() => {
    const { dates } = rebasedA;
    const a = rebasedA.values, b = rebasedB.values;
    if (priceMode === "prices") {
      return [
        { dates, data: a, borderColor: "#3b82f6", borderWidth: 2, label: assetA.label },
        { dates, data: b, borderColor: "#f59e0b", borderWidth: 2, label: assetB.label },
      ];
    }
    if (priceMode === "ratio") {
      return [{ dates, data: a.map((v, i) => (v == null || b[i] == null ? null : (v / b[i]) * 100)), borderColor: "#3b82f6", borderWidth: 2, label: `${assetA.label}/${assetB.label}` }];
    }
    return [{ dates, data: a.map((v, i) => (v == null || b[i] == null ? null : v - b[i])), borderColor: "#f59e0b", borderWidth: 2, label: `${assetA.label}-${assetB.label}` }];
  }, [rebasedA, rebasedB, priceMode, assetA.label, assetB.label]);

  return (
    <Page>
      <PageHeader
        title="Correlation"
        subtitle="Rolling correlation between two assets."
        actions={
          <>
            <AssetSelector label="Asset A" baskets={baskets ?? []} selection={assetA} onChange={setAssetA} />
            <AssetSelector label="Asset B" baskets={baskets ?? []} selection={assetB} onChange={setAssetB} />
          </>
        }
      />

      {isLoading && <StateMessage kind="loading" />}
      {isError && <StateMessage kind="error">Could not load correlation data.</StateMessage>}
      {corr && corr.dates.length === 0 && <StateMessage>Not enough overlapping price history for these two assets.</StateMessage>}

      {corr && corr.dates.length > 0 && (
        <>
          <RollingWindows
            key={`${assetA.id}:${assetB.id}`}
            title={`Rolling correlation, ${assetA.label} vs ${assetB.label}`}
            current={corr.current}
            series={(k) => ({ dates: corr.dates, data: corr.windows[k].map((v) => (v == null ? null : v * 100)) })}
            format={fmtCorr}
            valueColor={signColor}
            referenceLine={0}
            defaultActive={["3m", "1y"]}
          />

          <Panel
            title={priceMode === "prices" ? "Price, indexed to 100" : priceMode === "ratio" ? `Ratio ${assetA.label}/${assetB.label}` : `Difference ${assetA.label} − ${assetB.label}`}
            actions={
              <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                {PRICE_MODES.map((m) => (
                  <Button key={m.key} variant="range-toggle" active={priceMode === m.key} onClick={() => setPriceMode(m.key)}>{m.label}</Button>
                ))}
                <span style={{ width: 1, height: 20, background: "var(--border)", margin: "0 6px" }} />
                {PRICE_RANGES.map((r) => (
                  <Button key={r.key} variant="range-toggle" active={priceRange === r.key} onClick={() => setPriceRange(r.key)}>{r.label}</Button>
                ))}
              </div>
            }
          >
            {rebasedA.dates.length > 0 ? (
              <LineChart dates={rebasedA.dates} datasets={priceDatasets} referenceLine={priceMode === "diff" ? 0 : 100} height={340} />
            ) : (
              <StateMessage>Not enough price history for this timeframe.</StateMessage>
            )}
          </Panel>
        </>
      )}
    </Page>
  );
}
