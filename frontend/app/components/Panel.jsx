/**
 * Section container — DESIGN.md `{components.panel}`: sharp corners, --bg-surface, 1px
 * --border. Panels never use --bg-elevated (reserved for KpiCard, so cards read one step
 * "lifted" above the panels around them).
 *
 * Props:
 *   title:    optional label-styled heading (short noun phrase, no explanatory sentence —
 *             put explanations in an <InfoTip/> passed via `titleExtra`)
 *   titleExtra: optional node right after the title (InfoTip, a legend)
 *   actions:  optional node pinned to the right of the title row
 *   flush:    true → no padding (tables that run edge to edge); the title row keeps its own
 *   children, style
 */
export default function Panel({ title, titleExtra, actions, flush = false, children, style }) {
  const hasHead = title || titleExtra || actions;
  return (
    <section
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-none)",
        padding: flush ? 0 : "var(--space-4)",
        marginBottom: "var(--space-5)",
        ...style,
      }}
    >
      {hasHead && (
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap",
            marginBottom: "var(--space-3)", padding: flush ? "var(--space-4) var(--space-4) 0" : 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap", minWidth: 0 }}>
            {title && (
              <h2
                style={{
                  fontFamily: "var(--font-family-sans)",
                  fontSize: "var(--text-label-size)",
                  fontWeight: "var(--text-label-weight)",
                  lineHeight: "var(--text-label-line-height)",
                  letterSpacing: "var(--text-label-tracking)",
                  textTransform: "uppercase",
                  color: "var(--text-secondary)",
                }}
              >
                {title}
              </h2>
            )}
            {titleExtra}
          </div>
          {actions && <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
