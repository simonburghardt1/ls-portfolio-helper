// Shared regime utilities — used by both the Market Regime page and the Basket
// detail page's Regime section, which both bucket a continuous composite score
// into a discrete Up/Down/Ranging-style label using the same shape of logic,
// just at different scales (Market Regime: composite ~[-1,1]; Basket: score01 0-100).

export function scoreToRegime(score, thresholds) {
  if (score == null) return null;
  const { up, down } = thresholds;
  if (score > up) return "up";
  if (score < down) return "down";
  return "ranging";
}

export function lastNonNull(arr) {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return null;
}

// `periods`: count of consecutive trailing entries in the current regime bucket
// (a plain index count, not a calendar unit — both pages' underlying data is
// daily bars, per market_regime.py's own "daily-bar equivalents of weekly
// periods" comment, so callers decide their own display label, e.g. "weeks" to
// match Market Regime's existing copy, or "days" for a more literal reading).
export function getCurrentRegimeInfo(regimes, dates) {
  if (!regimes?.length) return null;
  let i = regimes.length - 1;
  while (i >= 0 && regimes[i] === null) i--;
  if (i < 0) return null;
  const regime = regimes[i];
  let start = i;
  while (start > 0 && regimes[start - 1] === regime) start--;
  return { regime, periods: i - start + 1, date: dates[i], index: i };
}
