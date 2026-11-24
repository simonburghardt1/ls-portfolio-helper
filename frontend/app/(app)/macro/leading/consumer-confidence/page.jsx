"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import LineChart from "@/app/components/LineChart";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import Button from "@/app/components/Button";
import StateMessage from "@/app/components/StateMessage";
import SeriesLegend from "@/app/components/SeriesLegend";
import { toggleKeepOne } from "@/app/components/SeriesCards";
import { authFetch } from "@/app/lib/api";
import { MACRO_RANGES, rangeFrom, latestLegend } from "@/app/lib/macro";

const API = "http://localhost:8000";

/** Linear regression trend line dataset for a single series. */
function trendLine(dates, values, color) {
  if (!dates || dates.length < 10) return null;

  const n = dates.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX  += i;
    sumY  += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;

  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  return {
    dates:            [dates[0], dates[n - 1]],
    data:             [intercept, intercept + slope * (n - 1)],
    borderColor:      color,
    borderWidth:      1,
    lineStyle:        2,    // dashed
    lastValueVisible: false,
    label:            "",
  };
}

export default function ConsumerConfidencePage() {
  const [series, setSeries]   = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [range, setRange]     = useState("20Y");
  const [active, setActive]   = useState(null); // null = all series shown

  useEffect(() => {
    authFetch(`${API}/api/consumer-confidence/series`)
      .then((r) => r.json())
      .then((d) => { setSeries(d.series ?? {}); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  const keys = Object.keys(series);
  const shown = active ?? new Set(keys);
  const visible = keys.filter((k) => shown.has(k)).map((k) => series[k]);
  const datasets = [
    ...visible.map((s) => ({ dates: s.dates, data: s.values, borderColor: s.color, borderWidth: 2, label: s.label })),
    ...visible.map((s) => trendLine(s.dates, s.values, s.color)).filter(Boolean),
  ];

  return (
    <Page>
      <PageHeader
        title="Consumer Confidence"
        subtitle="University of Michigan Survey of Consumers. Index 1966:Q1 = 100."
      />

      {loading && <StateMessage kind="loading" />}
      {error && <StateMessage kind="error">{error}</StateMessage>}
      {!loading && !error && keys.length === 0 && (
        <StateMessage>
          No data available. Current Conditions and Expectations can be imported under{" "}
          <Link href="/admin/consumer-confidence" style={{ color: "var(--text-primary)" }}>Admin → Consumer Confidence</Link>.
        </StateMessage>
      )}

      {keys.length > 0 && (
        <Panel
          titleExtra={<SeriesLegend {...latestLegend(keys.map((k) => [k, series[k]]), { dp: 1 })} active={shown} onToggle={(k) => setActive(toggleKeepOne(shown, k))} />}
          actions={MACRO_RANGES.map((r) => (
            <Button key={r.label} variant="range-toggle" active={range === r.label} onClick={() => setRange(r.label)}>{r.label}</Button>
          ))}
        >
          <LineChart dates={null} datasets={datasets} visibleRange={rangeFrom(MACRO_RANGES.find((r) => r.label === range)?.years)} referenceLine={85} />
        </Panel>
      )}
    </Page>
  );
}
