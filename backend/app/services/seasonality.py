"""
Seasonality page (Markets section) — weekly year-over-year overlay/cohort-average chart
plus a monthly returns heatmap table, for any asset (stock/commodity/etf/basket/hbm via
the Universal Asset Price Provider, AD-9). Computed live on request, no persistence.

Weekly overlay: every calendar year in the asset's available history is reduced to a fixed
52-slot array indexed by day-of-year // 7 (the last 1-2 days of a year fold into slot 52),
each slot holding the cumulative return at that week's last close, measured from the prior
year's last close (see _year_week_cum_return). Using week-number (not calendar
date) as the common index is what lets the frontend either show individual years side by
side or average an arbitrary cohort of them elementwise (skipping nulls at each slot) —
both modes read the exact same per-year arrays, no separate averaging code path needed
server-side.

Election-cycle cohorts: US presidential elections land on years divisible by 4 (2024,
2028, ...), so cycle phase is a plain year % 4 lookup, not a hardcoded year list.
"""
from datetime import datetime, timezone, timedelta

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.services.asset_price_provider import get_price_series

FETCH_YEARS = 25  # seasonality benefits from as much history as realistically exists;
                  # longer than other pages' FETCH_YEARS=11 (correlation/beta/volatility)
                  # since more cycles/years directly improves this analysis

WEEKS_PER_YEAR = 52

MONTH_COUNT = 12


def _cycle_phase(year: int) -> str:
    m = year % 4
    return {0: "election", 1: "post_election", 2: "midterm", 3: "pre_election"}[m]


def _year_week_cum_return(year_close: pd.Series, prev_close: float | None = None) -> list[float | None]:
    year_close = year_close.dropna()
    if len(year_close) < 2:
        return [None] * WEEKS_PER_YEAR

    # Base = the prior year's last close when there is one, so week 1 carries the year's first
    # week of returns (the same base the monthly table's January uses) and a year's path ends
    # at its full-year return. Only an asset's first (partial) year falls back to its own first
    # close.
    base = prev_close if prev_close else float(year_close.iloc[0])
    if not base:
        return [None] * WEEKS_PER_YEAR

    # Slot = day-of-year // 7 (days 1-7 → slot 0, …, days 358-366 → slot 51), holding the
    # last close inside it. Unlike ISO weeks or resample("W") bin labels this can never
    # spill across a year boundary — previously a year's last December days landed in ISO
    # week 1 of the *next* year and overwrote slot 0 with the full-year return.
    slot_of = np.minimum((year_close.index.dayofyear - 1) // 7, WEEKS_PER_YEAR - 1)
    last_per_slot = year_close.groupby(slot_of).last()

    slots: list[float | None] = [None] * WEEKS_PER_YEAR
    for slot, price in last_per_slot.items():
        slots[int(slot)] = round(float(price / base - 1), 4)
    return slots


def _weekly_seasonality(close: pd.Series) -> list[dict]:
    years = sorted({d.year for d in close.index})
    out = []
    for year in years:
        year_close = close[close.index.year == year]
        prev = close[close.index.year == year - 1]
        out.append({
            "year": year,
            "cycle_phase": _cycle_phase(year),
            "week_cum_return": _year_week_cum_return(year_close, float(prev.iloc[-1]) if len(prev) else None),
        })
    return out


def _monthly_returns(close: pd.Series) -> dict:
    monthly = close.resample("ME").last()
    monthly_returns = monthly.pct_change()

    years = sorted({d.year for d in monthly_returns.index})
    rows = []
    month_buckets: list[list[float]] = [[] for _ in range(MONTH_COUNT)]

    for year in years:
        months: list[float | None] = [None] * MONTH_COUNT
        for ts, ret in monthly_returns[monthly_returns.index.year == year].items():
            if pd.isna(ret):
                continue
            m = ts.month - 1
            val = round(float(ret), 4)
            months[m] = val
            month_buckets[m].append(val)

        known = [m for m in months if m is not None]
        total = round(float(np.prod([1 + m for m in known]) - 1), 4) if known else None
        rows.append({"year": year, "months": months, "total": total})

    avg_by_month = [round(float(np.mean(b)), 4) if b else None for b in month_buckets]

    return {"rows": rows, "avg_by_month": avg_by_month}


def compute_seasonality(db: Session, asset_type: str, asset_id: str) -> dict:
    empty = {"years": [], "monthly_returns": {"rows": [], "avg_by_month": [None] * MONTH_COUNT}}

    start = (datetime.now(timezone.utc).date() - timedelta(days=365 * FETCH_YEARS)).isoformat()
    close = get_price_series(db, asset_type, asset_id, start)
    if close.empty:
        return empty

    return {
        "years": _weekly_seasonality(close),
        "monthly_returns": _monthly_returns(close),
    }
