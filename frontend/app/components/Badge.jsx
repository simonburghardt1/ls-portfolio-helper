/**
 * Shared badge — two treatments depending on interactivity (see DESIGN.md Shapes):
 *
 *   static (default) — no container at all, plain color-coded text. For
 *                       purely informational labels (WIN/LOSS, SOON, status
 *                       rows) that shouldn't compete visually as if they
 *                       were a control.
 *   interactive       — a full pill (`--radius-full`), translucent color
 *                       fill, cursor:pointer, hover border brightening. For
 *                       genuine toggles (e.g. a LONG/SHORT position side).
 *                       This rounded register is deliberately distinct from
 *                       nav/tabs' smaller soft-rectangle radius — see
 *                       DESIGN.md Shapes for why the two aren't mixed.
 *
 * Props:
 *   variant:     "positive" | "negative" | "neutral" | "disabled" (default "neutral")
 *   interactive: bool — switches to the full-pill, clickable treatment
 *   children, onClick, style, title: standard passthroughs (onClick only
 *                applies when interactive)
 */
export default function Badge({
    variant = "neutral",
    interactive = false,
    children,
    onClick,
    style,
    title,
    ...rest
}) {
    const textColor = {
        positive: "var(--positive)",
        negative: "var(--negative)",
        neutral: "var(--text-secondary)",
        disabled: "var(--text-disabled)",
    }[variant] ?? "var(--text-secondary)";

    const fill = {
        positive: "rgba(52, 211, 153, 0.18)",
        negative: "rgba(242, 88, 92, 0.18)",
    }[variant] ?? "var(--bg-surface)";

    if (!interactive) {
        return (
            <span
                title={title}
                style={{
                    fontFamily: "var(--font-family-sans)",
                    fontSize: "var(--text-label-size)",
                    fontWeight: "var(--text-label-weight)",
                    letterSpacing: "var(--text-label-tracking)",
                    color: textColor,
                    ...style,
                }}
                {...rest}
            >
                {children}
            </span>
        );
    }

    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "3px 12px",
                borderRadius: "var(--radius-full)",
                background: fill,
                border: "1px solid transparent",
                fontFamily: "var(--font-family-sans)",
                fontSize: "var(--text-label-size)",
                fontWeight: "var(--text-label-weight)",
                letterSpacing: "var(--text-label-tracking)",
                color: textColor,
                cursor: "pointer",
                appearance: "none",
                transition: "border-color 0.1s ease",
                ...style,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--text-secondary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "transparent"; }}
            {...rest}
        >
            {children}
        </button>
    );
}
