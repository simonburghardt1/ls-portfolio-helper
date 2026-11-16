"use client";

import Popover from "@/app/components/Popover";

/**
 * Small "i" button that opens its explanation in a popup on click (closes on outside click
 * / Escape). Use it instead of an explanatory sentence on the page — the page stays quiet,
 * the detail is one click away.
 *
 * Props: text — the explanation; align — "left" | "right" popup edge (default "left")
 */
export default function InfoTip({ text, align = "left" }) {
  return (
    <Popover
      align={align}
      width={280}
      padded
      trigger={(toggle, open) => (
        <button
          type="button"
          onClick={toggle}
          aria-label="More info"
          aria-expanded={open}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 16, height: 16, padding: 0, borderRadius: "50%",
            border: `1px solid ${open ? "var(--text-secondary)" : "var(--border)"}`,
            background: open ? "var(--bg-elevated)" : "transparent",
            fontFamily: "var(--font-family-sans)", fontSize: 10, fontWeight: 700,
            color: open ? "var(--text-primary)" : "var(--text-secondary)", cursor: "pointer", verticalAlign: "middle",
          }}
        >
          i
        </button>
      )}
    >
      <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-primary)", textTransform: "none", letterSpacing: "normal", fontWeight: 400 }}>
        {text}
      </div>
    </Popover>
  );
}
