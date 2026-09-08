"""
Universal Asset Price Provider (AD-9) — the single entry point for a price series
regardless of asset type. Per-type dispatch underneath:
  - stock/commodity/etf: the existing yfinance path (services.basket._download_close)
  - basket: services.basket._reconstruct_series — the *live* buy-and-hold reconstruction,
    not the (write-only, single-row) basket_nav table AD-9's original text assumed would
    exist by now. Story 1.2 (persisting BasketNav daily) was deliberately dropped this
    session — _reconstruct_series is the actual current source of truth for Basket prices.
  - hbm: services.high_beta_momentum.get_index_series — the legacy basket's own, separate,
    already-persisted table (AD-7: read-only here, never written or migrated).

Basket+HBM enumeration (needed for FR-3/FR-5) is NOT duplicated here — it already exists
as services.basket.list_baskets (built for Story 1.4: unions the user's real Baskets with
a synthetic HBM entry).
"""
import logging
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy.orm import Session

from app.repositories import basket as basket_repo
from app.services import basket as basket_service
from app.services import high_beta_momentum as hbm_service

log = logging.getLogger(__name__)

ASSET_TYPES = ("stock", "commodity", "etf", "basket", "hbm")


def _basket_native_series(db: Session, basket_id: int, start: str, end: str | None) -> pd.Series:
    today = datetime.now(timezone.utc).date()
    constituents = basket_repo.get_effective_constituents(db, basket_id, as_of=today)
    if not constituents:
        return pd.Series(dtype=float)
    tickers = [c.ticker for c in constituents]
    weights = {c.ticker: c.weight for c in constituents}
    series = basket_service._reconstruct_series(tickers, weights, start=start, end=end)
    if not series["dates"]:
        return pd.Series(dtype=float)
    return pd.Series(series["index_level"], index=pd.to_datetime(series["dates"]))


def _hbm_native_series(db: Session, start: str, end: str | None) -> pd.Series:
    series = hbm_service.get_index_series(db)
    if not series["dates"]:
        return pd.Series(dtype=float)
    s = pd.Series(series["index_level"], index=pd.to_datetime(series["dates"]))
    s = s[s.index >= pd.Timestamp(start)]
    if end:
        s = s[s.index <= pd.Timestamp(end)]
    return s


def get_price_series(
    db: Session,
    asset_type: str,
    asset_id: str,
    start: str,
    end: str | None = None,
    spy_series: pd.Series | None = None,
) -> pd.Series:
    """
    AD-9's single entry point. Returns a pandas.Series indexed by trading-day Timestamp,
    ascending, one value per date, no forward-fill applied here — reindexed onto SPY's
    calendar (reindex(spy.index, method="nearest", tolerance=4d), market_regime.py's
    existing align() pattern) before returning, so every caller can assume one shared
    calendar regardless of source. Empty Series on failure, never raises — matches
    _download_close's existing tolerant-failure convention.

    spy_series: pass an already-fetched SPY series to skip a redundant internal SPY
    download when fetching several series for the same window at once (e.g.
    market_regime.py's 5-ticker _download_all). Self-fetches otherwise.
    """
    if asset_type in ("stock", "commodity", "etf"):
        native = basket_service._download_close(asset_id, start, end)
    elif asset_type == "basket":
        native = _basket_native_series(db, int(asset_id), start, end)
    elif asset_type == "hbm":
        native = _hbm_native_series(db, start, end)
    else:
        raise ValueError(f"Unknown asset_type: {asset_type!r} (expected one of {ASSET_TYPES})")

    native = native.dropna()
    if native.empty:
        return native

    is_self_spy = asset_type == "stock" and asset_id.upper() == "SPY"
    if is_self_spy and spy_series is None:
        return native.sort_index()

    spy = spy_series if spy_series is not None else basket_service._download_close("SPY", start, end).dropna()
    if spy.empty:
        log.warning("get_price_series(%s, %s): SPY calendar unavailable, returning unaligned native series", asset_type, asset_id)
        return native.sort_index()

    return native.reindex(spy.index, method="nearest", tolerance=pd.Timedelta("4d"))
