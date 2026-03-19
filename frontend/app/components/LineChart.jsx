"use client";

import {
    Chart as ChartJS,
    LineElement,
    PointElement,
    LinearScale,
    TimeScale,
    Tooltip,
    Legend,
    CategoryScale,
} from "chart.js";
import { Line } from "react-chartjs-2";
import "chartjs-adapter-date-fns";

ChartJS.register(
    LineElement,
    PointElement,
    LinearScale,
    TimeScale,
    Tooltip,
    Legend,
    CategoryScale,
);

export default function LineChart({ dates, datasets }) {
    const data = {
        labels: dates,
        datasets,
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: "index",
            intersect: false,
        },
        scales: {
            x: {
                type: "time",
                time: {
                    unit: "month",
                },
                ticks: {
                    color: "#9ca3af",
                },
                grid: {
                    color: "rgba(55,65,81,0.35)",
                },
                border: {
                    color: "#374151",
                },
            },
            y: {
                beginAtZero: false,
                ticks: {
                    color: "#9ca3af",
                },
                grid: {
                    color: "rgba(55,65,81,0.35)",
                },
                border: {
                    color: "#374151",
                },
            },
        },
        plugins: {
            legend: {
                labels: {
                    color: "#e5e7eb",
                    boxWidth: 18,
                },
            },
            tooltip: {
                backgroundColor: "#111827",
                titleColor: "#f9fafb",
                bodyColor: "#e5e7eb",
                borderColor: "#374151",
                borderWidth: 1,
            },
        },
    };

    return (
        <div style={{ height: 380 }}>
            <Line data={data} options={options} />
        </div>
    );
}
