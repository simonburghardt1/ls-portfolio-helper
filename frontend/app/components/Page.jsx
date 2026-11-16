/**
 * Outer frame for every app page: background, padding, text colour. Pages render
 * <Page><PageHeader …/>…sections…</Page> instead of hand-rolling the wrapper div.
 */
export default function Page({ children, style }) {
  return (
    <div style={{ padding: "28px 32px", minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)", ...style }}>
      {children}
    </div>
  );
}
