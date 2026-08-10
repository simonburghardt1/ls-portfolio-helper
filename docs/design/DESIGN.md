# DESIGN.md — Slate Mono

**Status:** living document, kept in sync with `frontend/app/globals.css` and the shared components in `frontend/app/components/`. Last synced: 2026-08-04.

> This is a distilled, code-accurate version of the BMAD UX spine originally produced at `_bmad-output/planning-artifacts/ux-designs/ux-ls-portfolio-helper-2026-07-27/DESIGN.md` (not committed — see [README](README.md)). Token *names* below match the real CSS custom properties in `globals.css`, not the abstract `{colors.x}` naming the BMAD spine uses internally.

## Brand & Style

LS Portfolio Helper is a private trading and macro-research tool for a single user, built to a professional, shippable bar — not "good enough for just me." The aesthetic reference points: **Godel Terminal** (palette, sharp edges, professional typography, tonally-layered dark greys), **YouTube** (sidebar hierarchy and rounded active-state affordance), **Discord** (dark-grey warmth). The result is deliberately *not* a terminal and *not* accounting software — calm and focused on a handful of important numbers, not a dense data firehose.

The system is called **Slate Mono** — a near-monochrome, cool-toned dark palette where the accent color is almost absent by design. Color is a scarce resource spent on the numbers that matter: gains and losses. Everything else — chrome, nav, borders, structure — stays quiet grey so green and red carry real signal instead of competing with decorative brand color.

The shape language carries a second piece of meaning: sharp corners everywhere data/content live, and rounding is reserved for exactly two specific, narrow registers (see [Shapes](#shapes)). Treat that pairing as load-bearing, not a stylistic accident.

## Colors

Defined in `frontend/app/globals.css` under `:root`.

| Token | Value | Use |
|---|---|---|
| `--page-background` | `#05070a` | Outermost canvas, behind the centered app frame (one step darker than `--bg-base`) |
| `--bg-base` | `#0e0f11` | Page-level root background — the darkest tone the app content itself sits on |
| `--bg-surface` | `#16181b` | Sidebar, panels, chart/table containers — one step brighter than base |
| `--bg-elevated` | `#1e2124` | KPI cards and anything meant to "lift" slightly off its surface — one step brighter than surface |
| `--border` | `#2c3034` | The only border color. 1px hairlines everywhere; never used as a fill |
| `--text-primary` | `#eceef0` | Highest-contrast text: headlines, active nav items, neutral KPI values |
| `--text-secondary` | `#8b9096` | Default body/label text, inactive nav items, group headers |
| `--text-disabled` | `#5c6066` | Dimmest tone — "coming soon" nav items and their badges only |
| `--accent` | `#6b7280` | The *only* accent color. Spent in exactly one place: the active sidebar nav item's affordance. Never a button fill, link color, or decorative flourish |
| `--nav-active-surface` | `rgba(107,114,128,0.22)` | Fill behind the active sidebar nav item / active tab (`--accent` at 22% opacity) |
| `--positive` | `#34d399` | Gains, positive deltas — the only green in the system |
| `--negative` | `#f2585c` | Losses, negative deltas — the only red in the system |
| `--caution` | `#f59e0b` | Amber — neutral/warning states that are neither a gain nor a loss (e.g. Market Regime's "Ranging" state, "custom weights active" notices) |

**Never reuse `--positive`/`--negative` for anything except gain/loss meaning.** No other UI state (success toasts, generic warnings, unrelated badges) should borrow green or red, or they stop reading as "money." Translucent fills derived from these (e.g. `rgba(52,211,153,0.18)` for an interactive Badge, `rgba(52,211,153,0.3)` for a success-state border) should keep the same RGB base (`52,211,153` / `242,88,92`) so they stay visually locked to the token even though CSS can't `rgba()` a custom property directly.

### Chart series colors (categorical)

For chart *lines/series* (not KPI values, not badges), use `--chart-1` through `--chart-11`, in order, one per series:

| Token | Value | | Token | Value | | Token | Value |
|---|---|---|---|---|---|---|---|
| `--chart-1` | `#3b82f6` blue | | `--chart-5` | `#ef4444` red | | `--chart-9` | `#84cc16` lime |
| `--chart-2` | `#10b981` green | | `--chart-6` | `#06b6d4` cyan | | `--chart-10` | `#a78bfa` light purple |
| `--chart-3` | `#f59e0b` amber | | `--chart-7` | `#f97316` orange | | `--chart-11` | `#fb923c` light orange |
| `--chart-4` | `#8b5cf6` purple | | `--chart-8` | `#ec4899` pink | | | |

A single-series chart uses `--chart-1` only. This formalizes a sequence that was already the de facto standard in several places before it had a name: backend indicator-color dicts (`building_permits.py`, `consumer_confidence.py`, `cpi_ppi.py`, `debt.py`, `gdp.py`, `nfib.py` all define their series in exactly this blue → green → amber → purple → red order) and `ism-manufacturing/page.jsx`'s 11-component palette (the origin of the 6–11 extension). See [status.md](status.md) for which pages still need retrofitting onto these tokens vs. which already match by convention.

**These are categorical/qualitative colors, not semantic ones.** Unlike `--positive`/`--negative`, a series being `--chart-2` (green) does not mean "this went up" — it just means "second series in this chart." Context (a KPI value vs. a named line in a legend) disambiguates; don't read chart-line green/red as gain/loss signals.

**Use the literal hex value in code, not `var(--chart-N)`.** Every chart-color consumer in this app — direct `createChart()` calls, and the shared `LineChart.jsx` component (which is *also* a `lightweight-charts` wrapper, not a separate SVG/DOM chart) — draws on `<canvas>`, and canvas 2D context colors (`strokeStyle` etc.) don't resolve CSS custom properties; a `var(...)` string is silently invalid there and the line falls back to black with no console error. This isn't a narrow "canvas is the exception" case — it's the norm for every chart in this app today. Copy the literal hex from the table above and keep it in sync if the token ever changes. (Confirmed the hard way: the initial `--chart-1` rollout used `var(--chart-1)` in `(app)/page.js` and silently rendered a black line until caught in browser verification.)

Legacy tokens still present in `globals.css`, now fully unused — safe to delete, kept only as historical residue: `--green-400/500/600/900/muted`, `--blue-400`, `--blue-muted`, `--bg-subtle`, `--border-light`, `--text-muted`, `--text-ghost`, `--font-2xl/xl/lg/base/sm`.

## Typography

`--font-family-sans: -apple-system, "Segoe UI", system-ui, sans-serif` for everything read as *language* (headlines, labels, nav, body copy). `--font-family-mono: Consolas, "Cascadia Code", ui-monospace, monospace` for everything read as a *number* (KPI values, deltas, tabular data). System fonts only — no webfont loading, zero extra network requests. This mono/sans split is the single rule that tells a user "this is data" vs. "this is language"; never mix them.

| Role | Tokens | Size | Weight | Notes |
|---|---|---|---|---|
| Page headline | `--text-headline-*` | 34px | 700 | -0.02em tracking, 1.15 line-height |
| Eyebrow | `--text-eyebrow-*` | 12px | 600 | Uppercase, 0.1em tracking |
| Body copy | `--text-body-*` | 14.5px | 400 | 1.55 line-height |
| Label (KPI/panel labels) | `--text-label-*` | 11.5px | 600 | Uppercase, 0.06em tracking |
| Data, large | `--text-data-lg-*` | 24px | 600 | Mono, tabular numerals, -0.01em tracking — KPI values |
| Data, small | `--text-data-sm-*` | 12px | 600 | Mono, tabular numerals, 1.3 line-height — deltas, inline figures, `small` KPI tiles. **No dedicated tracking token exists for this size** — fall back to `normal`/unset rather than reusing the lg tracking value |
| Nav section label | `--text-nav-section-label-*` | 11px | 700 | Uppercase, 0.1em tracking |
| Nav group header | `--text-nav-group-header-*` | 13px | 600 | Sentence case |
| Nav item | `--text-nav-item-*` | 14px | 400 | |

Headline (34px) is ~2.4× body (14.5px) — deliberately large enough that hierarchy reads at a glance.

## Layout & Spacing

8px-rooted scale: `--space-1`…`--space-8` = 4/8/12/16/20/24/32/48px.

- `--sidebar-width` (252px) — fixed sidebar width.
- `--nav-item-indent` (22px) — indent for nav items under a group header.
- `--page-margin` (48px) — horizontal breathing room around main content.

**The app frame.** Sidebar + main content sit in a single flex container, horizontally centered, `max-width: calc(50vw + 720px)`, with a 1px `--border` on its left/right edges and `--bg-base` fill. The `<body>` behind it uses `--page-background` — one step darker. Above 1440px this reads as a bordered panel floating on a darker canvas; below 1440px the frame just fills the viewport.

## Elevation & Depth

No drop shadows as a hierarchy device anywhere in the default theme. Depth comes from **tonal layering**: `--bg-base` → `--bg-surface` → `--bg-elevated`, each a step brighter, separated by 1px `--border` hairlines. No blur, no shadow, no glow.

## Shapes

- **Sharp (`--radius-none`, 0px)** — every content container: KPI cards, tables, panels, chart frames, buttons (all variants, all states), form inputs. Default for everything. This is the "serious instrument" register: data lives in precise, unornamented rectangles.
- **Rounded, soft rectangle (`--radius-nav-active`, 8px)** — used in exactly two places: the active highlight on a sidebar nav item, and the active tab in `Tabs`. A full pill was explicitly tried and rejected for this use — too "consumer app" for a primary navigational control.
- **Rounded, full pill (`--radius-full`, 9999px)** — used in exactly one place: an interactive `Badge` (e.g. a LONG/SHORT position-side toggle). A deliberately different register from nav/tabs — a small, secondary, in-table control, not a page-level affordance.

**The rule, stated plainly: rounded means "this is a selection control," sharp means "this is content."** A `Button` range-toggle stays sharp even in its active state (communicates selection via fill/weight, not shape, so it doesn't compete with the tab bar's rounded signal). A static (non-interactive) `Badge` gets **no container at all** — plain color-coded text, same register as any other data-table column — so it never competes with the shape system either way. The two rounded registers (nav-active vs. full-pill) are kept visually distinct on purpose, so a user never mistakes an in-table toggle for a navigational element.

## Components

See [components.md](components.md) for exact props/usage. Visual specs:

**KPI Card** — sharp corners, `--bg-elevated` background, 1px `--border`. Label in `--text-label-*`/`--text-secondary` (uppercase, muted, recedes). Value in `--text-data-lg-*` (or `--text-data-sm-*` in the `small` variant), color-coded by sign (`--positive`/`--negative`/`--text-primary` for neutral). Optional delta line below in `--text-data-sm-*`, same color rule. Never uses `--accent`.

**Sidebar Nav** — three text levels: section label (11px/700/uppercase/muted — orientation only, not interactive), group header (13px/600/sentence-case), nav item (14px/400 — the largest/most legible of the three, since these are what's actually clicked). Only the active item gets rounded treatment (`--radius-nav-active`, `--nav-active-surface` fill, `--text-primary`/600). Inactive: transparent, sharp, `--text-secondary`. Disabled ("soon"): `--text-disabled`, not interactive.

**Panel** — sharp, `--bg-surface` background, 1px `--border`, `--space-5` padding. Holds secondary content beneath a page's KPI row. Never uses `--bg-elevated` (that tone is reserved for KPI cards, so cards read as "lifted" above the panels containing them).

**Tabs** — flat transparent buttons under a full-width 1px `--border` bottom border. Active tab: `--radius-nav-active` rounded, `--nav-active-surface` fill, `--text-primary`/600. Inactive: transparent, `--text-secondary`/400.

**Button** — always sharp, regardless of variant/state.
- *secondary* (default) — transparent, 1px `--border`, `--text-secondary` text.
- *range-toggle* — for single-select groups. Inactive = secondary. Active = `--nav-active-surface` fill, `--text-primary`/600, **sharp corners always** (never the nav/tabs rounding).
- *primary* — a page's main triggered action. Solid `--text-primary` fill, `--bg-base` text (the system's only "inverted" pairing), 600 weight. **Interim decision, not fully settled** — flagged as possibly needing more visual pop for a genuine CTA; revisit if it reads too quiet in practice.

**Badge** — two structurally different render paths, not just a style toggle:
- *static* (default) — no container at all. Plain `--text-label-*` text, color-coded positive/negative/neutral/disabled.
- *interactive* — full pill (`--radius-full`), translucent color fill (~18% opacity), `cursor: pointer`, hover border brightens to `--text-secondary`.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Spend `--positive`/`--negative` only on gain/loss meaning | Reuse green/red for any other UI state |
| Keep `--accent` confined to the active-nav affordance | Use `--accent` as a button fill, link color, or decorative accent |
| Sharp corners on every content container | Round a KPI card, table, or panel |
| Round nav/tabs at `--radius-nav-active` (8px) only | Use that radius on anything other than the active sidebar item or active tab |
| Use `--radius-full` only for an interactive `Badge` | Use a full pill for a page-level control, or mix the two rounded registers on the same kind of element |
| Give a static `Badge` no container at all | Wrap a purely informational badge in a bordered chip |
| Keep a range-toggle `Button`'s active state sharp | Round a range-toggle button's active state |
| Use mono with tabular figures for every numeric value | Set numbers in the sans face or let KPI columns use proportional spacing |
| Build depth via tonal layering (base/surface/elevated) | Add drop shadows or glows as a hierarchy device |
| Use `--caution` for neutral/warning, non-directional states | Use `--positive`/`--negative` for anything that isn't literally a gain or loss |
