"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ResponsiveContainer, Treemap } from "recharts";

const API = "http://localhost:8000";
const STORAGE_KEY = "heatmap_watchlist";
const DEFAULT_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "JPM", "V", "XOM"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function tileColor(pct) {
  if (pct == null)  return "#1f2937";
  if (pct <= -3)    return "#7f1d1d";
  if (pct <= -1)    return "#b91c1c";
  if (pct <= -0.2)  return "#ef4444";
  if (pct <   0.2)  return "#374151";
  if (pct <   1)    return "#16a34a";
  if (pct <   3)    return "#15803d";
  return "#14532d";
}

function computeSize(item, sizeMode) {
  if (sizeMode === "equal") return 1;
  return Math.log10(Math.max(item.market_cap, 10));
}

function loadStoredTickers() {
  if (typeof window === "undefined") return DEFAULT_TICKERS;
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? JSON.parse(s) : DEFAULT_TICKERS;
  } catch {
    return DEFAULT_TICKERS;
  }
}

// ── Custom treemap tile ───────────────────────────────────────────────────────

function HeatmapTile(props) {
  const { x, y, width, height, ticker, name, price, change_pct } = props;
  if (!width || !height || width < 4 || height < 4) return null;

  const cx = x + width / 2;
  const cy = y + height / 2;

  const tickerFs = Math.min(16, Math.max(8, width / 5));
  const changeFs = Math.min(12, Math.max(7, width / 7));
  const priceFs  = Math.min(10, Math.max(6, width / 9));

  const showTicker = width > 25 && height > 18;
  const showChange = width > 50 && height > 38 && change_pct != null;
  const showPrice  = width > 75 && height > 56 && price != null;

  const totalH = tickerFs
    + (showChange ? changeFs + 4 : 0)
    + (showPrice  ? priceFs  + 3 : 0);
  const startY = cy - totalH / 2 + tickerFs / 2;

  return (
    <g>
      <rect
        x={x + 1} y={y + 1} width={width - 2} height={height - 2}
        fill={tileColor(change_pct)} rx={3}
      />
      {showTicker && (
        <text x={cx} y={startY} textAnchor="middle" dominantBaseline="middle"
              fill="#f9fafb" fontSize={tickerFs} fontWeight="700"
              style={{ fontFamily: "ui-monospace, monospace" }}>
          {ticker || name}
        </text>
      )}
      {showChange && (
        <text x={cx} y={startY + tickerFs + 4} textAnchor="middle" dominantBaseline="middle"
              fill={change_pct >= 0 ? "#86efac" : "#fca5a5"} fontSize={changeFs}>
          {change_pct >= 0 ? "+" : ""}{change_pct.toFixed(2)}%
        </text>
      )}
      {showPrice && (
        <text x={cx} y={startY + tickerFs + changeFs + 8} textAnchor="middle" dominantBaseline="middle"
              fill="#9ca3af" fontSize={priceFs}>
          ${price.toFixed(2)}
        </text>
      )}
    </g>
  );
}

// ── Legend / Toggle ───────────────────────────────────────────────────────────

const LEGEND = [
  { label: "≤ −3%",      color: "#7f1d1d" },
  { label: "−3% to −1%", color: "#b91c1c" },
  { label: "−1% to 0%",  color: "#ef4444" },
  { label: "Flat",       color: "#374151" },
  { label: "0% to +1%",  color: "#16a34a" },
  { label: "+1% to +3%", color: "#15803d" },
  { label: "≥ +3%",      color: "#14532d" },
];

function ToggleBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 11px", fontSize: 12, borderRadius: 5, cursor: "pointer",
      background: active ? "#1e3a5f" : "transparent",
      border: `1px solid ${active ? "#2d5a8e" : "#1f2937"}`,
      color: active ? "#93c5fd" : "#6b7280",
      fontWeight: active ? 600 : 400,
    }}>
      {children}
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HeatmapPage() {
  const [tickers,         setTickers]         = useState(loadStoredTickers);
  const [input,           setInput]           = useState("");
  const [rawData,         setRawData]         = useState([]);
  const [asOf,            setAsOf]            = useState(null);
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState(null);
  const [sizeMode,        setSizeMode]        = useState("equal");
  const [groupBySector,   setGroupBySector]   = useState(false);
  // animKey changes on ticker add/remove → causes <Treemap key={animKey}> to remount → animation plays.
  // isAnimationActive is true only during those remounts; auto-refresh leaves it false so no animation.
  const [animKey,         setAnimKey]         = useState(0);
  const [isAnimActive,    setIsAnimActive]    = useState(true); // true for initial load

  // Persist watchlist
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tickers));
  }, [tickers]);

  // fetchData accepts a flag so ticker-change fetches can re-enable animation.
  const fetchData = useCallback(async (tickerList, withSector, animate = false) => {
    if (!tickerList.length) return;
    setLoading(true);
    setError(null);
    if (animate) setIsAnimActive(true);
    try {
      const res = await fetch(`${API}/api/portfolio/heatmap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: tickerList, include_sector: withSector }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      setRawData(json.data);
      setAsOf(json.as_of);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      // After data settles, disable animation so the next auto-refresh is silent
      setIsAnimActive(false);
    }
  }, []);

  // Initial fetch (animate=true) + re-fetch on sector toggle
  useEffect(() => {
    fetchData(tickers, groupBySector, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBySector]); // intentionally omit tickers — ticker changes go through addTicker/removeTicker

  // Auto-refresh every 60 s — no animation flag
  useEffect(() => {
    const id = setInterval(() => fetchData(tickers, groupBySector, false), 60_000);
    return () => clearInterval(id);
  }, [tickers, groupBySector, fetchData]);

  // Derived data
  const flatData = useMemo(
    () => rawData.map(d => ({ ...d, name: d.ticker, size: computeSize(d, sizeMode) })),
    [rawData, sizeMode]
  );

  const sectorGroups = useMemo(() => {
    if (!groupBySector) return null;
    const map = {};
    flatData.forEach(d => {
      const s = d.sector || "Unknown";
      if (!map[s]) map[s] = { name: s, stocks: [] };
      map[s].stocks.push(d);
    });
    // Sort sectors by total size descending so the largest group is first
    return Object.values(map).sort(
      (a, b) => b.stocks.reduce((s, t) => s + t.size, 0) - a.stocks.reduce((s, t) => s + t.size, 0)
    );
  }, [flatData, groupBySector]);

  function addTicker() {
    const t = input.trim().toUpperCase();
    if (t && !tickers.includes(t)) {
      const next = [...tickers, t];
      setTickers(next);
      setAnimKey(k => k + 1);
      // Fetch immediately with animation enabled
      fetchData(next, groupBySector, true);
    }
    setInput("");
  }

  function removeTicker(t) {
    const next = tickers.filter(x => x !== t);
    setTickers(next);
    setAnimKey(k => k + 1);
    fetchData(next, groupBySector, true);
  }

  const subtitle = [
    `Size: ${sizeMode === "equal" ? "equal" : "log(market cap)"}`,
    groupBySector ? "grouped by sector" : null,
    "color: daily % change · auto-refresh 60 s · data via yfinance",
  ].filter(Boolean).join(" · ");

  const hasData = flatData.length > 0;

  return (
    <div style={{ padding: "28px 32px", minHeight: "100vh", background: "#020617", color: "#e5e7eb" }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#f9fafb", margin: 0 }}>Stock Heatmap</h1>
        <p style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{subtitle}</p>
      </div>

      {/* Controls */}
      <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 8, padding: "16px 20px", marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#3b4c6b", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
          Watchlist
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addTicker()}
            placeholder="Add ticker…"
            style={{
              background: "#111827", border: "1px solid #1f2937", borderRadius: 6,
              padding: "6px 12px", fontSize: 13, color: "#e5e7eb", outline: "none", width: 160,
            }}
          />
          <button onClick={addTicker} style={{
            background: "#1e3a5f", border: "1px solid #2d5a8e", borderRadius: 6,
            padding: "6px 14px", fontSize: 13, color: "#93c5fd", cursor: "pointer", fontWeight: 600,
          }}>
            Add
          </button>

          <div style={{ width: 1, height: 22, background: "#1f2937", margin: "0 4px" }} />
          <span style={{ fontSize: 11, color: "#4b5563" }}>Size:</span>
          <ToggleBtn active={sizeMode === "equal"} onClick={() => setSizeMode("equal")}>Equal</ToggleBtn>
          <ToggleBtn active={sizeMode === "log"}   onClick={() => setSizeMode("log")}>Market Cap</ToggleBtn>

          <div style={{ width: 1, height: 22, background: "#1f2937", margin: "0 4px" }} />
          <ToggleBtn active={groupBySector} onClick={() => setGroupBySector(v => !v)}>
            {groupBySector ? "Sectors: On" : "Sectors: Off"}
          </ToggleBtn>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {asOf && <span style={{ fontSize: 12, color: "#4b5563" }}>as of {asOf}</span>}
            <button
              onClick={() => fetchData(tickers, groupBySector, false)}
              disabled={loading}
              style={{
                background: "transparent", border: "1px solid #1f2937", borderRadius: 6,
                padding: "6px 14px", fontSize: 13,
                color: loading ? "#374151" : "#9ca3af",
                cursor: loading ? "default" : "pointer",
              }}
            >
              {loading ? "Loading…" : "↻ Refresh"}
            </button>
          </div>
        </div>

        {/* Ticker chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {tickers.map(t => (
            <div key={t} style={{
              display: "flex", alignItems: "center", gap: 4,
              background: "#111827", border: "1px solid #1f2937", borderRadius: 4,
              padding: "3px 8px", fontSize: 12,
            }}>
              <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#e5e7eb" }}>{t}</span>
              <button
                onClick={() => removeTicker(t)}
                style={{ background: "none", border: "none", color: "#4b5563", cursor: "pointer", padding: 0, lineHeight: 1, fontSize: 14 }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ background: "#1c0a0a", border: "1px solid #7f1d1d", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#fca5a5" }}>
          Failed to load data: {error}
        </div>
      )}

      {/* ── Heatmap ─────────────────────────────────────────────────────────── */}
      {hasData && (
        <div style={{ background: "#080e1a", border: "1px solid #1f2937", borderRadius: 8, padding: 16 }}>

          {/* Sector mode: one mini-treemap per sector */}
          {sectorGroups ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {sectorGroups.map(sector => {
                // Height: proportional to stock count, clamped between 100 and 220 px
                const h = Math.max(100, Math.min(220, sector.stocks.length * 45));
                return (
                  <div key={sector.name} style={{ flex: "1 1 calc(50% - 6px)", minWidth: 220 }}>
                    {/* Sector label */}
                    <div style={{
                      fontSize: 10, fontWeight: 700, color: "#3b5a8b",
                      letterSpacing: "0.08em", textTransform: "uppercase",
                      marginBottom: 4, paddingLeft: 2,
                    }}>
                      {sector.name}
                    </div>
                    <ResponsiveContainer width="100%" height={h}>
                      <Treemap
                        key={`${animKey}-${sector.name}`}
                        data={sector.stocks}
                        dataKey="size"
                        aspectRatio={4 / 3}
                        stroke="transparent"
                        isAnimationActive={isAnimActive}
                        content={<HeatmapTile />}
                      />
                    </ResponsiveContainer>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Flat mode: single treemap */
            <ResponsiveContainer width="100%" height={560}>
              <Treemap
                key={animKey}
                data={flatData}
                dataKey="size"
                aspectRatio={4 / 3}
                stroke="transparent"
                isAnimationActive={isAnimActive}
                content={<HeatmapTile />}
              />
            </ResponsiveContainer>
          )}

          {/* Legend */}
          <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap", justifyContent: "center" }}>
            {LEGEND.map(({ label, color }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#6b7280" }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: color }} />
                {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && !hasData && tickers.length > 0 && (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#4b5563", fontSize: 14 }}>
          No data returned. Check that the backend is running.
        </div>
      )}
    </div>
  );
}
