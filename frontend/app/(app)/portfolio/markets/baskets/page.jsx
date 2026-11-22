"use client";

import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import PageHeader from "@/app/components/PageHeader";
import Button from "@/app/components/Button";
import { REGIME_CONFIG } from "@/app/components/RegimeChart";
import { scoreToRegime } from "@/app/lib/regime";
import { fmtPct, signColor } from "@/app/lib/format";
import Page from "@/app/components/Page";
import Sparkline from "@/app/components/Sparkline";
import StateMessage from "@/app/components/StateMessage";
import styles from "@/app/components/OverviewCard.module.css";

// Same thresholds as the Basket detail page's BASKET_REGIME_THRESHOLDS (score01 0-100 scale).
const REGIME_THRESHOLDS = { up: 60, down: 40 };

// Kept in sync with backend/app/services/basket.py's HBM_SYNTHETIC_ID — High Beta Momentum is
// projected into this list from its own tables and opens the normal Basket detail page under
// /baskets/high-beta-momentum (the API serves it as id -1).
const HBM_SYNTHETIC_ID = -1;

const SPARK_DAYS = 63; // ~3 months of trading days

export default function BasketsPage() {
  const { data: baskets, isLoading, isError, error } = useQuery({
    queryKey: ["baskets"],
    queryFn: () => api.get("/api/baskets"),
  });

  // Same query key as the detail page, so opening a Basket after this is served from cache.
  const seriesQueries = useQueries({
    queries: (baskets ?? []).map((b) => ({
      queryKey: ["basket-series", String(b.id)],
      queryFn: () => api.get(`/api/baskets/${b.id}/series`),
      staleTime: 5 * 60 * 1000,
    })),
  });
  const seriesById = Object.fromEntries((baskets ?? []).map((b, i) => [b.id, seriesQueries[i]?.data]));

  const mine = (baskets ?? []).filter((b) => b.user_id != null);
  const system = (baskets ?? []).filter((b) => b.user_id == null);

  return (
    <Page>
      <PageHeader
        title="Baskets"
        subtitle="Custom and system Baskets. Click a card for its performance, regime and holdings."
        actions={<Link href="/portfolio/markets/baskets/new"><Button variant="primary">+ Add Basket</Button></Link>}
      />

      {isLoading && <StateMessage kind="loading" />}
      {isError && <StateMessage kind="error">{error?.message || "Could not load Baskets."}</StateMessage>}
      {!isLoading && !isError && baskets?.length === 0 && <StateMessage>No Baskets yet. Use + Add Basket to create one.</StateMessage>}

      {!isLoading && !isError && baskets?.length > 0 && (
        <>
          <BasketSection title="My Baskets" baskets={mine} seriesById={seriesById} />
          <BasketSection title="System Baskets" baskets={system} seriesById={seriesById} />
        </>
      )}
    </Page>
  );
}

function BasketSection({ title, baskets, seriesById }) {
  if (!baskets.length) return null;
  return (
    <section style={{ marginBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        <h2 style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
          {title}
        </h2>
        <span style={{ fontSize: 12, color: "var(--text-disabled)" }}>{baskets.length}</span>
      </div>
      {/* Fixed column width → every card the same size, whatever its name or content */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
        {baskets.map((b) => (
          <BasketCard key={b.id} basket={b} series={seriesById[b.id]} />
        ))}
      </div>
    </section>
  );
}

function BasketCard({ basket: b, series }) {
  const href = `/portfolio/markets/baskets/${b.id === HBM_SYNTHETIC_ID ? "high-beta-momentum" : b.id}`;
  const nHoldings = b.num_holdings ?? b.tickers?.length;
  const regimeBucket = b.regime_score != null ? scoreToRegime(b.regime_score, REGIME_THRESHOLDS) : null;
  const regime = regimeBucket ? REGIME_CONFIG[regimeBucket] : null;

  const spark = series?.index_level?.slice(-SPARK_DAYS) ?? null;
  const sparkChange = spark?.length > 1 ? spark[spark.length - 1] / spark[0] - 1 : null;

  return (
    <Link href={href} className={styles.card}>
      {/* Name + meta */}
      <div style={{ minWidth: 0 }}>
        <div title={b.name} style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {b.name}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
          {nHoldings != null ? `${nHoldings} holdings` : "—"}
          {b.weighting_method && ` · ${b.weighting_method === "market_cap" ? "Market-cap" : "Equal-weight"}`}
        </div>
      </div>

      {/* Returns */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <div>
          <span style={{ fontFamily: "var(--font-family-mono)", fontSize: 22, fontWeight: 600, color: signColor(b.nav_change_pct), fontVariantNumeric: "tabular-nums" }}>
            {fmtPct(b.nav_change_pct)}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 4 }}>1D</span>
        </div>
        <div>
          <span style={{ fontFamily: "var(--font-family-mono)", fontSize: 13, fontWeight: 600, color: signColor(b.ytd_change_pct) }}>
            {fmtPct(b.ytd_change_pct)}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 4 }}>YTD</span>
        </div>
      </div>

      {/* 3-month sparkline */}
      <div style={{ height: 44 }}>
        {spark?.length > 1 ? (
          <Sparkline values={spark} color={sparkChange >= 0 ? "var(--positive)" : "var(--negative)"} />
        ) : (
          <div style={{ height: "100%", background: "var(--bg-surface)", opacity: 0.5 }} />
        )}
      </div>

      {/* Regime */}
      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
        {regime ? (
          <>
            <span style={{ color: regime.color, fontWeight: 600, whiteSpace: "nowrap" }}>
              {regime.label} <span style={{ fontFamily: "var(--font-family-mono)", opacity: 0.85 }}>{Math.round(b.regime_score)}</span>
            </span>
            <ScoreBar score={b.regime_score} color={regime.color} />
          </>
        ) : (
          <span style={{ color: "var(--text-disabled)" }}>Regime not scored yet</span>
        )}
        {sparkChange != null && (
          <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-disabled)", letterSpacing: "0.06em" }}>
            3M <span style={{ color: signColor(sparkChange), fontFamily: "var(--font-family-mono)" }}>{fmtPct(sparkChange)}</span>
          </span>
        )}
      </div>
    </Link>
  );
}

// 0-100 regime score with the 40/60 Ranging band marked
function ScoreBar({ score, color }) {
  return (
    <div style={{ position: "relative", flex: 1, maxWidth: 90, height: 4, background: "var(--bg-surface)" }}>
      <div style={{ position: "absolute", left: "40%", width: "20%", top: 0, bottom: 0, background: "rgba(255,255,255,0.06)" }} />
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.max(0, Math.min(100, score))}%`, background: color }} />
    </div>
  );
}
