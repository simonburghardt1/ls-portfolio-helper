"""
Seasonality page (Markets section) — weekly year-over-year overlay/cohort-average chart
plus a monthly returns heatmap table, for any asset (stock/commodity/etf/basket/hbm via
the Universal Asset Price Provider, AD-9). Computed live on request, no persistence.

Weekly overlay: every calendar year in the asset's available history is resampled to
weekly and reduced to a fixed 52-slot array indexed by ISO week number (1-52; week 53,
which only some years have, folds into slot 52 rather than getting its own slot — a rare
year-end edge case, not worth a 53rd slot only some years populate), each slot holding that
week's cumulative return from the year's own first value. Using week-number (not calendar
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


def _year_week_cum_return(year_close: pd.Series) -> list[float | None]:
    weekly = year_close.resample("W").last().dropna()
    if len(weekly) < 2:
        return [None] * WEEKS_PER_YEAR

    base = weekly.iloc[0]
    if not base:
        return [None] * WEEKS_PER_YEAR

    slots: list[float | None] = [None] * WEEKS_PER_YEAR
    for ts, price in weekly.items():
        week = min(ts.isocalendar().week, WEEKS_PER_YEAR)
        slots[week - 1] = round(float(price / base - 1), 4)
    return slots


def _weekly_seasonality(close: pd.Series) -> list[dict]:
    years = sorted({d.year for d in close.index})
    out = []
    for year in years:
        year_close = close[close.index.year == year]
        out.append({
            "year": year,
            "cycle_phase": _cycle_phase(year),
            "week_cum_return": _year_week_cum_return(year_close),
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
