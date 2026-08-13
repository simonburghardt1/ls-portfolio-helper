"""
High Beta Momentum basket — a reconstructed proxy for Goldman Sachs' GSPRHIMO
basket (whose real holdings/weights are proprietary Marquee/Bloomberg data,
not publicly available).

Methodology (fixed, discussed with the user):
  - Universe: $3B-$50B market cap, NASDAQ + NYSE only.
  - Universe source: yfinance's screener (no free source has point-in-time
    historical index constituents, so a widened $1B-$100B band is screened
    TODAY as a safety margin, then the tight $3B-$50B band is applied against
    an *approximated* historical market cap at each rebalance date).
  - Historical market cap approximation: current sharesOutstanding × historical
    adjusted close. Known limitation: misses names fully delisted from
    NASDAQ/NYSE since; reasonably accurate for names still listed today.
  - Monthly rebalance. Selection = top 50 by combined z-score of:
      trailing 1Y beta vs SPY, and trailing "12-1" momentum (return from
      t-252 to t-21 trading days, skipping the most recent ~month to avoid
      short-term reversal effects — standard Jegadeesh & Titman convention).
    combined_score = 0.5 * z(beta) + 0.5 * z(momentum)
  - Equal-weighted (1/50), reset every rebalance.
  - Daily NAV chain (not just monthly points): each day's basket return is the
    mean of the currently-held names' daily returns (tolerating missing data
    for individual names), chained from a base index level of 100.
"""

import logging
import math
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
import yfinance as yf
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.high_beta_momentum import HbmHolding, HbmIndexLevel
from app.services.portfolio import _compute_beta, download_prices_chunked

log = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

CAP_SCREEN_MIN = 1_000_000_000    # screener safety-margin band (today's snapshot)
CAP_SCREEN_MAX = 100_000_000_000
CAP_MIN        = 3_000_000_000    # actual eligibility band, applied historically
CAP_MAX        = 50_000_000_000

TOP_N              = 50
BETA_LOOKBACK      = 252   # ~1 trading year
MOMENTUM_LOOKBACK  = 252   # ~1 trading year
MOMENTUM_SKIP      = 21    # ~1 trading month, skipped (12-1 momentum)
MIN_HISTORY_DAYS   = BETA_LOOKBACK + MOMENTUM_SKIP   # 273 — guards both windows at once
WEIGHT_BETA        = 0.5
WEIGHT_MOMENTUM    = 0.5

HISTORY_YEARS         = 5
DOWNLOAD_BUFFER_YEARS = 2   # extra history so the first rebalance has a full trailing window

# In-memory build progress (admin /build is long-running; /status polls this + a DB summary)
_build_state: dict = {
    "running": False, "phase": None, "started_at": None, "finished_at": None, "error": None,
}


# ── Universe screening ──────────────────────────────────────────────────────────

def _screen_universe(cap_min: float = CAP_SCREEN_MIN, cap_max: float = CAP_SCREEN_MAX, page_size: int = 250) -> list[dict]:
    """Yahoo Finance screener, paginated. Returns [{ticker, shares_out}, ...]."""
    query = yf.EquityQuery("and", [
        yf.EquityQuery("btwn", ["intradaymarketcap", cap_min, cap_max]),
        yf.EquityQuery("is-in", ["exchange", "NMS", "NYQ"]),
    ])

    results: list[dict] = []
    offset = 0
    while True:
        try:
            resp = yf.screen(query, size=page_size, offset=offset)
        except Exception as exc:
            log.warning("HBM screen: page at offset %d failed: %s", offset, exc)
            break
        quotes = resp.get("quotes", [])
        if not quotes:
            break
        results.extend({"ticker": q["symbol"], "shares_out": q.get("sharesOutstanding")} for q in quotes)
        offset += page_size
        if offset >= resp.get("total", 0):
            break

    return results


# ── Math helpers ─────────────────────────────────────────────────────────────────

def _zscore(s: pd.Series) -> pd.Series:
    std = s.std()
    if not std or pd.isna(std):
        return pd.Series(0.0, index=s.index)
    return (s - s.mean()) / std


def _month_end_dates(index: pd.DatetimeIndex, years: int) -> list[pd.Timestamp]:
    """
    Last trading day of each (year, month) present in `index`, limited to the
    trailing `years`. Drops the most recent (year, month) group unconditionally —
    since `index` always ends at "today", that group is the current, still-open
    month, not a completed month-end (its last trading day so far is an artifact
    of when we happened to download, not a real rebalance point).
    """
    if len(index) == 0:
        return []
    cutoff = index[-1] - pd.DateOffset(years=years)
    grouped = pd.Series(index, index=index).groupby([index.year, index.month]).max()
    dates = sorted(d for d in grouped if d >= cutoff)
    return dates[:-1] if dates else dates


# ── Per-rebalance selection ──────────────────────────────────────────────────────

def _compute_rebalance(
    prices: pd.DataFrame, returns: pd.DataFrame, shares_out: dict[str, float],
    rb_date: pd.Timestamp, spy_returns: pd.Series,
) -> pd.DataFrame:
    """Selects the top-50 by combined z(beta)+z(momentum) score as of rb_date."""
    empty = pd.DataFrame(columns=[
        "ticker", "rank", "beta", "momentum", "z_beta", "z_momentum",
        "combined_score", "market_cap", "weight",
    ])

    if rb_date not in prices.index:
        return empty
    loc = prices.index.get_loc(rb_date)
    if loc < MIN_HISTORY_DAYS:
        return empty

    price_row = prices.iloc[loc]
    caps = {
        t: shares_out[t] * price_row[t]
        for t in shares_out
        if t in prices.columns and shares_out.get(t) and pd.notna(price_row[t])
    }
    eligible = [t for t, c in caps.items() if CAP_MIN <= c <= CAP_MAX]

    beta_window = returns.iloc[loc - BETA_LOOKBACK + 1: loc + 1]
    spy_window  = spy_returns.iloc[loc - BETA_LOOKBACK + 1: loc + 1]

    beta_vals: dict[str, float] = {}
    mom_vals: dict[str, float] = {}
    for t in eligible:
        if t not in returns.columns:
            continue
        asset_window = beta_window[t]
        if asset_window.isna().sum() > BETA_LOOKBACK * 0.2:
            continue  # too many missing days (recent IPO / illiquid) — skip
        p_now  = prices[t].iloc[loc - MOMENTUM_SKIP]
        p_then = prices[t].iloc[loc - MOMENTUM_LOOKBACK]
        if pd.isna(p_now) or pd.isna(p_then) or p_then == 0:
            continue
        beta_vals[t] = _compute_beta(asset_window, spy_window)
        mom_vals[t]  = float(p_now / p_then - 1)

    common = sorted(set(beta_vals) & set(mom_vals))
    if not common:
        return empty

    beta_s = pd.Series({t: beta_vals[t] for t in common})
    mom_s  = pd.Series({t: mom_vals[t] for t in common})
    z_beta = _zscore(beta_s)
    z_mom  = _zscore(mom_s)
    score  = WEIGHT_BETA * z_beta + WEIGHT_MOMENTUM * z_mom

    top = score.nlargest(min(TOP_N, len(score)))
    n = len(top)

    rows = [
        {
            "ticker": t, "rank": rank,
            "beta": beta_vals[t], "momentum": mom_vals[t],
            "z_beta": float(z_beta[t]), "z_momentum": float(z_mom[t]),
            "combined_score": float(s), "market_cap": caps[t],
            "weight": 1.0 / n,
        }
        for rank, (t, s) in enumerate(top.items(), start=1)
    ]
    return pd.DataFrame(rows)


# ── NAV chain construction ───────────────────────────────────────────────────────

def _walk_forward(returns: pd.DataFrame, all_days: pd.DatetimeIndex, start_date, end_date,
                   holdings: dict[str, float], index_level: float, nav_rows: list) -> float:
    """Advances index_level day-by-day over (start_date, end_date] using `holdings`. Returns the new index_level."""
    days = all_days[(all_days > pd.Timestamp(start_date)) & (all_days <= pd.Timestamp(end_date))]
    for d in days:
        day_rets = [
            returns.at[d, t] for t in holdings
            if t in returns.columns and pd.notna(returns.at[d, t])
        ]
        basket_ret = float(np.mean(day_rets)) if day_rets else 0.0
        index_level *= (1 + basket_ret)
        nav_rows.append({
            "date": d.date(), "index_level": index_level,
            "daily_return": basket_ret, "num_holdings_active": len(day_rets),
        })
    return index_level


def _build_index_and_holdings(
    prices: pd.DataFrame, returns: pd.DataFrame, shares_out: dict[str, float],
    rb_dates: list[pd.Timestamp], spy_returns: pd.Series,
) -> tuple[pd.DataFrame, list[tuple[date, pd.DataFrame]]]:
    if not rb_dates:
        return pd.DataFrame(), []

    nav_rows: list = []
    holding_sets: list[tuple[date, pd.DataFrame]] = []
    index_level = 100.0
    all_days = prices.index

    first_holdings = _compute_rebalance(prices, returns, shares_out, rb_dates[0], spy_returns)
    holding_sets.append((rb_dates[0].date(), first_holdings))
    current_holdings = dict(zip(first_holdings["ticker"], first_holdings["weight"]))
    nav_rows.append({
        "date": rb_dates[0].date(), "index_level": index_level,
        "daily_return": None, "num_holdings_active": len(current_holdings),
    })

    for i in range(1, len(rb_dates)):
        index_level = _walk_forward(returns, all_days, rb_dates[i - 1], rb_dates[i], current_holdings, index_level, nav_rows)
        holdings_df = _compute_rebalance(prices, returns, shares_out, rb_dates[i], spy_returns)
        holding_sets.append((rb_dates[i].date(), holdings_df))
        current_holdings = dict(zip(holdings_df["ticker"], holdings_df["weight"]))

    last_day = all_days[-1]
    if last_day > rb_dates[-1]:
        index_level = _walk_forward(returns, all_days, rb_dates[-1], last_day, current_holdings, index_level, nav_rows)

    return pd.DataFrame(nav_rows), holding_sets


# ── DB upserts ────────────────────────────────────────────────────────────────

def _sanitize_rows(rows: list[dict]) -> list[dict]:
    """
    Replace NaN with None in-place. Necessary because building an intermediate
    pd.DataFrame from row dicts silently upcasts a Python `None` in an
    otherwise-float column to `np.nan` (e.g. the first NAV row's daily_return,
    which has no prior day to compute a return from) — and Postgres happily
    stores that as a real NaN float (not SQL NULL), which then fails to
    JSON-serialize (Starlette's JSONResponse uses allow_nan=False).
    """
    for row in rows:
        for k, v in row.items():
            if isinstance(v, float) and math.isnan(v):
                row[k] = None
    return rows


def _upsert_index(db: Session, nav_df: pd.DataFrame):
    if nav_df.empty:
        return
    rows = _sanitize_rows(nav_df.to_dict("records"))
    stmt = pg_insert(HbmIndexLevel).values(rows).on_conflict_do_update(
        index_elements=["date"],
        set_={
            "index_level": pg_insert(HbmIndexLevel).excluded.index_level,
            "daily_return": pg_insert(HbmIndexLevel).excluded.daily_return,
            "num_holdings_active": pg_insert(HbmIndexLevel).excluded.num_holdings_active,
        },
    )
    db.execute(stmt)
    db.commit()


def _upsert_holdings(db: Session, rebalance_date: date, holdings_df: pd.DataFrame):
    if holdings_df.empty:
        return
    rows = _sanitize_rows(holdings_df.to_dict("records"))
    for r in rows:
        r["rebalance_date"] = rebalance_date
    stmt = pg_insert(HbmHolding).values(rows).on_conflict_do_update(
        index_elements=["rebalance_date", "ticker"],
        set_={
            c: pg_insert(HbmHolding).excluded[c]
            for c in ("rank", "beta", "momentum", "z_beta", "z_momentum", "combined_score", "market_cap", "weight")
        },
    )
    db.execute(stmt)
    db.commit()


# ── Public API: seed (full rebuild, background task) ──────────────────────────

def seed_high_beta_momentum():
    """
    Full historical rebuild: re-screens the universe, downloads ~7 years of
    daily prices for ~2000+ candidates, and recomputes every monthly rebalance
    over the trailing HISTORY_YEARS. Long-running (10-40 min) — opens its own
    DB session rather than depending on a request-scoped one surviving that long.
    """
    if _build_state["running"]:
        log.warning("HBM: seed already running, ignoring duplicate trigger.")
        return

    _build_state.update(running=True, phase="screening", started_at=datetime.now(timezone.utc), finished_at=None, error=None)
    db = SessionLocal()
    try:
        candidates = _screen_universe()
        log.info("HBM seed: screened %d candidates.", len(candidates))
        shares_out = {c["ticker"]: c["shares_out"] for c in candidates if c["shares_out"]}
        tickers = list(shares_out.keys())
        if not tickers:
            raise RuntimeError("Screener returned no usable candidates.")

        _build_state["phase"] = "downloading"
        start = (datetime.now(timezone.utc) - timedelta(days=365 * (HISTORY_YEARS + DOWNLOAD_BUFFER_YEARS))).strftime("%Y-%m-%d")
        prices = download_prices_chunked(tickers + ["SPY"], start=start)
        if prices.empty or "SPY" not in prices.columns:
            raise RuntimeError("Price download failed or returned no SPY benchmark data.")
        log.info("HBM seed: downloaded prices for %d tickers, %d trading days.", len(prices.columns), len(prices))

        returns = prices.pct_change()
        spy_returns = returns["SPY"]

        _build_state["phase"] = "computing"
        rb_dates = _month_end_dates(prices.index, years=HISTORY_YEARS)
        if not rb_dates:
            raise RuntimeError("No month-end dates found in the downloaded price history.")
        nav_df, holding_sets = _build_index_and_holdings(prices, returns, shares_out, rb_dates, spy_returns)

        _build_state["phase"] = "saving"
        db.execute(delete(HbmIndexLevel))
        db.execute(delete(HbmHolding))
        db.commit()
        _upsert_index(db, nav_df)
        for rb_date, holdings_df in holding_sets:
            _upsert_holdings(db, rb_date, holdings_df)

        _build_state.update(running=False, phase="done", finished_at=datetime.now(timezone.utc))
        log.info("HBM seed complete: %d NAV rows, %d rebalances.", len(nav_df), len(holding_sets))

    except Exception as exc:
        log.exception("HBM seed failed")
        _build_state.update(running=False, phase="error", error=str(exc), finished_at=datetime.now(timezone.utc))
    finally:
        db.close()


# ── Public API: monthly incremental update ────────────────────────────────────

def update_high_beta_momentum(db: Session):
    """
    Fast, single-month incremental update — re-screens the universe fresh
    (point-in-time correctness) and extends the NAV chain from the last
    stored level. No-ops (with a log warning) if no baseline exists yet;
    intentionally does NOT auto-trigger the expensive seed from a cron job.
    """
    last_nav_row = db.execute(select(HbmIndexLevel).order_by(HbmIndexLevel.date.desc()).limit(1)).scalar_one_or_none()
    last_rb = db.execute(select(HbmHolding.rebalance_date).order_by(HbmHolding.rebalance_date.desc()).limit(1)).scalar()
    if last_nav_row is None or last_rb is None:
        log.warning("HBM update: no baseline data — run POST /build first, skipping.")
        return

    candidates = _screen_universe()
    shares_out = {c["ticker"]: c["shares_out"] for c in candidates if c["shares_out"]}
    tickers = list(shares_out.keys())
    if not tickers:
        log.warning("HBM update: screener returned no candidates, skipping.")
        return

    start = (datetime.now(timezone.utc) - timedelta(days=430)).strftime("%Y-%m-%d")  # ~14mo buffer
    prices = download_prices_chunked(tickers + ["SPY"], start=start)
    if prices.empty or "SPY" not in prices.columns:
        log.warning("HBM update: price download failed, skipping.")
        return

    returns = prices.pct_change()
    spy_returns = returns["SPY"]

    rb_dates = _month_end_dates(prices.index, years=1)
    new_rb_dates = [d for d in rb_dates if d.date() > last_rb]

    prior_rows = db.execute(select(HbmHolding).where(HbmHolding.rebalance_date == last_rb)).scalars().all()
    current_holdings = {r.ticker: r.weight for r in prior_rows}
    index_level = last_nav_row.index_level
    last_date = last_nav_row.date
    all_days = prices.index

    nav_rows: list = []
    holding_sets: list[tuple[date, pd.DataFrame]] = []

    for rb_date in new_rb_dates:
        index_level = _walk_forward(returns, all_days, last_date, rb_date, current_holdings, index_level, nav_rows)
        holdings_df = _compute_rebalance(prices, returns, shares_out, rb_date, spy_returns)
        holding_sets.append((rb_date.date(), holdings_df))
        current_holdings = dict(zip(holdings_df["ticker"], holdings_df["weight"]))
        last_date = rb_date.date()

    # Always extend the daily NAV chain through the latest downloaded trading day,
    # independent of whether a new month-end rebalance happened this run.
    last_day = all_days[-1]
    if last_day > pd.Timestamp(last_date):
        index_level = _walk_forward(returns, all_days, last_date, last_day, current_holdings, index_level, nav_rows)

    if not nav_rows and not holding_sets:
        log.info("HBM update: no new trading days or rebalances since %s.", last_rb)
        return

    _upsert_index(db, pd.DataFrame(nav_rows))
    for rb_date, holdings_df in holding_sets:
        _upsert_holdings(db, rb_date, holdings_df)

    log.info("HBM update: added %d NAV rows, %d new rebalance(s).", len(nav_rows), len(holding_sets))


# ── Read helpers (for the router) ─────────────────────────────────────────────

def get_index_series(db: Session) -> dict:
    rows = db.execute(select(HbmIndexLevel).order_by(HbmIndexLevel.date)).scalars().all()
    return {
        "dates":         [r.date.strftime("%Y-%m-%d") for r in rows],
        "index_level":   [r.index_level for r in rows],
        "daily_return":  [r.daily_return for r in rows],
    }


def get_rebalance_dates(db: Session) -> list[str]:
    rows = db.execute(select(HbmHolding.rebalance_date).distinct().order_by(HbmHolding.rebalance_date)).all()
    return [r[0].isoformat() for r in rows]


def get_holdings(db: Session, target_date: str | None) -> dict:
    if target_date:
        d = date.fromisoformat(target_date)
        actual = db.execute(
            select(HbmHolding.rebalance_date)
            .where(HbmHolding.rebalance_date <= d)
            .order_by(HbmHolding.rebalance_date.desc()).limit(1)
        ).scalar()
    else:
        actual = db.execute(select(HbmHolding.rebalance_date).order_by(HbmHolding.rebalance_date.desc()).limit(1)).scalar()

    if actual is None:
        return {"rebalance_date": None, "rows": []}

    rows = db.execute(
        select(HbmHolding).where(HbmHolding.rebalance_date == actual).order_by(HbmHolding.rank)
    ).scalars().all()

    return {
        "rebalance_date": actual.isoformat(),
        "rows": [
            {
                "ticker": r.ticker, "rank": r.rank, "beta": r.beta, "momentum": r.momentum,
                "z_beta": r.z_beta, "z_momentum": r.z_momentum, "combined_score": r.combined_score,
                "market_cap": r.market_cap, "weight": r.weight,
            }
            for r in rows
        ],
    }


def get_build_status(db: Session) -> dict:
    row_count = db.execute(select(func.count()).select_from(HbmIndexLevel)).scalar()
    earliest = db.execute(select(HbmIndexLevel.date).order_by(HbmIndexLevel.date.asc()).limit(1)).scalar()
    latest = db.execute(select(HbmIndexLevel.date).order_by(HbmIndexLevel.date.desc()).limit(1)).scalar()
    return {
        **_build_state,
        "row_count": row_count,
        "earliest": earliest.isoformat() if earliest else None,
        "latest": latest.isoformat() if latest else None,
    }
