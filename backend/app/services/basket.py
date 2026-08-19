"""
Basket service — business logic and orchestration for the Basket domain.
Delegates all persistence to app.repositories.basket (AD-1).
"""
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timezone, datetime, timedelta

import pandas as pd
import yfinance as yf
from sqlalchemy.orm import Session

from app.models.basket import Basket
from app.repositories import basket as basket_repo

log = logging.getLogger(__name__)

MIN_HOLDINGS = 5
MAX_HOLDINGS = 20
WEIGHTING_METHODS = ("equal", "market_cap")
SERIES_LOOKBACK_DAYS = 420  # comfortably covers 1Y, YTD (any time of year), 3M, 1M, 1W


class BasketValidationError(Exception):
    """Raised on a domain rule violation; the router maps this to a typed 400 (AD-12)."""


def _fetch_market_cap(ticker: str) -> float | None:
    try:
        cap = getattr(yf.Ticker(ticker).fast_info, "market_cap", None)
        return float(cap) if cap else None
    except Exception:
        log.warning("Basket market-cap fetch failed for %s", ticker, exc_info=True)
        return None


def _equal_weights(tickers: list[str]) -> dict[str, float]:
    weight = 1.0 / len(tickers)
    return {t: weight for t in tickers}


def _market_cap_weights(tickers: list[str]) -> dict[str, float]:
    with ThreadPoolExecutor(max_workers=min(len(tickers), 8)) as pool:
        caps = dict(zip(tickers, pool.map(_fetch_market_cap, tickers)))

    missing = [t for t, cap in caps.items() if not cap]
    if missing:
        raise BasketValidationError(
            f"Could not fetch market cap for: {', '.join(missing)}. "
            "Try Equal-weight, or remove/replace these tickers."
        )

    total = sum(caps.values())
    return {t: cap / total for t, cap in caps.items()}


def create_basket(
    db: Session,
    name: str,
    user_id: int,
    tickers: list[str],
    weighting_method: str,
) -> Basket:
    if not (MIN_HOLDINGS <= len(tickers) <= MAX_HOLDINGS):
        raise BasketValidationError(
            f"A Basket must have between {MIN_HOLDINGS} and {MAX_HOLDINGS} holdings "
            f"(got {len(tickers)})."
        )
    if weighting_method not in WEIGHTING_METHODS:
        raise BasketValidationError(
            f"Weighting method must be one of {WEIGHTING_METHODS} (got '{weighting_method}')."
        )
    if len(set(tickers)) != len(tickers):
        raise BasketValidationError("Duplicate tickers are not allowed in a Basket.")

    weights = _equal_weights(tickers) if weighting_method == "equal" else _market_cap_weights(tickers)
    constituents = [{"ticker": t, "weight": weights[t]} for t in tickers]

    creation_date = datetime.now(timezone.utc).date()

    basket = basket_repo.create_basket(
        db,
        name=name,
        user_id=user_id,
        weighting_method=weighting_method,
        constituents=constituents,
        effective_date=creation_date,
    )

    # AD-8: creation writes exactly one synchronous BasketNav row — the only synchronous NAV write.
    basket_repo.add_nav_row(db, basket_id=basket.id, nav_date=creation_date, index_level=100)

    return basket


def _visible_to(basket: Basket, user_id: int) -> bool:
    """System (user_id NULL) or the caller's own Basket (AD-9-anticipated visibility rule)."""
    return basket.user_id is None or basket.user_id == user_id


def _next_trading_day(from_date: date) -> date:
    """Next weekday after from_date. Doesn't account for market holidays — no shared trading-
    calendar utility exists in this codebase yet; acceptable simplification for MVP."""
    d = from_date + timedelta(days=1)
    while d.weekday() >= 5:  # 5=Saturday, 6=Sunday
        d += timedelta(days=1)
    return d


def update_basket(
    db: Session,
    basket_id: int,
    user_id: int,
    name: str,
    tickers: list[str],
    weighting_method: str,
) -> Basket | None:
    """
    Edits a Basket's name/tickers/weighting. Per AD-8, this never touches BasketNav or an
    already-effective weight-set — it only schedules a new weight-set effective the next
    trading day. No admin-role concept exists yet (AD-5), so — consistent with this being a
    single-user MVP tool with auth enforcement explicitly deferred — editing is allowed for
    any Basket visible to the caller (system or own), not restricted to owned-only.
    """
    basket = basket_repo.get_basket(db, basket_id)
    if not basket or not _visible_to(basket, user_id):
        return None

    if not (MIN_HOLDINGS <= len(tickers) <= MAX_HOLDINGS):
        raise BasketValidationError(
            f"A Basket must have between {MIN_HOLDINGS} and {MAX_HOLDINGS} holdings "
            f"(got {len(tickers)})."
        )
    if weighting_method not in WEIGHTING_METHODS:
        raise BasketValidationError(
            f"Weighting method must be one of {WEIGHTING_METHODS} (got '{weighting_method}')."
        )
    if len(set(tickers)) != len(tickers):
        raise BasketValidationError("Duplicate tickers are not allowed in a Basket.")

    weights = _equal_weights(tickers) if weighting_method == "equal" else _market_cap_weights(tickers)
    constituents = [{"ticker": t, "weight": weights[t]} for t in tickers]
    effective_date = _next_trading_day(datetime.now(timezone.utc).date())

    return basket_repo.update_basket(
        db,
        basket,
        name=name,
        weighting_method=weighting_method,
        constituents=constituents,
        effective_date=effective_date,
    )


def _download_close(ticker: str, start: str) -> pd.Series:
    """Same shape as market_regime.py's _dl helper — one ticker's daily Close series."""
    try:
        raw = yf.download(ticker, start=start, interval="1d", auto_adjust=True, progress=False)
        if raw.empty:
            return pd.Series(dtype=float, name=ticker)
        if isinstance(raw.columns, pd.MultiIndex):
            for key in [("Close", ticker), (ticker, "Close")]:
                if key in raw.columns:
                    return raw[key].rename(ticker)
            return pd.Series(dtype=float, name=ticker)
        return raw["Close"].squeeze().rename(ticker)
    except Exception as e:
        log.warning("Basket price download failed for %s: %s", ticker, e)
        return pd.Series(dtype=float, name=ticker)


def _reconstruct_series(tickers: list[str], weights: dict[str, float]) -> dict:
    """
    Fixed-weight buy-and-hold index for the given tickers/weights — a basket held like an ETF:
    dollar-weighted at the start of the lookback window, never rebalanced. This is the single
    source of truth for every Basket price figure shown anywhere (list cards, detail KPI strip,
    the chart, and per-holding performance/contribution) — computed on request, not persisted
    (mirrors AD-8's compute-on-request precedent for non-authoritative previews). The only
    stored, authoritative BasketNav row today is the single day-zero one written at creation;
    Story 1.2's daily job will extend that forward, at which point list/detail should likely
    prefer the stored series over recomputing it (see Dev Notes — not done here).

    Returns {} dates/index_level/ticker_prices, all empty, if fewer than 2 common trading days
    are available across every ticker.
    """
    start = (datetime.now(timezone.utc).date() - timedelta(days=SERIES_LOOKBACK_DAYS)).isoformat()

    with ThreadPoolExecutor(max_workers=min(len(tickers), 8)) as pool:
        closes = list(pool.map(lambda t: _download_close(t, start), tickers))

    df = pd.concat(closes, axis=1).dropna(how="any")
    if len(df) < 2:
        return {"dates": [], "index_level": [], "ticker_prices": {}}

    # value_t = sum(weight_i * price_i_t / price_i_0), indexed to 100 at the first common date.
    normalized = df / df.iloc[0]
    weight_vec = pd.Series(weights).reindex(df.columns)
    index_level = 100 * (normalized * weight_vec).sum(axis=1)

    return {
        "dates": [d.strftime("%Y-%m-%d") for d in df.index],
        "index_level": [round(float(v), 4) for v in index_level],
        "ticker_prices": {t: [round(float(v), 4) for v in df[t]] for t in df.columns},
    }


def _latest_and_change(index_level: list[float]) -> tuple[float | None, float | None]:
    if not index_level:
        return None, None
    latest = index_level[-1]
    change = (index_level[-1] / index_level[-2] - 1) if len(index_level) >= 2 else None
    return latest, change


def _basket_dict(b: Basket, series: dict, tickers: list[str]) -> dict:
    latest_nav, nav_change_pct = _latest_and_change(series.get("index_level", []))
    return {
        "id": b.id,
        "name": b.name,
        "user_id": b.user_id,
        "weighting_method": b.weighting_method,
        "created_at": b.created_at,
        "latest_nav": latest_nav,
        "nav_change_pct": nav_change_pct,
        "tickers": tickers,
    }


def list_baskets(db: Session, user_id: int) -> list[dict]:
    """Baskets enriched with a live-reconstructed latest NAV and 1D change (see _reconstruct_series)."""
    baskets = basket_repo.list_baskets(db, user_id=user_id)
    if not baskets:
        return []

    # DB reads happen up front, single-threaded — Session isn't safe for concurrent use.
    # Only the pure yfinance/pandas computation below is parallelized across Baskets.
    constituents_by_basket = {b.id: basket_repo.get_current_constituents(db, b.id) for b in baskets}

    def _compute(b: Basket) -> dict:
        constituents = constituents_by_basket[b.id]
        if not constituents:
            return _basket_dict(b, {}, [])
        tickers = [c.ticker for c in constituents]
        weights = {c.ticker: c.weight for c in constituents}
        return _basket_dict(b, _reconstruct_series(tickers, weights), tickers)

    with ThreadPoolExecutor(max_workers=min(len(baskets), 4)) as pool:
        return list(pool.map(_compute, baskets))


def get_basket_detail(db: Session, basket_id: int, user_id: int) -> dict | None:
    basket = basket_repo.get_basket(db, basket_id)
    if not basket or not _visible_to(basket, user_id):
        return None
    constituents = basket_repo.get_current_constituents(db, basket_id)
    if not constituents:
        return _basket_dict(basket, {}, [])
    tickers = [c.ticker for c in constituents]
    weights = {c.ticker: c.weight for c in constituents}
    return _basket_dict(basket, _reconstruct_series(tickers, weights), tickers)


def get_basket_series(db: Session, basket_id: int, user_id: int) -> dict | None:
    """Full reconstructed series plus a per-holding breakdown (ticker, weight, aligned prices)
    for the frontend to derive performance/contribution over whichever range is selected."""
    basket = basket_repo.get_basket(db, basket_id)
    if not basket or not _visible_to(basket, user_id):
        return None

    constituents = basket_repo.get_current_constituents(db, basket_id)
    if not constituents:
        return {"dates": [], "index_level": [], "holdings": []}

    tickers = [c.ticker for c in constituents]
    weights = {c.ticker: c.weight for c in constituents}
    series = _reconstruct_series(tickers, weights)

    holdings = [
        {"ticker": t, "weight": weights[t], "prices": series["ticker_prices"].get(t, [])}
        for t in tickers
    ]
    return {"dates": series["dates"], "index_level": series["index_level"], "holdings": holdings}
