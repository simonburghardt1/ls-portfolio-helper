"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import { fmtNum } from "@/app/lib/format";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import AssetSelector from "@/app/components/AssetSelector";
import RollingWindows from "@/app/components/RollingWindows";
import StateMessage from "@/app/components/StateMessage";

export default function BetaPage() {
  const [asset, setAsset] = useState({ type: "stock", id: "AAPL", label: "AAPL" });
  const [benchmark, setBenchmark] = useState({ type: "stock", id: "SPY", label: "SPY" });

  const { data: baskets } = useQuery({ queryKey: ["baskets"], queryFn: () => api.get("/api/baskets") });

  const { data: beta, isLoading, isError } = useQuery({
    queryKey: ["beta", asset.type, asset.id, benchmark.type, benchmark.id],
    queryFn: () => api.get(
      `/api/beta?asset_type=${asset.type}&asset_id=${encodeURIComponent(asset.id)}` +
      `&benchmark_type=${benchmark.type}&benchmark_id=${encodeURIComponent(benchmark.id)}`
    ),
    enabled: Boolean(asset.id && benchmark.id),
  });

  const hasData = beta && Object.values(beta.windows).some((w) => w.dates.length > 0);

  return (
    <Page>
      <PageHeader
        title="Beta"
        subtitle="Rolling beta of an asset against a benchmark."
        actions={
          <>
            <AssetSelector label="Asset" baskets={baskets ?? []} selection={asset} onChange={setAsset} />
            <AssetSelector label="Benchmark" baskets={baskets ?? []} selection={benchmark} onChange={setBenchmark} />
          </>
        }
      />

      {isLoading && <StateMessage kind="loading" />}
      {isError && <StateMessage kind="error">Could not load beta data.</StateMessage>}
      {beta && !hasData && <StateMessage>Not enough overlapping price history for these two assets.</StateMessage>}

      {hasData && (
        <RollingWindows
          key={`${asset.id}:${benchmark.id}`}
          title={`Rolling beta, ${asset.label} vs ${benchmark.label}`}
          current={beta.current}
          series={(k) => ({ dates: beta.windows[k].dates, data: beta.windows[k].values })}
          format={(v) => fmtNum(v)}
          referenceLine={1}
          defaultActive={["1y", "5y"]}
        />
      )}
    </Page>
  );
}
