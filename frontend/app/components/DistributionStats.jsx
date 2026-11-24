"use client";

import { useMemo } from "react";
import { describe } from "@/app/lib/stats";

/**
 * The numbers behind a <DistributionHistogram>: distribution, tails and quantiles against the
 * normal, a Jarque–Bera normality test and the sample. A narrow column meant to sit right of
 * the histogram.
 *
 * Props:
 *   values, dates: the same sample as the histogram (dates optional — used for best/worst and range)
 *   format:        (v) => string for values (e.g. a % formatter)
 *   periodLabel:   "week" / "month" — for "Best week", "Up / down weeks"
 */
export default function DistributionStats({ values, dates, format, periodLabel = "period" }) {
  const s = useMemo(() => describe(values), [values]);
  if (!s) return null;

  const at = (i) => (dates?.[i] ? ` · ${dates[i]}` : "");
  const firstDate = dates?.find((d, i) => d && values[i] != null);
  const lastDate = dates && [...dates].reverse().find((d, i) => d && values[values.length - 1 - i] != null);
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const normal = s.jbP >= 0.05;

  return (
    <div style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
      <Section title="Distribution">
        <Row label="Mean" value={format(s.mean)} />
        <Row label="Median" value={format(s.median)} />
        <Row label="Sigma" value={format(s.sigma).replace(/^\+/, "")} />
        <Row label="Skewness" value={s.skew.toFixed(3)} />
        <Row label="Excess kurtosis" value={s.kurt.toFixed(3)} />
        <Row label={`Best ${periodLabel}`} value={`${format(s.max)}${at(s.maxIdx)}`} />
        <Row label={`Worst ${periodLabel}`} value={`${format(s.min)}${at(s.minIdx)}`} />
      </Section>

      <Section title="Tails" extra="observed · normal">
        {s.tails.map((t) => (
          <Row key={t.k} label={`Beyond ±${t.k}σ`} value={`${t.count} (${pct(t.share)}) · ${pct(t.normal)}`} />
        ))}
      </Section>

      <Section title="Quantiles" extra="observed · normal">
        {s.quantiles.map((q) => (
          <Row key={q.p} label={`${ORDINAL[q.p]} percentile`} value={`${format(q.observed)} · ${format(q.normal)}`} />
        ))}
      </Section>

      <Section title="Normality">
        <Row label="Jarque–Bera" value={s.jb.toFixed(1)} />
        <Row label="p-value" value={s.jbP < 0.001 ? "<0.001" : s.jbP.toFixed(3)} />
        <Row label="Normal at 95%" value={normal ? "Yes" : "No"} />
      </Section>

      <Section title="Sample">
        <Row label="Observations" value={s.n} />
        {firstDate && <Row label="Range" value={`${firstDate} – ${lastDate}`} />}
        <Row label={`Up / down ${periodLabel}s`} value={`${s.up} (${pct(s.up / s.n)}) / ${s.down}`} />
      </Section>
    </div>
  );
}

const ORDINAL = { 0.01: "1st", 0.05: "5th", 0.95: "95th", 0.99: "99th" };

function Section({ title, extra, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: 4 }}>
        {title}{extra && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-disabled)" }}> · {extra}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "2px 0" }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-family-mono)", color: "var(--text-primary)", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}
