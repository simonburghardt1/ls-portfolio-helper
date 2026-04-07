"""
CFTC Commitments of Traders (COT) data service.

Two report types are used:
- Disaggregated Futures Only (commodities): "Managed Money" category
- TFF / Traders in Financial Futures (currencies, indices, crypto): "Asset Manager/Institutional" category

Both sourced from the CFTC Socrata REST API (free, no auth required).
"""

import asyncio
import datetime
import logging

import httpx
from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.cot_data import CotData

log = logging.getLogger(__name__)

DISAGG_URL = "https://publicreporting.cftc.gov/resource/72hh-3qpy.json"
TFF_URL    = "https://publicreporting.cftc.gov/resource/gpe5-46if.json"

# key → {label, cftc_name, asset_class, report_type, yf_ticker}
CONTRACTS: dict[str, dict] = {
    # ── Energy ──────────────────────────────────────────────────────────────────
    "wti": {
        "label":      "WTI Crude Oil",
        # Renamed by CFTC ~Feb 2022; old name stopped at 2022-01-02
        "cftc_name":  "CRUDE OIL, LIGHT SWEET-WTI - ICE FUTURES EUROPE",
        "asset_class": "energy",
        "report_type": "disaggregated",
        "yf_ticker":   "CL=F",
    },
    "brent": {
        "label":      "Brent Crude",
        # Renamed by CFTC ~Feb 2022; old name stopped at 2022-01-02
        "cftc_name":  "BRENT LAST DAY - NEW YORK MERCANTILE EXCHANGE",
        "asset_class": "energy",
        "report_type": "disaggregated",
        "yf_ticker":   "BZ=F",
    },
    "nat_gas": {
        "label":      "Natural Gas",
        "cftc_name":  "NAT GAS NYME - NEW YORK MERCANTILE EXCHANGE",
        "asset_class": "energy",
        "report_type": "disaggregated",
        "yf_ticker":   "NG=F",
    },
    # ── Precious Metals ─────────────────────────────────────────────────────────
    "gold": {
        "label":      "Gold",
        "cftc_name":  "GOLD - COMMODITY EXCHANGE INC.",
        "asset_class": "precious_metals",
        "report_type": "disaggregated",
        "yf_ticker":   "GC=F",
    },
    "silver": {
        "label":      "Silver",
        "cftc_name":  "SILVER - COMMODITY EXCHANGE INC.",
        "asset_class": "precious_metals",
        "report_type": "disaggregated",
        "yf_ticker":   "SI=F",
    },
    "platinum": {
        "label":      "Platinum",
        "cftc_name":  "PLATINUM - NEW YORK MERCANTILE EXCHANGE",
        "asset_class": "precious_metals",
        "report_type": "disaggregated",
        "yf_ticker":   "PL=F",
    },
    "palladium": {
        "label":      "Palladium",
        "cftc_name":  "PALLADIUM - NEW YORK MERCANTILE EXCHANGE",
        "asset_class": "precious_metals",
        "report_type": "disaggregated",
        "yf_ticker":   "PA=F",
    },
    # ── Agricultural Commodities ─────────────────────────────────────────────────
    "corn": {
        "label":      "Corn",
        "cftc_name":  "CORN - CHICAGO BOARD OF TRADE",
        "asset_class": "commodities",
        "report_type": "disaggregated",
        "yf_ticker":   "ZC=F",
    },
    "wheat": {
        "label":      "Wheat",
        "cftc_name":  "WHEAT-SRW - CHICAGO BOARD OF TRADE",
        "asset_class": "commodities",
        "report_type": "disaggregated",
        "yf_ticker":   "ZW=F",
    },
    "soybeans": {
        "label":      "Soybeans",
        "cftc_name":  "SOYBEANS - CHICAGO BOARD OF TRADE",
        "asset_class": "commodities",
        "report_type": "disaggregated",
        "yf_ticker":   "ZS=F",
    },
    "sugar": {
        "label":      "Sugar No.11",
        "cftc_name":  "SUGAR NO. 11 - ICE FUTURES U.S.",
        "asset_class": "commodities",
        "report_type": "disaggregated",
        "yf_ticker":   "SB=F",
    },
    # ── Industrial Metals ───────────────────────────────────────────────────────
    "copper": {
        "label":      "Copper",
        # Renamed by CFTC ~Feb 2022; old name stopped at 2022-01-02
        "cftc_name":  "COPPER- #1 - COMMODITY EXCHANGE INC.",
        "asset_class": "industrial_metals",
        "report_type": "disaggregated",
        "yf_ticker":   "HG=F",
    },
    "aluminium": {
        "label":      "Aluminium",
        "cftc_name":  "ALUMINUM MWP - COMMODITY EXCHANGE INC.",
        "asset_class": "industrial_metals",
        "report_type": "disaggregated",
        "yf_ticker":   "ALI=F",
    },
    # ── Currencies ──────────────────────────────────────────────────────────────
    "eur": {
        "label":      "Euro FX",
        "cftc_name":  "EURO FX - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "currencies",
        "report_type": "tff",
        "yf_ticker":   "EURUSD=X",
    },
    "gbp": {
        "label":      "British Pound",
        "cftc_name":  "BRITISH POUND STERLING - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "currencies",
        "report_type": "tff",
        "yf_ticker":   "GBPUSD=X",
    },
    "jpy": {
        "label":      "Japanese Yen",
        "cftc_name":  "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "currencies",
        "report_type": "tff",
        "yf_ticker":   "JPYUSD=X",
    },
    "chf": {
        "label":      "Swiss Franc",
        "cftc_name":  "SWISS FRANC - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "currencies",
        "report_type": "tff",
        "yf_ticker":   "CHFUSD=X",
    },
    "aud": {
        "label":      "Australian Dollar",
        "cftc_name":  "AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "currencies",
        "report_type": "tff",
        "yf_ticker":   "AUDUSD=X",
    },
    "cad": {
        "label":      "Canadian Dollar",
        "cftc_name":  "CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "currencies",
        "report_type": "tff",
        "yf_ticker":   "CADUSD=X",
    },
    "usd_index": {
        "label":      "USD Index",
        "cftc_name":  "USD INDEX - ICE FUTURES U.S.",
        "asset_class": "currencies",
        "report_type": "tff",
        "yf_ticker":   "DX=F",
    },
    # ── Indices ─────────────────────────────────────────────────────────────────
    "sp500": {
        "label":      "S&P 500 E-Mini",
        "cftc_name":  "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "indices",
        "report_type": "tff",
        "yf_ticker":   "ES=F",
    },
    "nasdaq": {
        "label":      "NASDAQ E-Mini",
        "cftc_name":  "NASDAQ MINI - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "indices",
        "report_type": "tff",
        "yf_ticker":   "NQ=F",
    },
    "dow": {
        "label":      "Dow E-Mini",
        "cftc_name":  "DJIA x $5 - CHICAGO BOARD OF TRADE",
        "asset_class": "indices",
        "report_type": "tff",
        "yf_ticker":   "YM=F",
    },
    "russell": {
        "label":      "Russell 2000",
        "cftc_name":  "MICRO E-MINI RUSSELL 2000 INDX - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "indices",
        "report_type": "tff",
        "yf_ticker":   "RTY=F",
    },
    "vix": {
        "label":      "VIX Futures",
        "cftc_name":  "VIX FUTURES - CBOE FUTURES EXCHANGE",
        "asset_class": "indices",
        "report_type": "tff",
        "yf_ticker":   "^VIX",
    },
    "msci_em": {
        "label":      "MSCI Emerging Markets",
        "cftc_name":  "MSCI EM INDEX - ICE FUTURES U.S.",
        "asset_class": "indices",
        "report_type": "tff",
        "yf_ticker":   "EEM",
    },
    # ── Crypto ──────────────────────────────────────────────────────────────────
    "bitcoin": {
        "label":      "Bitcoin",
        "cftc_name":  "BITCOIN - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "crypto",
        "report_type": "tff",
        "yf_ticker":   "BTC-USD",
    },
    "ethereum": {
        "label":      "Ethereum",
        "cftc_name":  "ETHER CASH SETTLED - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "crypto",
        "report_type": "tff",
        "yf_ticker":   "ETH-USD",
    },
}

ASSET_CLASS_LABELS = {
    "energy":           "Energy",
    "precious_metals":  "Precious Metals",
    "commodities":      "Commodities",
    "industrial_metals": "Industrial Metals",
    "currencies":       "Currencies",
    "indices":          "Indices",
    "crypto":           "Crypto",
}


def _safe_int(val) -> int | None:
    try:
        return int(float(val)) if val is not None else None
    except (ValueError, TypeError):
        return None


async def _fetch_contract(contract_key: str, start_date: str = "2009-01-01") -> list[dict]:
    """Fetch all COT rows for a single contract from the CFTC Socrata API."""
    meta = CONTRACTS[contract_key]
    url  = DISAGG_URL if meta["report_type"] == "disaggregated" else TFF_URL

    if meta["report_type"] == "disaggregated":
        select_cols = (
            "report_date_as_yyyy_mm_dd,"
            "open_interest_all,"
            "m_money_positions_long_all,"
            "m_money_positions_short_all,"
            "market_and_exchange_names"
        )
    else:
        select_cols = (
            "report_date_as_yyyy_mm_dd,"
            "open_interest_all,"
            "asset_mgr_positions_long,"
            "asset_mgr_positions_short,"
            "market_and_exchange_names"
        )

    params = {
        "$select": select_cols,
        "$where":  f"market_and_exchange_names='{meta['cftc_name']}' AND report_date_as_yyyy_mm_dd >= '{start_date}'",
        "$order":  "report_date_as_yyyy_mm_dd ASC",
        "$limit":  "2000",
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        rows = resp.json()

    if rows:
        log.debug("COT %s first row keys: %s", contract_key, list(rows[0].keys()))

    result = []
    for row in rows:
        raw_date = row.get("report_date_as_yyyy_mm_dd", "")
        if not raw_date:
            continue
        # Date comes as "YYYY-MM-DDT00:00:00.000" or "YYYY-MM-DD"
        date_str = raw_date[:10]
        try:
            date = datetime.date.fromisoformat(date_str)
        except ValueError:
            continue

        if meta["report_type"] == "disaggregated":
            long_pos  = _safe_int(row.get("m_money_positions_long_all"))
            short_pos = _safe_int(row.get("m_money_positions_short_all"))
        else:
            long_pos  = _safe_int(row.get("asset_mgr_positions_long"))
            short_pos = _safe_int(row.get("asset_mgr_positions_short"))

        oi = _safe_int(row.get("open_interest_all"))

        result.append({
            "date":          date,
            "contract":      contract_key,
            "asset_class":   meta["asset_class"],
            "long_pos":      long_pos,
            "short_pos":     short_pos,
            "open_interest": oi,
        })

    return result


def _upsert_rows(db, rows: list[dict]) -> int:
    """Bulk upsert rows into cot_data. Returns number of rows processed."""
    if not rows:
        return 0
    stmt = pg_insert(CotData).values(rows).on_conflict_do_update(
        index_elements=["date", "contract"],
        set_={
            "asset_class":   pg_insert(CotData).excluded.asset_class,
            "long_pos":      pg_insert(CotData).excluded.long_pos,
            "short_pos":     pg_insert(CotData).excluded.short_pos,
            "open_interest": pg_insert(CotData).excluded.open_interest,
        },
    )
    db.execute(stmt)
    return len(rows)


async def seed_cot_data(db) -> dict:
    """Full historical seed — fetches all data from 2009-01-01 for all contracts."""
    summary = {}
    for key in CONTRACTS:
        try:
            rows = await _fetch_contract(key, "2009-01-01")
            count = _upsert_rows(db, rows)
            db.commit()
            summary[key] = count
            log.info("COT seed %s: %d rows", key, count)
        except Exception as exc:
            log.warning("COT seed %s failed: %s", key, exc)
            summary[key] = f"error: {exc}"
        await asyncio.sleep(0.5)
    return summary


async def update_cot_data(db) -> dict:
    """Incremental update — only fetches recent data (last 60 days buffer for revisions)."""
    result = db.execute(text("SELECT MAX(date) FROM cot_data")).scalar()
    if result is None:
        return await seed_cot_data(db)

    start = (result - datetime.timedelta(days=60)).isoformat()
    summary = {}
    for key in CONTRACTS:
        try:
            rows = await _fetch_contract(key, start)
            count = _upsert_rows(db, rows)
            db.commit()
            summary[key] = count
            log.info("COT update %s: %d rows from %s", key, count, start)
        except Exception as exc:
            log.warning("COT update %s failed: %s", key, exc)
            summary[key] = f"error: {exc}"
        await asyncio.sleep(0.3)
    return summary


def _compute_net(long_pos, short_pos, open_interest):
    net_pos = None
    net_pct = None
    if long_pos is not None and short_pos is not None:
        net_pos = long_pos - short_pos
        if open_interest and open_interest > 0:
            net_pct = round(net_pos / open_interest * 100, 2)
    return net_pos, net_pct


def get_cot_overview(db) -> dict:
    """Return latest row per contract, grouped by asset class."""
    # Subquery: latest date per contract
    subq = (
        db.query(CotData.contract, func.max(CotData.date).label("max_date"))
        .group_by(CotData.contract)
        .subquery()
    )
    rows = (
        db.query(CotData)
        .join(subq, (CotData.contract == subq.c.contract) & (CotData.date == subq.c.max_date))
        .all()
    )

    by_class: dict[str, list] = {}
    for row in rows:
        ac = row.asset_class or "other"
        if ac not in by_class:
            by_class[ac] = []
        net_pos, net_pct = _compute_net(row.long_pos, row.short_pos, row.open_interest)
        meta = CONTRACTS.get(row.contract, {})
        by_class[ac].append({
            "contract":      row.contract,
            "label":         meta.get("label", row.contract),
            "date":          row.date.isoformat(),
            "long_pos":      row.long_pos,
            "short_pos":     row.short_pos,
            "open_interest": row.open_interest,
            "net_pos":       net_pos,
            "net_pct":       net_pct,
        })

    return by_class


def get_cot_series(db, contract_key: str) -> dict:
    """Return full time series for one contract, ordered by date."""
    rows = (
        db.query(CotData)
        .filter(CotData.contract == contract_key)
        .order_by(CotData.date.asc())
        .all()
    )

    dates, long_pos, short_pos, open_interest, net_pos, net_pct = [], [], [], [], [], []
    for row in rows:
        dates.append(row.date.isoformat())
        long_pos.append(row.long_pos)
        short_pos.append(row.short_pos)
        open_interest.append(row.open_interest)
        np_, npct = _compute_net(row.long_pos, row.short_pos, row.open_interest)
        net_pos.append(np_)
        net_pct.append(npct)

    return {
        "contract":      contract_key,
        "label":         CONTRACTS.get(contract_key, {}).get("label", contract_key),
        "asset_class":   CONTRACTS.get(contract_key, {}).get("asset_class"),
        "dates":         dates,
        "long_pos":      long_pos,
        "short_pos":     short_pos,
        "open_interest": open_interest,
        "net_pos":       net_pos,
        "net_pct":       net_pct,
    }


async def get_cot_price(contract_key: str) -> dict:
    """Fetch daily price history for a contract via yfinance."""
    import yfinance as yf

    meta = CONTRACTS.get(contract_key, {})
    ticker = meta.get("yf_ticker")
    if not ticker:
        return {"dates": [], "prices": [], "ticker": None}
    try:
        data = yf.download(ticker, start="2006-01-01", progress=False, auto_adjust=True)
        # Newer yfinance returns multi-level columns; squeeze to plain Series
        closes = data["Close"].squeeze().dropna()
        if closes.empty:
            return {"dates": [], "prices": [], "ticker": ticker}
        return {
            "ticker": ticker,
            "dates":  [str(d.date()) for d in closes.index],
            "prices": [round(float(v), 6) for v in closes],
        }
    except Exception as exc:
        log.warning("get_cot_price %s (%s) failed: %s", contract_key, ticker, exc)
        return {"dates": [], "prices": [], "ticker": ticker, "error": str(exc)}


def get_cot_status(db) -> dict:
    """Return latest date per contract from DB."""
    rows = (
        db.query(CotData.contract, func.max(CotData.date).label("latest"))
        .group_by(CotData.contract)
        .all()
    )
    result = {}
    for contract, latest in rows:
        meta = CONTRACTS.get(contract, {})
        result[contract] = {
            "label":       meta.get("label", contract),
            "asset_class": meta.get("asset_class"),
            "latest_date": latest.isoformat() if latest else None,
        }
    # Add contracts with no data
    for key, meta in CONTRACTS.items():
        if key not in result:
            result[key] = {"label": meta["label"], "asset_class": meta["asset_class"], "latest_date": None}
    return result
