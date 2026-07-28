/**
 * Shared page header: title + optional subtitle.
 *
 * Uses DESIGN.md's headline/body typography tokens so the page-title-to-
 * body-text size ratio (34px vs. 14.5px) is consistent everywhere instead
 * of each page hand-rolling its own (previously flattened) heading size.
 *
 * Props:
 *   title:    string — the page's h1 headline
 *   subtitle: string (optional) — one line of supporting body copy
 */
export default function PageHeader({ title, subtitle }) {
    return (
        <div style={{ marginBottom: "var(--space-6)" }}>
            <h1
                style={{
                    fontFamily: "var(--font-family-sans)",
                    fontSize: "var(--text-headline-size)",
                    fontWeight: "var(--text-headline-weight)",
                    lineHeight: "var(--text-headline-line-height)",
                    letterSpacing: "var(--text-headline-tracking)",
                    color: "var(--text-primary)",
                    marginBottom: subtitle ? "var(--space-1)" : 0,
                }}
            >
                {title}
            </h1>
            {subtitle && (
                <p
                    style={{
                        fontFamily: "var(--font-family-sans)",
                        fontSize: "var(--text-body-size)",
                        fontWeight: "var(--text-body-weight)",
                        lineHeight: "var(--text-body-line-height)",
                        color: "var(--text-secondary)",
                    }}
                >
                    {subtitle}
                </p>
            )}
        </div>
    );
}
