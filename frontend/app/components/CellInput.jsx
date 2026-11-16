"use client";

/** Text/number/date input for table cells (row editing, the Backtesting builder). invalid → red border. */
export default function CellInput({ value, onChange, type = "text", width = 80, align = "left", mono = false, upper = false, autoFocus, onBlur, placeholder, invalid = false, step }) {
  return (
    <input
      type={type}
      step={step}
      value={value ?? ""}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange(upper ? e.target.value.toUpperCase() : e.target.value)}
      onBlur={onBlur}
      onClick={(e) => e.stopPropagation()}
      style={{
        width, padding: "4px 6px", fontSize: 12, textAlign: align,
        background: "var(--bg-base)", border: `1px solid ${invalid ? "var(--negative)" : "var(--border)"}`, borderRadius: "var(--radius-none)",
        color: "var(--text-primary)", outline: "none", colorScheme: "dark",
        fontFamily: mono ? "var(--font-family-mono)" : "var(--font-family-sans)",
        fontVariantNumeric: "tabular-nums",
        textTransform: upper ? "uppercase" : "none",
      }}
    />
  );
}
