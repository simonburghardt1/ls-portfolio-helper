"use client";

import { useEffect, useState } from "react";
import LineChart from "@/app/components/LineChart";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import Tabs from "@/app/components/Tabs";
import Button from "@/app/components/Button";
import Select from "@/app/components/Select";
import SignBars from "@/app/components/SignBars";
import StateMessage from "@/app/components/StateMessage";
import SeriesLegend from "@/app/components/SeriesLegend";
import { authFetch } from "@/app/lib/api";
import { fmtPct, signColor } from "@/app/lib/format";

const API = "http://localhost:8000";

const CORR = {
  debt_sp500: { label: "Debt & S&P 500", color: "var(--chart-1)" },
  debt_gdp:   { label: "Debt & GDP",     color: "var(--chart-3)" },
};

function mean(values) {
  const valid = values.filter((v) => v != null && !isNaN(v));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

export default function DebtPage() {
  const [tab, setTab] = useState("debt");
  const [seriesId, setSeriesId] = useState("FYGFD");
  const [showGdp, setShowGdp] = useState(false);

  const [series, setSeries] = useState(null);
  const [correlation, setCorrelation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      authFetch(`${API}/api/debt/series`).then((r) => r.json()),
      authFetch(`${API}/api/debt/market-correlation`).then((r) => r.json()),
    ])
      .then(([s, c]) => { setSeries(s.series); setCorrelation(c); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  const selected = series?.[seriesId];
  const corrDates = correlation?.years?.map((y) => `${y}-01-01`) ?? [];

  return (
    <Page>
      <PageHeader title="Debt" subtitle="US Gross Federal Debt, annual." />

      <Tabs
        tabs={[
          { key: "debt",        label: "Debt" },
          { key: "correlation", label: "Market Correlation" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {loading && <StateMessage kind="loading" />}
      {error && <StateMessage kind="error">{error}</StateMessage>}

      {tab === "debt" && series && (
        <>
          {selected && (
            <>
              <Panel
                title={selected.label}
                actions={
                  <Select
                    ariaLabel="Series"
                    value={seriesId}
                    onChange={setSeriesId}
                    options={Object.entries(series).map(([sid, s]) => ({ value: sid, label: s.label }))}
                  />
                }
              >
                <LineChart
                  dates={selected.dates}
                  datasets={[{ dates: selected.dates, data: selected.values, borderColor: selected.color, borderWidth: 2, label: selected.label }]}
                />
              </Panel>
              <Panel title={`${selected.label}, YoY %`}>
                <SignBars dates={selected.yoy_dates} values={selected.yoy} />
              </Panel>
            </>
          )}
        </>
      )}

      {tab === "correlation" && correlation && (
        <>
          <Panel
            title="Federal Debt YoY (right axis) vs. S&P 500 YoY (left axis)"
            actions={<Button variant="range-toggle" active={showGdp} onClick={() => setShowGdp((v) => !v)}>Real GDP YoY</Button>}
          >
            <LineChart
              dates={corrDates}
              datasets={[
                { dates: corrDates, data: correlation.debt_yoy,  borderColor: "var(--chart-1)", borderWidth: 2,   label: "Debt YoY",    priceScaleId: "right" },
                { dates: corrDates, data: correlation.sp500_yoy, borderColor: "var(--chart-5)", borderWidth: 1.5, label: "S&P 500 YoY", priceScaleId: "left" },
                ...(showGdp ? [{ dates: corrDates, data: correlation.gdp_yoy, borderColor: "var(--chart-2)", borderWidth: 1.5, label: "Real GDP YoY", priceScaleId: "right" }] : []),
              ]}
            />
          </Panel>

          <Panel
            title={`Rolling ${correlation.window_years}Y Correlation`}
            titleExtra={
              <SeriesLegend
                items={Object.entries(CORR).map(([k, c]) => {
                  const avg = mean(correlation.correlation[k] ?? []);
                  return { key: k, label: c.label, color: c.color, value: <span style={{ color: signColor(avg) }}>{fmtPct(avg, 1, { sign: false })}</span>, note: "avg." };
                })}
              />
            }
          >
            <LineChart
              dates={corrDates}
              datasets={Object.entries(correlation.correlation).map(([k, values]) => ({
                dates: corrDates, data: values.map((v) => (v == null ? null : v * 100)),
                borderColor: CORR[k]?.color, borderWidth: 2, label: CORR[k]?.label ?? k,
              }))}
              referenceLine={0}
            />
          </Panel>
        </>
      )}
    </Page>
  );
}
