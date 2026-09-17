"""
Per-Basket Regime methodology (AD-10/AD-11, FR-9). Computed live over the same
lookback window as the price chart (services.basket._reconstruct_series) — no
BasketRegime table or basket_regime_daily scheduled job exists yet (that's the
literal AD-4/AD-10 architecture; this is the methodology, computed on request).

Formulas mirror market_regime.py's exact parameters/shapes 1:1 where AD-10 says
to ("ported 1:1 from market-wide's exact parameters"), with one deliberate,
documented deviation: AD-10 specifies Vol-Spread as 30D Implied Vol / 30D
Realized Vol, normalized against its own rolling 52-week min/max. yfinance has
no historical options data — only a live snapshot of today's chain — so there
is no way to know where "today's IV/RV" falls in a real 52-week history. The
scored "vol" component therefore uses 30D realized volatility only (which does
have full history, computed from the Basket's own daily returns), normalized
the same way market-wide normalizes VIX. The constituent-weighted 30D implied
vol ("Basket VIX") is still computed and returned — as a live, informational
snapshot, not part of the composite, since it cannot be historically scored.
"""
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta

import numpy as np
import pandas as pd
import yfinance as yf
from sqlalchemy.orm import Session

from app.models.basket import Basket
from app.repositories import basket as basket_repo
from app.services.basket import _visible_to, _download_close, _reconstruct_series, SERIES_LOOKBACK_DAYS

log = logging.getLogger(__name__)

EMA_SPAN = 105          # 21-week EMA on daily bars, same as market_regime.py
SMA_PERIOD = 100        # 20-week SMA on daily bars, same as market_regime.py
RATIO_MA = 50           # 10-week MA for breadth/relative-strength ratios
VOL_WINDOW = 260        # 52-week rolling window for realized-vol normalization
REALIZED_VOL_WINDOW = 30
SMOOTH_SPAN = 10        # 2-week EMA smoother on the composite
BAND_BREACH_PCT = 0.01
SPY_TICKER = "SPY"

WEIGHTS = {"bmsb": 0.25, "vol": 0.25, "breadth": 0.25, "relative_strength": 0.25}


def _score_bmsb(price: float, ema: float, sma: float) -> float:
    band_upper = max(ema, sma)
    band_lower = min(ema, sma)
    if price > band_upper and ema > sma:
        return 1.0
    if price < band_lower * (1 - BAND_BREACH_PCT):
        return -1.0
    return 0.0


def _score_ratio_vs_ma(ratio, ratio_ma) -> float | None:
    if pd.isna(ratio) or pd.isna(ratio_ma) or ratio_ma == 0:
        return None
    return float(np.clip((ratio / ratio_ma - 1) * 20, -1.0, 1.0))


def _score_vol(vol, vol_min, vol_max) -> float | None:
    if pd.isna(vol) or pd.isna(vol_min) or pd.isna(vol_max) or vol_max == vol_min:
        return None
    return float(1.0 - 2.0 * np.clip((vol - vol_min) / (vol_max - vol_min), 0, 1))


def _composite(scores: dict) -> float | None:
    total_w = total_s = 0.0
    for key, w in WEIGHTS.items():
        s = scores.get(key)
        if s is not None:
            total_s += w * s
            total_w += w
    return total_s / total_w if total_w else None


MIN_PLAUSIBLE_IV = 0.03  # real equity IV is never sanely below ~3%
MAX_PLAUSIBLE_IV = 3.00  # or above 300% — either extreme is a stale/degenerate
                          # Black-Scholes artifact from a quote-less options chain,
                          # not a real reading (see module docstring / Dev Notes)


def _fetch_atm_iv_30d(ticker: str) -> float | None:
    """
    Nearest-to-30D-expiration ATM call implied volatility, or None if unavailable.
    yfinance's options endpoint is only reliably live during market hours; outside
    them most/all strikes return bid=ask=0 "placeholder" quotes whose
    impliedVolatility is a Black-Scholes degenerate near-zero garbage value. A
    nonzero bid alone isn't sufficient evidence of a real quote either — a single
    deep-ITM contract can show bid>0 with a meaningless near-zero IV (no time value
    left) — so implausibly low IVs are rejected outright rather than trusted.
    """
    try:
        t = yf.Ticker(ticker)
        exps = t.options
        if not exps:
            return None
        target = datetime.now(timezone.utc).date() + timedelta(days=30)
        closest = min(exps, key=lambda e: abs((datetime.fromisoformat(e).date() - target).days))
        calls = t.option_chain(closest).calls
        spot = getattr(t.fast_info, "last_price", None)
        if calls.empty or not spot:
            return None
        calls = calls[
            (calls["bid"] > 0)
            & (calls["impliedVolatility"] >= MIN_PLAUSIBLE_IV)
            & (calls["impliedVolatility"] <= MAX_PLAUSIBLE_IV)
        ].copy()
        if calls.empty:
            return None
        calls["diff"] = (calls["strike"] - spot).abs()
        iv = calls.sort_values("diff").iloc[0]["impliedVolatility"]
        return float(iv) if iv and MIN_PLAUSIBLE_IV <= iv <= MAX_PLAUSIBLE_IV else None
    except Exception as e:
        log.warning("Basket VIX: IV fetch failed for %s: %s", ticker, e)
        return None


def _basket_vix(tickers: list[str], weights: dict[str, float]) -> float | None:
    """Constituent-weighted 30D implied vol — a live snapshot, not historically scorable (see module docstring)."""
    with ThreadPoolExecutor(max_workers=min(len(tickers), 8)) as pool:
        ivs = dict(zip(tickers, pool.map(_fetch_atm_iv_30d, tickers)))
    available = {t: iv for t, iv in ivs.items() if iv is not None}
    total_w = sum(weights[t] for t in available)
    if not available or not total_w:
        return None
    return sum(weights[t] * iv for t, iv in available.items()) / total_w


def _round_list(vals) -> list[float | None]:
    return [round(float(v), 4) if v is not None and not (isinstance(v, float) and pd.isna(v)) else None for v in vals]


_EMPTY_REGIME_SERIES = {
    "dates": [], "score01": [], "components": {"bmsb": [], "vol": [], "breadth": [], "relative_strength": []},
    "breadth_pct": [], "prices": [], "ema21": [], "sma20": [], "realized_vol_last": None,
}


def _compute_regime_series(tickers: list[str], weights: dict[str, float]) -> dict:
    """
    The scored/historical half of the per-Basket regime methodology (AD-10) — BMSB, Vol,
    Breadth, Relative Strength and their composite, over the Basket's full available price
    history. Deliberately excludes the live, per-constituent options-chain Basket VIX/IV-RV
    snapshot (see _basket_vix/module docstring: not historically scorable, so it isn't part
    of this series) — extracted out of the former single-function compute_basket_regime so
    the daily persistence job (compute_and_persist_all_basket_regimes) can compute just this
    cheap part, once per Basket per day, without paying for an options-chain fetch per
    constituent for every Basket. compute_basket_regime (the detail-page path) still needs
    both, and remains the only caller that also computes the live VIX snapshot.
    """
    series = _reconstruct_series(tickers, weights)
    if not series["dates"]:
        return dict(_EMPTY_REGIME_SERIES)

    dates = pd.to_datetime(series["dates"])
    nav = pd.Series(series["index_level"], index=dates)
    ticker_prices_df = pd.DataFrame(series["ticker_prices"], index=dates)

    start = (datetime.now(timezone.utc).date() - timedelta(days=SERIES_LOOKBACK_DAYS)).isoformat()
    spy = _download_close(SPY_TICKER, start).dropna()
    spy_aligned = spy.reindex(dates, method="nearest", tolerance=pd.Timedelta("4d"))

    # BMSB
    ema = nav.ewm(span=EMA_SPAN, adjust=False).mean()
    sma = nav.rolling(SMA_PERIOD).mean()

    # Vol (realized, 30D annualized), normalized over its own rolling 52-week range.
    returns = nav.pct_change()
    realized_vol = returns.rolling(REALIZED_VOL_WINDOW).std() * np.sqrt(252)
    vol_min = realized_vol.rolling(VOL_WINDOW).min()
    vol_max = realized_vol.rolling(VOL_WINDOW).max()

    # Breadth: % of constituents above their own 50D SMA (NaN, not False, during each ticker's warmup).
    rolling_sma = ticker_prices_df.rolling(RATIO_MA).mean()
    above_sma = (ticker_prices_df > rolling_sma).where(rolling_sma.notna())
    breadth_pct = above_sma.mean(axis=1)
    breadth_ma = breadth_pct.rolling(RATIO_MA).mean()

    # Relative Strength: Basket-NAV/SPY ratio vs its own rolling MA.
    rel_strength_ratio = (nav / spy_aligned).where(spy_aligned > 0)
    rel_strength_ma = rel_strength_ratio.rolling(RATIO_MA).mean()

    bmsb_scores, vol_scores, breadth_scores, rs_scores, composite_raw = [], [], [], [], []
    for i in range(len(nav)):
        sb = None if pd.isna(ema.iloc[i]) or pd.isna(sma.iloc[i]) else _score_bmsb(nav.iloc[i], ema.iloc[i], sma.iloc[i])
        sv = _score_vol(realized_vol.iloc[i], vol_min.iloc[i], vol_max.iloc[i])
        sbr = _score_ratio_vs_ma(breadth_pct.iloc[i], breadth_ma.iloc[i])
        srs = _score_ratio_vs_ma(rel_strength_ratio.iloc[i], rel_strength_ma.iloc[i])
        bmsb_scores.append(sb)
        vol_scores.append(sv)
        breadth_scores.append(sbr)
        rs_scores.append(srs)
        composite_raw.append(_composite({"bmsb": sb, "vol": sv, "breadth": sbr, "relative_strength": srs}))

    composite_series = pd.Series([v if v is not None else np.nan for v in composite_raw], index=dates)
    composite_smoothed = composite_series.ewm(span=SMOOTH_SPAN, adjust=False).mean()
    score01 = ((composite_smoothed + 1) / 2 * 100).clip(0, 100)

    realized_vol_last = realized_vol.iloc[-1]
    realized_vol_last = None if pd.isna(realized_vol_last) else round(float(realized_vol_last), 4)

    return {
        "dates": series["dates"],
        "score01": _round_list(score01.tolist()),
        "components": {
            "bmsb": _round_list(bmsb_scores),
            "vol": _round_list(vol_scores),
            "breadth": _round_list(breadth_scores),
            "relative_strength": _round_list(rs_scores),
        },
        "breadth_pct": _round_list(breadth_pct.tolist()),
        "realized_vol_last": realized_vol_last,
        "prices": _round_list(nav.tolist()),
        "ema21": _round_list(ema.tolist()),
        "sma20": _round_list(sma.tolist()),
    }


def compute_basket_regime(db: Session, basket_id: int, user_id: int) -> dict | None:
    basket = basket_repo.get_basket(db, basket_id)
    if not basket or not _visible_to(basket, user_id):
        return None

    constituents = basket_repo.get_effective_constituents(db, basket_id, as_of=datetime.now(timezone.utc).date())
    if not constituents:
        return {**_EMPTY_REGIME_SERIES, "basket_vix": None, "iv_rv_ratio": None}

    tickers = [c.ticker for c in constituents]
    weights = {c.ticker: c.weight for c in constituents}

    series = _compute_regime_series(tickers, weights)
    if not series["dates"]:
        return {**series, "basket_vix": None, "iv_rv_ratio": None}

    # IV/RV ratio: today's live Basket VIX (implied vol) against today's realized vol —
    # a snapshot-only comparison, not a scored/history-backed component. We can't score
    # or chart this over time the way the other four components are (see module
    # docstring: yfinance has no historical options data, so there's nothing to
    # normalize against a rolling range), but a same-day ratio needs no history at all.
    basket_vix_value = _basket_vix(tickers, weights)
    iv_rv_ratio = (
        round(basket_vix_value / series["realized_vol_last"], 4)
        if basket_vix_value is not None and series["realized_vol_last"]
        else None
    )

    return {
        **series,
        "basket_vix": round(basket_vix_value, 4) if basket_vix_value is not None else None,
        "iv_rv_ratio": iv_rv_ratio,
    }


def _last_or_none(vals: list) -> float | None:
    return vals[-1] if vals else None


def compute_and_persist_all_basket_regimes(db: Session) -> int:
    """
    The basket_regime_daily job (scheduler.py, AD-4): computes today's regime for every real
    Basket (HBM's synthetic entry has its own separate regime concept — out of scope here)
    and upserts one BasketRegime row each, so the Basket overview list page can show a score
    from a cheap DB read instead of recomputing full history live for every Basket on every
    request. Never calls the live options-chain Basket VIX (see _compute_regime_series) —
    that stays a detail-page-only, on-request snapshot. A Basket with no price history yet
    is skipped (logged), matching every other job in scheduler.py's swallow-and-continue
    convention. Returns the number of rows written.
    """
    baskets = basket_repo.list_all_baskets(db)  # every Basket regardless of owner — an internal batch job, not a per-user request
    if not baskets:
        return 0

    today = datetime.now(timezone.utc).date()
    constituents_by_basket = {b.id: basket_repo.get_effective_constituents(db, b.id, as_of=today) for b in baskets}

    def _compute(b: Basket) -> dict | None:
        constituents = constituents_by_basket[b.id]
        if not constituents:
            return None
        tickers = [c.ticker for c in constituents]
        weights = {c.ticker: c.weight for c in constituents}
        try:
            series = _compute_regime_series(tickers, weights)
        except Exception:
            log.warning("basket_regime_daily: computation failed for basket_id=%s", b.id, exc_info=True)
            return None
        if not series["dates"]:
            return None
        score = _last_or_none(series["score01"])
        return {
            "basket_id": b.id,
            "date": datetime.fromisoformat(series["dates"][-1]).date(),
            "regime": _label_for_score(score),
            "score01": score,
            "score_bmsb": _last_or_none(series["components"]["bmsb"]),
            "score_vol": _last_or_none(series["components"]["vol"]),
            "score_breadth": _last_or_none(series["components"]["breadth"]),
            "score_relative_strength": _last_or_none(series["components"]["relative_strength"]),
        }

    with ThreadPoolExecutor(max_workers=min(len(baskets), 4)) as pool:
        rows = [r for r in pool.map(_compute, baskets) if r is not None]

    if rows:
        basket_repo.upsert_basket_regime(db, rows)
    return len(rows)


def _label_for_score(score: float | None) -> str | None:
    """Discrete Uptrend/Ranging/Downtrend bucket for a 0-100 score01 value — same thresholds
    (60/40) as the frontend's scoreToRegime (app/lib/regime.js), duplicated here only because
    this is what gets persisted/read outside the browser (admin status, future backend use)."""
    if score is None:
        return None
    if score > 60:
        return "up"
    if score < 40:
        return "down"
    return "ranging"
