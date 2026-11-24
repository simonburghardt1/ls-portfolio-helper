"use client";

import IsmDashboard from "../_ism/IsmDashboard";

const CONFIG = {
  kind: "services",
  title: "ISM Services Index",
  subtitle: "Institute for Supply Management. Monthly Services PMI components.",
  colors: {
    pmi:                 "var(--chart-1)",
    new_orders:          "var(--chart-2)",
    business_activity:   "var(--chart-3)",
    employment:          "var(--chart-4)",
    supplier_deliveries: "var(--chart-5)",
    inventories:         "var(--chart-6)",
    inventory_sentiment: "var(--chart-7)",
    prices:              "var(--chart-8)",
    backlog_of_orders:   "var(--chart-9)",
    new_export_orders:   "var(--chart-10)",
    imports:             "var(--chart-11)",
  },
  defaultActive: ["pmi", "new_orders", "business_activity"],
  invertedCol: "inventory_sentiment",
  invertedNote: "Inventory Sentiment coloured inverted (low = bullish)",
  name: "ISM Services",
  adminHref: "/admin/ism-services",
};

export default function IsmServicesPage() {
  return <IsmDashboard config={CONFIG} />;
}
