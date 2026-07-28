/**
 * Shared panel container — implements DESIGN.md's `{components.panel}` spec
 * exactly: sharp corners, `--bg-surface` background, 1px `--border`, an
 * optional label-styled title, and internal padding from the spacing scale.
 *
 * Panels never use `--bg-elevated` (that tone is reserved for KpiCard so
 * cards read as "lifted" one step above the panels containing them).
 *
 * Props:
 *   title:    string (optional) — label-styled heading at the top of the panel
 *   children: panel content
 *   style:    optional style overrides/extensions merged onto the container
 */
export default function Panel({ title, children, style }) {
    return (
        <div
            style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-none)",
                padding: "var(--space-5)",
                ...style,
            }}
        >
            {title && (
                <div
                    style={{
                        fontFamily: "var(--font-family-sans)",
                        fontSize: "var(--text-label-size)",
                        fontWeight: "var(--text-label-weight)",
                        lineHeight: "var(--text-label-line-height)",
                        letterSpacing: "var(--text-label-tracking)",
                        textTransform: "uppercase",
                        color: "var(--text-secondary)",
                        marginBottom: "var(--space-3)",
                    }}
                >
                    {title}
                </div>
            )}
            {children}
        </div>
    );
}
