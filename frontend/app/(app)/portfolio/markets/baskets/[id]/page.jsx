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

const RANGES = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "YTD", days: null },
  { label: "1Y", days: 365 },
];

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

export default function BasketDetailPage() {
  const { id } = useParams();
  const [range, setRange] = useState("3M");

  const { data: basket, isLoading: basketLoading, isError: basketError } = useQuery({
    queryKey: ["basket", id],
    queryFn: () => api.get(`/api/baskets/${id}`),
  });

  const { data: series, isLoading: seriesLoading, isError: seriesError, error: seriesErrorObj } = useQuery({
    queryKey: ["basket-series", id],
    queryFn: () => api.get(`/api/baskets/${id}/series`),
  });

  const rebased = useMemo(() => {
    if (!series?.dates?.length) return { dates: [], levels: [] };
    return rebase(series.dates, series.index_level, rangeStartDate(range));
  }, [series, range]);

  const holdingsBreakdown = useMemo(
    () => computeHoldingsBreakdown(series?.dates, series?.index_level, series?.holdings, rangeStartDate(range)),
    [series, range]
  );

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
            <KpiCard label="Latest NAV" formatted={basket.latest_nav != null ? basket.latest_nav.toFixed(2) : "—"} small />
            <KpiCard
              label="1D Change"
              formatted={pct(basket.nav_change_pct)}
              valueColor={basket.nav_change_pct == null ? undefined : basket.nav_change_pct >= 0 ? "var(--positive)" : "var(--negative)"}
              small
            />
            <KpiCard label="Weighting" formatted={basket.weighting_method === "market_cap" ? "Market Cap" : "Equal-weight"} small />
          </div>

          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            {RANGES.map((r) => (
              <Button key={r.label} variant="range-toggle" active={range === r.label} onClick={() => setRange(r.label)}>
                {r.label}
              </Button>
            ))}
          </div>

          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", padding: "16px 8px 8px" }}>
            {rebased.dates.length > 0 ? (
              <LineChart
                dates={rebased.dates}
                datasets={[{ dates: rebased.dates, data: rebased.levels, borderColor: "#a78bfa", borderWidth: 2, label: `${basket.name} (indexed to 100)` }]}
                referenceLine={100}
              />
            ) : (
              <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
                Not enough price history yet for this timeframe.
              </div>
            )}
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
