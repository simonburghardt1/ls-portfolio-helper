"use client";

import { useState, useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineSeries,
  HistogramSeries,
} from "lightweight-charts";

const API = "http://localhost:8000";

const ASSET_CLASS_ORDER = [
  "energy",
  "precious_metals",
  "commodities",
  "industrial_metals",
  "currencies",
  "indices",
  "crypto",
];

const ASSET_CLASS_LABELS = {
  energy:            "Energy",
  precious_metals:   "Precious Metals",
  commodities:       "Commodities",
  industrial_metals: "Industrial Metals",
  currencies:        "Currencies",
  indices:           "Indices",
  crypto:            "Crypto",
};

const PERIODS = [
  { label: "1Y",  years: 1  },
  { label: "3Y",  years: 3  },
  { label: "5Y",  years: 5  },
  { label: "10Y", years: 10 },
  { label: "20Y", years: 20 },
  { label: "MAX", years: null },
];

function fmtK(val) {
  if (val == null) return "—";
  const abs = Math.abs(val);
  if (abs >= 1000) return (val / 1000).toFixed(1) + "K";
  return val.toLocaleString();
}

function netColor(pct) {
  if (pct == null) return "#6b7280";
  if (pct > 10)  return "#22c55e";
  if (pct < -10) return "#ef4444";
  return "#9ca3af";
}

// ── Net % bar — centered at 0, green right / red left ────────────────────────
function NetBar({ pct }) {
  if (pct == null) return <div style={{ height: 6, background: "#111827", borderRadius: 3 }} />;
  const clamped = Math.max(-100, Math.min(100, pct));
  const isPos   = clamped >= 0;
  const fill    = Math.abs(clamped) / 2; // max 50% of total width
  return (
    <div style={{ height: 6, background: "#111827", borderRadius: 3, display: "flex", position: "relative" }}>
      {/* negative half (right→center) */}
      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
        {!isPos && (
          <div style={{ width: `${fill * 2}%`, background: "#ef4444", borderRadius: "3px 0 0 3px" }} />
        )}
      </div>
      {/* center divider */}
      <div style={{ width: 1, background: "#374151", flexShrink: 0 }} />
      {/* positive half (center→right) */}
      <div style={{ flex: 1 }}>
        {isPos && (
          <div style={{ width: `${fill * 2}%`, background: "#22c55e", borderRadius: "0 3px 3px 0" }} />
        )}
      </div>
    </div>
  );
}

export default function CotDataPage() {
  const [overview,   setOverview]   = useState(null);
  const [contracts,  setContracts]  = useState({});
  const [selected,   setSelected]   = useState("gold");
  const [series,     setSeries]     = useState(null);
  const [period,     setPeriod]     = useState("5Y");
  const [loadingOv,  setLoadingOv]  = useState(true);
  const [loadingSer, setLoadingSer] = useState(false);
  const [showAll,    setShowAll]    = useState(false);
  const [error,      setError]      = useState(null);

  const mainRef  = useRef(null);
  const subRef   = useRef(null);
  const mainChart = useRef(null);
  const subChart  = useRef(null);
  const syncing   = useRef(false);

  // Load overview + contracts on mount
  useEffect(() => {
    async function load() {
      try {
        const [ovRes, conRes] = await Promise.all([
          fetch(`${API}/api/cot/overview`),
          fetch(`${API}/api/cot/contracts`),
        ]);
        setOverview(await ovRes.json());
        setContracts(await conRes.json());
      } catch (e) {
        setError(e.message);
      } finally {
        setLoadingOv(false);
      }
    }
    load();
  }, []);

  // Load series when selected changes
  useEffect(() => {
    async function load() {
      setLoadingSer(true);
      setSeries(null);
      try {
        const res = await fetch(`${API}/api/cot/series/${selected}`);
        setSeries(await res.json());
      } catch (e) {
        setError(e.message);
      } finally {
        setLoadingSer(false);
      }
    }
    load();
  }, [selected]);

  // Build / rebuild charts when series changes
  useEffect(() => {
    if (!series || !mainRef.current || !subRef.current) return;

    mainChart.current?.remove();
    subChart.current?.remove();

    const mc = createChart(mainRef.current, {
      layout:          { background: { type: ColorType.Solid, color: "#080e1a" }, textColor: "#6b7280" },
      grid:            { vertLines: { color: "rgba(31,41,55,0.5)" }, horzLines: { color: "rgba(31,41,55,0.5)" } },
      crosshair:       { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1f2937" },
      timeScale:       { borderColor: "#1f2937", timeVisible: false },
      width:           mainRef.current.clientWidth,
      height:          360,
    });
    mainChart.current = mc;

    // Net % line
    const netSeries = mc.addSeries(LineSeries, {
      color:            "#60a5fa",
      lineWidth:        2,
      priceLineVisible: false,
      lastValueVisible: true,
      title:            "Net %",
    });
    netSeries.setData(
      series.dates
        .map((d, i) => ({ time: d, value: series.net_pct[i] }))
        .filter(p => p.value != null)
    );

    // Zero line
    const zeroSeries = mc.addSeries(LineSeries, {
      color:            "rgba(107,114,128,0.5)",
      lineWidth:        1,
      lineStyle:        2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const validDates = series.dates.filter((_, i) => series.net_pct[i] != null);
    if (validDates.length >= 2) {
      zeroSeries.setData([
        { time: validDates[0],                        value: 0 },
        { time: validDates[validDates.length - 1],    value: 0 },
      ]);
    }

    mc.timeScale().fitContent();

    // Sub chart — Open Interest histogram
    const sc = createChart(subRef.current, {
      layout:          { background: { type: ColorType.Solid, color: "#080e1a" }, textColor: "#6b7280" },
      grid:            { vertLines: { color: "rgba(31,41,55,0.5)" }, horzLines: { visible: false } },
      crosshair:       { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1f2937", scaleMargins: { top: 0.05, bottom: 0.05 } },
      timeScale:       { borderColor: "#1f2937", timeVisible: true },
      width:           subRef.current.clientWidth,
      height:          120,
    });
    subChart.current = sc;

    const oiSeries = sc.addSeries(HistogramSeries, {
      color:            "rgba(100,150,255,0.5)",
      priceLineVisible: false,
      lastValueVisible: false,
      base:             0,
    });
    oiSeries.setData(
      series.dates
        .map((d, i) => ({ time: d, value: series.open_interest[i] }))
        .filter(p => p.value != null)
    );

    sc.timeScale().fitContent();

    // Sync time scales
    mc.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (syncing.current || !range) return;
      syncing.current = true;
      sc.timeScale().setVisibleRange(range);
      syncing.current = false;
    });
    sc.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (syncing.current || !range) return;
      syncing.current = true;
      mc.timeScale().setVisibleRange(range);
      syncing.current = false;
    });

    // Resize
    const ro = new ResizeObserver(() => {
      mc.applyOptions({ width: mainRef.current?.clientWidth ?? 600 });
      sc.applyOptions({ width: subRef.current?.clientWidth ?? 600 });
    });
    ro.observe(mainRef.current);

    return () => {
      ro.disconnect();
      mc.remove(); mainChart.current = null;
      sc.remove(); subChart.current  = null;
    };
  }, [series]);

  // Apply period to main chart (sub syncs automatically)
  useEffect(() => {
    if (!mainChart.current) return;
    const sel = PERIODS.find(p => p.label === period);
    if (!sel?.years) {
      mainChart.current.timeScale().fitContent();
    } else {
      const to = new Date(), from = new Date();
      from.setFullYear(from.getFullYear() - sel.years);
      try {
        mainChart.current.timeScale().setVisibleRange({
          from: from.toISOString().slice(0, 10),
          to:   to.toISOString().slice(0, 10),
        });
      } catch {
        mainChart.current.timeScale().fitContent();
      }
    }
  }, [period, series]);

  // Table rows — most recent 52 or all
  const tableRows = series
    ? [...series.dates.map((d, i) => ({
        date: d,
        long_pos: series.long_pos[i],
        short_pos: series.short_pos[i],
        net_pos: series.net_pos[i],
        open_interest: series.open_interest[i],
        net_pct: series.net_pct[i],
      }))]
        .reverse()
        .slice(0, showAll ? undefined : 52)
    : [];

  if (error) return <div style={{ padding: "40px 32px", color: "#fca5a5", fontSize: 13 }}>Error: {error}</div>;

  return (
    <div style={{ padding: "28px 32px", minHeight: "100vh", background: "#020617", color: "#e5e7eb" }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f9fafb", margin: 0 }}>COT Data</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
          Commitments of Traders — Asset Manager / Managed Money positioning. Source: CFTC (weekly, updated Fridays).
        </p>
      </div>

      {/* ── Overview grid ─────────────────────────────────────────────────────── */}
      {loadingOv ? (
        <div style={{ color: "#4b5563", fontSize: 13, marginBottom: 36 }}>Loading overview…</div>
      ) : overview && (
        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>
            Net Positioning Overview
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
            {ASSET_CLASS_ORDER.filter(ac => overview[ac]).map(ac => (
              <div key={ac} style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 10, padding: "16px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#9ca3af" }}>{ASSET_CLASS_LABELS[ac]}</span>
                  <span style={{ fontSize: 10, color: "#374151" }}>{overview[ac].length} contracts</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {overview[ac].map(item => (
                    <div key={item.contract}
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelected(item.contract)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                        <span style={{
                          fontSize: 12, color: selected === item.contract ? "#60a5fa" : "#d1d5db",
                          fontWeight: selected === item.contract ? 600 : 400,
                        }}>
                          {item.label}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: netColor(item.net_pct), fontVariantNumeric: "tabular-nums" }}>
                          {item.net_pct != null ? (item.net_pct > 0 ? "+" : "") + item.net_pct.toFixed(1) + "%" : "—"}
                        </span>
                      </div>
                      <NetBar pct={item.net_pct} />
                      <div style={{ fontSize: 10, color: "#374151", marginTop: 2 }}>{item.date}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Detail section ────────────────────────────────────────────────────── */}
      <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 10, padding: "24px 28px" }}>

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            style={{
              background: "#0a1628", border: "1px solid #1f2937", borderRadius: 6,
              color: "#e5e7eb", fontSize: 13, padding: "6px 10px", cursor: "pointer",
            }}
          >
            {ASSET_CLASS_ORDER.map(ac => {
              const items = Object.entries(contracts).filter(([, m]) => m.asset_class === ac);
              if (!items.length) return null;
              return (
                <optgroup key={ac} label={ASSET_CLASS_LABELS[ac]}>
                  {items.map(([key, meta]) => (
                    <option key={key} value={key}>{meta.label}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>

          <div style={{ display: "flex", gap: 4 }}>
            {PERIODS.map(p => (
              <button key={p.label} onClick={() => setPeriod(p.label)}
                style={{
                  padding: "5px 10px", fontSize: 12, borderRadius: 5,
                  background: period === p.label ? "#1e3a5f" : "transparent",
                  border: period === p.label ? "1px solid #2d5a8e" : "1px solid #1f2937",
                  color: period === p.label ? "#93c5fd" : "#6b7280",
                  cursor: "pointer",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Chart title */}
        {series && (
          <div style={{ fontSize: 13, color: "#9ca3af", marginBottom: 12 }}>
            <span style={{ fontWeight: 600, color: "#e5e7eb" }}>{series.label}</span>
            {" "}— Net Long/Short % of Open Interest · {ASSET_CLASS_LABELS[series.asset_class] ?? series.asset_class}
          </div>
        )}

        {loadingSer && <div style={{ color: "#4b5563", fontSize: 13, padding: "40px 0" }}>Loading series…</div>}

        {/* Main chart */}
        <div ref={mainRef} style={{ width: "100%", display: loadingSer ? "none" : "block" }} />

        {/* Sub chart label */}
        {!loadingSer && series && (
          <div style={{ fontSize: 10, color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 4, marginBottom: 2 }}>
            Open Interest
          </div>
        )}

        {/* Sub chart */}
        <div ref={subRef} style={{ width: "100%", display: loadingSer ? "none" : "block" }} />

        {/* ── Data table ──────────────────────────────────────────────────────── */}
        {series && series.dates.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              Data
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                <thead>
                  <tr>
                    {["Date", "Long", "Short", "Net", "Open Interest", "Net %"].map(h => (
                      <th key={h} style={{ textAlign: h === "Date" ? "left" : "right", padding: "6px 10px", color: "#4b5563", fontWeight: 600, borderBottom: "1px solid #1f2937", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, i) => (
                    <tr key={row.date} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                      <td style={{ padding: "5px 10px", color: "#6b7280" }}>{row.date}</td>
                      <td style={{ padding: "5px 10px", color: "#9ca3af", textAlign: "right" }}>{fmtK(row.long_pos)}</td>
                      <td style={{ padding: "5px 10px", color: "#9ca3af", textAlign: "right" }}>{fmtK(row.short_pos)}</td>
                      <td style={{ padding: "5px 10px", color: netColor(row.net_pct), textAlign: "right" }}>
                        {row.net_pos != null ? (row.net_pos > 0 ? "+" : "") + fmtK(row.net_pos) : "—"}
                      </td>
                      <td style={{ padding: "5px 10px", color: "#6b7280", textAlign: "right" }}>{fmtK(row.open_interest)}</td>
                      <td style={{ padding: "5px 10px", fontWeight: 600, color: netColor(row.net_pct), textAlign: "right" }}>
                        {row.net_pct != null ? (row.net_pct > 0 ? "+" : "") + row.net_pct.toFixed(2) + "%" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {series.dates.length > 52 && (
              <button
                onClick={() => setShowAll(p => !p)}
                style={{ marginTop: 10, background: "transparent", border: "1px solid #1f2937", borderRadius: 6, color: "#6b7280", fontSize: 12, padding: "5px 12px", cursor: "pointer" }}
              >
                {showAll ? "Show less" : `Show all ${series.dates.length} rows`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
