"use client";

import { useState } from "react";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Tabs from "@/app/components/Tabs";
import Button from "@/app/components/Button";
import LivePortfolioTab from "./LivePortfolioTab";
import RealizedPnlTab from "./RealizedPnlTab";
import EquityCurveTab from "./EquityCurveTab";
import IbkrImport from "./IbkrImport";

const TABS = [
  { key: "live", label: "Live Portfolio" },
  { key: "realized", label: "Realized PnL" },
  { key: "equity", label: "Equity Curve" },
];

export default function TrackRecordPage() {
  const [tab, setTab] = useState("live");
  const [importOpen, setImportOpen] = useState(false);
  // Bumped after an import / clear-all so the active tab remounts and refetches
  const [dataVersion, setDataVersion] = useState(0);

  return (
    <Page>
      <PageHeader
        title="Trading Track Record"
        subtitle="Live positions, realized trades and the equity curve."
        actions={!importOpen && <Button variant="secondary" onClick={() => setImportOpen(true)}>Import IBKR CSV</Button>}
      />

      {importOpen && <IbkrImport onImported={() => setDataVersion((v) => v + 1)} onClose={() => setImportOpen(false)} />}

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "live" && <LivePortfolioTab key={`live-${dataVersion}`} />}
      {tab === "realized" && <RealizedPnlTab key={`realized-${dataVersion}`} />}
      {tab === "equity" && <EquityCurveTab key={`equity-${dataVersion}`} />}
    </Page>
  );
}
