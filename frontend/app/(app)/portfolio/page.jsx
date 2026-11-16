"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import { fmtNum, fmtPct, signColor } from "@/app/lib/format";
import { usePortfolioSelectionStore } from "@/app/store/portfolioSelectionStore";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Button from "@/app/components/Button";
import Popover, { MenuItem, MenuDivider } from "@/app/components/Popover";
import StateMessage from "@/app/components/StateMessage";
import Sparkline from "@/app/components/Sparkline";
import styles from "./portfolios.module.css";

export default function PortfoliosPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setSelectedPortfolio } = usePortfolioSelectionStore();

  const { data: portfolios, isLoading, error } = useQuery({
    queryKey: ["portfolios"],
    queryFn: () => api.get("/api/portfolios"),
  });

  // Returns, beta and correlation for every card from one request (prices downloaded once)
  const { data: summaries } = useQuery({
    queryKey: ["portfolios-summary", portfolios?.map((p) => `${p.id}:${p.updated_at}`).join(",")],
    queryFn: () => api.get("/api/portfolios/summary"),
    enabled: portfolios?.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  const summaryById = Object.fromEntries((summaries ?? []).map((s) => [s.id, s]));

  const remove = useMutation({
    mutationFn: (id) => api.delete(`/api/portfolios/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      queryClient.invalidateQueries({ queryKey: ["portfolios-summary"] });
    },
  });

  // Every analysis page reads the shared selection, so "open in X" = select, then navigate
  function openIn(p, href) {
    setSelectedPortfolio(p.id, p.name);
    router.push(href);
  }

  function confirmDelete(p) {
    if (window.confirm(`Delete portfolio "${p.name}"? This cannot be undone.`)) remove.mutate(p.id);
  }

  return (
    <Page>
      <PageHeader
        title="Portfolios"
        subtitle="Saved long/short portfolios. Click one to backtest it."
        actions={<Link href="/portfolio/new"><Button variant="primary">+ New portfolio</Button></Link>}
      />

      {isLoading && <StateMessage kind="loading" />}
      {error && <StateMessage kind="error">{error.message}</StateMessage>}
      {remove.isError && <StateMessage kind="error">{remove.error?.message || "Could not delete the portfolio."}</StateMessage>}
      {portfolios && portfolios.length === 0 && <StateMessage>No portfolios yet. Use + New portfolio to create one.</StateMessage>}

      {portfolios?.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {portfolios.map((p) => (
            <PortfolioCard
              key={p.id}
              portfolio={p}
              summary={summaryById[p.id]}
              loadingSummary={!summaries}
              onOpen={() => openIn(p, "/portfolio/backtesting")}
              onEdit={() => router.push(`/portfolio/${p.id}/edit`)}
              onCopy={() => router.push(`/portfolio/new?copyFrom=${p.id}`)}
              onVolatility={() => openIn(p, "/portfolio/risk/volatility")}
              onBeta={() => openIn(p, "/portfolio/risk/beta")}
              onDelete={() => confirmDelete(p)}
            />
          ))}
        </div>
      )}
    </Page>
  );
}

function PortfolioCard({ portfolio: p, summary: s, loadingSummary, onOpen, onEdit, onCopy, onVolatility, onBeta, onDelete }) {
  const longs = p.positions.filter((x) => x.side === "long").length;
  const net = Math.round(p.positions.reduce((t, x) => t + (x.side === "short" ? -1 : 1) * (Number(x.weight) || 0), 0) * 1e4) / 1e4; // to 0.01%: stored weights carry rounding noise
  const failed = s?.missing?.length > 0;

  return (
    <div
      className={styles.card}
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      title="Open in the Backtester"
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div title={p.name} style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {p.name}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
            {p.positions.length} positions · {longs} L / {p.positions.length - longs} S
          </div>
        </div>
        {/* stopPropagation: the menu must not also open the card */}
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Popover
            align="right"
            width={200}
            trigger={(toggle) => (
              <button type="button" className={styles.menuButton} onClick={toggle} aria-label={`More actions for ${p.name}`} title="More actions">⋯</button>
            )}
          >
            {(close) => (
              <>
                <MenuItem onClick={() => { close(); onEdit(); }}>Edit</MenuItem>
                <MenuItem onClick={() => { close(); onCopy(); }}>Copy portfolio</MenuItem>
                <MenuDivider />
                <MenuItem onClick={() => { close(); onVolatility(); }}>Volatility &amp; correlation</MenuItem>
                <MenuItem onClick={() => { close(); onBeta(); }}>Beta</MenuItem>
                <MenuDivider />
                <MenuItem danger onClick={() => { close(); onDelete(); }}>Delete portfolio</MenuItem>
              </>
            )}
          </Popover>
        </div>
      </div>

      {/* Returns of the book as it stands today */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <Ret value={s?.ret_1d} label="1D" size={22} />
        <Ret value={s?.ret_ytd} label="YTD" size={13} />
      </div>

      <div style={{ height: 44 }}>
        {s?.spark?.length > 1 ? (
          <Sparkline values={s.spark} color={s.ret_3m >= 0 ? "var(--positive)" : "var(--negative)"} />
        ) : failed ? (
          <div style={{ fontSize: 12, color: "var(--text-disabled)" }}>No price data for {s.missing.join(", ")}</div>
        ) : (
          <div style={{ height: "100%", background: "var(--bg-surface)", opacity: loadingSummary ? 0.5 : 0.3 }} />
        )}
      </div>

      <div style={{ marginTop: "auto", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <Kpi label="Beta" value={fmtNum(s?.beta)} />
        <Kpi label="Corr" value={fmtNum(s?.correlation)} />
        <Kpi label="Net" value={fmtPct(net, 0)} color={signColor(Math.round(net * 100) / 100)} />
      </div>
    </div>
  );
}

function Ret({ value, label, size }) {
  return (
    <div>
      <span style={{ fontFamily: "var(--font-family-mono)", fontSize: size, fontWeight: 600, color: value != null ? signColor(value) : "var(--text-disabled)", fontVariantNumeric: "tabular-nums" }}>
        {value != null ? fmtPct(value) : "—"}
      </span>
      <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 4 }}>{label}</span>
    </div>
  );
}

function Kpi({ label, value, color = "var(--text-primary)" }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: "0.06em", color: "var(--text-disabled)" }}>{label.toUpperCase()}</div>
      <div style={{ fontFamily: "var(--font-family-mono)", fontSize: 13, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}
