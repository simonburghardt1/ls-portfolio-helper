"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode, HistogramSeries } from "lightweight-charts";

// --positive / --negative at 75% (canvas needs a literal colour for the alpha)
const UP = "rgba(52,211,153,0.75)";
const DOWN = "rgba(242,88,92,0.75)";

/**
 * Time-series bar chart coloured by sign — one bar per date, green above zero, red below.
 * Used for YoY % changes on the macro pages (Debt, GDP).
 *
 * Props: dates ("YYYY-MM-DD"[]), values ((number|null)[]), height (default 220)
 */
export default function SignBars({ dates, values, height = 220 }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !dates?.length) return;

    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#9ca3af" },
      grid: { vertLines: { color: "rgba(55,65,81,0.35)" }, horzLines: { color: "rgba(55,65,81,0.35)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: { borderColor: "#374151", timeVisible: false },
      width: el.clientWidth,
      height,
    });

    const bars = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: true, base: 0 });
    bars.setData(
      dates
        .map((d, i) => ({ time: d, value: values[i], color: values[i] >= 0 ? UP : DOWN }))
        .filter((p) => p.value != null)
    );
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => { ro.disconnect(); chart.remove(); };
  }, [dates, values, height]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
