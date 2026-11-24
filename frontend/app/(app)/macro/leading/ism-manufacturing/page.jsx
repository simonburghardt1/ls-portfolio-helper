"use client";

import IsmDashboard from "../_ism/IsmDashboard";

const CONFIG = {
  kind: "manufacturing",
  title: "ISM Manufacturing Index",
  subtitle: "Institute for Supply Management. Monthly PMI components.",
  colors: {
    pmi:                   "var(--chart-1)",
    new_orders:            "var(--chart-2)",
    production:            "var(--chart-3)",
    employment:            "var(--chart-4)",
    supplier_deliveries:   "var(--chart-5)",
    inventories:           "var(--chart-6)",
    customers_inventories: "var(--chart-7)",
    prices:                "var(--chart-8)",
    backlog_of_orders:     "var(--chart-9)",
    new_export_orders:     "var(--chart-10)",
    imports:               "var(--chart-11)",
  },
  defaultActive: ["pmi", "new_orders", "production"],
  invertedCol: "customers_inventories",
  invertedNote: "Customers' Inventories coloured inverted (low = bullish)",
  name: "ISM",
  adminHref: "/admin/ism",
};

export default function IsmManufacturingPage() {
  return <IsmDashboard config={CONFIG} />;
}
