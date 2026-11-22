"use client";

import { useEffect, useRef } from "react";
import { createChart, createSeriesMarkers, ColorType, CrosshairMode, LineSeries, PriceScaleMode } from "lightweight-charts";
import { resolveColor } from "@/app/lib/cssColor";

// Colours may be CSS vars ("var(--chart-1)"); the canvas needs them resolved
const resolveMarkers = (markers) => (markers ?? []).map((m) => (m.color ? { ...m, color: resolveColor(m.color) } : m));

/**
 * markers: optional array of lightweight-charts marker objects ({time, position, color,
 * shape, ...} — the library's own shape, passed straight through) applied to the first
 * series in `datasets`. Used by the Volatility page to highlight the weeks matching a
 * selected Distribution-of-Returns histogram bin; unused (and inert) for every other
 * caller of this shared component.
 */
export default function LineChart({ dates, datasets, visibleRange, referenceLine, logScale, markers, height = 380 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const markersApiRef = useRef(null);

  // Recreate chart when data changes
  useEffect(() => {
    if (!containerRef.current || !datasets?.length) return;
    if (!dates?.length && !datasets.some((d) => d.dates?.length)) return;

    const hasLeftAxis = datasets.some((d) => d.priceScaleId === "left");

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "rgba(55,65,81,0.35)" },
        horzLines: { color: "rgba(55,65,81,0.35)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: "#374151",
        mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      },
      leftPriceScale: { visible: hasLeftAxis, borderColor: "#374151" },
      timeScale: { borderColor: "#374151", timeVisible: true },
      width: containerRef.current.clientWidth,
      height,
    });

    chartRef.current = chart;
    markersApiRef.current = null;

    datasets.forEach((ds, i) => {
      const series = chart.addSeries(LineSeries, {
        color:            resolveColor(ds.borderColor ?? "var(--chart-1)"),
        lineWidth:        ds.borderWidth      ?? 2,
        lineStyle:        ds.lineStyle        ?? 0,
        priceLineVisible: false,
        lastValueVisible: ds.lastValueVisible ?? true,
        title:            ds.label            ?? "",
        priceScaleId:     ds.priceScaleId     ?? "right",
      });

      const dsDates = ds.dates ?? dates;
      const data = dsDates
        .map((date, i) => ({ time: date, value: ds.data[i] }))
        .filter((p) => p.value != null && !isNaN(p.value))
        .sort((a, b) => (a.time < b.time ? -1 : 1));

      series.setData(data);

      if (i === 0) {
        markersApiRef.current = createSeriesMarkers(series, resolveMarkers(markers));
      }
    });

    // Draw horizontal reference line (e.g. 50-threshold)
    if (referenceLine != null) {
      const allDates = datasets.flatMap((ds) =>
        (ds.dates ?? dates ?? []).filter(Boolean)
      );
      if (allDates.length >= 2) {
        const sorted = [...allDates].sort();
        const refSeries = chart.addSeries(LineSeries, {
          color: "rgba(156,163,175,0.55)",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          title: "",
          lineStyle: 1, // dashed
        });
        refSeries.setData([
          { time: sorted[0], value: referenceLine },
          { time: sorted[sorted.length - 1], value: referenceLine },
        ]);
      }
    }

    if (visibleRange) {
      chart.timeScale().setVisibleRange(visibleRange);
    } else {
      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [dates, datasets, logScale, height]);

  // Update visible range without recreating the chart
  useEffect(() => {
    if (!chartRef.current) return;
    if (visibleRange) {
      chartRef.current.timeScale().setVisibleRange(visibleRange);
    } else {
      chartRef.current.timeScale().fitContent();
    }
  }, [visibleRange]);

  // Update markers without recreating the chart (e.g. clicking a different histogram bin)
  useEffect(() => {
    if (!markersApiRef.current) return;
    markersApiRef.current.setMarkers(resolveMarkers(markers));
  }, [markers]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
