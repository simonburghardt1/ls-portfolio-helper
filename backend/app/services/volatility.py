"""
Volatility page (Story 2.1, FR-6) — ATR and Distribution of Returns for any asset type.
Computed live on request, no persistence. Implied Volatility is explicitly out of scope
(confirmed with the user) — yfinance only ever gives a live options-chain snapshot, no
historical series (see services/basket_regime.py's module docstring for the same
limitation already documented there), so it wouldn't fit this page's time-series pattern.

ATR needs OHLC (High/Low/Close), which the AD-9 universal provider (get_price_series)
doesn't carry — it's Close-only by design. Baskets/HBM have no native OHLC at all (NAV is
a synthetic Close-only index), so their ATR is a constituent-weighted average of each
holding's own ATR% — the same shape as basket_regime.py's _basket_vix (weighted average
across a ThreadPoolExecutor-parallelized per-ticker fetch), just over plain OHLC price
history instead of a live options chain.

Distribution of Returns' methodology (weekly returns, the ±3sigma/12-bin histogram, the
descriptive-stats block, the normal-distribution empirical-rule check, the percentile
table, the positive/negative/zero breakdown) is taken directly from the user's own
reference workbook, not invented here — see the DoR tab of their analysis template.
"""
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.repositories import basket as basket_repo
from app.services import high_beta_momentum as hbm_service
from app.services.basket import _download_ohlc
from app.services.asset_price_provider import get_price_series

log = logging.getLogger(__name__)

FETCH_YEARS = 11  # matches correlation.py/beta.py's convention

ATR_WINDOW = 14

WINDOW_WEEKS = {"1y": 52, "3y": 156, "5y": 260, "max": None}

# Bin edges as multiples of stdev away from the mean, per the reference workbook's DoR tab.
SIGMA_STEPS = [-3, -2.4, -1.8, -1.2, -0.6, 0, 0.6, 1.2, 1.8, 2.4, 3]

PERCENTILE_LEVELS = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 99]

NORMAL_PCT = {1: 0.6827, 2: 0.9545, 3: 0.9973}


def _true_range(df_ohlc: pd.DataFrame) -> pd.Series:
    prev_close = df_ohlc["Close"].shift(1)
    return pd.concat([
        df_ohlc["High"] - df_ohlc["Low"],
        (df_ohlc["High"] - prev_close).abs(),
        (df_ohlc["Low"] - prev_close).abs(),
    ], axis=1).max(axis=1)


def _atr_pct(df_ohlc: pd.DataFrame, window: int = ATR_WINDOW) -> pd.Series:
    """Average True Range as a % of Close (ATR / Close) — normalizes across price levels
    so constituents of very different share prices can be weight-averaged meaningfully.
    Resamples daily OHLC to weekly bars first (matching compute_return_distribution's
    weekly-return convention — the two sections of this page previously disagreed on
    their base frequency) — a 14-*week* ATR, the standard convention for a weekly chart,
    not a codebase-specific choice."""
    if df_ohlc.empty:
        return pd.Series(dtype=float)
    weekly = df_ohlc.resample("W").agg({"High": "max", "Low": "min", "Close": "last"}).dropna()
    if weekly.empty:
        return pd.Series(dtype=float)
    tr = _true_range(weekly)
    atr = tr.rolling(window).mean()
    return (atr / weekly["Close"]).dropna()


def _fetch_start() -> str:
    return (datetime.now(timezone.utc).date() - timedelta(days=365 * FETCH_YEARS)).isoformat()


def _weighted_atr(tickers: list[str], weights: dict[str, float]) -> pd.Series:
    start = _fetch_start()
    with ThreadPoolExecutor(max_workers=min(len(tickers), 8)) as pool:
        atrs = list(pool.map(lambda t: _atr_pct(_download_ohlc(t, start)).rename(t), tickers))
    atrs = [s for s in atrs if not s.empty]
    if not atrs:
        return pd.Series(dtype=float)
    df = pd.concat(atrs, axis=1).dropna(how="any")
    if df.empty:
        return pd.Series(dtype=float)
    weight_vec = pd.Series(weights).reindex(df.columns).fillna(0)
    total_w = weight_vec.sum()
    if not total_w:
        return pd.Series(dtype=float)
    return (df * weight_vec).sum(axis=1) / total_w


def compute_atr_series(db: Session, asset_type: str, asset_id: str) -> dict:
    empty = {"dates": [], "values": [], "current": None}

    if asset_type in ("stock", "commodity", "etf"):
        series = _atr_pct(_download_ohlc(asset_id, _fetch_start()))
    elif asset_type == "basket":
        today = datetime.now(timezone.utc).date()
        constituents = basket_repo.get_effective_constituents(db, int(asset_id), as_of=today)
        if not constituents:
            return empty
        tickers = [c.ticker for c in constituents]
        weights = {c.ticker: c.weight for c in constituents}
        series = _weighted_atr(tickers, weights)
    elif asset_type == "hbm":
        holdings = hbm_service.get_holdings(db, None)
        rows = holdings.get("rows", [])
        if not rows:
            return empty
        tickers = [r["ticker"] for r in rows]
        weights = {r["ticker"]: r["weight"] for r in rows}
        series = _weighted_atr(tickers, weights)
    else:
        return empty

    if series.empty:
        return empty

    dates = [d.strftime("%Y-%m-%d") for d in series.index]
    values = [round(float(v), 4) if pd.notna(v) else None for v in series]
    current = values[-1] if values else None
    return {"dates": dates, "values": values, "current": current}


def _bin_edges(mean: float, stdev: float) -> list[float]:
    return [mean + k * stdev for k in SIGMA_STEPS]


def _histogram(returns: pd.Series, mean: float, stdev: float) -> list[dict]:
    edges = _bin_edges(mean, stdev)
    n = len(returns)
    bins = []

    def pct(v: float) -> str:
        return f"{v * 100:.2f}%"

    def dates_for(mask: pd.Series) -> list[str]:
        return [d.strftime("%Y-%m-%d") for d in returns.index[mask]]

    # Below the lowest edge
    mask = returns <= edges[0]
    bins.append({"range_label": f"Less than {pct(edges[0])}", "lower": None, "upper": edges[0], "count": int(mask.sum()), "dates": dates_for(mask)})

    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (returns > lo) & (returns <= hi)
        bins.append({"range_label": f"{pct(lo)} to {pct(hi)}", "lower": lo, "upper": hi, "count": int(mask.sum()), "dates": dates_for(mask)})

    # Above the highest edge
    mask = returns > edges[-1]
    bins.append({"range_label": f"Greater than {pct(edges[-1])}", "lower": edges[-1], "upper": None, "count": int(mask.sum()), "dates": dates_for(mask)})

    cumulative = 0
    for b in bins:
        b["probability"] = round(b["count"] / n, 4) if n else 0.0
        cumulative += b["count"]
        b["cumulative_pct"] = round(cumulative / n, 4) if n else 0.0
        b["lower"] = round(b["lower"], 4) if b["lower"] is not None else None
        b["upper"] = round(b["upper"], 4) if b["upper"] is not None else None
    return bins


def _normal_check(returns: pd.Series, mean: float, stdev: float) -> list[dict]:
    n = len(returns)
    out = []
    for k, normal_pct in NORMAL_PCT.items():
        upper = mean + k * stdev
        lower = mean - k * stdev
        actual_count = int(((returns > lower) & (returns < upper)).sum())
        out.append({
            "sigma": k,
            "upper": round(upper, 4),
            "lower": round(lower, 4),
            "actual_count": actual_count,
            "actual_pct": round(actual_count / n, 4) if n else 0.0,
            "normal_pct": normal_pct,
        })
    return out


def _percentiles(returns: pd.Series) -> list[dict]:
    values = returns.to_numpy()
    return [
        {"p": p, "value": round(float(np.percentile(values, p)), 4)}
        for p in PERCENTILE_LEVELS
    ]


def _breakdown(returns: pd.Series) -> dict:
    n = len(returns)

    def group(mask: pd.Series) -> dict:
        subset = returns[mask]
        count = int(len(subset))
        avg = float(subset.mean()) if count else 0.0
        freq_pct = round(count / n, 4) if n else 0.0
        return {"avg": round(avg, 4), "count": count, "freq_pct": freq_pct, "freq_adjusted": round(avg * freq_pct, 4)}

    return {
        "positive": group(returns > 0),
        "negative": group(returns < 0),
        "zero": group(returns == 0),
    }


def compute_return_distribution(db: Session, asset_type: str, asset_id: str, window: str) -> dict:
    empty = {"bins": [], "stats": {}, "normal_check": [], "percentiles": [], "breakdown": {}, "prices": {"dates": [], "values": []}}

    close = get_price_series(db, asset_type, asset_id, _fetch_start())
    if close.empty:
        return empty

    weekly = close.resample("W").last().dropna()
    returns = weekly.pct_change().dropna()
    if returns.empty:
        return empty

    weeks = WINDOW_WEEKS.get(window)
    if weeks:
        returns = returns.tail(weeks)
    if len(returns) < 2:
        return empty

    mean = float(returns.mean())
    stdev = float(returns.std())
    n = len(returns)

    stats = {
        "mean": round(mean, 4),
        "std_error": round(float(stdev / np.sqrt(n)), 4) if n else None,
        "median": round(float(returns.median()), 4),
        "mode": round(float(returns.mode().iloc[0]), 4) if not returns.mode().empty and returns.duplicated().any() else None,
        "stdev": round(stdev, 4),
        "variance": round(float(returns.var()), 4),
        "kurtosis": round(float(returns.kurt()), 4) if n > 3 else None,
        "skewness": round(float(returns.skew()), 4) if n > 2 else None,
        "range": round(float(returns.max() - returns.min()), 4),
        "min": round(float(returns.min()), 4),
        "max": round(float(returns.max()), 4),
        "sum": round(float(returns.sum()), 4),
        "count": n,
    }

    price_window = weekly.loc[returns.index[0]:]

    return {
        "bins": _histogram(returns, mean, stdev),
        "stats": stats,
        "normal_check": _normal_check(returns, mean, stdev),
        "percentiles": _percentiles(returns),
        "breakdown": _breakdown(returns),
        "prices": {
            "dates": [d.strftime("%Y-%m-%d") for d in price_window.index],
            "values": [round(float(v), 4) for v in price_window],
        },
    }
