/**
 * Dropdown with an optional label above it — the same label-over-control look as
 * PortfolioPicker and AssetSelector, so it also fits a PageHeader's `actions` slot.
 *
 * Props:
 *   label:    optional small uppercase label
 *   value, onChange: controlled value; onChange gets the new value (string), not the event
 *   options:  [{ value, label, disabled? }] — or pass <option>/<optgroup> children instead
 *   width:    control width in px (default 240)
 *   ariaLabel: accessible name when there is no visible label
 */
export default function Select({ label, value, onChange, options, width = 240, ariaLabel, children, style }) {
  const control = (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label ? undefined : ariaLabel}
      style={{
        background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-none)",
        color: "var(--text-primary)", fontFamily: "var(--font-family-sans)", fontSize: 13,
        padding: "6px 10px", cursor: "pointer", width, maxWidth: "100%",
        ...(label ? null : style),
      }}
    >
      {options ? options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>) : children}
    </select>
  );
  if (!label) return control;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, ...style }}>
      <span style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      {control}
    </label>
  );
}
