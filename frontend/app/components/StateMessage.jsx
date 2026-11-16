/**
 * The one way to show loading / empty / error states.
 *
 *   <StateMessage kind="loading" />                    → "Loading…"
 *   <StateMessage kind="empty">No Baskets yet.</StateMessage>
 *   <StateMessage kind="error">Could not load …</StateMessage>
 *
 * Copy rule: one short sentence, no exclamation marks, no apologies.
 */
export default function StateMessage({ kind = "empty", children, style }) {
  if (kind === "error") {
    return (
      <div
        role="alert"
        style={{
          background: "var(--bg-surface)", border: "1px solid var(--negative)", color: "var(--negative)",
          padding: "10px 14px", fontSize: 13, marginBottom: "var(--space-4)", ...style,
        }}
      >
        {children ?? "Something went wrong."}
      </div>
    );
  }
  return (
    <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: "40px 0", textAlign: "center", ...style }}>
      {children ?? (kind === "loading" ? "Loading…" : "Nothing to show.")}
    </div>
  );
}
