"""
Single-stock regime: the Basket regime methodology (basket_regime.py) applied to one stock.

Same parameters and score functions as the Basket regime, four components at 25% each:
  - BMSB:              price vs. EMA-21W / SMA-20W band
  - Realized Vol:      30D realized vol, normalized over its own rolling 52-week range
  - Relative Strength: stock/SPY ratio vs. its 10-week MA
  - Sector Strength:   sector ETF/SPY ratio vs. its 10-week MA — replaces the Basket's
                       breadth, which needs constituents a single stock doesn't have

The sector comes from yfinance's profile and maps to the matching SPDR sector ETF. A
component without data (no sector, or before the ETF existed — XLRE 2015, XLC 2018) drops
out and the composite re-weights over the rest, like the Basket composite does.

Computed on request and kept in memory for a few hours, like the non-SPY index regimes in
market_regime.py. The 30D implied vol is a live options-chain snapshot (informational only,
not scored — yfinance has no IV history; see basket_regime.py's docstring).
"""
import datetime
import logging
import threading

import numpy as np
import pandas as pd
import yfinance as yf

from app.services.basket import _download_close
from app.services.basket_regime import (
    EMA_SPAN, SMA_PERIOD, RATIO_MA, VOL_WINDOW, REALIZED_VOL_WINDOW, SMOOTH_SPAN, SPY_TICKER,
    _score_bmsb, _score_ratio_vs_ma, _score_vol, _fetch_atm_iv_30d, _round_list,
)

log = logging.getLogger(__name__)

HISTORY_YEARS = 15
CACHE_TTL = datetime.timedelta(hours=6)

WEIGHTS = {"bmsb": 0.25, "vol": 0.25, "relative_strength": 0.25, "sector": 0.25}

# yfinance sector name → SPDR Select Sector ETF
SECTOR_ETFS = {
    "Technology":             "XLK",
    "Financial Services":     "XLF",
    "Healthcare":             "XLV",
    "Consumer Cyclical":      "XLY",
    "Consumer Defensive":     "XLP",
    "Energy":                 "XLE",
    "Industrials":            "XLI",
    "Basic Materials":        "XLB",
    "Utilities":              "XLU",
    "Real Estate":            "XLRE",
    "Communication Services": "XLC",
}

_cache: dict[str, tuple[datetime.datetime, dict]] = {}
_lock = threading.Lock()


class NotAStockError(ValueError):
    """The ticker exists but is an ETF, fund, index, … — this page covers single stocks only."""


def _profile(ticker: str) -> dict:
    """Name, type and sector from yfinance; an empty dict when the lookup fails."""
    try:
        info = yf.Ticker(ticker).info or {}
    except Exception as e:  # rate limits, network — the regime still works without a sector
        log.warning("Stock regime: profile lookup failed for %s: %s", ticker, e)
        return {}
    return {
        "name":       info.get("shortName") or info.get("longName"),
        "quote_type": info.get("quoteType"),
        "sector":     info.get("sector"),
        "industry":   info.get("industry"),
    }


def _composite(scores: dict) -> float | None:
    total_w = total_s = 0.0
    for key, w in WEIGHTS.items():
        s = scores.get(key)
        if s is not None:
            total_s += w * s
            total_w += w
    return total_s / total_w if total_w else None


def _last(series: pd.Series):
    s = series.dropna()
    return None if s.empty else float(s.iloc[-1])


def _pct_vs(ratio: pd.Series, ma: pd.Series):
    r, m = _last(ratio), _last(ma)
    return None if r is None or not m else round(r / m - 1, 4)


def get_stock_regime(ticker: str) -> dict | None:
    """Regime series and current details for one stock; None when there is no price history."""
    ticker = ticker.strip().upper()
    with _lock:
        hit = _cache.get(ticker)
        if hit and datetime.datetime.now() - hit[0] < CACHE_TTL:
            return hit[1]

    profile = _profile(ticker)
    if profile.get("quote_type") and profile["quote_type"] != "EQUITY":
        raise NotAStockError(f"{ticker} is not a single stock ({profile['quote_type']})")

    start = (datetime.date.today() - datetime.timedelta(days=365 * HISTORY_YEARS)).isoformat()
    price = _download_close(ticker, start).dropna()
    if len(price) < SMA_PERIOD:
        return None
    dates = price.index

    def aligned(sym: str) -> pd.Series:
        s = _download_close(sym, start).dropna()
        return s.reindex(dates, method="nearest", tolerance=pd.Timedelta("4d"))

    spy = aligned(SPY_TICKER)
    sector_etf = SECTOR_ETFS.get(profile.get("sector"))
    etf = aligned(sector_etf) if sector_etf else pd.Series(np.nan, index=dates)

    # BMSB
    ema = price.ewm(span=EMA_SPAN, adjust=False).mean()
    sma = price.rolling(SMA_PERIOD).mean()

    # Realized vol (30D, annualized) within its own rolling 52-week range
    realized_vol = price.pct_change().rolling(REALIZED_VOL_WINDOW).std() * np.sqrt(252)
    vol_min = realized_vol.rolling(VOL_WINDOW).min()
    vol_max = realized_vol.rolling(VOL_WINDOW).max()

    # Relative strength: stock/SPY vs. its 10-week MA
    rs_ratio = (price / spy).where(spy > 0)
    rs_ma = rs_ratio.rolling(RATIO_MA).mean()

    # Sector strength: sector ETF/SPY vs. its 10-week MA
    sector_ratio = (etf / spy).where(spy > 0)
    sector_ma = sector_ratio.rolling(RATIO_MA).mean()

    comps = {k: [] for k in WEIGHTS}
    composite_raw = []
    for i in range(len(price)):
        scores = {
            "bmsb": None if pd.isna(ema.iloc[i]) or pd.isna(sma.iloc[i]) else _score_bmsb(price.iloc[i], ema.iloc[i], sma.iloc[i]),
            "vol": _score_vol(realized_vol.iloc[i], vol_min.iloc[i], vol_max.iloc[i]),
            "relative_strength": _score_ratio_vs_ma(rs_ratio.iloc[i], rs_ma.iloc[i]),
            "sector": _score_ratio_vs_ma(sector_ratio.iloc[i], sector_ma.iloc[i]),
        }
        for k, v in scores.items():
            comps[k].append(v)
        composite_raw.append(_composite(scores))

    composite = pd.Series([np.nan if v is None else v for v in composite_raw], index=dates)
    score01 = ((composite.ewm(span=SMOOTH_SPAN, adjust=False).mean() + 1) / 2 * 100).clip(0, 100)

    rv_last = _last(realized_vol)
    iv = _fetch_atm_iv_30d(ticker)

    result = {
        "ticker":     ticker,
        "name":       profile.get("name"),
        "sector":     profile.get("sector"),
        "industry":   profile.get("industry"),
        "sector_etf": sector_etf,
        "dates":      [d.strftime("%Y-%m-%d") for d in dates],
        "prices":     _round_list(price.tolist()),
        "ema21":      _round_list(ema.tolist()),
        "sma20":      _round_list(sma.tolist()),
        "score01":    _round_list(score01.tolist()),
        "components": {k: _round_list(v) for k, v in comps.items()},
        "weights":    WEIGHTS,
        # The inputs behind the latest scores, for the components table
        "details": {
            "price":          _last(price),
            "ema21":          _last(ema),
            "sma20":          _last(sma),
            "realized_vol":   rv_last,
            "vol_min_52w":    _last(vol_min),
            "vol_max_52w":    _last(vol_max),
            "rs_vs_ma":       _pct_vs(rs_ratio, rs_ma),
            "sector_vs_ma":   _pct_vs(sector_ratio, sector_ma),
            "implied_vol_30d": round(iv, 4) if iv is not None else None,
            "iv_rv":          round(iv / rv_last, 2) if iv is not None and rv_last else None,
        },
    }
    with _lock:
        _cache[ticker] = (datetime.datetime.now(), result)
    return result
