"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";

/**
 * Portfolio source picker for the portfolio risk pages — same label-over-control look as
 * AssetSelector, so it sits in a PageHeader's `actions` slot the same way.
 *
 * Props:
 *   value:     "live" | portfolio id | null
 *   onChange:  (value, name) => void
 *   allowLive: include "Live portfolio" (the Track Record's open positions) as an option
 */
export default function PortfolioPicker({ value, onChange, allowLive = false }) {
  const { data: portfolios } = useQuery({ queryKey: ["portfolios"], queryFn: () => api.get("/api/portfolios") });

  function handle(e) {
    const raw = e.target.value;
    if (raw === "live") return onChange("live", "Live portfolio");
    const id = Number(raw);
    onChange(id, (portfolios ?? []).find((p) => p.id === id)?.name ?? null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Portfolio
      </label>
      <select
        value={value ?? ""}
        onChange={handle}
        style={{
          background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
          color: "var(--text-primary)", fontFamily: "var(--font-family-sans)", fontSize: 13,
          padding: "6px 10px", cursor: "pointer", width: 240,
        }}
      >
        {value == null && <option value="" disabled>Select a portfolio</option>}
        {allowLive && <option value="live">Live portfolio</option>}
        {(portfolios ?? []).length > 0 && (
          <optgroup label="Saved">
            {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
        )}
      </select>
    </div>
  );
}
