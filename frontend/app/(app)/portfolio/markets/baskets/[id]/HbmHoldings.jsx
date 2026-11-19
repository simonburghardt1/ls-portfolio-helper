"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import { fmtNum, fmtPct, signColor } from "@/app/lib/format";
import DataTable from "@/app/components/DataTable";
import StateMessage from "@/app/components/StateMessage";

/**
 * Holdings tab for High Beta Momentum. Its members change every month, so instead of the
 * custom-Basket performance/contribution table this shows the factor screen behind each
 * monthly rebalance, with the rebalance date to pick.
 */
export default function HbmHoldings({ selectedCompares, onToggleCompare, compareColor }) {
  const [picked, setPicked] = useState(null);

  const { data: rebalances } = useQuery({
    queryKey: ["hbm-rebalance-dates"],
    queryFn: () => api.get("/api/high-beta-momentum/rebalance-dates"),
  });
  const dates = rebalances?.dates ?? [];
  const latest = dates[dates.length - 1] ?? null;
  const date = picked ?? latest; // newest rebalance until one is picked
  const isLatest = date === latest;

  const holdings = useQuery({
    queryKey: ["hbm-holdings", date],
    queryFn: () => api.get(`/api/high-beta-momentum/holdings?date=${date}`),
    enabled: !!date,
  });
  const rows = holdings.data?.rows ?? [];
  const avg = (k) => (rows.length ? rows.reduce((t, r) => t + (r[k] ?? 0), 0) / rows.length : null);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Rebalance</span>
        <select
          value={date ?? ""}
          onChange={(e) => setPicked(e.target.value)}
          aria-label="Rebalance date"
          style={{ background: "var(--bg-base)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: 13, padding: "6px 10px", cursor: "pointer" }}
        >
          {[...dates].reverse().map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {rows.length > 0 && (
          <span style={{ fontSize: 12, fontFamily: "var(--font-family-mono)", color: "var(--text-secondary)" }}>
            {rows.length} · avg β {fmtNum(avg("beta"))} · avg momentum {fmtPct(avg("momentum"), 0)}
          </span>
        )}
        {isLatest && rows.length > 0 && (
          <span style={{ fontSize: 12, color: "var(--text-disabled)" }}>Click a row to add it to the Performance chart</span>
        )}
      </div>

      {holdings.isLoading ? <StateMessage kind="loading" /> : holdings.error ? (
        <StateMessage kind="error">{holdings.error.message}</StateMessage>
      ) : (
        <DataTable
          rows={rows}
          rowKey="ticker"
          defaultSort={{ key: "rank", dir: "asc" }}
          // Only today's members can be compared (the compare endpoint serves current holdings)
          onRowClick={isLatest ? (r) => onToggleCompare(r.ticker) : undefined}
          isRowSelected={(r) => isLatest && selectedCompares.includes(r.ticker)}
          columns={[
            ...(isLatest ? [{
              key: "dot", label: "", width: 28,
              render: (r) => {
                const on = selectedCompares.includes(r.ticker);
                return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: on ? compareColor(r.ticker) : "transparent", border: on ? "none" : "1px solid var(--border)" }} />;
              },
            }] : []),
            { key: "rank", label: "#", numeric: true, sortable: true, width: 48 },
            { key: "ticker", label: "Ticker", sortable: true, value: (r) => r.ticker, render: (r) => <span style={{ fontWeight: 600 }}>{r.ticker}</span> },
            { key: "beta", label: "Beta", numeric: true, sortable: true, format: (v) => fmtNum(v) },
            { key: "momentum", label: "Momentum 12-1", numeric: true, sortable: true, format: (v) => fmtPct(v, 1), color: signColor },
            { key: "combined_score", label: "Score", numeric: true, sortable: true, format: (v) => fmtNum(v), title: "0.5×z(beta) + 0.5×z(momentum)" },
            { key: "market_cap", label: "Market cap", numeric: true, sortable: true, format: (v) => (v != null ? `$${(v / 1e9).toFixed(1)}B` : "—") },
            { key: "weight", label: "Weight", numeric: true, sortable: true, format: (v) => fmtPct(v, 1, { sign: false }) },
          ]}
        />
      )}
    </>
  );
}
