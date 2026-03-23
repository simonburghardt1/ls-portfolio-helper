"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode, LineSeries } from "lightweight-charts";

export default function LineChart({ dates, datasets, visibleRange, referenceLine }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  // Recreate chart when data changes
  useEffect(() => {
    if (!containerRef.current || !datasets?.length) return;
    if (!dates?.length && !datasets.some((d) => d.dates?.length)) return;

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
      rightPriceScale: { borderColor: "#374151" },
      timeScale: { borderColor: "#374151", timeVisible: true },
      width: containerRef.current.clientWidth,
      height: 380,
    });

    chartRef.current = chart;

    datasets.forEach((ds) => {
      const series = chart.addSeries(LineSeries, {
        color:            ds.borderColor      ?? "#3b82f6",
        lineWidth:        ds.borderWidth      ?? 2,
        lineStyle:        ds.lineStyle        ?? 0,
        priceLineVisible: false,
        lastValueVisible: ds.lastValueVisible ?? true,
        title:            ds.label            ?? "",
      });

      const dsDates = ds.dates ?? dates;
      const data = dsDates
        .map((date, i) => ({ time: date, value: ds.data[i] }))
        .filter((p) => p.value != null && !isNaN(p.value))
        .sort((a, b) => (a.time < b.time ? -1 : 1));

      series.setData(data);
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
  }, [dates, datasets]);

  // Update visible range without recreating the chart
  useEffect(() => {
    if (!chartRef.current) return;
    if (visibleRange) {
      chartRef.current.timeScale().setVisibleRange(visibleRange);
    } else {
      chartRef.current.timeScale().fitContent();
    }
  }, [visibleRange]);

  return <div ref={containerRef} style={{ width: "100%", height: 380 }} />;
}
