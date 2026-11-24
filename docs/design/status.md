# Rollout status & open items

**Last synced: 2026-11-16.** Snapshot of where the Slate Mono redesign actually is in the code — check this before assuming a page is "done." Verify against the code before trusting anything here that's more than a session or two old (see the memory-hygiene note in the repo's CLAUDE.md-equivalent guidance).

## Redesign v2 rollout (started 2026-11-16)

Goal: every page rebuilt on the shared kit (`Page`, `PageHeader` with badges/meta/actions, `Panel`, `KpiCard`, `Popover`, `Chip`, `InfoTip`, `StateMessage`, `lib/format`, `lib/hooks`) and following DESIGN.md → Restraint. Gallery at `/dev/kit`.

Plan: kit first → one template per page type → roll out in batches by type, each batch screenshot-reviewed and committed.

| Page type | Pages | Status |
|---|---|---|
| Analysis tool | Seasonality | ✅ reference page (kit + Restraint) |
| | Single-stock Volatility, Correlation, Beta | ✅ kit; Correlation/Beta share `RollingWindows` (KPI cards = line toggles) |
| | Portfolio Volatility & Correlation, Portfolio Beta | ✅ kit; shared `PortfolioPicker`, matrices/statistics behind tabs |
| List / detail | Basket detail | ✅ header + menus, chart in Panel, StateMessage, shared format helpers; chart colours as CSS vars (LineChart/RegimeChart resolve them via lib/cssColor) |
| | Track Record | ✅ split into tab components; DataTable with sorting + click-to-edit rows (`useRowEditor`), 5–6 KPIs per tab, IBKR import behind a header button |
| | Backtesting | ✅ builder on DataTable + CellInput/SideTag, summary line instead of 7 cards, returns table instead of 10 cards, chart + windowed drawdown in one panel, compare/regime as chips |
| | Portfolios (Overview + Construction merged) | ✅ Baskets-style cards (1D/YTD, 3M sparkline, beta/corr/net from one `/api/portfolios/summary` call), click → Backtester with selection, ⋯ menu (Edit, Copy, Vol & corr, Beta, Delete); PortfolioForm on /portfolio/new and /portfolio/[id]/edit with % weights; /portfolio/overview redirects |
| | High Beta Momentum | ✅ folded into Basket detail (/baskets/high-beta-momentum, API id -1): own NAV rebased as is, regime from its NAV, Holdings tab = factor screen per rebalance; old page redirects |
| | Baskets overview | ✅ PageHeader actions, StateMessage, shared format helpers, cards share OverviewCard.module.css with Portfolios |
| Macro indicator | Building Permits, Consumer Confidence, Debt, GDP, NFIB, ISM ×2 | ✅ Panel + StateMessage; series toggles/latest values as a quiet `SeriesLegend` line in the chart panel (no KPI cards on single-chart pages); `Select`, `SignBars` (YoY bars); ISM ×2 share `_ism/IsmDashboard` with a per-page config; NFIB refresh only for admins |
| | CPI/PPI (rework 2026-11-24) | ✅ one colour rule for the page: amber above the 2% target pace, blue below; distribution panel = `DistributionHistogram` + `DistributionStats` (MoM/YoY switch) |
| | Commodities | ✅ kit header/Select, price Panel, distribution panel like CPI (daily/weekly) |
| | Market Regime | ✅ SPY/QQQ switch; QQQ scored on its own instruments (QQEW/QQQ breadth, VXN), computed on request and cached 6h (`market_regime.get_index_regime`) |
| | COT | ✅ reworked: Positioning DataTable of all contracts grouped by asset class (`groupBy`; net % bar, 1W change, 3Y COT index gauge, 1Y sparkline; row click selects), net % chart with optional price and the contract Select in its panel, positions chart (long/short lines, open interest as bars via LineChart `type: "histogram"`), weekly reports table; GBP covers both CFTC names (renamed 2022-02-08); `/api/cot/overview` now a flat list with `change_1w`, `cot_index`, `spark` |
| Admin / forms | Data import, ISM imports, HBM admin, Indicators, Consumer Confidence admin, Basket new/edit, login/register | ⬜ |

**Histograms (2026-11-24):** `DistributionHistogram` (bars split at a pivot, normal fit, mean, current-value marker, log y, clickable bins) + `DistributionStats` (lib/stats.js) on CPI, Commodities and Volatility (daily/weekly toggle, `freq` on `/api/volatility/distribution`); the old `Histogram.jsx` is gone. Macro legend values are coloured by their MoM change.

**DataTable (2026-11-16):** shared table component; Seasonality heatmap, portfolio correlation/covariance/Sharpe, Volatility statistics, Portfolio Beta and Basket holdings migrated. Still hand-rolled: admin indicators. COT now on DataTable. CPI components and ISM industry comments now on DataTable.

**Page frame (2026-11-16):** every page now renders inside the shared `Page` component (full width, `--page-margin` side padding); no page has its own outer wrapper or `maxWidth` column any more, admin forms included.

## Component adoption, by page (v1)

`PageHeader` + `Button` are adopted on every page in the app — that rollout is complete. `Tabs`, `KpiCard`, and `Badge` are adopted only where a page actually consumes them; most pages don't need all three.

| Page | PageHeader | Button | Tabs | KpiCard | Badge |
|---|---|---|---|---|---|
| `/` (Dashboard) | ✅ | ✅ | — | ✅ | — |
| `/macro/leading/ism-manufacturing` | ✅ | ✅ | ✅ | — | — |
| `/macro/leading/ism-services` | ✅ | ✅ | ✅ | — | — |
| `/macro/leading/nfib-optimism` | ✅ | ✅ | ✅ | — | — |
| `/macro/concurrent/cpi-ppi` | ✅ | ✅ | ✅ | — | — |
| `/macro/leading/consumer-confidence` | ✅ | ✅ | — | — | — |
| `/macro/leading/building-permits` | ✅ | ✅ | — | — | — |
| `/macro/leading/commodities` | ✅ | ✅ | — | — | — |
| `/macro/leading/cot-data` | ✅ | ✅ | — | — | — |
| `/portfolio` (landing) | ✅ | ✅ | — | — | — |
| `/portfolio/backtesting` | ✅ | ✅ | — | — | — |
| `/portfolio/heatmap` | ✅ | ✅ | — | — | — |
| `/portfolio/market-regime` | ✅ | ✅ | — | ✅ | — |
| `/portfolio/risk/volatility` | ✅ | ✅ | — | — | — |
| `/portfolio/track-record` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/admin/consumer-confidence` | ✅ | ✅ | — | — | — |
| `/admin/data-import` | ✅ | ✅ | — | — | — |
| `/admin/indicators` | ✅ | — | — | — | — |
| `/admin/ism` | ✅ | — | — | — | — |
| `/admin/ism-services` | ✅ | — | — | — | — |
| `/login`, `/register` | — | — | — | — | — |

**Reading this table:** a "—" for `KpiCard`/`Badge` usually just means the page doesn't happen to have that kind of UI (or is a plain form/list). It does **not** mean the page still has the old dark-navy/pastel-color problem — that was a separate issue (see below) and is fixed everywhere as of 2026-08-04.

**Known real gap:** `/portfolio/backtesting` has its own local `KpiCard`/`KpiCardLink`/`RiskCard`/`ReturnCard` helper functions (not the shared `KpiCard.jsx`) — they got their colors/shapes normalized to the design tokens in the background-palette sweep, but structurally they're still four separate hand-rolled components doing what the shared `KpiCard` already does. A future pass could consolidate them, following the same pattern used for Track Record and Market Regime (see [components.md](components.md)'s `KpiCard` entry — its `caption`/`small`/`valueColor` props exist specifically to support non-Dashboard use cases like this).

## Color/background palette

**Fixed app-wide as of 2026-08-04.** Every page previously had some mix of a pre-redesign dark-navy palette (`#020617`/`#0f172a`/`#080e1a` backgrounds, `#1f2937`/`#374151`/`#0d1829` borders) and non-canonical pastel green/red (`#86efac`/`#fca5a5`) instead of the actual `--positive`/`--negative` tokens. Both were swept and replaced with `--bg-base`/`--bg-surface`/`--bg-elevated`/`--border` and `--positive`/`--negative`/`--caution` across all 18 page files, including `lightweight-charts` canvas configs (now transparent, sitting on their wrapping panel's `--bg-surface` instead of a hardcoded solid fill).

## Chart series colors

**`--chart-1`…`--chart-11` tokens formalized 2026-08-11** (see DESIGN.md → Chart series colors). Adoption:

- ✅ **Already matches by convention** (no change needed): backend indicator-color dicts in `building_permits.py`, `consumer_confidence.py`, `cpi_ppi.py`, `debt.py`, `gdp.py`, `nfib.py`; `ism-manufacturing/page.jsx`'s 11-component palette.
- ✅ **Fixed 2026-08-11:** Dashboard (`(app)/page.js`)'s single-series chart line — was `var(--green-500)` (a legacy token, and semantically wrong per the positive/negative rule), now the literal `--chart-1` hex (`#3b82f6`; see DESIGN.md's note on why `var()` doesn't work here).
- ✅ **Fixed 2026-08-11:** `cot-data/page.jsx` and `track-record/page.jsx`'s primary single-line series — were `#60a5fa` (a different, lighter blue), now `--chart-1`'s literal hex. Their secondary/comparison lines (cot-data's price overlay, Track Record's SPX benchmark, both amber) and Track Record's separate Realized PnL pane (orange) were left untouched — already correct. `market-regime/page.jsx`'s 4 component-signal colors were reordered onto `--chart-1..4` (BMSB blue, Market Breadth green, VIX amber unchanged, Credit purple) instead of the previous ad hoc green/blue/amber/light-purple mix.

## Backlog

- **Single-stock regime** (requested 2026-11-24): the same regime view as Market Regime and the Basket regime tab, for any single ticker (price + EMA-21W/SMA-20W, regime shading, composite score, component signals). Likely reuses `RegimeChart` and the Basket scoring in `backend/app/services/basket_regime.py` (`_regime_from_series` works on any price series). Not started.

## Open design decisions

- **Primary CTA button color is interim, not settled.** Currently a monochrome fill (`--text-primary` on `--bg-base`) — flagged during design review as possibly needing more visual pop for a genuine call-to-action. Revisit if it reads too quiet in practice.
- **Voice/tone and copy style** — never decided (see EXPERIENCE.md → Voice and Tone). No microcopy conventions for error/empty/loading states.
- **Empty/error/loading states** — never designed for any page. Currently whatever each page's original author happened to hand-roll (inconsistent).
- **Accessibility floor** — no WCAG target or contrast verification has ever been done. Known concrete gaps: no `focus-visible` on `Badge`'s interactive button or `Button`'s primary fill; `Tabs` has no ARIA roles/keyboard nav; range-toggle `Button` has no `aria-pressed`.

## Known pre-existing bugs surfaced during the redesign (not caused by it, not yet fixed)

- Track Record's Realized PnL WIN/LOSS badge treats a `null` P&L (an unrealized/pending trade) as a win (`pnl_dollar >= 0` coerces `null` → `true`). Pre-existing, carried forward unexamined.
- Backtesting's header subtitle ("Loaded: X") never resets after loading a portfolio — editing positions or running a fresh backtest leaves it stuck showing the old name.

## Where to look for more detail

The full, granular decision history (every spec, every review finding, every triage) lives in `_bmad-output/implementation-artifacts/deferred-work.md` and the per-spec files alongside it — not committed, local to whichever machine ran the BMAD session. If you're deep in a specific component and want the "why," check there first; if it's not there, it's genuinely undecided.
