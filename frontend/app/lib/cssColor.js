// Canvas charts (lightweight-charts) paint without the CSS engine, so a colour like
// "var(--negative)" means nothing to them. The chart components pass every colour they get
// from a page through resolveColor, which looks the variable up on :root. Pages can then
// use the same tokens for charts as for everything else. Client-side only (charts are).

const VAR_RE = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/;

export function resolveColor(color) {
  if (typeof color !== "string" || typeof window === "undefined") return color;
  const m = color.trim().match(VAR_RE);
  if (!m) return color;
  const value = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
  return value || (m[2] ? resolveColor(m[2].trim()) : color);
}

/** A resolved colour with transparency: "#8b5cf6" + 0.4 → "rgba(139,92,246,0.4)". Non-hex colours pass through. */
export function withAlpha(color, alpha) {
  const c = resolveColor(color);
  const m = typeof c === "string" && c.match(/^#([0-9a-f]{6})$/i);
  if (!m || alpha == null) return c;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
