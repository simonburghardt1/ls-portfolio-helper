"""
Rolling beta of one asset against a benchmark (Story 2.3, FR-8). Computed live on
request, no persistence — reuses the Universal Asset Price Provider (AD-9) for both
series (already SPY-calendar-aligned). Beta = Cov(asset_ret, bench_ret) / Var(bench_ret),
the same formula services.portfolio._compute_beta uses for a single point-in-time
value — computed here via pandas' vectorized `.rolling(window).cov()`/`.var()` instead
of calling that function once per day, since a rolling series over ~2700 days needs a
vectorized approach to stay fast (mirrors services.correlation.py's `.rolling().corr()`).

Return frequency varies by window, matching common finance-industry practice (and,
empirically, TradingView/Yahoo Finance's own conventions — cross-checked directly:
daily-return AAPL/SPY 1Y beta computed 0.69 here vs. TradingView's reported 0.83;
switching to weekly returns for the same window gives 0.88, matching almost exactly;
Yahoo's "Beta (5Y Monthly)" label is explicit about using monthly returns — our daily
5Y beta of 1.17 vs monthly-return 1.08 vs Yahoo's reported 1.09, again a close match).
Daily returns accumulate too much idiosyncratic/microstructure noise over a year+ to
represent the systematic relationship as cleanly as a lower-frequency sample does.
1M/3M/6M stay on daily returns — too few data points at weekly/monthly frequency to
compute a meaningful covariance (e.g. 1M would have ~4 weekly points).
"""
from datetime import datetime, timezone, timedelta

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.services.asset_price_provider import get_price_series

# freq: pandas resample rule (None = use daily prices as-is). periods: rolling window
# length in units of that frequency (21 trading days, 52 weeks, 60 months, etc).
WINDOW_CONFIG = {
    "1m": {"freq": None, "periods": 21},
    "3m": {"freq": None, "periods": 63},
    "6m": {"freq": None, "periods": 126},
    "1y": {"freq": "W",  "periods": 52},
    "5y": {"freq": "ME", "periods": 60},
}
FETCH_YEARS = 11  # 5y rolling window + ~5y of visible resulting beta history


def _rolling_beta(df: pd.DataFrame, freq: str | None, periods: int) -> tuple[list[str], list[float | None]]:
    resampled = df if freq is None else df.resample(freq).last()
    asset_ret = resampled["asset"].pct_change()
    bench_ret = resampled["benchmark"].pct_change()

    roll_cov = asset_ret.rolling(periods).cov(bench_ret)
    roll_var = bench_ret.rolling(periods).var()
    roll_beta = roll_cov / roll_var

    dates = [d.strftime("%Y-%m-%d") for d in resampled.index]
    values = [None if pd.isna(v) or not np.isfinite(v) else round(float(v), 4) for v in roll_beta]
    return dates, values


def compute_beta_series(db: Session, asset_type: str, asset_id: str, benchmark_type: str, benchmark_id: str) -> dict:
    start = (datetime.now(timezone.utc).date() - timedelta(days=365 * FETCH_YEARS)).isoformat()

    empty = {
        "windows": {w: {"dates": [], "values": []} for w in WINDOW_CONFIG},
        "current": {w: None for w in WINDOW_CONFIG},
    }

    spy = get_price_series(db, "stock", "SPY", start)
    asset = get_price_series(db, asset_type, asset_id, start, spy_series=spy)
    benchmark = get_price_series(db, benchmark_type, benchmark_id, start, spy_series=spy)
    if asset.empty or benchmark.empty:
        return empty

    df = pd.DataFrame({"asset": asset, "benchmark": benchmark}).dropna()
    if len(df) < 2:
        return empty

    windows: dict[str, dict] = {}
    current: dict[str, float | None] = {}
    for label, cfg in WINDOW_CONFIG.items():
        dates, values = _rolling_beta(df, cfg["freq"], cfg["periods"])
        windows[label] = {"dates": dates, "values": values}
        valid = [v for v in values if v is not None]
        current[label] = valid[-1] if valid else None

    return {"windows": windows, "current": current}
