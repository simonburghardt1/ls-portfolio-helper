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
from app.services import high_beta_momentum as hbm_service
from app.services.portfolio import _compute_beta

log = logging.getLogger(__name__)

MIN_HOLDINGS = 5
MAX_HOLDINGS = 20
WEIGHTING_METHODS = ("equal", "market_cap")
SERIES_LOOKBACK_DAYS = 500  # covers 1Y/YTD/3M/1M/1W with margin, plus >=290 trading days
                            # so basket_regime's 260-day rolling vol-normalization window
                            # (+ its own 30-day warmup) has enough history to not always be null

# Plain ETF tickers, not raw index tickers — matches this codebase's convention everywhere
# else a benchmark is needed (market_regime.py/high_beta_momentum.py/portfolio.py all use
# "SPY", never "^GSPC"). Frontend keeps a matching copy of these labels (BasketDetailPage) —
# keep both in sync if this list changes.
COMPARISON_BENCHMARKS: dict[str, str] = {
    "SPY": "S&P 500",
    "QQQ": "Nasdaq 100",
    "DIA": "Dow Jones",
    "IWM": "Russell 2000",
    "BTC-USD": "Bitcoin",
}


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


def update_basket(
    db: Session,
    basket_id: int,
    user_id: int,
    name: str,
    tickers: list[str],
    weighting_method: str,
) -> Basket | None:
    """
    Edits a Basket's name/tickers/weighting, effective immediately (effective_date = today).
    Previously this scheduled the new weight-set for the next trading day (AD-8's original
    rationale: never rewrite a *persisted* NAV history) — but Story 1.2 (the persisted,
    point-in-time NAV table) was dropped, and _reconstruct_series always recomputes the whole
    lookback window live from whichever weight-set is currently effective, so there is no
    persisted history left to protect. Delaying the edit by a day no longer serves that
    purpose and only hides the user's own change from themselves until the next day. Prior
    (already-effective) weight-sets are still never modified or deleted — only a same-day
    repeat edit collapses into the latest one (basket_repo.update_basket's existing behavior).
    No admin-role concept exists yet (AD-5), so — consistent with this being a single-user MVP
    tool with auth enforcement explicitly deferred — editing is allowed for any Basket visible
    to the caller (system or own), not restricted to owned-only.
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
    effective_date = datetime.now(timezone.utc).date()

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
    the chart, and per-holding performance/contribution) — computed live on every request, not
    persisted. Story 1.2 (a daily job extending BasketNav forward) was deliberately dropped —
    its premise (NAV "frozen" without it) no longer held once this function existed; BasketNav
    stays write-only (one day-zero row from creation, never read) unless a concrete future need
    (e.g. Epic 4 backtesting) actually requires persisted history.

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


def _ytd_change(dates: list[str], index_level: list[float]) -> float | None:
    """Year-to-date change of the live-reconstructed series — mirrors the frontend's own
    computeRangeChanges/rangeStartDate YTD logic (baskets/[id]/page.jsx) so both agree."""
    if not dates or not index_level:
        return None
    ytd_start = f"{datetime.now(timezone.utc).year}-01-01"
    idx = next((i for i, d in enumerate(dates) if d >= ytd_start), None)
    if idx is None:
        return None
    base = index_level[idx]
    if not base:
        return None
    return round(index_level[-1] / base - 1, 4)


def _cagr(dates: list[str], index_level: list[float]) -> float | None:
    """Annualized return over the full retroactively-reconstructed window — same "held these
    weights the whole window" philosophy as the YTD/1Y Change KPIs (_reconstruct_series always
    applies the Basket's current weights across its whole lookback window regardless of when
    the Basket itself was actually created), not anchored to the Basket's real creation date.
    None under 30 days of window: an annualized rate from a handful of days is more misleading
    than informative, not a real CAGR — this can only happen right after SERIES_LOOKBACK_DAYS
    itself is ever shortened, since the window is normally ~500 days regardless of Basket age."""
    if not dates or len(dates) < 2 or not index_level:
        return None
    days_elapsed = (date.fromisoformat(dates[-1]) - date.fromisoformat(dates[0])).days
    if days_elapsed < 30:
        return None
    base = index_level[0]
    if not base:
        return None
    years = days_elapsed / 365.25
    return round((index_level[-1] / base) ** (1 / years) - 1, 4)


def _beta_vs_spy(dates: list[str], index_level: list[float]) -> float | None:
    """Single Basket-level beta vs. SPY — covariance/variance of daily returns over the
    reconstructed window (not HBM's per-holding-averaged beta; one portfolio-level number).
    Reuses services.portfolio._compute_beta for the actual cov/var math; the length guards
    here are stricter than that function's own (which falls back to a 1.0 default beta on
    thin data) since a Basket KPI should show "—" rather than a silently-assumed market beta."""
    if len(dates) < 30:
        return None
    spy = _download_close("SPY", dates[0])
    if spy.empty:
        return None
    aligned = pd.DataFrame({
        "basket": pd.Series(index_level, index=pd.to_datetime(dates)),
        "spy": spy,
    }).dropna()
    if len(aligned) < 30:
        return None
    basket_ret = aligned["basket"].pct_change().dropna()
    spy_ret = aligned["spy"].pct_change().dropna()
    if len(basket_ret) < 10 or len(spy_ret) < 10:
        return None
    return round(_compute_beta(basket_ret, spy_ret), 4)


def _basket_dict(b: Basket, series: dict, tickers: list[str]) -> dict:
    index_level = series.get("index_level", [])
    _, nav_change_pct = _latest_and_change(index_level)
    ytd_change_pct = _ytd_change(series.get("dates", []), index_level)
    return {
        "id": b.id,
        "name": b.name,
        "user_id": b.user_id,
        "weighting_method": b.weighting_method,
        "created_at": b.created_at,
        "ytd_change_pct": ytd_change_pct,
        "nav_change_pct": nav_change_pct,
        "tickers": tickers,
    }


HBM_SYNTHETIC_ID = -1  # sentinel — real basket ids are positive SERIAL, never collides


def _hbm_as_basket_entry(db: Session) -> dict | None:
    """Projects the legacy High Beta Momentum basket's own, separate tables (hbm_index_level/
    hbm_holding — AD-7, never touched or migrated) into a Basket-shaped dict for the list.
    Read-only: only calls high_beta_momentum's existing read helpers. None if HBM hasn't been
    seeded yet (no /admin/high-beta-momentum "Build" run), so no dead/empty card shows.
    Clicking this card routes straight to HBM's own detail page, not /baskets/{id} — it has
    its own, richer factor-screening presentation that a generic Basket page can't reproduce."""
    series = hbm_service.get_index_series(db)
    if not series["dates"]:
        return None
    holdings = hbm_service.get_holdings(db, None)  # None = latest rebalance
    tickers = [r["ticker"] for r in holdings["rows"]]
    _, nav_change_pct = _latest_and_change(series["index_level"])
    ytd_change_pct = _ytd_change(series["dates"], series["index_level"])
    return {
        "id": HBM_SYNTHETIC_ID,
        "name": "High Beta Momentum",
        "user_id": None,  # renders the existing SYSTEM badge, same convention as a global Basket
        "weighting_method": "beta_momentum",
        "created_at": datetime.fromisoformat(series["dates"][0]).replace(tzinfo=timezone.utc),
        "ytd_change_pct": ytd_change_pct,
        "nav_change_pct": nav_change_pct,
        "tickers": tickers,
        "cagr": None,
        "beta_vs_spy": None,
        "num_holdings": len(tickers),
    }


def list_baskets(db: Session, user_id: int) -> list[dict]:
    """Baskets enriched with a live-reconstructed YTD change and 1D change (see _reconstruct_series),
    with the legacy High Beta Momentum basket prepended as a synthetic entry (Story 1.4)."""
    hbm_entry = _hbm_as_basket_entry(db)
    prefix = [hbm_entry] if hbm_entry else []

    baskets = basket_repo.list_baskets(db, user_id=user_id)
    if not baskets:
        return prefix

    today = datetime.now(timezone.utc).date()
    # DB reads happen up front, single-threaded — Session isn't safe for concurrent use.
    # Only the pure yfinance/pandas computation below is parallelized across Baskets.
    constituents_by_basket = {b.id: basket_repo.get_effective_constituents(db, b.id, as_of=today) for b in baskets}

    def _compute(b: Basket) -> dict:
        constituents = constituents_by_basket[b.id]
        if not constituents:
            return _basket_dict(b, {}, [])
        tickers = [c.ticker for c in constituents]
        weights = {c.ticker: c.weight for c in constituents}
        return _basket_dict(b, _reconstruct_series(tickers, weights), tickers)

    with ThreadPoolExecutor(max_workers=min(len(baskets), 4)) as pool:
        return prefix + list(pool.map(_compute, baskets))


def get_basket_detail(db: Session, basket_id: int, user_id: int) -> dict | None:
    basket = basket_repo.get_basket(db, basket_id)
    if not basket or not _visible_to(basket, user_id):
        return None
    constituents = basket_repo.get_effective_constituents(db, basket_id, as_of=datetime.now(timezone.utc).date())
    if not constituents:
        return {**_basket_dict(basket, {}, []), "cagr": None, "beta_vs_spy": None, "num_holdings": 0}
    tickers = [c.ticker for c in constituents]
    weights = {c.ticker: c.weight for c in constituents}
    series = _reconstruct_series(tickers, weights)
    result = _basket_dict(basket, series, tickers)
    result["cagr"] = _cagr(series.get("dates", []), series.get("index_level", []))
    result["beta_vs_spy"] = _beta_vs_spy(series.get("dates", []), series.get("index_level", []))
    result["num_holdings"] = len(tickers)
    return result


def get_basket_series(db: Session, basket_id: int, user_id: int) -> dict | None:
    """Full reconstructed series plus a per-holding breakdown (ticker, weight, aligned prices)
    for the frontend to derive performance/contribution over whichever range is selected."""
    basket = basket_repo.get_basket(db, basket_id)
    if not basket or not _visible_to(basket, user_id):
        return None

    constituents = basket_repo.get_effective_constituents(db, basket_id, as_of=datetime.now(timezone.utc).date())
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


def get_basket_compare(db: Session, basket_id: int, user_id: int, ticker: str) -> dict | None:
    """
    One comparison ticker's own price series, for the frontend to overlay on the Basket
    chart. Deliberately NOT aligned to the Basket's own dates — the frontend independently
    rebases both series to 100 at the same target calendar date (the existing rebase()
    helper), and the chart component already supports two datasets with independent date
    arrays, so no backend-side date-alignment is needed.
    """
    basket = basket_repo.get_basket(db, basket_id)
    if not basket or not _visible_to(basket, user_id):
        return None

    ticker = ticker.strip().upper()
    constituent_tickers = {
        c.ticker for c in basket_repo.get_effective_constituents(db, basket_id, as_of=datetime.now(timezone.utc).date())
    }
    if ticker not in COMPARISON_BENCHMARKS and ticker not in constituent_tickers:
        raise BasketValidationError(
            f"'{ticker}' is not a recognized comparison ticker — choose one of "
            f"{', '.join(COMPARISON_BENCHMARKS)} or one of this Basket's own holdings."
        )

    start = (datetime.now(timezone.utc).date() - timedelta(days=SERIES_LOOKBACK_DAYS)).isoformat()
    closes = _download_close(ticker, start).dropna()

    return {
        "ticker": ticker,
        "dates": [d.strftime("%Y-%m-%d") for d in closes.index],
        "prices": [round(float(v), 4) for v in closes],
    }
