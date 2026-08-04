# EXPERIENCE.md

**Status:** living document, distilled from `_bmad-output/planning-artifacts/ux-designs/ux-ls-portfolio-helper-2026-07-27/EXPERIENCE.md` (not committed — see [README](README.md)). Last synced: 2026-08-04.

> This is a conversational-discovery redesign, not sourced from a PRD. Several sections below are marked as open gaps rather than filled with invented content.

## Foundation

Desktop web app. Next.js frontend, FastAPI backend. No named UI system/component library — custom-built, see [DESIGN.md](DESIGN.md) for visual tokens and [components.md](components.md) for the shared component API. Single-user, single-tenant tool, but scoped to a professional/shippable polish bar rather than a throwaway internal tool — the redesign restyles the product, it does not reorganize what it does.

## Information Architecture

Sourced from the real navigation structure in `frontend/app/components/Sidebar.jsx`. The redesign changes visual treatment (spacing, hierarchy, shape, type); it does not add, remove, or reorganize sections.

| Section | Group | Items |
|---|---|---|
| Macro-Ökonomie | *(ungrouped)* | Macro Dashboard (`/`) |
| Macro-Ökonomie | Leading Indicators | Bond Yields*, ISM Manufacturing, ISM Non-Manufacturing*, Consumer Confidence, US Building Permits, NFIB Optimism, CoT Data, Commodity Prices, European Sentiment*, China Manufacturing PMI* |
| Macro-Ökonomie | Concurrent Indicators | GDP*, M2 Money Supply*, CPI & PPI, USD Trade Weighted*, Employment Report*, Jobless Claims* |
| Portfolio Management | Portfolio (linkable group header → `/portfolio`) | Backtesting, Heatmap, Market Regime, Volatility & Correlation, Beta* |
| Trading Track Record | *(ungrouped)* | Track Record |
| Admin | *(ungrouped)* | Data Import, ISM URL Import, Indicator Refresh |

`*` = marked `soon` in the current codebase (disabled row + "SOON" badge, not yet a live route).

Three-level hierarchy in the sidebar: top-level section → group header (optionally itself a link, e.g. "Portfolio") → individual item. Group headers are individually collapsible, independent per group.

## Voice and Tone

**Open gap — not addressed in discovery.** No voice/tone table exists; palette, shape, typography, and sidebar hierarchy were covered in depth, but copy voice and microcopy tone (error messages, empty states, labels-as-sentences vs. fragments) were never discussed. Needs a dedicated follow-up decision before ship.

## Component Patterns

Behavioral specs only — visual specs live in [DESIGN.md](DESIGN.md), exact props in [components.md](components.md).

| Component | Use | Behavioral rules |
|---|---|---|
| KPI Card | Dashboard, Track Record, Backtesting, Market Regime, CPI/PPI, and other data pages | Static (non-interactive `<div>`) is the default. Interactivity (click/select) is reserved for tiles with a real destination or effect — e.g. Dashboard's tiles select which series the page's chart displays; Backtesting's `KpiCardLink` navigates to a related detail page. Most other pages' KPI tiles are purely informational and stay static. Color-coding applies identically regardless of interactivity. |
| Badge | Any page showing a status, result, or inline label chip (LONG/SHORT, WIN/LOSS, "SOON", per-series insight values, admin status rows) | Most badges are static (no click handler). A badge is interactive when it represents a real toggle — e.g. a LONG/SHORT position-side badge flips the position's side on click and persists via the page's existing save flow. Static and interactive badges are **not** visually similar (unlike the original DESIGN.md draft assumed) — see DESIGN.md Shapes: static has no container, interactive is a full pill. |
| Button | Any page's secondary actions, range/period selectors, and primary triggered actions | *Secondary* — generic action, no special state beyond `disabled`. *Range-toggle* — single-select among a fixed group; exactly one option active, selection persists in page state. *Primary* — a page's main triggered action, typically paired with a loading/disabled state during its async operation. The monochrome-fill treatment is flagged as interim in DESIGN.md. |
| Panel | Track Record (Equity Curve, Realized Trades) and any page needing a secondary content container beneath its KPI row | Static content frame, no interactive behavior of its own — whatever chart/table it holds carries its own behavior. |
| Sidebar Nav Item | Global sidebar, all sections | **Item** — navigates via Next.js `Link`/routing. Active state = exact pathname match. Disabled ("soon") items render `--text-disabled` + "SOON" badge, not clickable. **Group header** — click toggles collapsed/expanded state independently per group; where the header is itself a route, the label navigates while a separate chevron toggles collapse. **Section label** — purely orientational, no interaction. |
| Tabs | CPI/PPI, Track Record, Market Regime (via composite-regime view), and any page with a multi-view content switch | Click switches the active tab and its content region; exactly one active at a time. Unlike Sidebar Nav Items, a Tabs bar has no disabled/"soon" state. |

## State Patterns

Only states actually discussed or demonstrated are documented; everything else is an open gap.

| State | Surface | Status |
|---|---|---|
| Active nav item | Sidebar | Covered — rounded highlight per DESIGN.md. |
| Hover nav item | Sidebar | **[GAP]** — the *visual* hover treatment for a restyled nav item was never explicitly specced; reasonable to infer a subtle version of the active treatment but not confirmed. |
| Disabled / "coming soon" nav item | Sidebar | Covered — `--text-disabled` + "SOON" badge, existing `Sidebar.jsx` behavior. |
| Empty state (no KPI data, no trades yet) | Dashboard, Track Record, Backtesting | **[GAP]** — not discussed. No empty-state copy or layout designed. |
| Error state (failed data load, e.g. broker import or API failure) | Any data page | **[GAP]** — not discussed. |
| Loading state (KPI values pending, chart loading) | Any data page | **[GAP]** — not discussed. |

## Interaction Primitives

- **Nav click** — standard link navigation (`next/navigation` `Link`/`usePathname`).
- **Nav hover** — affordance exists but restyled treatment is an open gap.
- **Sidebar group collapse/expand** — existing primitive: click a group header (or chevron) to toggle `collapsed[groupKey]`, per-group independent, no accordion-exclusivity.
- **Logout** — existing sidebar footer button, unchanged.

No new interaction primitives (drag, multi-select, command palette, keyboard shortcuts) have been discussed — none should be assumed.

## Accessibility Floor

**Open gap — not addressed in discovery.** No WCAG conformance level, contrast ratio targets, or screen-reader behavior was decided. Contrast ratios for the Slate Mono hex values (e.g. `--text-secondary` `#8b9096` on `--bg-base` `#0e0f11`) have not been verified against any standard.

Known, tracked accessibility debt (see [status.md](status.md) for the running list): no `focus-visible` treatment on `Badge`'s interactive button or `Button`'s primary fill; `Tabs` has no ARIA roles (`role="tablist"`/`tab`, `aria-selected`) or arrow-key navigation; `Button`'s range-toggle communicates state via fill/weight only, no `aria-pressed`.

One deliberate positive: the sharp-vs-rounded shape split means "interactive vs. content" is legible from shape alone, not just color. KPI deltas also pair color with a directional arrow glyph (▲/▼) rather than color alone — a good, worth-preserving redundant-encoding pattern.

## Key Flows

No named-protagonist journey work was done beyond one grounded example from the original design discovery — kept here for reference, based on the approved Track Record mock:

### Flow — checking Track Record

1. Open the app; sidebar shows "Trading Track Record" → "Track Record" (top-level, ungrouped, no scrolling needed).
2. Click "Track Record" — the item takes the active treatment (rounded highlight, `--text-primary` label); the page loads with the eyebrow "Trading Track Record" above the headline "Track Record."
3. KPI cards render across the top of each tab (Live Portfolio / Realized PnL / Equity Curve), color-coded by sign.
4. Tab content (positions table, trade history, or equity curve charts) renders below in a `--bg-surface` panel.
5. **Climax:** at a glance, before reading a single label closely, the user can tell the account is up (green-coded values, sharp-cornered cards) and which nav item got them there (the one rounded shape in the sidebar).

No failure/error path is documented — data-load error states were never discussed (see State Patterns).
