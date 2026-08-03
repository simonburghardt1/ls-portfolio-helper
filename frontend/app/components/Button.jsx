/**
 * Shared button — three variants:
 *
 *   "secondary"     — plain bordered button: `--text-secondary` text,
 *                      `--border` outline, transparent fill, sharp corners.
 *   "range-toggle"  — for range-selector button groups (e.g. 5Y/10Y/20Y/MAX).
 *                      Inactive state looks identical to "secondary". The
 *                      active/selected toggle gets `--text-primary` text and
 *                      a `--nav-active-surface` fill — sharp corners always,
 *                      unlike Tabs' rounded active treatment (confirmed by
 *                      design: rounding stays reserved for sidebar nav + tabs).
 *   "primary"       — a page's main triggered action (Run Backtest, Add
 *                      Position, Confirm Import). Solid `--text-primary`
 *                      fill with `--bg-base` text (the only "inverted"
 *                      pairing in the system) — no new hue, so `--accent`
 *                      stays exclusive to nav. Interim decision, not fully
 *                      settled: flagged as possibly needing more visual pop.
 *
 * Props:
 *   variant:  "secondary" | "range-toggle" | "primary" (default "secondary")
 *   active:   bool — only meaningful for "range-toggle"; whether this option
 *             is the currently-selected one
 *   children, onClick, disabled, style, title: standard button passthroughs
 */
export default function Button({
    variant = "secondary",
    active = false,
    children,
    onClick,
    disabled,
    style,
    title,
    ...rest
}) {
    const isActiveToggle = variant === "range-toggle" && active;
    const isPrimary = variant === "primary";

    const base = {
        fontFamily: "var(--font-family-sans)",
        fontSize: "var(--font-base)",
        fontWeight: isActiveToggle || isPrimary ? 600 : 400,
        cursor: disabled ? "default" : "pointer",
        border: isPrimary ? "1px solid var(--text-primary)" : "1px solid var(--border)",
        borderRadius: "var(--radius-none)",
        padding: variant === "range-toggle" ? "4px 12px" : "8px 16px",
        background: isPrimary ? "var(--text-primary)" : isActiveToggle ? "var(--nav-active-surface)" : "transparent",
        color: isPrimary ? "var(--bg-base)" : isActiveToggle ? "var(--text-primary)" : "var(--text-secondary)",
        transition: "background 0.1s ease, color 0.1s ease, border-color 0.1s ease",
        opacity: disabled ? 0.5 : 1,
    };

    return (
        <button type="button" onClick={onClick} disabled={disabled} title={title} style={{ ...base, ...style }} {...rest}>
            {children}
        </button>
    );
}
