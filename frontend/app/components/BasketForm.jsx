"use client";

import { useState } from "react";
import Link from "next/link";
import PageHeader from "@/app/components/PageHeader";
import Button from "@/app/components/Button";

const MIN_HOLDINGS = 5;
const MAX_HOLDINGS = 20;

function paddedTickers(tickers) {
  const list = tickers?.length ? [...tickers] : [];
  while (list.length < MIN_HOLDINGS) list.push("");
  return list;
}

/**
 * Shared Basket name/tickers/weighting form — used by both the Add Basket page (create) and
 * the Basket edit page, so editing lands on "the same mask" as creation. The caller owns the
 * mutation (create vs. update hit different endpoints); this component owns only form state,
 * validation, and layout.
 *
 * Props:
 *   title, subtitle:            page heading text
 *   initialName:                string (default "")
 *   initialWeightingMethod:     "equal" | "market_cap" (default "equal")
 *   initialTickers:             string[] (default 5 empty rows)
 *   submitLabel, savingLabel:   button text (idle / pending)
 *   onSubmit({name, tickers, weighting_method}): called with a validated payload
 *   isPending:                  bool — disables the submit button, shows savingLabel
 *   serverError:                string | null — surfaced below the form (e.g. mutation error)
 *   cancelHref:                 Link target for the Cancel button
 */
export default function BasketForm({
  title,
  subtitle,
  initialName = "",
  initialWeightingMethod = "equal",
  initialTickers,
  submitLabel = "Save Basket",
  savingLabel = "Saving…",
  onSubmit,
  isPending = false,
  serverError = null,
  cancelHref = "/portfolio/markets/baskets",
}) {
  const [name, setName] = useState(initialName);
  const [weightingMethod, setWeightingMethod] = useState(initialWeightingMethod);
  const [tickers, setTickers] = useState(() => paddedTickers(initialTickers));
  const [validationError, setValidationError] = useState(null);

  function updateTicker(index, value) {
    setTickers((t) => {
      const next = [...t];
      next[index] = value.toUpperCase();
      return next;
    });
  }

  function addTicker() {
    setTickers((t) => (t.length >= MAX_HOLDINGS ? t : [...t, ""]));
  }

  function removeTicker(index) {
    setTickers((t) => t.filter((_, i) => i !== index));
  }

  function validate() {
    if (!name.trim()) return "Basket name is required.";
    const trimmed = tickers.map((t) => t.trim()).filter(Boolean);
    if (trimmed.length < MIN_HOLDINGS || trimmed.length > MAX_HOLDINGS) {
      return `A Basket must have between ${MIN_HOLDINGS} and ${MAX_HOLDINGS} holdings (currently ${trimmed.length}).`;
    }
    if (new Set(trimmed).size !== trimmed.length) {
      return "Duplicate tickers are not allowed.";
    }
    return null;
  }

  function submit() {
    const error = validate();
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    onSubmit({
      name: name.trim(),
      tickers: tickers.map((t) => t.trim()).filter(Boolean),
      weighting_method: weightingMethod,
    });
  }

  const displayError = validationError || serverError;

  return (
    <div style={{ padding: "28px 32px", minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <PageHeader title={title} subtitle={subtitle} />

      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", padding: "24px 28px", maxWidth: 560 }}>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>Basket Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Marine Shipping"
            style={{
              background: "var(--bg-base)", border: "1px solid var(--border)",
              padding: "8px 12px", fontSize: 14, color: "var(--text-primary)", outline: "none", width: "100%",
            }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 8 }}>Weighting</label>
          <div style={{ display: "flex", gap: 4 }}>
            <Button variant="range-toggle" active={weightingMethod === "equal"} onClick={() => setWeightingMethod("equal")}>
              Equal-weight
            </Button>
            <Button variant="range-toggle" active={weightingMethod === "market_cap"} onClick={() => setWeightingMethod("market_cap")}>
              Market Cap Weighted
            </Button>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 8 }}>
            Tickers ({tickers.length}/{MAX_HOLDINGS}, minimum {MIN_HOLDINGS})
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {tickers.map((t, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  value={t}
                  onChange={(e) => updateTicker(i, e.target.value)}
                  placeholder="AAPL"
                  style={{
                    width: 90, background: "var(--bg-base)", border: "1px solid var(--border)",
                    padding: "6px 10px", fontSize: 13, color: "var(--text-primary)", outline: "none",
                  }}
                />
                {tickers.length > MIN_HOLDINGS && (
                  <button
                    onClick={() => removeTicker(i)}
                    style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 16, padding: "2px 4px" }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <Button
            variant="secondary"
            onClick={addTicker}
            disabled={tickers.length >= MAX_HOLDINGS}
            style={{ marginTop: 10, fontSize: 12 }}
          >
            + Add Ticker
          </Button>
        </div>

        {displayError && (
          <div style={{ fontSize: 13, color: "var(--negative)", background: "var(--bg-surface)", border: "1px solid var(--negative)", padding: "8px 12px", marginBottom: 14 }}>
            {displayError}
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="primary" onClick={submit} disabled={isPending}>
            {isPending ? savingLabel : submitLabel}
          </Button>
          <Link href={cancelHref} style={{ textDecoration: "none" }}>
            <Button variant="secondary">Cancel</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
