// Descriptive statistics and normal-distribution helpers for the return histograms.

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7). */
export function normCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Standard normal density. */
export function normPdf(z) {
  return Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI);
}

/** Inverse standard normal CDF (Acklam's rational approximation, relative error < 1.2e-9). */
export function normInv(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -normInv(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Quantile of sorted values (linear interpolation, like numpy's default). */
export function quantile(sorted, p) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Summary of a sample: mean, median, sigma (sample sd), skewness, excess kurtosis, min/max with
 * their index, tails beyond ±kσ vs. the normal, quantiles vs. the normal, Jarque–Bera.
 */
export function describe(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  const n = v.length;
  if (n < 3) return null;
  const mean = v.reduce((a, b) => a + b, 0) / n;
  let m2 = 0, m3 = 0, m4 = 0;
  for (const x of v) {
    const d = x - mean;
    m2 += d * d; m3 += d * d * d; m4 += d * d * d * d;
  }
  m2 /= n; m3 /= n; m4 /= n;
  const sigma = Math.sqrt((m2 * n) / (n - 1));
  const skew = m2 > 0 ? m3 / m2 ** 1.5 : 0;
  const kurt = m2 > 0 ? m4 / (m2 * m2) - 3 : 0;
  const sorted = [...v].sort((a, b) => a - b);

  // Positions in the original array (so callers can look up the matching date)
  let minIdx = -1, maxIdx = -1;
  values.forEach((x, i) => {
    if (x == null || !Number.isFinite(x)) return;
    if (minIdx < 0 || x < values[minIdx]) minIdx = i;
    if (maxIdx < 0 || x > values[maxIdx]) maxIdx = i;
  });

  const tails = [1, 2, 3].map((k) => {
    const count = v.filter((x) => Math.abs(x - mean) > k * sigma).length;
    return { k, count, share: count / n, normal: 2 * (1 - normCdf(k)) };
  });
  const quantiles = [0.01, 0.05, 0.95, 0.99].map((p) => ({ p, observed: quantile(sorted, p), normal: mean + sigma * normInv(p) }));

  const jb = (n / 6) * (skew * skew + (kurt * kurt) / 4);
  return {
    n, mean, median: quantile(sorted, 0.5), sigma, skew, kurt,
    min: sorted[0], max: sorted[n - 1], minIdx, maxIdx,
    up: v.filter((x) => x > 0).length, down: v.filter((x) => x < 0).length,
    tails, quantiles,
    jb, jbP: Math.exp(-jb / 2), // chi-square with 2 degrees of freedom
  };
}

/**
 * Bin width: the Freedman–Diaconis rule, but at least ~1.5·√n bins (FD gets coarse for small
 * samples like 120 months) and at most ~120; rounded down to a 1/2/2.5/5 × 10^k step.
 */
export function niceBinWidth(sorted) {
  const n = sorted.length;
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  const span = sorted[n - 1] - sorted[0] || 1;
  const fd = iqr > 0 ? (2 * iqr) / Math.cbrt(n) : span / 20;
  const minBins = Math.min(100, Math.max(12, 1.5 * Math.sqrt(n)));
  let w = Math.min(fd, span / minBins);
  w = Math.max(w, span / 120);
  // round down to the nearest nice step, so the bin count never drops below the target
  const mag = 10 ** Math.floor(Math.log10(w));
  return [5, 2.5, 2, 1].find((s) => s * mag <= w * (1 + 1e-9)) * mag;
}
