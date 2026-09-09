"use client";

import { useState } from "react";
import Button from "@/app/components/Button";

// Shared across pages that need to pick any asset (stock/commodity/ETF ticker, or a
// Basket — real ones plus the synthetic HBM entry from services.basket.list_baskets).
// Page-local in spirit for now — the architecture spine flags the *final* Universal
// Asset Selector as still needing its own UX design pass (no dropdown/combobox
// precedent existed in this app's design system before this). Extracted into a shared
// component once a second page (Beta) needed the identical selector, rather than a
// second copy-paste — not itself the "final", redesigned component that pass would produce.

const SELECT_STYLE = {
  background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
  color: "#e5e7eb", fontSize: 13, padding: "6px 10px", cursor: "pointer", width: 220,
};

export default function AssetSelector({ label, baskets, selection, onChange }) {
  const [mode, setMode] = useState(selection.type === "stock" ? "ticker" : "basket");
  const [tickerText, setTickerText] = useState(selection.type === "stock" ? selection.id : "");

  function handleModeChange(newMode) {
    setMode(newMode);
    if (newMode === "ticker") {
      const t = tickerText.trim().toUpperCase();
      onChange({ type: "stock", id: t, label: t || "—" });
    } else if (baskets[0]) {
      const b = baskets[0];
      onChange({ type: b.id === -1 ? "hbm" : "basket", id: b.id, label: b.name });
    }
  }

  function handleTickerChange(e) {
    const t = e.target.value;
    setTickerText(t);
    onChange({ type: "stock", id: t.trim().toUpperCase(), label: t.trim().toUpperCase() || "—" });
  }

  function handleBasketChange(e) {
    const [type, id] = e.target.value.split(":");
    const b = baskets.find((x) => String(x.id) === id);
    onChange({ type, id, label: b?.name ?? id });
  }

  const basketValue = selection.type !== "stock" ? `${selection.type}:${selection.id}` : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </label>
      <div style={{ display: "flex", gap: 4 }}>
        <Button variant="range-toggle" active={mode === "ticker"} onClick={() => handleModeChange("ticker")}>Ticker</Button>
        <Button variant="range-toggle" active={mode === "basket"} onClick={() => handleModeChange("basket")}>Basket</Button>
      </div>
      {mode === "ticker" ? (
        <input
          type="text"
          value={tickerText}
          onChange={handleTickerChange}
          placeholder="e.g. AAPL"
          style={{ ...SELECT_STYLE, cursor: "text" }}
        />
      ) : (
        <select value={basketValue} onChange={handleBasketChange} style={SELECT_STYLE}>
          {baskets.map((b) => (
            <option key={b.id} value={`${b.id === -1 ? "hbm" : "basket"}:${b.id}`}>{b.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
