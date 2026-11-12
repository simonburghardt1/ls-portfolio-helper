"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import PageHeader from "@/app/components/PageHeader";
import KpiCard from "@/app/components/KpiCard";
import Badge from "@/app/components/Badge";
import Button from "@/app/components/Button";
import LineChart from "@/app/components/LineChart";
import Tabs from "@/app/components/Tabs";
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
  { label: "3Y", days: 1095 },
  { label: "5Y", days: 1825 },
  { label: "Max", days: null },
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

const MAX_COMPARISONS = 5;

// The Basket's own line keeps #a78bfa (--chart-10, established throughout this file as
// "this Basket"). These 5 slots pull from the app's own categorical chart tokens
// (globals.css) — literal hex since canvas charts can't consume CSS vars — skipping
// chart-4 (#8b5cf6, purple) so it doesn't read too close to the Basket's own line.
const COMPARE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4"];

function rangeStartDate(rangeLabel) {
  const now = new Date();
  if (rangeLabel === "YTD") {
    return `${now.getFullYear()}-01-01`;
  }
  if (rangeLabel === "Max") {
    return "1900-01-01"; // earlier than any real series — findIndex naturally lands on its first date
  }
  const days = RANGES.find((r) => r.label === rangeLabel)?.days ?? 30;
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Plain rescale to 100 at the first date >= fromDate — used only for the external compare
// ticker overlay (a single price series with no per-holding weights to reseed).
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

// Simulates buying every holding fresh at its *target* weight on the first date of the
// selected window and tracking forward with real prices from there — matches what the
// chart's own "indexed to 100" framing already visually implies (selecting a timeframe
// means "what if I'd bought in fresh here"), rather than rescaling the Basket's real,
// never-rebalanced history (whose slope within the window is still driven by whatever
// weights had already drifted to by that point). Exactly _reconstruct_series's own
// fixed-weight-buy-and-hold formula (100 * Σ weight_i * price_i(t)/price_i(t0)), just
// computed client-side per selected range from the holdings arrays already in hand.
// "Max" naturally reduces to the Basket's true total return, since target weights genuinely
// were applied at the real inception — reseeding there changes nothing.
function rebaseWeighted(dates, holdings, fromDate) {
  if (!dates?.length || !holdings?.length) return { dates: [], levels: [] };
  const startIdx = dates.findIndex((d) => d >= fromDate);
  if (startIdx === -1) return { dates: [], levels: [] };

  const bases = holdings.map((h) => h.prices[startIdx]);
  if (bases.some((b) => !b)) return { dates: [], levels: [] };

  const slicedDates = dates.slice(startIdx);
  const levels = slicedDates.map((_, i) => {
    const idx = startIdx + i;
    let total = 0;
    holdings.forEach((h, hi) => {
      const p = h.prices[idx];
      if (p != null) total += h.weight * (p / bases[hi]);
    });
    return total * 100;
  });
  return { dates: slicedDates, levels };
}

function pct(v) {
  if (v == null || isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
}

// Per-holding performance and contribution over the selected range — assumes a fresh
// rebalance to target weight at the start of the selected window (see rebaseWeighted's
// docstring for why), so contribution is simply targetWeight × performance and this always
// sums to the Basket's own return for the window by construction. "Max" reflects the
// Basket's true un-rebalanced history, since it never actually rebalanced before then.
function computeHoldingsBreakdown(dates, holdings, fromDate) {
  if (!dates?.length || !holdings?.length) return [];
  const startIdx = dates.findIndex((d) => d >= fromDate);
  if (startIdx === -1) return [];

  return holdings
    .map((h) => {
      const startPrice = h.prices[startIdx];
      const endPrice = h.prices[h.prices.length - 1];
      if (!startPrice || !endPrice) {
        return { ticker: h.ticker, targetWeight: h.weight, performance: null, contribution: null };
      }
      const performance = endPrice / startPrice - 1;
      return { ticker: h.ticker, targetWeight: h.weight, performance, contribution: h.weight * performance };
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

// Target-weight-weighted return between two indices into `holdings[].prices` — same
// "reseed to target weight, track forward" story as rebaseWeighted, just evaluated at a
// single end point instead of a whole series (Σ weight_i × price_i(to)/price_i(from) − 1).
function weightedReturn(holdings, fromIdx, toIdx) {
  let total = 0;
  for (const h of holdings) {
    const p0 = h.prices[fromIdx];
    const p1 = h.prices[toIdx];
    if (p0 == null || p1 == null) continue;
    total += h.weight * (p1 / p0);
  }
  return total - 1;
}

// % change over each selectable timeframe, from a fresh target-weight rebalance at the
// start of that timeframe (same reseed logic as rebaseWeighted/computeHoldingsBreakdown,
// so this KPI row and the chart/table below always tell the same story) — independent of
// whichever range is currently selected for the chart below (this row shows all of them at
// once). "1D" uses the literal last two points, not rangeStartDate/findIndex — a calendar
// "1 day ago" lookup breaks across weekends (Friday's "1 day ago" is Sunday, no trading match).
function computeRangeChanges(dates, holdings) {
  if (!dates?.length || !holdings?.length) return {};
  const lastIdx = dates.length - 1;
  const out = { "1D": lastIdx >= 1 ? weightedReturn(holdings, lastIdx - 1, lastIdx) : null };
  for (const r of RANGES) {
    const startIdx = dates.findIndex((d) => d >= rangeStartDate(r.label));
    out[r.label] = startIdx === -1 ? null : weightedReturn(holdings, startIdx, lastIdx);
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const [range, setRange] = useState("3M");
  const [selectedCompares, setSelectedCompares] = useState([]);
  const [regimePeriod, setRegimePeriod] = useState("1Y");

  // App Router doesn't remount this component when navigating between two instances of the
  // same dynamic route (/baskets/16 -> /baskets/15) — without this, compare tickers selected
  // on one Basket would carry over to another where they're neither a benchmark nor a
  // constituent. Reset during render (React's documented pattern for "adjust state when a
  // prop changes"), not in an Effect — avoids an extra commit/cascading-render for what's a
  // synchronous bail-out.
  const [prevId, setPrevId] = useState(id);
  if (id !== prevId) {
    setPrevId(id);
    setSelectedCompares([]);
  }

  function toggleCompare(ticker) {
    setSelectedCompares((prev) => {
      if (prev.includes(ticker)) return prev.filter((t) => t !== ticker);
      if (prev.length >= MAX_COMPARISONS) return prev;
      return [...prev, ticker];
    });
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
  // `series.holdings` already — only fire a network request for the external benchmarks.
  const externalCompareTickers = selectedCompares.filter(
    (t) => !(series?.holdings ?? []).some((h) => h.ticker === t)
  );

  const compareQueries = useQueries({
    queries: externalCompareTickers.map((ticker) => ({
      queryKey: ["basket-compare", id, ticker],
      queryFn: () => api.get(`/api/baskets/${id}/compare?ticker=${encodeURIComponent(ticker)}`),
    })),
  });
  const compareErrorFlag = compareQueries.some((q) => q.isError);

  // Separate query, own loading state — regime involves live options-chain lookups per
  // ticker and can take longer than the price series; it shouldn't block the chart.
  const { data: regime, isLoading: regimeLoading } = useQuery({
    queryKey: ["basket-regime", id],
    queryFn: () => api.get(`/api/baskets/${id}/regime`),
  });

  const deleteBasket = useMutation({
    mutationFn: () => api.delete(`/api/baskets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["baskets"] });
      router.push("/portfolio/markets/baskets");
    },
  });

  function handleDelete() {
    if (confirm(`Delete Basket "${basket?.name}"? This cannot be undone.`)) {
      deleteBasket.mutate();
    }
  }

  const rebased = useMemo(() => {
    if (!series?.dates?.length) return { dates: [], levels: [] };
    return rebaseWeighted(series.dates, series.holdings, rangeStartDate(range));
  }, [series, range]);

  const holdingsBreakdown = useMemo(
    () => computeHoldingsBreakdown(series?.dates, series?.holdings, rangeStartDate(range)),
    [series, range]
  );

  const rangeChanges = useMemo(
    () => computeRangeChanges(series?.dates, series?.holdings),
    [series]
  );

  // One rebased {ticker, dates, levels} entry per selected comparison, in selection order —
  // each resolved from series.holdings (constituent) or the matching useQueries result
  // (external benchmark), then independently indexed to 100 at the range's own start.
  const compareRebasedList = useMemo(() => {
    if (!selectedCompares.length || !series) return [];
    return selectedCompares
      .map((ticker) => {
        const holding = series.holdings.find((h) => h.ticker === ticker);
        let raw;
        if (holding) {
          raw = { dates: series.dates, prices: holding.prices };
        } else {
          const idx = externalCompareTickers.indexOf(ticker);
          raw = idx === -1 ? null : compareQueries[idx]?.data ?? null;
        }
        if (!raw?.dates?.length) return null;
        const rebasedSeries = rebase(raw.dates, raw.prices, rangeStartDate(range));
        return rebasedSeries.dates.length ? { ticker, ...rebasedSeries } : null;
      })
      .filter(Boolean);
  }, [selectedCompares, series, range, compareQueries, externalCompareTickers]);

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

  const [tab, setTab] = useState("performance");
  const [compareOpen, setCompareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const compareRef = useRef(null);
  const menuRef = useRef(null);
  useClickOutside(compareRef, compareOpen, () => setCompareOpen(false));
  useClickOutside(menuRef, menuOpen, () => setMenuOpen(false));

  const isLoading = basketLoading || seriesLoading;
  const isError = basketError || seriesError;

  // Header regime pill: the live composite once /regime has loaded, until then the
  // persisted daily score (same one the Basket overview cards show).
  const headerScore = lastNonNull(regime?.score01) ?? basket?.regime_score ?? null;
  const headerBucket = headerScore != null ? scoreToRegime(headerScore, BASKET_REGIME_THRESHOLDS) : null;
  const headerRegime = headerBucket ? REGIME_CONFIG[headerBucket] : null;

  const compareColor = (ticker) => COMPARE_COLORS[selectedCompares.indexOf(ticker) % COMPARE_COLORS.length];

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
          {/* ── Header: name, regime, key facts as one quiet line ── */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, margin: "12px 0 20px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <PageHeader title={basket.name} style={{ marginBottom: 0 }} />
                {headerRegime && (
                  <span
                    title="Regime score (0-100): ≥60 Uptrend, ≤40 Downtrend, otherwise Ranging"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px",
                      borderRadius: "var(--radius-full)", fontSize: 12, fontWeight: 600,
                      color: headerRegime.color, border: `1px solid ${headerRegime.color}`,
                      background: `${headerRegime.color}1f`,
                    }}
                  >
                    {headerRegime.label}
                    <span style={{ fontFamily: "var(--font-family-mono)", opacity: 0.85 }}>{Math.round(headerScore)}</span>
                  </span>
                )}
                {basket.user_id == null ? <Badge variant="disabled">SYSTEM</Badge> : <Badge variant="neutral">CUSTOM</Badge>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, fontSize: 13, color: "var(--text-secondary)" }}>
                <MetaItem>{basket.weighting_method === "market_cap" ? "Market-cap weighted" : "Equal-weight"}</MetaItem>
                <Dot />
                <MetaItem>{basket.num_holdings ?? "—"} holdings</MetaItem>
                <Dot />
                <MetaItem>β {basket.beta_vs_spy != null ? basket.beta_vs_spy.toFixed(2) : "—"} <Muted>vs SPY</Muted></MetaItem>
                <Dot />
                <MetaItem>CAGR <Num color={changeColor(basket.cagr)}>{pct(basket.cagr)}</Num></MetaItem>
                <Dot />
                <MetaItem>Today <Num color={changeColor(rangeChanges["1D"])}>{pct(rangeChanges["1D"])}</Num></MetaItem>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <Link href={`/portfolio/markets/baskets/${id}/edit`} style={{ textDecoration: "none" }}>
                <Button variant="secondary">Edit</Button>
              </Link>
              <div ref={menuRef} style={{ position: "relative" }}>
                <Button variant="secondary" onClick={() => setMenuOpen((o) => !o)} title="More actions" aria-label="More actions">
                  ⋯
                </Button>
                {menuOpen && (
                  <div style={{ ...popoverStyle, right: 0, minWidth: 160 }}>
                    <button
                      type="button"
                      onClick={() => { setMenuOpen(false); router.push(`/portfolio/markets/baskets/new?copyFrom=${id}`); }}
                      style={menuItemStyle}
                    >
                      Copy Basket
                    </button>
                    <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                    <button
                      type="button"
                      onClick={() => { setMenuOpen(false); handleDelete(); }}
                      disabled={deleteBasket.isPending}
                      style={{ ...menuItemStyle, color: "var(--negative)" }}
                    >
                      {deleteBasket.isPending ? "Deleting…" : "Delete Basket"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {deleteBasket.isError && (
            <div style={{ background: "var(--bg-surface)", border: "1px solid var(--negative)", padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "var(--negative)" }}>
              {deleteBasket.error?.message || "Could not delete this Basket."}
            </div>
          )}

          <Tabs
            tabs={[
              { key: "performance", label: "Performance" },
              { key: "regime", label: "Regime" },
              { key: "holdings", label: "Holdings" },
            ]}
            active={tab}
            onChange={setTab}
          />

          {/* ── Range bar (Performance + Holdings): each range shows its own return ── */}
          {tab !== "regime" && (
            <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
              {RANGES.map((r) => {
                const v = rangeChanges[r.label];
                return (
                  <Button
                    key={r.label}
                    variant="range-toggle"
                    active={range === r.label}
                    onClick={() => setRange(r.label)}
                    style={{ padding: "6px 12px", minWidth: 76, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}
                  >
                    <span style={{ fontSize: 11, letterSpacing: "0.04em" }}>{r.label}</span>
                    <span style={{ fontFamily: "var(--font-family-mono)", fontSize: 13, fontWeight: 600, color: changeColor(v) ?? "var(--text-secondary)" }}>
                      {pct(v)}
                    </span>
                  </Button>
                );
              })}
            </div>
          )}

          {/* ── Performance ── */}
          {tab === "performance" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap", minHeight: 30 }}>
                {selectedCompares.map((t) => (
                  <span key={t} style={chipStyle}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: compareColor(t) }} />
                    {compareLabel(t)}
                    <button type="button" onClick={() => toggleCompare(t)} aria-label={`Remove ${compareLabel(t)}`} style={chipCloseStyle}>×</button>
                  </span>
                ))}
                <div ref={compareRef} style={{ position: "relative" }}>
                  <Button variant="secondary" onClick={() => setCompareOpen((o) => !o)} style={{ padding: "4px 12px" }}>
                    + Compare
                  </Button>
                  {compareOpen && (
                    <div style={{ ...popoverStyle, left: 0, width: 240, maxHeight: 360, overflowY: "auto" }}>
                      <CompareGroup
                        title="Benchmarks"
                        items={COMPARISON_BENCHMARKS.map((b) => ({ ticker: b.ticker, label: b.label }))}
                        selected={selectedCompares}
                        full={selectedCompares.length >= MAX_COMPARISONS}
                        onToggle={toggleCompare}
                        colorFor={compareColor}
                      />
                      <CompareGroup
                        title="Holdings"
                        items={(basket.tickers ?? []).map((t) => ({ ticker: t, label: t }))}
                        selected={selectedCompares}
                        full={selectedCompares.length >= MAX_COMPARISONS}
                        onToggle={toggleCompare}
                        colorFor={compareColor}
                      />
                      {selectedCompares.length >= MAX_COMPARISONS && (
                        <div style={{ fontSize: 11, color: "var(--text-secondary)", padding: "6px 12px 8px" }}>
                          Max {MAX_COMPARISONS} — remove one to add another.
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {compareErrorFlag && <span style={{ fontSize: 11, color: "var(--negative)" }}>Could not load comparison data.</span>}
              </div>

              <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", padding: "16px 8px 8px" }}>
                {rebased.dates.length > 0 ? (
                  <LineChart
                    height={340}
                    dates={rebased.dates}
                    datasets={[
                      { dates: rebased.dates, data: rebased.levels, borderColor: "#a78bfa", borderWidth: 2, label: `${basket.name} (indexed to 100)` },
                      ...compareRebasedList.map((c) => ({
                        dates: c.dates,
                        data: c.levels,
                        borderColor: compareColor(c.ticker),
                        borderWidth: 2,
                        lineStyle: 2,
                        label: compareLabel(c.ticker),
                      })),
                    ]}
                    referenceLine={100}
                  />
                ) : (
                  <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
                    Not enough price history yet for this timeframe.
                  </div>
                )}

                {/* Drawdown as a sub-panel of the same chart card, same range */}
                {drawdown.dates.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 10 }}>
                    <div style={{ display: "flex", gap: 16, alignItems: "baseline", padding: "0 8px 4px", fontSize: 12, color: "var(--text-secondary)" }}>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 11 }}>Drawdown</span>
                      <span>Current <Num color={drawdown.current < 0 ? "var(--negative)" : undefined}>{pct(drawdown.current)}</Num></span>
                      <span>Max <Num color="var(--negative)">{pct(drawdown.max)}</Num></span>
                    </div>
                    <LineChart
                      height={150}
                      dates={drawdown.dates}
                      datasets={[{ dates: drawdown.dates, data: drawdown.drawdown.map((v) => v * 100), borderColor: "#f2585c", borderWidth: 2, label: "Drawdown %" }]}
                      referenceLine={0}
                    />
                  </div>
                )}
              </div>

              {compareRebasedList
                .filter((c) => c.dates[0] !== rebased.dates[0])
                .map((c) => (
                  <div key={c.ticker} style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6 }}>
                    {compareLabel(c.ticker)} price history starts {c.dates[0]} — rebased to its own start, not the selected range&apos;s.
                  </div>
                ))}
            </>
          )}

          {/* ── Regime ── */}
          {tab === "regime" && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)" }}>
                  Composite of four components, equal-weighted
                  <InfoTip text={REGIME_INFO} />
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {BASKET_REGIME_PERIODS.map((p) => (
                    <Button key={p.label} variant="range-toggle" active={regimePeriod === p.label} onClick={() => setRegimePeriod(p.label)}>
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>

              {regimeLoading ? (
                <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "24px 0", textAlign: "center" }}>Loading regime…</div>
              ) : (
                <>
                  <RegimeCards regime={regime} regimeCfg={regimeCfg} currentRegimeInfo={currentRegimeInfo} />
                  <LiveOptionsLine regime={regime} />
                  {regimeChartData && (
                    <div style={{ marginTop: 16 }}>
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
                </>
              )}
            </>
          )}

          {/* ── Holdings ── */}
          {tab === "holdings" && (
            holdingsBreakdown.length > 0 ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)", marginBottom: 10 }}>
                  Performance &amp; contribution over {range} · click a row to add it to the Performance chart
                  <InfoTip text={HOLDINGS_INFO} />
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        <th style={{ ...thStyle, width: 28 }} />
                        <th style={thStyle}>Ticker</th>
                        <th style={{ ...thStyle, width: "30%" }}>Weight</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Performance</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Contribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const maxW = Math.max(...holdingsBreakdown.map((h) => h.targetWeight));
                        return holdingsBreakdown.map((h) => {
                          const compared = selectedCompares.includes(h.ticker);
                          return (
                            <tr
                              key={h.ticker}
                              onClick={() => toggleCompare(h.ticker)}
                              title={compared ? "Remove from Performance chart" : "Add to Performance chart"}
                              style={{ cursor: "pointer", background: compared ? "rgba(255,255,255,0.03)" : "transparent" }}
                            >
                              <td style={tdStyle}>
                                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: compared ? compareColor(h.ticker) : "transparent", border: compared ? "none" : "1px solid var(--border)" }} />
                              </td>
                              <td style={{ ...tdStyle, fontWeight: 600, color: "var(--text-primary)" }}>{h.ticker}</td>
                              <td style={tdStyle}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <div style={{ flex: 1, maxWidth: 160, height: 6, background: "var(--bg-elevated)" }}>
                                    <div style={{ width: `${(h.targetWeight / maxW) * 100}%`, height: "100%", background: "#a78bfa" }} />
                                  </div>
                                  <span style={{ fontFamily: "var(--font-family-mono)", minWidth: 48 }}>{(h.targetWeight * 100).toFixed(1)}%</span>
                                </div>
                              </td>
                              <td style={{ ...tdStyle, ...numCell, color: changeColor(h.performance) ?? "var(--text-secondary)" }}>{pct(h.performance)}</td>
                              <td style={{ ...tdStyle, ...numCell, color: changeColor(h.contribution) ?? "var(--text-secondary)" }}>{pct(h.contribution)}</td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
                Not enough price history yet for this timeframe.
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

// ── Small pieces ──────────────────────────────────────────────────────────────

const REGIME_INFO =
  "Composite of BMSB, realized volatility, breadth and relative strength vs SPY, equal-weighted and 2-week smoothed. " +
  "Realized Vol is scored against its own trailing 1-year range, so it needs about a year of history before it produces a value — " +
  "on a younger Basket its line only covers the most recent part; that's expected, not missing data. " +
  "Basket VIX and IV/RV are live options-market snapshots, separate from the composite, and only available while option quotes are trading.";

const HOLDINGS_INFO =
  "Weight is the Basket's target allocation. Performance and Contribution assume a fresh rebalance to that target weight at the start " +
  "of the selected range — matching the Performance chart, which is indexed to 100 there too — so contributions sum to the Basket's own " +
  "return for the window. \"Max\" reflects the Basket's true history since inception, since it never rebalances on its own.";

function useClickOutside(ref, active, onOutside) {
  useEffect(() => {
    if (!active) return;
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) onOutside();
    }
    function handleKey(e) {
      if (e.key === "Escape") onOutside();
    }
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handleKey);
    };
  }, [ref, active, onOutside]);
}

function InfoTip({ text }) {
  return (
    <span
      title={text}
      aria-label={text}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 16, height: 16, borderRadius: "50%", border: "1px solid var(--border)",
        fontSize: 10, fontWeight: 700, color: "var(--text-secondary)", cursor: "help", flexShrink: 0,
      }}
    >
      i
    </span>
  );
}

function MetaItem({ children }) {
  return <span style={{ whiteSpace: "nowrap" }}>{children}</span>;
}

function Dot() {
  return <span style={{ color: "var(--border)" }}>·</span>;
}

function Muted({ children }) {
  return <span style={{ color: "var(--text-disabled)" }}>{children}</span>;
}

function Num({ children, color }) {
  return <span style={{ fontFamily: "var(--font-family-mono)", fontWeight: 600, color: color ?? "var(--text-primary)" }}>{children}</span>;
}

function CompareGroup({ title, items, selected, full, onToggle, colorFor }) {
  if (!items.length) return null;
  return (
    <div style={{ padding: "6px 0" }}>
      <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em", padding: "4px 12px" }}>
        {title}
      </div>
      {items.map((it) => {
        const on = selected.includes(it.ticker);
        const disabled = !on && full;
        return (
          <button
            key={it.ticker}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(it.ticker)}
            style={{ ...menuItemStyle, opacity: disabled ? 0.4 : 1, cursor: disabled ? "default" : "pointer" }}
          >
            <span style={{
              width: 12, height: 12, flexShrink: 0, border: "1px solid var(--border)",
              background: on ? colorFor(it.ticker) : "transparent",
            }} />
            <span style={{ color: on ? "var(--text-primary)" : "var(--text-secondary)" }}>{it.label}</span>
            {it.label !== it.ticker && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-disabled)" }}>{it.ticker}</span>}
          </button>
        );
      })}
    </div>
  );
}

function RegimeCards({ regime, regimeCfg, currentRegimeInfo }) {
  const last = (arr) => (arr?.length ? arr[arr.length - 1] : null);
  const bmsbScore = last(regime?.components?.bmsb);
  const bmsb = bmsbLabel(last(regime?.prices), last(regime?.ema21), last(regime?.sma20));
  const vol = last(regime?.components?.vol);
  const volBucket = scoreToRegime(vol, COMPONENT_THRESHOLDS);
  const volCfg = volBucket ? REGIME_CONFIG[volBucket] : null;
  const breadthPct = last(regime?.breadth_pct);
  const relStrength = last(regime?.components?.relative_strength);
  const relBucket = scoreToRegime(relStrength, COMPONENT_THRESHOLDS);
  const relCfg = relBucket ? REGIME_CONFIG[relBucket] : null;

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {regimeCfg && (
        <KpiCard
          label="Regime"
          formatted={regimeCfg.label}
          valueColor={regimeCfg.color}
          small
          caption={`${currentRegimeInfo.periods}d · score ${lastNonNull(regime?.score01)?.toFixed(0)}`}
        />
      )}
      <KpiCard label="BMSB" formatted={bmsb.text} valueColor={bmsb.color} small caption={bmsbScore != null ? `score ${bmsbScore.toFixed(2)}` : undefined} />
      <KpiCard label="Vol (realized)" formatted={volCfg?.label ?? "—"} valueColor={volCfg?.color ?? "var(--text-secondary)"} small caption={vol != null ? `score ${vol.toFixed(2)}` : undefined} />
      <KpiCard label="Breadth" formatted={breadthPct != null ? `${(breadthPct * 100).toFixed(0)}%` : "—"} small caption="% > own 50D SMA" />
      <KpiCard label="Relative Strength" formatted={relCfg?.label ?? "—"} valueColor={relCfg?.color ?? "var(--text-secondary)"} small caption={relStrength != null ? `score ${relStrength.toFixed(2)}` : undefined} />
    </div>
  );
}

// Live-only options snapshot — not part of the composite (no historical implied-vol source
// exists to score or chart it, see basket_regime.py), so it's a single line, not more cards.
function LiveOptionsLine({ regime }) {
  const vix = regime?.basket_vix;
  const ratio = regime?.iv_rv_ratio;
  const ratioText =
    ratio == null
      ? null
      : ratio > 1
      ? `options price ${((ratio - 1) * 100).toFixed(0)}% more vol than realized`
      : ratio < 1
      ? `options price ${((1 - ratio) * 100).toFixed(0)}% less vol than realized`
      : "in line with realized vol";
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline", marginTop: 12, fontSize: 12, color: "var(--text-secondary)" }}>
      <span style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10 }}>Live options</span>
      {vix == null && ratio == null ? (
        <span>no live quotes right now</span>
      ) : (
        <>
          <span>Basket VIX <Num>{vix != null ? `${(vix * 100).toFixed(1)}%` : "—"}</Num> <Muted>30D implied</Muted></span>
          <Dot />
          <span>IV/RV <Num>{ratio != null ? `${ratio.toFixed(2)}x` : "—"}</Num>{ratioText && <Muted> — {ratioText}</Muted>}</span>
        </>
      )}
    </div>
  );
}

const popoverStyle = {
  position: "absolute", top: "calc(100% + 4px)", zIndex: 20,
  background: "var(--bg-elevated)", border: "1px solid var(--border)",
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)", padding: "4px 0",
};
const menuItemStyle = {
  display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 12px",
  background: "transparent", border: "none", textAlign: "left", cursor: "pointer",
  fontFamily: "var(--font-family-sans)", fontSize: 13, color: "var(--text-primary)",
};
const chipStyle = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 4px 3px 10px",
  border: "1px solid var(--border)", borderRadius: "var(--radius-full)", fontSize: 12, color: "var(--text-primary)",
};
const chipCloseStyle = {
  background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer",
  fontSize: 14, lineHeight: 1, padding: "0 4px",
};
const thStyle = { fontSize: 11, color: "var(--text-secondary)", padding: "6px 8px", textAlign: "left", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" };
const tdStyle = { padding: "8px", borderTop: "1px solid var(--border)" };
const numCell = { textAlign: "right", fontFamily: "var(--font-family-mono)", fontVariantNumeric: "tabular-nums" };
