# Design docs

This folder is the **committed, durable** record of the app's visual/UX redesign ("Slate Mono"). It's what travels with the repo across machines.

## Why this exists separately from `_bmad-output/`

Design/implementation work in this repo uses the BMAD workflow, which writes its process files to `_bmad-output/` — memlogs, specs, review reports, mockups, iteration history. That folder is **gitignored on purpose**: it's working scratch, verbose by design, and most of it (spec change logs, adversarial-review findings, per-batch memlogs) has no lasting value once the decision it captured has been applied to real code.

The files in *this* folder are the distillation: the actual decisions, tokens, and rules that came out of that process, kept in sync with what's really in the code. When `_bmad-output/` produces a new final decision (a new component, a corrected token, a resolved open question), it should get reflected here too, so `docs/design/` never goes stale relative to `frontend/`.

## Files

- **[DESIGN.md](DESIGN.md)** — visual identity: colors, typography, spacing, shapes, and per-component visual specs. Token names here match the real CSS custom properties in `frontend/app/globals.css` — copy-paste safe.
- **[EXPERIENCE.md](EXPERIENCE.md)** — information architecture, component behavior, state patterns, accessibility notes, and known open gaps (things that were deliberately never decided rather than silently invented).
- **[components.md](components.md)** — concrete prop-level API reference for the shared components (`Badge`, `Button`, `KpiCard`, `PageHeader`, `Tabs`) in `frontend/app/components/`.
- **[status.md](status.md)** — which pages have been migrated to the shared component system, which haven't, and the handful of open decisions/known issues worth keeping visible.

## Workflow

- Keep working in `_bmad-output/` via the BMAD skills (`bmad-ux`, `bmad-quick-dev`, etc.) as before — nothing about that changes.
- When a BMAD run finalizes a real design decision or ships a component change, update the relevant file here in the same session (or shortly after) so it's committed and available on any machine.
- If you start a session on a different device and `_bmad-output/` is empty (it's gitignored, so a fresh `git clone` won't have it), start from what's here — it's the authoritative "what did we decide and what's actually built" record. `_bmad-output/`'s memlog is nice-to-have historical color, not required to pick the work back up.
