"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import PageHeader from "@/app/components/PageHeader";
import KpiCard from "@/app/components/KpiCard";
import Badge from "@/app/components/Badge";
import Button from "@/app/components/Button";
import LineChart from "@/app/components/LineChart";
import RegimeGauge from "@/app/components/RegimeGauge";
import RegimeChart, { REGIME_CONFIG } from "@/app/components/RegimeChart";
import { scoreToRegime, lastNonNull, getCurrentRegimeInfo } from "@/app/lib/regime";

const BASKET_REGIME_THRESHOLDS = { up: 60, down: 40 }; // score01 (0-100) equivalent of Market Regime's composite ±0.2 via score01=(composite+1)/2*100
const COMPONENT_THRESHOLDS = { up: 0.2, down: -0.2 };   // raw per-component scores are ~[-1,1], same scale as Market Regime's

const BASKET_REGIME_PERIODS = [
  { label: "3M", days: 90 },
  { label: "6M", days: 182 },
  { label: "1Y", days: 365 },
  { label: "All", days: null },
];

function regimeVisibleRange(periodLabel) {
  const p = BASKET_REGIME_PERIODS.find((x) => x.label === periodLabel);
  if (!p?.days) return null;
  const to = new Date(), from = new Date();
  from.setDate(from.getDate() - p.days);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const RANGES = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "YTD", days: null },
  { label: "1Y", days: 365 },
];

// Keep in sync with backend/app/services/basket.py's COMPARISON_BENCHMARKS — duplicated
// here deliberately (5 static labels) rather than adding a round-trip just to fetch them.
const COMPARISON_BENCHMARKS = [
  { ticker: "SPY", label: "S&P 500" },
  { ticker: "QQQ", label: "Nasdaq 100" },
  { ticker: "DIA", label: "Dow Jones" },
  { ticker: "IWM", label: "Russell 2000" },
  { ticker: "BTC-USD", label: "Bitcoin" },
];

const SELECT_STYLE = {
  background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
  color: "#e5e7eb", fontSize: 13, padding: "6px 10px", cursor: "pointer",
};

function rangeStartDate(rangeLabel) {
  const now = new Date();
  if (rangeLabel === "YTD") {
    return `${now.getFullYear()}-01-01`;
  }
  const days = RANGES.find((r) => r.label === rangeLabel)?.days ?? 30;
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Rebases the series to 100 at the first date >= fromDate — "index the basket to 100 for the timeframe".
function rebase(dates, levels, fromDate) {
  const startIdx = dates.findIndex((d) => d >= fromDate);
  if (startIdx === -1) return { dates: [], levels: [] };
  const base = levels[startIdx];
  if (!base) return { dates: [], levels: [] };
  return {
    dates: dates.slice(startIdx),
    levels: levels.slice(startIdx).map((v) => (v / base) * 100),
  };
}

function pct(v) {
  if (v == null || isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
}

// Per-holding performance and contribution over the selected range.
//
// `weight` shown to the user is always the Basket's static *target* weight (how it was
// constructed — e.g. exactly 1/N for Equal-weight) so an Equal-weight Basket visibly reads
// as equal-weighted, no matter which range is selected.
//
// `contribution` cannot use that same target weight, though: this Basket never rebalances
// (no rebalancing mechanic exists yet — AD-8 only covers creation + daily NAV extension), so
// each ticker's *actual* dollar-share drifts away from its target weight over time. Using the
// static target weight for contribution would make per-holding contributions NOT sum to the
// Basket's own return over the window (verified/caught in an earlier round). So contribution
// is computed against the drifted, effective weight *at the start of the selected window*
// instead: effective_weight_i(t0) = (target_weight_i * price_i,t0 / price_i,0) /
// (index_level[t0] / 100), i.e. this ticker's actual share of Basket value at t0 — the target
// weight is only used for display, never for the contribution math.
function computeHoldingsBreakdown(dates, indexLevel, holdings, fromDate) {
  if (!dates?.length || !holdings?.length) return [];
  const startIdx = dates.findIndex((d) => d >= fromDate);
  if (startIdx === -1) return [];
  const basketValueAtStart = indexLevel[startIdx];
  if (!basketValueAtStart) return [];

  return holdings
    .map((h) => {
      const priceAtInception = h.prices[0];
      const startPrice = h.prices[startIdx];
      const endPrice = h.prices[h.prices.length - 1];
      if (!priceAtInception || !startPrice) {
        return { ticker: h.ticker, targetWeight: h.weight, performance: null, contribution: null };
      }
      const effectiveWeight = (h.weight * startPrice / priceAtInception) / (basketValueAtStart / 100);
      const performance = endPrice / startPrice - 1;
      return { ticker: h.ticker, targetWeight: h.weight, performance, contribution: effectiveWeight * performance };
    })
    .sort((a, b) => (b.contribution ?? -Infinity) - (a.contribution ?? -Infinity));
}

// Describes where price literally sits relative to the EMA/SMA band — independent of
// the *scored* bmsb component (which additionally requires ema > sma, "trend confirmed",
// before it counts a break above the band as +1; see basket_regime.py::_score_bmsb). Using
// the raw price/ema/sma here instead of the compressed score avoids a misleading "Inside
// Band" label for a basket whose price has already broken well above the band but whose
// EMA hasn't crossed above its SMA yet — that's a real, sometimes lengthy state (a fresh
// rally the slow-moving 21W/20W averages haven't caught up to), not "inside" anything.
function bmsbLabel(price, ema, sma) {
  if (price == null || ema == null || sma == null) return { text: "—", color: "var(--text-secondary)" };
  const bandUpper = Math.max(ema, sma);
  const bandLower = Math.min(ema, sma);
  if (price > bandUpper) return { text: "Above Band", color: "var(--positive)" };
  if (price < bandLower) return { text: "Below Band", color: "var(--negative)" };
  return { text: "Inside Band", color: "var(--text-secondary)" };
}

// % change over each selectable timeframe, from the Basket's own index series — independent
// of whichever range is currently selected for the chart below (this row shows all of them
// at once). "1D" uses the literal last two points, not rangeStartDate/findIndex — a calendar
// "1 day ago" lookup breaks across weekends (Friday's "1 day ago" is Sunday, no trading match).
function computeRangeChanges(dates, levels) {
  if (!dates?.length || !levels?.length) return {};
  const lastIdx = dates.length - 1;
  const out = { "1D": lastIdx >= 1 ? levels[lastIdx] / levels[lastIdx - 1] - 1 : null };
  for (const r of RANGES) {
    const startIdx = dates.findIndex((d) => d >= rangeStartDate(r.label));
    out[r.label] = startIdx === -1 ? null : levels[lastIdx] / levels[startIdx] - 1;
  }
  return out;
}

function changeColor(v) {
  return v == null ? undefined : v >= 0 ? "var(--positive)" : "var(--negative)";
}

function compareLabel(ticker) {
  return COMPARISON_BENCHMARKS.find((b) => b.ticker === ticker)?.label ?? ticker;
}

// Current + historical drawdown (Story 1.6) from the same reconstructed index series
// as the performance chart — peak-to-date running max, no extra data needed.
function computeDrawdown(dates, levels) {
  if (!dates?.length) return { dates: [], drawdown: [], current: null, max: null };
  let peak = -Infinity;
  const drawdown = levels.map((v) => {
    peak = Math.max(peak, v);
    return v / peak - 1;
  });
  return {
    dates,
    drawdown,
    current: drawdown[drawdown.length - 1],
    max: Math.min(...drawdown),
  };
}

export default function BasketDetailPage() {
  const { id } = useParams();
  const [range, setRange] = useState("3M");
  const [selectedCompare, setSelectedCompare] = useState("");
  const [regimePeriod, setRegimePeriod] = useState("1Y");

  // App Router doesn't remount this component when navigating between two instances of the
  // same dynamic route (/baskets/16 -> /baskets/15) — without this, a compare ticker selected
  // on one Basket would carry over to another where it's neither a benchmark nor a constituent.
  // Reset during render (React's documented pattern for "adjust state when a prop changes"),
  // not in an Effect — avoids an extra commit/cascading-render for what's a synchronous bail-out.
  const [prevId, setPrevId] = useState(id);
  if (id !== prevId) {
    setPrevId(id);
    setSelectedCompare("");
  }

  const { data: basket, isLoading: basketLoading, isError: basketError } = useQuery({
    queryKey: ["basket", id],
    queryFn: () => api.get(`/api/baskets/${id}`),
  });

  const { data: series, isLoading: seriesLoading, isError: seriesError, error: seriesErrorObj } = useQuery({
    queryKey: ["basket-series", id],
    queryFn: () => api.get(`/api/baskets/${id}/series`),
  });

  // A selected compare ticker that's already a Basket constituent has its prices sitting in
  // `series.holdings` already — only fire a network request for the 5 external benchmarks.
  const compareIsConstituent = selectedCompare !== "" && (series?.holdings ?? []).some((h) => h.ticker === selectedCompare);

  const { data: compareData, isError: compareErrorFlag } = useQuery({
    queryKey: ["basket-compare", id, selectedCompare],
    queryFn: () => api.get(`/api/baskets/${id}/compare?ticker=${encodeURIComponent(selectedCompare)}`),
    enabled: selectedCompare !== "" && !compareIsConstituent,
  });

  // Separate query, own loading state — regime involves live options-chain lookups per
  // ticker and can take longer than the price series; it shouldn't block the chart.
  const { data: regime, isLoading: regimeLoading } = useQuery({
    queryKey: ["basket-regime", id],
    queryFn: () => api.get(`/api/baskets/${id}/regime`),
  });

  const rebased = useMemo(() => {
    if (!series?.dates?.length) return { dates: [], levels: [] };
    return rebase(series.dates, series.index_level, rangeStartDate(range));
  }, [series, range]);

  const holdingsBreakdown = useMemo(
    () => computeHoldingsBreakdown(series?.dates, series?.index_level, series?.holdings, rangeStartDate(range)),
    [series, range]
  );

  const rangeChanges = useMemo(
    () => computeRangeChanges(series?.dates, series?.index_level),
    [series]
  );

  const compareSeries = useMemo(() => {
    if (selectedCompare === "") return null;
    if (compareIsConstituent) {
      const holding = series.holdings.find((h) => h.ticker === selectedCompare);
      return holding ? { dates: series.dates, prices: holding.prices } : null;
    }
    return compareData ?? null;
  }, [selectedCompare, compareIsConstituent, series, compareData]);

  const compareRebased = useMemo(() => {
    if (!compareSeries?.dates?.length) return null;
    return rebase(compareSeries.dates, compareSeries.prices, rangeStartDate(range));
  }, [compareSeries, range]);

  // Drawdown follows the same range as the main chart — mathematically equivalent to
  // recomputing over the raw range-sliced data, since drawdown is a pure ratio (v/peak - 1)
  // and rebasing to 100 just multiplies every value by one constant, which cancels out.
  const drawdown = useMemo(
    () => computeDrawdown(rebased.dates, rebased.levels),
    [rebased]
  );

  // RegimeChart props — recomputed only when `regime` itself changes, so
  // RegimeChart's internal rebuild effect fires exactly once per fetch, not per render.
  const regimeChartData = useMemo(() => {
    if (!regime?.dates?.length) return null;
    const regimes = regime.score01.map((s) => scoreToRegime(s, BASKET_REGIME_THRESHOLDS));
    return {
      dates: regime.dates,
      price: { data: regime.prices, label: basket?.name ?? "NAV" },
      overlays: [
        { key: "ema21", label: "EMA-21W", color: "#a78bfa", data: regime.ema21 },
        { key: "sma20", label: "SMA-20W", color: "#fb923c", data: regime.sma20 },
      ],
      regimes,
      composite: { data: regime.score01, domain: [0, 100], thresholds: BASKET_REGIME_THRESHOLDS },
      components: [
        { key: "bmsb", label: "BMSB", color: "#3b82f6", weight: 0.25, data: regime.components?.bmsb },
        { key: "vol", label: "Realized Vol", color: "#f59e0b", weight: 0.25, data: regime.components?.vol },
        { key: "breadth", label: "Market Breadth", color: "#10b981", weight: 0.25, data: regime.components?.breadth },
        { key: "relative_strength", label: "Relative Strength", color: "#8b5cf6", weight: 0.25, data: regime.components?.relative_strength },
      ],
    };
  }, [regime, basket?.name]);

  const regimeVisible = useMemo(() => regimeVisibleRange(regimePeriod), [regimePeriod]);

  const currentRegimeInfo = useMemo(
    () => (regimeChartData ? getCurrentRegimeInfo(regimeChartData.regimes, regimeChartData.dates) : null),
    [regimeChartData]
  );
  const regimeCfg = currentRegimeInfo ? REGIME_CONFIG[currentRegimeInfo.regime] : null;

  const isLoading = basketLoading || seriesLoading;
  const isError = basketError || seriesError;

  return (
    <div style={{ padding: "28px 32px", minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <Link href="/portfolio/markets/baskets" style={{ fontSize: 12, color: "var(--text-secondary)", textDecoration: "none" }}>
        ← Baskets
      </Link>

      {isLoading && (
        <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
          Loading…
        </div>
      )}

      {isError && (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--negative)", padding: "12px 16px", marginTop: 16, fontSize: 13, color: "var(--negative)" }}>
          {seriesErrorObj?.message || "Could not load this Basket."}
        </div>
      )}

      {!isLoading && !isError && basket && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "12px 0 24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <PageHeader title={basket.name} style={{ marginBottom: 0 }} />
              {basket.user_id == null ? (
                <Badge variant="disabled">SYSTEM</Badge>
              ) : (
                <Badge variant="neutral">CUSTOM</Badge>
              )}
            </div>
            <Link href={`/portfolio/markets/baskets/${id}/edit`} style={{ textDecoration: "none" }}>
              <Button variant="secondary">Edit</Button>
            </Link>
          </div>

          <div style={{ display: "flex", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
            <KpiCard label="Latest NAV" formatted={basket.latest_nav != null ? basket.latest_nav.toFixed(2) : "—"} small caption="since inception" />
            <KpiCard label="Weighting" formatted={basket.weighting_method === "market_cap" ? "Market Cap" : "Equal-weight"} small />
            {["1D", "1W", "1M", "3M", "YTD", "1Y"].map((label) => (
              <KpiCard
                key={label}
                label={`${label} Change`}
                formatted={pct(rangeChanges[label])}
                valueColor={changeColor(rangeChanges[label])}
                small
              />
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", gap: 4 }}>
              {RANGES.map((r) => (
                <Button key={r.label} variant="range-toggle" active={range === r.label} onClick={() => setRange(r.label)}>
                  {r.label}
                </Button>
              ))}
            </div>
            <select value={selectedCompare} onChange={(e) => setSelectedCompare(e.target.value)} style={SELECT_STYLE}>
              <option value="">— None —</option>
              <optgroup label="Benchmarks">
                {COMPARISON_BENCHMARKS.map((b) => (
                  <option key={b.ticker} value={b.ticker}>{b.label}</option>
                ))}
              </optgroup>
              <optgroup label="Holdings">
                {(basket.tickers ?? []).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </optgroup>
            </select>
          </div>

          {compareErrorFlag && (
            <div style={{ fontSize: 11, color: "var(--negative)", marginBottom: 8 }}>Could not load comparison data.</div>
          )}

          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", padding: "16px 8px 8px" }}>
            {rebased.dates.length > 0 ? (
              <LineChart
                dates={rebased.dates}
                datasets={[
                  { dates: rebased.dates, data: rebased.levels, borderColor: "#a78bfa", borderWidth: 2, label: `${basket.name} (indexed to 100)` },
                  ...(compareRebased?.dates?.length
                    ? [{ dates: compareRebased.dates, data: compareRebased.levels, borderColor: "#3b82f6" /* --chart-1 */, borderWidth: 2, lineStyle: 2, label: compareLabel(selectedCompare) }]
                    : []),
                ]}
                referenceLine={100}
              />
            ) : (
              <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
                Not enough price history yet for this timeframe.
              </div>
            )}
          </div>

          {compareRebased?.dates?.length > 0 && compareRebased.dates[0] !== rebased.dates[0] && (
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6 }}>
              {compareLabel(selectedCompare)} price history starts {compareRebased.dates[0]} — rebased to its own start, not the selected range&apos;s.
            </div>
          )}

          {/* ── Regime (FR-9): BMSB, Vol, Breadth, Relative Strength → composite gauge ── */}
          <div style={{ marginTop: 28 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
              Regime
            </div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 12 }}>
              Composite of BMSB, realized-volatility, breadth, and relative-strength-vs-SPY, equal-weighted and 2-week smoothed. Realized Vol is scored against its own trailing 1-year range, so it needs about a year of history before it produces a value — its line on the chart below will only cover the most recent portion of a shorter-lived Basket&apos;s history, not the whole timeframe; that&apos;s expected, not missing data. &quot;Basket VIX&quot; is a live options-market snapshot — separate from the composite, and only available while option quotes are actively trading.
            </div>
            {regimeLoading ? (
              <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "24px 0", textAlign: "center" }}>Loading…</div>
            ) : (
              <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", padding: "20px 24px" }}>
                <div style={{ maxWidth: 420, marginBottom: 20 }}>
                  <RegimeGauge score={regime?.score01?.length ? regime.score01[regime.score01.length - 1] : null} label="Regime Score" />
                </div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  {(() => {
                    const last = (arr) => (arr?.length ? arr[arr.length - 1] : null);
                    const bmsbScore = last(regime?.components?.bmsb);
                    const bmsb = bmsbLabel(last(regime?.prices), last(regime?.ema21), last(regime?.sma20));
                    const vol = last(regime?.components?.vol);
                    const volCfg = scoreToRegime(vol, COMPONENT_THRESHOLDS) ? REGIME_CONFIG[scoreToRegime(vol, COMPONENT_THRESHOLDS)] : null;
                    const breadthPct = last(regime?.breadth_pct);
                    const relStrength = last(regime?.components?.relative_strength);
                    const relCfg = scoreToRegime(relStrength, COMPONENT_THRESHOLDS) ? REGIME_CONFIG[scoreToRegime(relStrength, COMPONENT_THRESHOLDS)] : null;
                    return (
                      <>
                        {regimeCfg && (
                          <KpiCard
                            label="Regime"
                            formatted={regimeCfg.label}
                            valueColor={regimeCfg.color}
                            small
                            caption={`${currentRegimeInfo.periods}d · score ${lastNonNull(regime?.score01)?.toFixed(0)}`}
                          />
                        )}
                        <KpiCard
                          label="BMSB"
                          formatted={bmsb.text}
                          valueColor={bmsb.color}
                          small
                          caption={bmsbScore != null ? `composite score ${bmsbScore.toFixed(2)}` : undefined}
                        />
                        <KpiCard label="Vol (realized)" formatted={volCfg?.label ?? "—"} valueColor={volCfg?.color ?? "var(--text-secondary)"} small caption={vol != null ? `score ${vol.toFixed(2)}` : undefined} />
                        <KpiCard label="Breadth" formatted={breadthPct != null ? `${(breadthPct * 100).toFixed(0)}%` : "—"} small caption="% > own 50D SMA" />
                        <KpiCard label="Relative Strength" formatted={relCfg?.label ?? "—"} valueColor={relCfg?.color ?? "var(--text-secondary)"} small caption={relStrength != null ? `score ${relStrength.toFixed(2)}` : undefined} />
                        <KpiCard
                          label="Basket VIX"
                          formatted={regime?.basket_vix != null ? `${(regime.basket_vix * 100).toFixed(1)}%` : "—"}
                          small
                          caption={regime?.basket_vix != null ? "30D implied vol" : "no live quotes right now"}
                        />
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {regimeChartData && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginBottom: 8 }}>
                  {BASKET_REGIME_PERIODS.map((p) => (
                    <Button key={p.label} variant="range-toggle" active={regimePeriod === p.label} onClick={() => setRegimePeriod(p.label)}>
                      {p.label}
                    </Button>
                  ))}
                </div>
                <RegimeChart
                  dates={regimeChartData.dates}
                  price={regimeChartData.price}
                  overlays={regimeChartData.overlays}
                  regimes={regimeChartData.regimes}
                  composite={regimeChartData.composite}
                  components={regimeChartData.components}
                  visibleRange={regimeVisible}
                  sectionTitles={{ composite: "Regime Score (0-100)" }}
                />
              </div>
            )}
          </div>

          {/* ── Drawdown (Story 1.6) ── */}
          <div style={{ marginTop: 28 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>
              Drawdown — {range}
            </div>
            <div style={{ display: "flex", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
              <KpiCard label="Current Drawdown" formatted={pct(drawdown.current)} valueColor={drawdown.current != null && drawdown.current < 0 ? "var(--negative)" : undefined} small />
              <KpiCard label="Max Drawdown" formatted={pct(drawdown.max)} valueColor="var(--negative)" small />
            </div>
            <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", padding: "16px 8px 8px" }}>
              {drawdown.dates.length > 0 ? (
                <LineChart
                  dates={drawdown.dates}
                  datasets={[{ dates: drawdown.dates, data: drawdown.drawdown.map((v) => v * 100), borderColor: "#f2585c", borderWidth: 2, label: "Drawdown %" }]}
                  referenceLine={0}
                />
              ) : (
                <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
                  Not enough price history yet.
                </div>
              )}
            </div>
          </div>

          {holdingsBreakdown.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                Holdings — {range} performance &amp; contribution
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 12 }}>
                Weight is how the Basket was constructed (target weight). Contribution accounts for how each holding&apos;s actual share has drifted from that target since the Basket doesn&apos;t rebalance — contributions sum to the Basket&apos;s own return for this window.
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <th style={thStyle}>Ticker</th>
                      <th style={thStyle}>Weight</th>
                      <th style={thStyle}>Performance ({range})</th>
                      <th style={thStyle}>Contribution ({range})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdingsBreakdown.map((h, i) => (
                      <tr key={h.ticker} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                        <td style={{ ...tdStyle, fontWeight: 600, color: "var(--text-primary)" }}>{h.ticker}</td>
                        <td style={tdStyle}>{(h.targetWeight * 100).toFixed(1)}%</td>
                        <td style={{ ...tdStyle, color: h.performance == null ? "var(--text-secondary)" : h.performance >= 0 ? "var(--positive)" : "var(--negative)" }}>
                          {pct(h.performance)}
                        </td>
                        <td style={{ ...tdStyle, color: h.contribution == null ? "var(--text-secondary)" : h.contribution >= 0 ? "var(--positive)" : "var(--negative)" }}>
                          {pct(h.contribution)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const thStyle = { fontSize: 11, color: "var(--text-secondary)", padding: "6px 8px", textAlign: "left", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" };
const tdStyle = { padding: "8px", borderTop: "1px solid var(--border)" };
