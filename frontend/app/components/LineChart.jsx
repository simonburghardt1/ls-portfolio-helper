"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode, LineSeries } from "lightweight-charts";

export default function LineChart({ dates, datasets, visibleRange }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  // Recreate chart when data changes
  useEffect(() => {
    if (!containerRef.current || !dates?.length || !datasets?.length) return;

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
        color: ds.borderColor ?? "#3b82f6",
        lineWidth: ds.borderWidth ?? 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "",
      });

      const data = dates
        .map((date, i) => ({ time: date, value: ds.data[i] }))
        .filter((p) => p.value != null && !isNaN(p.value))
        .sort((a, b) => (a.time < b.time ? -1 : 1));

      series.setData(data);
    });

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
