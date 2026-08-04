"""
Commodity price data — sourced from Yahoo Finance (yfinance).

Investing.com (the originally requested source) blocks scraping with Cloudflare,
and the LME/SHFE/DCE exchanges themselves are similarly locked down — so this
covers only the commodities with a working Yahoo Finance future contract.
Raw closes are stored in the existing generic `market_prices` table (ticker/date/close),
shared with the Market Regime feature.
"""

import datetime
import logging

import pandas as pd
import yfinance as yf
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.market_data import MarketPrice

log = logging.getLogger(__name__)

# ─── Registry ───────────────────────────────────────────────────────────────────

COMMODITIES: dict[str, dict] = {
    "wti":           {"label": "WTI Light Crude Oil",         "ticker": "CL=F",  "start": "2000-08-23"},
    "brent":         {"label": "Brent Oil",                   "ticker": "BZ=F",  "start": "2007-07-30"},
    "copper_comex":  {"label": "Copper (COMEX)",              "ticker": "HG=F",  "start": "2000-08-30"},
    "lumber":        {"label": "Lumber",                      "ticker": "LBR=F", "start": "2022-08-05"},
    "iron_ore_cme":  {"label": "Iron Ore (CME 62% Fe)",       "ticker": "TIO=F", "start": "2010-10-14"},
}


# ─── yfinance download ──────────────────────────────────────────────────────────

def _dl(ticker: str, start: str) -> pd.Series:
    try:
        raw = yf.download(ticker, start=start, interval="1d",
                          auto_adjust=True, progress=False)
        if raw.empty:
            return pd.Series(dtype=float, name=ticker)
        if isinstance(raw.columns, pd.MultiIndex):
            for key in [("Close", ticker), (ticker, "Close")]:
                if key in raw.columns:
                    return raw[key].rename(ticker)
            return pd.Series(dtype=float, name=ticker)
        return raw["Close"].squeeze().rename(ticker)
    except Exception as e:
        log.warning("_dl(%s) failed: %s", ticker, e)
        return pd.Series(dtype=float, name=ticker)


def _upsert_prices(db: Session, ticker: str, series: pd.Series):
    rows = [
        {"date": date.date(), "ticker": ticker, "close": None if pd.isna(val) else round(float(val), 4)}
        for date, val in series.items()
    ]
    if not rows:
        return
    stmt = pg_insert(MarketPrice).values(rows)\
             .on_conflict_do_update(
                 index_elements=["date", "ticker"],
                 set_={"close": pg_insert(MarketPrice).excluded.close}
             )
    db.execute(stmt)
    db.commit()


# ─── Public API ─────────────────────────────────────────────────────────────────

def seed_commodity(db: Session, commodity_id: str):
    """Full historical download + save for one commodity."""
    meta = COMMODITIES[commodity_id]
    series = _dl(meta["ticker"], meta["start"]).dropna()
    _upsert_prices(db, meta["ticker"], series)
    log.info("Seeded %s (%s): %d rows.", commodity_id, meta["ticker"], len(series))
    return len(series)


def update_commodity(db: Session, commodity_id: str):
    """Incremental refresh — only downloads and saves rows newer than what's stored."""
    meta = COMMODITIES[commodity_id]
    ticker = meta["ticker"]

    last = db.execute(
        select(MarketPrice.date)
        .where(MarketPrice.ticker == ticker)
        .order_by(MarketPrice.date.desc())
        .limit(1)
    ).scalar()

    if last is None:
        return seed_commodity(db, commodity_id)

    new_start = (last + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    series = _dl(ticker, new_start).dropna()
    if series.empty:
        log.info("Commodity %s: no new data since %s.", commodity_id, last)
        return 0

    _upsert_prices(db, ticker, series)
    log.info("Commodity %s updated: %d new row(s), latest %s.", commodity_id, len(series), series.index.max().date())
    return len(series)


def update_all_commodities(db: Session):
    for commodity_id in COMMODITIES:
        try:
            update_commodity(db, commodity_id)
        except Exception as exc:
            log.warning("Commodity update failed for %s: %s", commodity_id, exc)


def get_commodity_prices(db: Session, commodity_id: str) -> dict:
    meta = COMMODITIES[commodity_id]
    rows = db.execute(
        select(MarketPrice)
        .where(MarketPrice.ticker == meta["ticker"])
        .order_by(MarketPrice.date)
    ).scalars().all()

    return {
        "dates":  [r.date.strftime("%Y-%m-%d") for r in rows if r.close is not None],
        "closes": [r.close for r in rows if r.close is not None],
        "label":  meta["label"],
    }
