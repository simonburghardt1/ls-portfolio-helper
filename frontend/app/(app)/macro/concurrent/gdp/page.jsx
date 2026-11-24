"use client";

import { useEffect, useState } from "react";
import LineChart from "@/app/components/LineChart";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import Tabs from "@/app/components/Tabs";
import Select from "@/app/components/Select";
import SignBars from "@/app/components/SignBars";
import InfoTip from "@/app/components/InfoTip";
import StateMessage from "@/app/components/StateMessage";
import SeriesLegend from "@/app/components/SeriesLegend";
import { toggleKeepOne } from "@/app/components/SeriesCards";
import { authFetch } from "@/app/lib/api";
import { fmtPct, signColor } from "@/app/lib/format";

const API = "http://localhost:8000";

const REGIONS = [
  { value: "US", label: "United States" },
  { value: "UK", label: "United Kingdom" },
  { value: "EU", label: "EU Region" },
  { value: "DE", label: "Germany" },
  { value: "JP", label: "Japan" },
  { value: "CN", label: "China (coming soon)", disabled: true },
];

const LAGS = {
  lag0: { label: "No Lag", color: "var(--chart-1)" },
  lag1: { label: "1Q Lag", color: "var(--chart-2)" },
  lag2: { label: "2Q Lag", color: "var(--chart-3)" },
  lag3: { label: "3Q Lag", color: "var(--chart-10)" },
  lag4: { label: "4Q Lag", color: "var(--chart-5)" },
};

function mean(values) {
  const valid = values.filter((v) => v != null && !isNaN(v));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

export default function GdpPage() {
  const [region, setRegion] = useState("US");
  const [tab, setTab] = useState("gdp");
  const [activeLags, setActiveLags] = useState(new Set(Object.keys(LAGS)));

  const [series, setSeries] = useState(null);
  const [unit, setUnit] = useState("");
  const [correlation, setCorrelation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function changeRegion(r) {
    setRegion(r);
    setLoading(true);
    setError(null);
    setSeries(null);
    setUnit("");
    setCorrelation(null);
  }

  useEffect(() => {
    Promise.all([
      authFetch(`${API}/api/gdp/series?region=${region}`).then((r) => r.json()),
      authFetch(`${API}/api/gdp/market-correlation?region=${region}`).then((r) => r.json()),
    ])
      .then(([s, c]) => { setSeries(s.series); setUnit(s.unit ?? ""); setCorrelation(c); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [region]);

  const nominal = series?.nominal;
  const real    = series?.real;
  const market  = correlation?.market_name;

  return (
    <Page>
      <PageHeader
        title="GDP"
        subtitle="Gross Domestic Product, quarterly, seasonally adjusted annual rate."
        actions={<Select label="Region" value={region} onChange={changeRegion} options={REGIONS} />}
      />

      <Tabs
        tabs={[
          { key: "gdp",         label: "GDP" },
          { key: "correlation", label: "Market Correlation" },
          { key: "deepdive",    label: "Report Deep Dive" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {loading && <StateMessage kind="loading" />}
      {error && <StateMessage kind="error">{error}</StateMessage>}

      {tab === "gdp" && real && (
        <>
          <Panel title={`Nominal GDP vs. Real GDP${unit ? ` (${unit})` : ""}`}>
            <LineChart
              dates={real.dates}
              datasets={[
                ...(nominal ? [{ dates: nominal.dates, data: nominal.values, borderColor: nominal.color, borderWidth: 2, label: nominal.label }] : []),
                { dates: real.dates, data: real.values, borderColor: real.color, borderWidth: 2, label: real.label },
              ]}
            />
          </Panel>

          {nominal ? (
            <Panel title="Nominal GDP, YoY %">
              <SignBars dates={nominal.yoy_dates} values={nominal.yoy} />
            </Panel>
          ) : null}

          <Panel
            title="Real GDP, YoY %"
            titleExtra={!nominal && <InfoTip text="No nominal GDP chart for this region: the underlying quarterly series was discontinued by its source." />}
          >
            <SignBars dates={real.yoy_dates} values={real.yoy} />
          </Panel>
        </>
      )}

      {tab === "correlation" && correlation?.error && <StateMessage kind="error">{correlation.error}</StateMessage>}

      {tab === "correlation" && correlation && !correlation.error && (
        <>
          <Panel title={`Real GDP YoY (right axis) vs. ${market} YoY (left axis)`}>
            <LineChart
              dates={correlation.dates}
              datasets={[
                { dates: correlation.dates, data: correlation.gdp_yoy,   borderColor: "var(--chart-2)", borderWidth: 2,   label: "Real GDP YoY",    priceScaleId: "right" },
                { dates: correlation.dates, data: correlation.sp500_yoy, borderColor: "var(--chart-1)", borderWidth: 1.5, label: `${market} YoY`, priceScaleId: "left" },
              ]}
            />
          </Panel>

          <Panel
            title={`Rolling ${correlation.window_quarters / 4}Y Correlation, Real GDP YoY vs. ${market} YoY`}
            titleExtra={
              <>
                <InfoTip text={`Lag N = ${market} YoY from N quarters earlier, correlated against the current quarter's GDP YoY. Tests whether the market leads GDP. The value next to each lag is its average correlation.`} />
                {/* One entry per lag: average correlation, and the toggle for that lag's line */}
                <SeriesLegend
                  items={Object.entries(LAGS).map(([k, l]) => {
                    const avg = mean(correlation.correlation[k] ?? []);
                    return { key: k, label: l.label, color: l.color, value: <span style={{ color: signColor(avg) }}>{fmtPct(avg, 1, { sign: false })}</span> };
                  })}
                  active={activeLags}
                  onToggle={(k) => setActiveLags((p) => toggleKeepOne(p, k))}
                />
              </>
            }
          >
            <LineChart
              dates={correlation.dates}
              datasets={Object.entries(correlation.correlation)
                .filter(([k]) => activeLags.has(k))
                .map(([k, values]) => ({
                  dates: correlation.dates, data: values.map((v) => (v == null ? null : v * 100)),
                  borderColor: LAGS[k]?.color, borderWidth: k === "lag0" ? 2 : 1.3, label: LAGS[k]?.label ?? k,
                }))}
              referenceLine={0}
            />
          </Panel>
        </>
      )}

      {tab === "deepdive" && <StateMessage>Report Deep Dive is coming soon.</StateMessage>}
    </Page>
  );
}
