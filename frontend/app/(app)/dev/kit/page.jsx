"use client";

// Component gallery — every shared UI building block in one place, so the look can be
// reviewed (and screenshot-checked) without hunting through pages. Not linked from the
// sidebar; open /dev/kit directly. Add a section here whenever a component is added.

import { useState } from "react";
import { fmtPct, signColor } from "@/app/lib/format";
import Page from "@/app/components/Page";
import PageHeader from "@/app/components/PageHeader";
import Panel from "@/app/components/Panel";
import KpiCard from "@/app/components/KpiCard";
import Button from "@/app/components/Button";
import Badge from "@/app/components/Badge";
import Tabs from "@/app/components/Tabs";
import Chip from "@/app/components/Chip";
import InfoTip from "@/app/components/InfoTip";
import Popover, { MenuItem, MenuDivider, MenuGroupTitle } from "@/app/components/Popover";
import StateMessage from "@/app/components/StateMessage";
import DataTable from "@/app/components/DataTable";
import { heatColor } from "@/app/lib/heat";

export default function KitPage() {
  const [tab, setTab] = useState("a");
  const [range, setRange] = useState("1Y");
  const [chips, setChips] = useState(["SPY", "QQQ"]);
  const [selRow, setSelRow] = useState(null);

  return (
    <Page>
      <PageHeader
        title="Component kit"
        badges={<Badge variant="neutral">DEV</Badge>}
        meta={<><span>Shared building blocks</span><span style={{ color: "var(--border)" }}>·</span><span>frontend/app/components</span></>}
        actions={<><Button variant="secondary">Secondary</Button><Button variant="primary">Primary</Button></>}
      />

      <Panel title="KPI cards">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-3)" }}>
          <KpiCard label="November" formatted={fmtPct(0.026, 1)} valueColor={signColor(0.026)} caption="Up 19 of 24 years" />
          <KpiCard label="Next 4 weeks" formatted={fmtPct(-0.007, 1)} valueColor={signColor(-0.007)} caption="Up 3 of 6 years" />
          <KpiCard label="2026 YTD" formatted={fmtPct(0.12, 1)} valueColor={signColor(0.12)} caption="Seasonal avg +9.0%" />
          <KpiCard label="Regime" formatted="Uptrend" valueColor="var(--positive)" small caption="score 64" />
        </div>
      </Panel>

      <Panel title="Controls" titleExtra={<InfoTip text="InfoTip: explanations live here, not as sentences on the page." />}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <Row label="Toggle group">
            {["1M", "3M", "YTD", "1Y", "Max"].map((r) => (
              <Button key={r} variant="range-toggle" active={range === r} onClick={() => setRange(r)}>{r}</Button>
            ))}
          </Row>
          <Row label="Tabs">
            <Tabs tabs={[{ key: "a", label: "Performance" }, { key: "b", label: "Regime" }, { key: "c", label: "Holdings" }]} active={tab} onChange={setTab} />
          </Row>
          <Row label="Chips">
            {chips.map((c, i) => (
              <Chip key={c} color={["#3b82f6", "#10b981"][i % 2]} onRemove={() => setChips(chips.filter((x) => x !== c))}>{c}</Chip>
            ))}
            <Chip>static</Chip>
          </Row>
          <Row label="Popover menu">
            <Popover trigger={(t) => <Button variant="secondary" onClick={t}>⋯</Button>} width={180}>
              {(close) => (
                <>
                  <MenuGroupTitle>Group</MenuGroupTitle>
                  <MenuItem onClick={close}>Copy</MenuItem>
                  <MenuItem disabled>Disabled</MenuItem>
                  <MenuDivider />
                  <MenuItem danger onClick={close}>Delete</MenuItem>
                </>
              )}
            </Popover>
          </Row>
          <Row label="Badges">
            <Badge variant="neutral">CUSTOM</Badge>
            <Badge variant="disabled">SYSTEM</Badge>
          </Row>
        </div>
      </Panel>

      <Panel title="Data table" titleExtra={<InfoTip text="Click a header with sortable: true to sort (desc, asc, original). Rows can be clickable and selected." />}>
        <DataTable
          rowKey="t"
          rows={DEMO_ROWS}
          onRowClick={(r) => setSelRow(r.t === selRow ? null : r.t)}
          isRowSelected={(r) => r.t === selRow}
          footerRows={[{ t: "Total", w: 1, p: null, c: DEMO_ROWS.reduce((s, r) => s + r.c, 0), __strong: true }]}
          columns={[
            { key: "t", label: "Ticker", sortable: true },
            { key: "w", label: "Weight", numeric: true, sortable: true, format: (v) => fmtPct(v, 1, { sign: false }) },
            { key: "p", label: "Performance", numeric: true, sortable: true, format: (v) => fmtPct(v), color: signColor },
            { key: "c", label: "Contribution", numeric: true, sortable: true, format: (v) => fmtPct(v), color: signColor },
          ]}
        />
      </Panel>

      <Panel title="Heatmap table (dense, flush, inset)" flush>
        <DataTable
          dense
          inset
          rowKey="y"
          rows={[{ y: 2026, m: [0.015, -0.009, -0.049, 0.105] }, { y: 2025, m: [0.027, -0.013, -0.056, -0.009] }]}
          columns={[
            { key: "y", label: "Year" },
            ...["Jan", "Feb", "Mar", "Apr"].map((label, i) => ({
              key: label, label, numeric: true, value: (r) => r.m[i], format: (v) => fmtPct(v, 1), cellStyle: (v) => ({ background: heatColor(v, 0.06) }),
            })),
          ]}
        />
      </Panel>

      <Panel title="Numbers">
        <div style={{ display: "flex", gap: "var(--space-6)", fontFamily: "var(--font-family-mono)", fontSize: 13 }}>
          {[0.1234, -0.0567, 0, -0.00001, null].map((v, i) => (
            <span key={i} style={{ color: signColor(v) }}>{fmtPct(v)}</span>
          ))}
        </div>
      </Panel>

      <Panel title="States">
        <StateMessage kind="loading" style={{ padding: "12px 0" }} />
        <StateMessage style={{ padding: "12px 0" }}>Not enough price history for this asset.</StateMessage>
        <StateMessage kind="error" style={{ marginBottom: 0 }}>Could not load seasonality data.</StateMessage>
      </Panel>

      <Panel title="Flush panel (tables)" flush>
        <div style={{ padding: "0 var(--space-4) var(--space-4)", fontSize: 13, color: "var(--text-secondary)" }}>
          flush = no padding, so a table can run edge to edge; the title row keeps its own.
        </div>
      </Panel>
    </Page>
  );
}

const DEMO_ROWS = [
  { t: "NVDA", w: 0.2, p: 0.124, c: 0.0248 },
  { t: "AAPL", w: 0.3, p: -0.031, c: -0.0093 },
  { t: "MSFT", w: 0.5, p: 0.042, c: 0.021 },
];

function Row({ label, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
      <span style={{ width: 110, fontSize: 12, color: "var(--text-secondary)" }}>{label}</span>
      {children}
    </div>
  );
}
