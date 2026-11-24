"use client";

import { useEffect, useState } from "react";
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

export default function BuildingPermitsPage() {
  const [series, setSeries]   = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [range, setRange]     = useState("20Y");
  const [active, setActive]   = useState(null); // null = all series shown

  useEffect(() => {
    authFetch(`${API}/api/building-permits/series`)
      .then((r) => r.json())
      .then((d) => { setSeries(d.series ?? {}); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  const keys = Object.keys(series);
  const shown = active ?? new Set(keys);
  const datasets = keys.filter((k) => shown.has(k)).map((k) => ({
    dates: series[k].dates, data: series[k].values, borderColor: series[k].color, borderWidth: 2, label: series[k].label,
  }));

  return (
    <Page>
      <PageHeader
        title="US Building Permits"
        subtitle="US Census Bureau. Thousands of units, seasonally adjusted annual rate."
      />

      {loading && <StateMessage kind="loading" />}
      {error && <StateMessage kind="error">{error}</StateMessage>}
      {!loading && !error && keys.length === 0 && <StateMessage>No data available.</StateMessage>}

      {keys.length > 0 && (
        <Panel
          titleExtra={<SeriesLegend {...latestLegend(keys.map((k) => [k, series[k]]), { dp: 0, unit: "K" })} active={shown} onToggle={(k) => setActive(toggleKeepOne(shown, k))} />}
          actions={MACRO_RANGES.map((r) => (
            <Button key={r.label} variant="range-toggle" active={range === r.label} onClick={() => setRange(r.label)}>{r.label}</Button>
          ))}
        >
          <LineChart dates={null} datasets={datasets} visibleRange={rangeFrom(MACRO_RANGES.find((r) => r.label === range)?.years)} />
        </Panel>
      )}
    </Page>
  );
}
