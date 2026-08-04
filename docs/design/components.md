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
<PageHeader title="Market Regime" subtitle="Composite of BMSB · Market Breadth · VIX · Credit Spreads — daily closes." />
<PageHeader title="Macro Dashboard" subtitle="FRED data · Leading & concurrent indicators" style={{ marginBottom: 0 }} />
```

| Prop | Type | Notes |
|---|---|---|
| `title` | string | The page's `<h1>` |
| `subtitle` | string \| node | One line of supporting copy; accepts JSX (e.g. an inline `<strong>`) |
| `style` | object | Merged onto the wrapper div — needed to cancel the default bottom margin when the header sits inline next to a sibling button/status pill |

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
