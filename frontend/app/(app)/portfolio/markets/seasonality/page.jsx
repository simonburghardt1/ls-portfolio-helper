"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/api";
import { fmtPct, signColor } from "@/app/lib/format";
import { useElementWidth } from "@/app/lib/hooks";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import KpiCard from "@/app/components/KpiCard";
import Button from "@/app/components/Button";
import Chip from "@/app/components/Chip";
import InfoTip from "@/app/components/InfoTip";
import Popover from "@/app/components/Popover";
import StateMessage from "@/app/components/StateMessage";
import AssetSelector from "@/app/components/AssetSelector";
import styles from "./seasonality.module.css";

// ── Constants ──────────────────────────────────────────────────────────────────

const WEEKS = 52;
const MAX_COMPARE = 6;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// US presidential cycle: same year % 4 rule as backend/app/services/seasonality.py
const PHASE_OF = (year) => ({ 0: "election", 1: "post_election", 2: "midterm", 3: "pre_election" })[year % 4];
const CYCLES = [
  { key: "all", label: "All years" },
  { key: "pre_election", label: "Pre-Election" },
  { key: "election", label: "Election" },
  { key: "post_election", label: "Post-Election" },
  { key: "midterm", label: "Midterm" },
];

const AVG_COLOR = "#f59e0b";
const CURRENT_COLOR = "#60a5fa";
// Extra years — avoids the amber (average) and blue (current year) slots
const COMPARE_COLORS = ["#10b981", "#ec4899", "#a78bfa", "#06b6d4", "#84cc16", "#f97316"];

// ── Helpers ────────────────────────────────────────────────────────────────────

const pct = (v, dp = 1) => fmtPct(v, dp);
const pctColor = signColor;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

// Week slot i covers day-of-year 7i+1 … 7i+7 (backend: dayofyear // 7)
function weekDateLabel(i, year) {
  const d = new Date(Date.UTC(year, 0, 1 + i * 7 + 6));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// Fractional week position of each month start, for the chart's month grid
function monthStartWeeks(year) {
  return MONTHS.map((_, m) => {
    const doy = (Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / 86400000;
    return doy / 7 - 0.5;
  });
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SeasonalityPage() {
  const [asset, setAsset] = useState({ type: "stock", id: "SPY", label: "SPY" });
  const [cycle, setCycle] = useState("all");
  const [compare, setCompare] = useState([]);
  // Compared years from one asset mean nothing for another — reset during render
  const assetKey = `${asset.type}:${asset.id}`;
  const [prevAssetKey, setPrevAssetKey] = useState(assetKey);
  if (assetKey !== prevAssetKey) {
    setPrevAssetKey(assetKey);
    setCompare([]);
  }

  const { data: baskets } = useQuery({ queryKey: ["baskets"], queryFn: () => api.get("/api/baskets") });
  const { data, isLoading, isError } = useQuery({
    queryKey: ["seasonality", asset.type, asset.id],
    queryFn: () => api.get(`/api/seasonality?asset_type=${asset.type}&asset_id=${encodeURIComponent(asset.id)}`),
    enabled: Boolean(asset.id),
  });

  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();

  const model = useMemo(() => buildModel(data, cycle, thisYear, thisMonth), [data, cycle, thisYear, thisMonth]);

  function toggleCompare(year) {
    setCompare((prev) =>
      prev.includes(year) ? prev.filter((y) => y !== year) : prev.length >= MAX_COMPARE ? prev : [...prev, year]
    );
  }
  const compareColor = (year) => COMPARE_COLORS[compare.indexOf(year) % COMPARE_COLORS.length];

  const cycleLabel = CYCLES.find((c) => c.key === cycle)?.label;
  const currentPhase = PHASE_OF(thisYear);

  return (
    <Page>
      <PageHeader
        title="Seasonality"
        actions={<AssetSelector label="Asset" baskets={baskets ?? []} selection={asset} onChange={setAsset} />}
      />

      {/* Presidential-cycle filter — drives every section on the page */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: "var(--space-5)" }}>
        {CYCLES.map((c) => (
          <Button key={c.key} variant="range-toggle" active={cycle === c.key} onClick={() => setCycle(c.key)}>
            {c.label}
            {c.key === currentPhase && (
              <span title={`${thisYear} is a ${c.label} year`} style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", color: CURRENT_COLOR }}>
                NOW
              </span>
            )}
          </Button>
        ))}
      </div>

      {isLoading && <StateMessage kind="loading" />}
      {isError && <StateMessage kind="error">Could not load seasonality data.</StateMessage>}
      {data && !model && <StateMessage>Not enough price history for this asset.</StateMessage>}

      {model && (
        <>
          <KpiStrip model={model} thisYear={thisYear} thisMonth={thisMonth} />

          <Panel
            title="Seasonal path"
            titleExtra={
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", fontSize: 12, color: "var(--text-secondary)" }}>
                <LegendItem color={AVG_COLOR}>{cycleLabel} avg</LegendItem>
                <LegendItem band>Middle 50%</LegendItem>
                {model.current && <LegendItem color={CURRENT_COLOR}>{thisYear}</LegendItem>}
                {compare.map((y) => (
                  <Chip key={y} color={compareColor(y)} onRemove={() => toggleCompare(y)}>{String(y)}</Chip>
                ))}
              </div>
            }
            actions={
              <Popover align="right" width={300} padded trigger={(toggle) => <Button variant="range-toggle" onClick={toggle}>+ Year</Button>}>
                <YearPicker years={model.allYearsDesc} cycle={cycle} selected={compare} colorOf={compareColor} onToggle={toggleCompare} />
              </Popover>
            }
          >
            <SeasonalChart model={model} compare={compare} colorOf={compareColor} thisYear={thisYear} />
          </Panel>

          <MonthlyProfile model={model} thisMonth={thisMonth} />

          <Heatmap
            model={model}
            thisYear={thisYear}
            thisMonth={thisMonth}
            compare={compare}
            colorOf={compareColor}
            onToggleYear={toggleCompare}
          />
        </>
      )}
    </Page>
  );
}

// ── Model: everything the sections need, derived once per (data, cycle) ───────

function buildModel(data, cycle, thisYear, thisMonth) {
  const years = data?.years ?? [];
  if (!years.length) return null;
  const inCycle = (y) => cycle === "all" || PHASE_OF(y) === cycle;

  // "History" = complete calendar years (week 1 present) except the running one
  const complete = years.filter((y) => y.year !== thisYear && y.week_cum_return[0] != null);
  const cycleCounts = Object.fromEntries(
    CYCLES.map((c) => [c.key, complete.filter((y) => c.key === "all" || PHASE_OF(y.year) === c.key).length])
  );
  const histYears = complete.filter((y) => inCycle(y.year));
  if (!histYears.length && !years.some((y) => y.year === thisYear)) return null;

  const path = Array.from({ length: WEEKS }, (_, i) => {
    const vals = histYears.map((y) => y.week_cum_return[i]).filter((v) => v != null);
    return { avg: mean(vals), p25: quantile(vals, 0.25), p75: quantile(vals, 0.75) };
  });

  const current = years.find((y) => y.year === thisYear) ?? null;
  let nowWeek = -1;
  if (current) current.week_cum_return.forEach((v, i) => { if (v != null) nowWeek = i; });

  // Forward window from the current week (4 weeks, clipped at year end)
  let forward = null;
  if (nowWeek >= 0 && nowWeek < WEEKS - 1) {
    const to = Math.min(nowWeek + 4, WEEKS - 1);
    const rets = histYears
      .map((y) => {
        const a = y.week_cum_return[nowWeek], b = y.week_cum_return[to];
        return a == null || b == null ? null : (1 + b) / (1 + a) - 1;
      })
      .filter((v) => v != null);
    forward = { from: nowWeek, to, weeks: to - nowWeek, avg: mean(rets), up: rets.filter((r) => r > 0).length, n: rets.length };
  }

  // Monthly stats over the same history years
  const histSet = new Set(histYears.map((y) => y.year));
  const rows = data.monthly_returns.rows;
  const months = MONTHS.map((_, m) => {
    const vals = rows.filter((r) => histSet.has(r.year)).map((r) => r.months[m]).filter((v) => v != null);
    return { avg: mean(vals), median: quantile(vals, 0.5), up: vals.filter((v) => v > 0).length, n: vals.length };
  });
  const ranked = months.map((s, m) => ({ ...s, m })).filter((s) => s.avg != null).sort((a, b) => b.avg - a.avg);

  // Heatmap rows: the cycle's years incl. the running one, newest first
  // (complete years + the running one — an asset's partial first year would be a near-empty row)
  const completeSet = new Set(complete.map((y) => y.year));
  const heatRows = rows
    .filter((r) => inCycle(r.year) && (completeSet.has(r.year) || r.year === thisYear))
    .sort((a, b) => b.year - a.year);
  const absVals = heatRows.flatMap((r) => r.months).filter((v) => v != null).map(Math.abs);
  // Cap the colour scale at the 90th percentile so a single crash month doesn't wash out the rest
  const heatCap = Math.max(quantile(absVals, 0.9) ?? 0, 0.02);

  return {
    histYears, cycleCounts, path, current, nowWeek, forward, months,
    best: ranked[0] ?? null, worst: ranked[ranked.length - 1] ?? null,
    heatRows, heatCap,
    allYearsDesc: years.filter((y) => y.year !== thisYear && y.week_cum_return.some((v) => v != null)).map((y) => y.year).sort((a, b) => b - a),
    yearsByNum: Object.fromEntries(years.map((y) => [y.year, y])),
  };
}

// ── KPI strip ──────────────────────────────────────────────────────────────────

function KpiStrip({ model, thisYear, thisMonth }) {
  const m = model.months[thisMonth];
  const f = model.forward;
  const cur = model.current && model.nowWeek >= 0 ? model.current.week_cum_return[model.nowWeek] : null;
  const seasonalAtNow = model.nowWeek >= 0 ? model.path[model.nowWeek].avg : null;
  const upOf = (s) => (s?.n ? `Up ${s.up} of ${s.n} years` : "No history");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-3)", marginBottom: "var(--space-5)" }}>
      <KpiCard label={MONTHS_LONG[thisMonth]} formatted={pct(m.avg)} valueColor={pctColor(m.avg)} caption={upOf(m)} />
      <KpiCard label="Next 4 weeks" formatted={f ? pct(f.avg) : "—"} valueColor={pctColor(f?.avg)} caption={f ? upOf(f) : "Year end"} />
      <KpiCard label={`${thisYear} YTD`} formatted={pct(cur)} valueColor={pctColor(cur)} caption={`Seasonal avg ${pct(seasonalAtNow)}`} />
      <KpiCard
        label="Best / worst month"
        formatted={`${model.best ? MONTHS[model.best.m] : "—"} / ${model.worst ? MONTHS[model.worst.m] : "—"}`}
        caption={`${pct(model.best?.avg)} / ${pct(model.worst?.avg)}`}
      />
    </div>
  );
}

// ── Seasonal path chart (SVG) ──────────────────────────────────────────────────

function SeasonalChart({ model, compare, colorOf, thisYear }) {
  const [wrapRef, width] = useElementWidth();
  const [hover, setHover] = useState(null);
  const H = 360, padL = 8, padR = 56, padT = 14, padB = 26;
  const innerW = Math.max(width - padL - padR, 10), innerH = H - padT - padB;

  const lines = [];
  compare.forEach((y) => {
    const yr = model.yearsByNum[y];
    if (yr) lines.push({ key: y, label: String(y), color: colorOf(y), width: 1.5, values: yr.week_cum_return });
  });
  if (model.current) lines.push({ key: "current", label: String(thisYear), color: CURRENT_COLOR, width: 2.5, values: model.current.week_cum_return });

  // y-domain over everything drawn, always including 0
  const all = [0];
  model.path.forEach((p) => { [p.avg, p.p25, p.p75].forEach((v) => v != null && all.push(v)); });
  lines.forEach((l) => l.values.forEach((v) => v != null && all.push(v)));
  let lo = Math.min(...all), hi = Math.max(...all);
  const padY = (hi - lo) * 0.08 || 0.01;
  lo -= padY; hi += padY;

  const x = (i) => padL + (i / (WEEKS - 1)) * innerW;
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * innerH;
  const ticks = niceTicks(lo, hi, 6);

  function pathFor(values) {
    let d = "", pen = false;
    values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  }

  const bandPts = model.path.map((p, i) => (p.p25 == null ? null : { i, lo: p.p25, hi: p.p75 })).filter(Boolean);
  const band = bandPts.length
    ? `M${bandPts.map((p) => `${x(p.i).toFixed(1)},${y(p.hi).toFixed(1)}`).join("L")}L${[...bandPts].reverse().map((p) => `${x(p.i).toFixed(1)},${y(p.lo).toFixed(1)}`).join("L")}Z`
    : "";

  const monthX = monthStartWeeks(thisYear);

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left - padL) / innerW) * (WEEKS - 1));
    setHover(Math.max(0, Math.min(WEEKS - 1, i)));
  }

  const hp = hover != null ? model.path[hover] : null;

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      {width > 0 && (
        <svg width={width} height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: "block", cursor: "crosshair" }}>
          {/* y grid + labels */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={padL + innerW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "rgba(156,163,175,0.55)" : "rgba(55,65,81,0.35)"} strokeDasharray={t === 0 ? "4 3" : undefined} />
              <text x={padL + innerW + 8} y={y(t) + 4} fontSize={11} fill="#9ca3af" fontFamily="var(--font-family-mono)">{pct(t, Math.abs(hi - lo) < 0.06 ? 1 : 0)}</text>
            </g>
          ))}
          {/* month grid + labels */}
          {monthX.map((w, m) => {
            const mx = x(Math.max(w, 0));
            const nextX = m < 11 ? x(monthX[m + 1]) : padL + innerW;
            return (
              <g key={m}>
                {m > 0 && <line x1={mx} x2={mx} y1={padT} y2={padT + innerH} stroke="rgba(55,65,81,0.35)" />}
                <text x={(mx + nextX) / 2} y={H - 8} fontSize={11} fill="#9ca3af" textAnchor="middle">{MONTHS[m]}</text>
              </g>
            );
          })}
          {/* interquartile band + average */}
          <path d={band} fill={AVG_COLOR} opacity={0.1} />
          <path d={pathFor(model.path.map((p) => p.avg))} fill="none" stroke={AVG_COLOR} strokeWidth={2.5} strokeLinejoin="round" />
          {/* compared years + current year (drawn last = on top) */}
          {lines.map((l) => (
            <path key={l.key} d={pathFor(l.values)} fill="none" stroke={l.color} strokeWidth={l.width} strokeLinejoin="round" opacity={l.key === "current" ? 1 : 0.85} />
          ))}
          {/* today */}
          {model.nowWeek >= 0 && (
            <g>
              <line x1={x(model.nowWeek)} x2={x(model.nowWeek)} y1={padT} y2={padT + innerH} stroke={CURRENT_COLOR} strokeDasharray="3 3" opacity={0.6} />
              <circle cx={x(model.nowWeek)} cy={y(model.current.week_cum_return[model.nowWeek])} r={4} fill={CURRENT_COLOR} stroke="var(--bg-surface)" strokeWidth={2} />
              <text x={x(model.nowWeek) + 6} y={padT + 10} fontSize={10} fill={CURRENT_COLOR} fontWeight={600} letterSpacing="0.05em">TODAY</text>
            </g>
          )}
          {/* hover crosshair */}
          {hover != null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} stroke="rgba(229,231,235,0.4)" />
              {hp.avg != null && <circle cx={x(hover)} cy={y(hp.avg)} r={3.5} fill={AVG_COLOR} />}
              {lines.map((l) => l.values[hover] != null && <circle key={l.key} cx={x(hover)} cy={y(l.values[hover])} r={3.5} fill={l.color} />)}
            </g>
          )}
        </svg>
      )}
      {hover != null && hp && (
        <div
          style={{
            position: "absolute", top: padT + 4, pointerEvents: "none", zIndex: 5,
            ...(x(hover) > width * 0.6 ? { right: width - x(hover) + 12 } : { left: x(hover) + 12 }),
            background: "var(--bg-elevated)", border: "1px solid var(--border)", boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            padding: "8px 10px", fontSize: 12, minWidth: 170,
          }}
        >
          <div style={{ color: "var(--text-secondary)", marginBottom: 6 }}>Week {hover + 1} · ≈ {weekDateLabel(hover, thisYear)}</div>
          <TipRow color={AVG_COLOR} label="Average" value={hp.avg} />
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "var(--text-secondary)", fontSize: 11, margin: "2px 0 4px 14px" }}>
            <span>middle 50%</span>
            <span style={{ fontFamily: "var(--font-family-mono)" }}>{pct(hp.p25)} … {pct(hp.p75)}</span>
          </div>
          {[...lines].reverse().map((l) => <TipRow key={l.key} color={l.color} label={l.label} value={l.values[hover]} />)}
        </div>
      )}
    </div>
  );
}

function TipRow({ color, label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "1px 0" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-primary)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
        {label}
      </span>
      <span style={{ fontFamily: "var(--font-family-mono)", color: pctColor(value) }}>{pct(value)}</span>
    </div>
  );
}

function niceTicks(lo, hi, count) {
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-12; t += step) out.push(Math.round(t / step) * step);
  return out;
}

// ── Compare-year picker ────────────────────────────────────────────────────────

function YearPicker({ years, cycle, selected, colorOf, onToggle }) {
  const full = selected.length >= MAX_COMPARE;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
      {years.map((yr) => {
        const on = selected.includes(yr);
        const match = cycle === "all" || PHASE_OF(yr) === cycle;
        return (
          <button
            key={yr}
            type="button"
            onClick={() => onToggle(yr)}
            disabled={!on && full}
            title={!on && full ? `Up to ${MAX_COMPARE} years` : undefined}
            style={{
              padding: "5px 0", fontFamily: "var(--font-family-mono)", fontSize: 12, cursor: !on && full ? "not-allowed" : "pointer",
              background: on ? "var(--bg-surface)" : "transparent",
              border: `1px solid ${on ? colorOf(yr) : "var(--border)"}`,
              color: on || match ? "var(--text-primary)" : "var(--text-disabled)",
              opacity: !on && full ? 0.4 : 1,
            }}
          >
            {yr}
          </button>
        );
      })}
    </div>
  );
}

// ── Monthly average bars ───────────────────────────────────────────────────────

function MonthlyProfile({ model, thisMonth }) {
  // One scale for both directions, but only as much room below zero as the worst month needs
  const maxPos = Math.max(...model.months.map((s) => s.avg ?? 0), 0);
  const maxNeg = Math.max(...model.months.map((s) => -(s.avg ?? 0)), 0);
  const unit = 64 / Math.max(maxPos, maxNeg, 0.005); // px per 1.0 return
  const posH = Math.max(maxPos * unit, 8), negH = Math.max(maxNeg * unit, 8);
  return (
    <Panel title="Average month">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 6 }}>
        {model.months.map((s, m) => {
          const now = m === thisMonth;
          const h = s.avg == null ? 0 : Math.abs(s.avg) * unit;
          const up = s.avg != null && s.avg >= 0;
          return (
            <div
              key={m}
              title={`${MONTHS_LONG[m]}: avg ${pct(s.avg, 2)}, up ${s.up} of ${s.n} years`}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "6px 4px" }}
            >
              <span style={{ fontFamily: "var(--font-family-mono)", fontSize: 12, color: pctColor(s.avg) }}>{pct(s.avg)}</span>
              <div style={{ position: "relative", width: "100%", height: posH + negH + 1 }}>
                <div style={{ position: "absolute", left: 0, right: 0, top: posH, height: 1, background: "var(--border)" }} />
                <div style={{
                  position: "absolute", left: "25%", right: "25%",
                  top: up ? posH - h : posH + 1, height: h,
                  background: up ? "var(--positive)" : "var(--negative)", opacity: now ? 1 : 0.6,
                }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: now ? 700 : 400, color: now ? "var(--text-primary)" : "var(--text-secondary)" }}>{MONTHS[m]}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ── Monthly returns heatmap ────────────────────────────────────────────────────

function heatColor(v, cap) {
  if (v == null) return "transparent";
  const t = Math.min(Math.abs(v) / cap, 1);
  return v >= 0 ? `rgba(22,163,74,${0.08 + t * 0.6})` : `rgba(220,38,38,${0.08 + t * 0.6})`;
}

function Heatmap({ model, thisYear, thisMonth, compare, colorOf, onToggleYear }) {
  const summary = [
    { label: "Avg", vals: model.months.map((s) => s.avg), fmt: (v) => pct(v), heat: true },
    { label: "% Up", vals: model.months.map((s) => (s.n ? s.up / s.n : null)), fmt: (v) => (v == null ? "—" : `${Math.round(v * 100)}%`), heat: false },
  ];
  return (
    <Panel title="Monthly returns" titleExtra={<InfoTip text="Click a year to overlay it on the seasonal path." />} flush>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr>
              <th style={{ ...hth, textAlign: "left", paddingLeft: 16 }}>Year</th>
              {MONTHS.map((m, i) => (
                <th key={m} style={{ ...hth, color: i === thisMonth ? "var(--text-primary)" : hth.color }}>{m}</th>
              ))}
              <th style={{ ...hth, paddingRight: 16, borderLeft: "1px solid var(--border)" }}>Year</th>
            </tr>
          </thead>
          <tbody>
            {model.heatRows.map((r) => {
              const isCurrent = r.year === thisYear;
              const on = compare.includes(r.year);
              const clickable = !isCurrent && model.yearsByNum[r.year]?.week_cum_return.some((v) => v != null);
              const dot = isCurrent ? CURRENT_COLOR : on ? colorOf(r.year) : null;
              return (
                <tr
                  key={r.year}
                  className={clickable ? styles.clickRow : undefined}
                  onClick={clickable ? () => onToggleYear(r.year) : undefined}
                >
                  <td style={{ ...htd, textAlign: "left", paddingLeft: 16, color: "var(--text-primary)" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot ?? "transparent" }} />
                      {r.year}
                    </span>
                  </td>
                  {r.months.map((v, i) => (
                    <td
                      key={i}
                      title={isCurrent && i === thisMonth ? "Month to date" : undefined}
                      style={{ ...htd, background: heatColor(v, model.heatCap), color: "var(--text-primary)" }}
                    >
                      {v == null ? "" : pct(v)}
                    </td>
                  ))}
                  <td style={{ ...htd, paddingRight: 16, borderLeft: "1px solid var(--border)", color: pctColor(r.total) }}>
                    {pct(r.total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {summary.map((s, k) => (
              <tr key={s.label}>
                <td style={{ ...htd, textAlign: "left", paddingLeft: 28, color: "var(--text-secondary)", borderTop: k === 0 ? "1px solid var(--border)" : undefined }}>{s.label}</td>
                {s.vals.map((v, i) => (
                  <td key={i} style={{ ...htd, borderTop: k === 0 ? "1px solid var(--border)" : undefined, background: s.heat ? heatColor(v, model.heatCap) : "transparent", color: s.heat ? "var(--text-primary)" : "var(--text-secondary)" }}>
                    {s.fmt(v)}
                  </td>
                ))}
                <td style={{ ...htd, borderLeft: "1px solid var(--border)", borderTop: k === 0 ? "1px solid var(--border)" : undefined }} />
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

// ── Small pieces ───────────────────────────────────────────────────────────────

function LegendItem({ color, band, children }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {band
        ? <span style={{ width: 14, height: 10, background: AVG_COLOR, opacity: 0.18 }} />
        : <span style={{ width: 14, height: 2, background: color }} />}
      {children}
    </span>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const hth = {
  padding: "6px 8px", fontSize: 10, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase",
  letterSpacing: "0.05em", textAlign: "right", borderBottom: "1px solid var(--border)",
};
const htd = { padding: "5px 8px", textAlign: "right", fontSize: 11.5, whiteSpace: "nowrap", fontFamily: "var(--font-family-mono)" };
