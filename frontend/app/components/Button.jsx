/**
 * Shared button — two variants only (per spec, no primary/CTA variant yet):
 *
 *   "secondary"     — plain bordered button: `--text-secondary` text,
 *                      `--border` outline, transparent fill, sharp corners.
 *   "range-toggle"  — for range-selector button groups (e.g. 5Y/10Y/20Y/MAX).
 *                      Inactive state looks identical to "secondary". The
 *                      active/selected toggle gets `--text-primary` text and
 *                      a `--nav-active-surface` fill — sharp corners always,
 *                      unlike Tabs' rounded active treatment (confirmed by
 *                      design: rounding stays reserved for sidebar nav + tabs).
 *
 * Props:
 *   variant:  "secondary" | "range-toggle" (default "secondary")
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

    const base = {
        fontFamily: "var(--font-family-sans)",
        fontSize: "var(--font-base)",
        fontWeight: isActiveToggle ? 600 : 400,
        cursor: disabled ? "default" : "pointer",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-none)",
        padding: variant === "range-toggle" ? "4px 12px" : "8px 16px",
        background: isActiveToggle ? "var(--nav-active-surface)" : "transparent",
        color: isActiveToggle ? "var(--text-primary)" : "var(--text-secondary)",
        transition: "background 0.1s ease, color 0.1s ease, border-color 0.1s ease",
        opacity: disabled ? 0.5 : 1,
    };

    return (
        <button type="button" onClick={onClick} disabled={disabled} title={title} style={{ ...base, ...style }} {...rest}>
            {children}
        </button>
    );
}
