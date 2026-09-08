"""
2-asset rolling correlation (Story 2.2, FR-7). Computed live on request, no persistence —
reuses the Universal Asset Price Provider (AD-9) exclusively for both series, so any two
assets (stock/commodity/etf/basket/hbm) are already reindexed onto the same SPY trading
calendar before correlating — no separate alignment logic needed here.
"""
from datetime import datetime, timezone, timedelta

import pandas as pd
from sqlalchemy.orm import Session

from app.services.asset_price_provider import get_price_series

WINDOWS_DAYS = {"3m": 63, "6m": 126, "1y": 252, "2y": 504, "5y": 1260}
FETCH_YEARS = 11  # 5y rolling window + ~5y of visible resulting correlation history


def compute_correlation(db: Session, type_a: str, id_a: str, type_b: str, id_b: str) -> dict:
    start = (datetime.now(timezone.utc).date() - timedelta(days=365 * FETCH_YEARS)).isoformat()

    empty = {
        "dates": [],
        "windows": {w: [] for w in WINDOWS_DAYS},
        "prices": {"a": [], "b": []},
        "current": {w: None for w in WINDOWS_DAYS},
    }

    spy = get_price_series(db, "stock", "SPY", start)
    a = get_price_series(db, type_a, id_a, start, spy_series=spy)
    b = get_price_series(db, type_b, id_b, start, spy_series=spy)
    if a.empty or b.empty:
        return empty

    df = pd.DataFrame({"a": a, "b": b}).dropna()
    if len(df) < 2:
        return empty

    a_ret = df["a"].pct_change()
    b_ret = df["b"].pct_change()

    windows: dict[str, list] = {}
    current: dict[str, float | None] = {}
    for label, days in WINDOWS_DAYS.items():
        roll = a_ret.rolling(days).corr(b_ret)
        windows[label] = [None if pd.isna(v) else round(float(v), 4) for v in roll]
        valid = roll.dropna()
        current[label] = round(float(valid.iloc[-1]), 4) if not valid.empty else None

    prices_a = 100 * df["a"] / df["a"].iloc[0]
    prices_b = 100 * df["b"] / df["b"].iloc[0]

    return {
        "dates": [d.strftime("%Y-%m-%d") for d in df.index],
        "windows": windows,
        "prices": {
            "a": [round(float(v), 4) for v in prices_a],
            "b": [round(float(v), 4) for v in prices_b],
        },
        "current": current,
    }
