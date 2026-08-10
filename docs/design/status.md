# Rollout status & open items

**Last synced: 2026-08-04.** Snapshot of where the Slate Mono redesign actually is in the code — check this before assuming a page is "done." Verify against the code before trusting anything here that's more than a session or two old (see the memory-hygiene note in the repo's CLAUDE.md-equivalent guidance).

## Component adoption, by page

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
