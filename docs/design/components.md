# Shared component reference

Concrete prop-level API for the shared components in `frontend/app/components/`. Visual rationale lives in [DESIGN.md](DESIGN.md); behavioral rules in [EXPERIENCE.md](EXPERIENCE.md). This file exists so you don't have to re-read each component's source to know what it accepts — keep it in sync when a prop is added/changed.

## `Badge.jsx`

Unifies all status/result/toggle chips across the app (LONG/SHORT, WIN/LOSS, "SOON", per-series insight values, admin status rows) into one component with two structurally different render paths.

```jsx
<Badge variant="positive">WIN</Badge>                                  {/* static */}
<Badge variant={isLong ? "positive" : "negative"} interactive onClick={toggleSide}>
  {isLong ? "LONG" : "SHORT"}
</Badge>                                                                {/* interactive */}
```

| Prop | Type | Default | Notes |
|---|---|---|---|
| `variant` | `"positive" \| "negative" \| "neutral" \| "disabled"` | `"neutral"` | Color only |
| `interactive` | `bool` | `false` | Switches to the full-pill, clickable treatment |
| `onClick` | `fn` | — | Only applies when `interactive` |
| `children`, `style`, `title` | — | — | Standard passthroughs |

- **Static** (`interactive={false}`, the default) renders a bare `<span>` — no border/background/padding, just color-coded `--text-label-*` text. Used for anything purely informational.
- **Interactive** renders a `<button>` — full pill (`--radius-full`), translucent color fill (~18% opacity), `cursor: pointer`, hover border brightens to `--text-secondary`. Used only for a genuine toggle (e.g. flipping a position's long/short side).

**Known hardening gaps (not live bugs today, see [status.md](status.md)):** `onMouseEnter`/`onMouseLeave` aren't destructured out of `{...rest}` on the interactive branch, so a caller passing its own would silently override the built-in hover effect; the variant-lookup object has no guard against prototype-pollution-style keys.

## `Button.jsx`

```jsx
<Button variant="secondary" onClick={refresh}>Refresh</Button>
<Button variant="range-toggle" active={period === "1Y"} onClick={() => setPeriod("1Y")}>1Y</Button>
<Button variant="primary" onClick={runBacktest}>▶ Run Backtest</Button>
```

| Prop | Type | Default | Notes |
|---|---|---|---|
| `variant` | `"secondary" \| "range-toggle" \| "primary"` | `"secondary"` | |
| `active` | `bool` | `false` | Only meaningful for `"range-toggle"` |
| `children`, `onClick`, `disabled`, `style`, `title` | — | — | Standard passthroughs |

Always sharp corners, all variants, all states. `range-toggle`'s active state gets the same fill/color language as an active `Tabs` tab (`--nav-active-surface`, `--text-primary`/600) but **never** the rounded corner — shape stays sharp so a row of range buttons doesn't compete with an actual tab bar. `primary` is the only "inverted" pairing in the system (`--text-primary` fill, `--bg-base` text) — still an interim decision on whether it needs more visual weight for a genuine CTA.

**Known hardening gaps:** `type="button"` is hardcoded before `{...rest}` spreads, so a future `type="submit"` caller would be silently overridden; unrecognized `variant` values fall back to secondary-looking styling with no warning.

## `KpiCard.jsx`

Two independent axes: interactive-vs-static, and how the value is formatted.

```jsx
{/* Dashboard: interactive, numeric */}
<KpiCard id={k.id} label={k.name} value={k.value} unit={k.unit}
  change={k.change} good_direction={k.good_direction}
  onClick={handleCardClick} isSelected={selectedSeriesId === k.id} />

{/* Track Record / Market Regime: static, pre-formatted */}
<KpiCard label="Account Value" formatted={`€${(val/1000).toFixed(1)}K`} />
<KpiCard label="BMSB" formatted="Uptrend" valueColor="var(--positive)" small
  caption="score 1.00" />
```

| Prop | Type | Default | Notes |
|---|---|---|---|
| `id` | any | — | Passed back to `onClick(id)` |
| `label` | string | — | Uppercase label line |
| `value` | number | — | Coerced via `Number(value).toFixed(2)`. Ignored when `formatted` is present |
| `formatted` | string \| number | — | Pre-formatted display value, used as-is, takes priority over `value` |
| `unit` | string | — | Small text rendered inline next to the value |
| `change` | number | — | MoM-style delta; renders an arrow + value + "MoM" line below the value, color-coded via `good_direction` |
| `good_direction` | `"up" \| "down"` | — | Which sign of `change` counts as "good" (green) |
| `caption` | string \| node | — | Plain muted line below the value, for a secondary fact that isn't a delta (e.g. "score 0.55"). **Ignored when `change` is present** — `change` wins |
| `onClick` | fn | — | **Optional.** If provided, renders as a `<button>` (interactive). If omitted, renders as a `<div>` (static) |
| `isSelected` | bool | — | Only applied when `onClick` is provided — a static card ignores it |
| `small` | bool | `false` | Denser padding, `--text-data-sm-*` value size instead of `--text-data-lg-*` |
| `valueColor` | string | `var(--text-primary)` | Explicit override, e.g. `"var(--positive)"` |

Sharp corners, `--bg-elevated` background, 1px `--border` always. This is the one shared component every KPI-tile-style box in the app should use — if you find yourself hand-rolling a small labeled box with a bold value, use this instead (see [status.md](status.md) for pages that still don't).

## `PageHeader.jsx`

```jsx
<PageHeader title="Seasonality" actions={<AssetSelector … />} />
<PageHeader
  back={{ href: "/portfolio/markets/baskets", label: "Baskets" }}
  title={basket.name}
  badges={<><RegimePill … /><Badge variant="neutral">CUSTOM</Badge></>}
  meta={<><span>Equal-weight</span><span>·</span><span>7 holdings</span></>}
  actions={<><Button>Edit</Button><Popover …/></>}
/>
```

| Prop | Type | Notes |
|---|---|---|
| `title` | string | The page's `<h1>` — usually the only thing needed |
| `badges` | node | Inline right after the title (status pill, SYSTEM/CUSTOM) |
| `meta` | node | One quiet line of identifying facts under the title (see DESIGN.md → Restraint) |
| `actions` | node | Pinned right: buttons, an asset picker |
| `back` | `{ href, label }` | Breadcrumb link above the title on detail pages |
| `subtitle` | string \| node | Optional: one plain, factual line (DESIGN.md → Restraint) |
| `style` | object | Merged onto the wrapper |

## `Page.jsx`

`<Page>…</Page>` — the outer frame every page renders (background, 28px/32px padding, min-height). Replaces the hand-rolled wrapper `<div>`.

## `Panel.jsx`

```jsx
<Panel title="Seasonal path" titleExtra={<Legend/>} actions={<Popover …/>}>…</Panel>
<Panel title="Monthly returns" titleExtra={<InfoTip text="…" />} flush><table/></Panel>
```

| Prop | Notes |
|---|---|
| `title` | Label-styled heading (short noun phrase) |
| `titleExtra` | Node right after the title: an `InfoTip`, a chart legend |
| `actions` | Node pinned right of the title row |
| `flush` | No body padding — for edge-to-edge tables; the title row keeps its own |

## `Popover.jsx` (+ `MenuItem`, `MenuDivider`, `MenuGroupTitle`)

```jsx
<Popover align="right" width={170} trigger={(toggle) => <Button onClick={toggle}>⋯</Button>}>
  {(close) => <MenuItem onClick={() => { close(); copy(); }}>Copy Basket</MenuItem>}
</Popover>
```

Click-to-open panel under its trigger; closes on outside click / Escape. `children` may be a node or `(close) => node`. `padded` adds 12px padding for non-menu content (e.g. a picker grid). `MenuItem` takes `danger`, `disabled`. Styles in `Popover.module.css` (hover/focus states).

## `Chip.jsx`

`<Chip color="#3b82f6" onRemove={() => …}>SPY</Chip>` — removable pill for an active selection; `color` shows a dot matching the chart series. Omit `onRemove` for a static chip.

## `InfoTip.jsx`

`<InfoTip text="…" align="left|right" />` — "i" button; click opens the explanation in a popup (built on `Popover`, closes on outside click / Escape). The place for explanations (DESIGN.md → Restraint).

## `StateMessage.jsx`

`<StateMessage kind="loading" />`, `<StateMessage>No Baskets yet.</StateMessage>`, `<StateMessage kind="error">Could not load …</StateMessage>` — the only loading/empty/error rendering.

## `lib/format.js`, `lib/hooks.js`

- `fmtPct(v, dp = 2, { sign = true })` → `"+1.23%"`, `"—"` for null, never `"-0.00%"`. `fmtNum(v, dp)`. `signColor(v)` → `--positive`/`--negative`/`--text-secondary`.
- `useClickOutside(ref, active, onOutside)`, `useElementWidth()` → `[ref, width]`.

Don't re-declare `pct()`/`fmtPct()`/`pctColor()`/`useClickOutside()` locally in a page — import these.

## `RollingWindows.jsx`

`<RollingWindows title current series={(k) => ({dates, data})} format valueColor referenceLine defaultActive />` — one clickable `KpiCard` per rolling window (1M…5Y) that doubles as legend + toggle for its line in the chart below. Used by Correlation and Beta.

## `PortfolioPicker.jsx`

`<PortfolioPicker value onChange={(value, name) => …} allowLive />` — saved-portfolio select (optionally with "Live portfolio"), same label-over-control look as `AssetSelector`, for a `PageHeader`'s `actions`.

## Gallery

`/dev/kit` (not in the sidebar) renders every shared component and state. Add a section there whenever a component is added or changed.

## `Tabs.jsx`

```jsx
<Tabs tabs={[{ key: "lp", label: "Live Portfolio" }, { key: "rp", label: "Realized PnL" }]}
  active={tab} onChange={setTab} />
```

| Prop | Type | Notes |
|---|---|---|
| `tabs` | `[{ key, label }]` | |
| `active` | the currently selected tab's `key` | |
| `onChange` | `(key) => void` | |

Active tab gets the sidebar's rounded active-nav treatment (`--radius-nav-active`, `--nav-active-surface`, `--text-primary`/600) — the second and only other place rounding appears in the system besides sidebar nav. Replaces the old per-page colored-underline pattern.

**Known gap:** no ARIA roles/keyboard nav (`role="tablist"`/`tab`, `aria-selected`, arrow keys), no duplicate-key guard on the `tabs` array.
