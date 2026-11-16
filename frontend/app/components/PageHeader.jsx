/**
 * Page title row.
 *
 * Props:
 *   title:    page title (the only required piece — no subtitle by default, see DESIGN.md
 *             → Restraint)
 *   badges:   optional node rendered inline right after the title (status pill, SYSTEM tag)
 *   meta:     optional node for one quiet line of key facts under the title
 *   actions:  optional node pinned to the right (buttons, an asset picker)
 *   back:     optional { href, label } breadcrumb link above the title
 *   subtitle: legacy — still rendered for pages not yet migrated; don't use on new pages
 *   style:    container style overrides
 */
import Link from "next/link";

export default function PageHeader({ title, badges, meta, actions, back, subtitle, style }) {
  return (
    <div style={{ marginBottom: "var(--space-6)", ...style }}>
      {back && (
        <Link href={back.href} style={{ display: "inline-block", fontSize: 12, color: "var(--text-secondary)", marginBottom: "var(--space-3)" }}>
          ← {back.label}
        </Link>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <h1
              style={{
                fontFamily: "var(--font-family-sans)",
                fontSize: "var(--text-headline-size)",
                fontWeight: "var(--text-headline-weight)",
                lineHeight: "var(--text-headline-line-height)",
                letterSpacing: "var(--text-headline-tracking)",
                color: "var(--text-primary)",
              }}
            >
              {title}
            </h1>
            {badges}
          </div>
          {meta && (
            <div style={{ marginTop: "var(--space-2)", fontSize: 13, color: "var(--text-secondary)", display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
              {meta}
            </div>
          )}
          {subtitle && (
            <p
              style={{
                marginTop: "var(--space-1)",
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
        {actions && <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end", flexShrink: 0 }}>{actions}</div>}
      </div>
    </div>
  );
}
