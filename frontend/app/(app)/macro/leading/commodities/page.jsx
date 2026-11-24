"use client";

import { useEffect, useMemo, useState } from "react";
import LineChart from "@/app/components/LineChart";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import Button from "@/app/components/Button";
import Select from "@/app/components/Select";
import StateMessage from "@/app/components/StateMessage";
import DistributionHistogram from "@/app/components/DistributionHistogram";
import DistributionStats from "@/app/components/DistributionStats";
import { authFetch } from "@/app/lib/api";
import { rangeFrom } from "@/app/lib/macro";

const API = "http://localhost:8000";

const RANGES = [
  { label: "2Y",  years: 2 },
  { label: "5Y",  years: 5 },
  { label: "10Y", years: 10 },
  { label: "All", years: null },
];

// ── Return calculations (in %, with the date of each period's close) ──────────

function dailyReturns(dates, closes) {
  const values = [], out = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) { values.push((closes[i] / closes[i - 1] - 1) * 100); out.push(dates[i]); }
  }
  return { values, dates: out };
}

function isoWeekKey(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fdDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fdDay + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function weeklyReturns(dates, closes) {
  // last close of each ISO week
  const weekly = [];
  for (let i = 0; i < dates.length; i++) {
    const key = isoWeekKey(dates[i]);
    if (weekly.length && weekly[weekly.length - 1].key === key) weekly[weekly.length - 1] = { key, date: dates[i], close: closes[i] };
    else weekly.push({ key, date: dates[i], close: closes[i] });
  }
  const values = [], out = [];
  for (let i = 1; i < weekly.length; i++) {
    if (weekly[i - 1].close > 0) { values.push((weekly[i].close / weekly[i - 1].close - 1) * 100); out.push(weekly[i].date); }
  }
  return { values, dates: out };
}

const fmtR = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

export default function CommodityPricesPage() {
  const [list, setList] = useState({});
  const [commodity, setCommodity] = useState(null);
  const [series, setSeries] = useState(null); // { commodity, label, dates, closes }
  const [range, setRange] = useState("5Y");
  const [freq, setFreq] = useState("weekly");
  const [error, setError] = useState(null);

  useEffect(() => {
    authFetch(`${API}/api/commodities/list`)
      .then((r) => r.json())
      .then((d) => {
        setList(d);
        const first = Object.keys(d)[0];
        if (first) setCommodity(first);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!commodity) return;
    authFetch(`${API}/api/commodities/prices?commodity=${commodity}`)
      .then((r) => r.json())
      .then((d) => setSeries({ ...d, commodity }))
      .catch((e) => setError(e.message));
  }, [commodity]);

  const current = series?.commodity === commodity ? series : null;
  const visibleRange = rangeFrom(RANGES.find((r) => r.label === range)?.years);

  // The distribution covers the same range as the price chart
  const returns = useMemo(() => {
    if (!current?.dates?.length) return { values: [], dates: [] };
    const from = visibleRange?.from;
    const start = from ? Math.max(0, current.dates.findIndex((d) => d >= from)) : 0;
    const dates = current.dates.slice(start), closes = current.closes.slice(start);
    return freq === "daily" ? dailyReturns(dates, closes) : weeklyReturns(dates, closes);
  }, [current, freq, visibleRange?.from]);

  const latest = returns.values.at(-1);
  const period = freq === "daily" ? "day" : "week";

  return (
    <Page>
      <PageHeader
        title="Commodity Prices"
        subtitle="Historical prices and return distributions."
        actions={
          <Select
            label="Commodity"
            value={commodity}
            onChange={setCommodity}
            options={Object.entries(list).map(([id, meta]) => ({ value: id, label: meta.label }))}
          />
        }
      />

      {error && <StateMessage kind="error">{error}</StateMessage>}

      {!current ? (
        !error && <StateMessage kind="loading" />
      ) : !current.dates?.length ? (
        <StateMessage>No price data for this commodity.</StateMessage>
      ) : (
        <>
          <Panel
            title={current.label}
            actions={RANGES.map((r) => (
              <Button key={r.label} variant="range-toggle" active={range === r.label} onClick={() => setRange(r.label)}>{r.label}</Button>
            ))}
          >
            <LineChart
              dates={current.dates}
              datasets={[{ dates: current.dates, data: current.closes, borderColor: "var(--chart-1)", borderWidth: 1.5, label: current.label }]}
              visibleRange={visibleRange}
            />
          </Panel>

          <Panel
            title={`Distribution of ${freq} returns, ${range}`}
            actions={[["daily", "Daily"], ["weekly", "Weekly"]].map(([k, l]) => (
              <Button key={k} variant="range-toggle" active={freq === k} onClick={() => setFreq(k)}>{l}</Button>
            ))}
          >
            {returns.values.length < 3 ? (
              <StateMessage>Not enough price history for this range.</StateMessage>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: "var(--space-6)" }}>
                <DistributionHistogram
                  values={returns.values}
                  dates={returns.dates}
                  format={(v) => `${v.toFixed(0)}%`}
                  marker={latest != null ? { value: latest, label: `Latest ${fmtR(latest)}` } : undefined}
                  height={360}
                />
                <DistributionStats values={returns.values} dates={returns.dates} format={fmtR} periodLabel={period} />
              </div>
            )}
          </Panel>
        </>
      )}
    </Page>
  );
}
