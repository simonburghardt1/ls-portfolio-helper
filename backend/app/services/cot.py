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

# key → {label, cftc_name, asset_class, report_type}
CONTRACTS: dict[str, dict] = {
    "wti": {
        "label": "WTI Crude Oil",
        "cftc_name": "CRUDE OIL, LIGHT SWEET - NEW YORK MERCANTILE EXCHANGE",
        "asset_class": "energy",
        "report_type": "disaggregated",
    },
    "nat_gas": {
        "label": "Natural Gas",
        "cftc_name": "NATURAL GAS (NYMEX) - NEW YORK MERCANTILE EXCHANGE",
        "asset_class": "energy",
        "report_type": "disaggregated",
    },
    "brent": {
        "label": "Brent Crude",
        "cftc_name": "BRENT CRUDE OIL LAST DAY - NEW YORK MERCANTILE EXCHANGE",
        "asset_class": "energy",
        "report_type": "disaggregated",
    },
    "gold": {
        "label": "Gold",
        "cftc_name": "GOLD - COMMODITY EXCHANGE INC.",
        "asset_class": "precious_metals",
        "report_type": "disaggregated",
    },
    "silver": {
        "label": "Silver",
        "cftc_name": "SILVER - COMMODITY EXCHANGE INC.",
        "asset_class": "precious_metals",
        "report_type": "disaggregated",
    },
    "corn": {
        "label": "Corn",
        "cftc_name": "CORN - CHICAGO BOARD OF TRADE",
        "asset_class": "commodities",
        "report_type": "disaggregated",
    },
    "wheat": {
        "label": "Wheat",
        "cftc_name": "WHEAT-SRW - CHICAGO BOARD OF TRADE",
        "asset_class": "commodities",
        "report_type": "disaggregated",
    },
    "soybeans": {
        "label": "Soybeans",
        "cftc_name": "SOYBEANS - CHICAGO BOARD OF TRADE",
        "asset_class": "commodities",
        "report_type": "disaggregated",
    },
    "sugar": {
        "label": "Sugar No.11",
        "cftc_name": "SUGAR NO. 11 (WORLD) - ICE FUTURES U.S.",
        "asset_class": "commodities",
        "report_type": "disaggregated",
    },
    "copper": {
        "label": "Copper",
        "cftc_name": "COPPER-GRADE #1 - COMMODITY EXCHANGE INC.",
        "asset_class": "industrial_metals",
        "report_type": "disaggregated",
    },
    "eur": {
        "label": "Euro FX",
        "cftc_name": "EURO FX - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "currencies",
        "report_type": "tff",
    },
    "gbp": {
        "label": "British Pound",
        "cftc_name": "BRITISH POUND STERLING - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "currencies",
        "report_type": "tff",
    },
    "jpy": {
        "label": "Japanese Yen",
        "cftc_name": "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "currencies",
        "report_type": "tff",
    },
    "chf": {
        "label": "Swiss Franc",
        "cftc_name": "SWISS FRANC - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "currencies",
        "report_type": "tff",
    },
    "aud": {
        "label": "Australian Dollar",
        "cftc_name": "AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "currencies",
        "report_type": "tff",
    },
    "cad": {
        "label": "Canadian Dollar",
        "cftc_name": "CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "currencies",
        "report_type": "tff",
    },
    "sp500": {
        "label": "S&P 500 E-Mini",
        "cftc_name": "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "indices",
        "report_type": "tff",
    },
    "nasdaq": {
        "label": "NASDAQ E-Mini",
        "cftc_name": "NASDAQ MINI - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "indices",
        "report_type": "tff",
    },
    "dow": {
        "label": "Dow E-Mini",
        "cftc_name": "DJIA x $5 - CHICAGO BOARD OF TRADE",
        "asset_class": "indices",
        "report_type": "tff",
    },
    "russell": {
        "label": "Russell 2000",
        "cftc_name": "RUSSELL 2000 MINI INDEX - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "indices",
        "report_type": "tff",
    },
    "bitcoin": {
        "label": "Bitcoin",
        "cftc_name": "BITCOIN - CHICAGO MERCANTILE EXCHANGE",
        "asset_class": "crypto",
        "report_type": "tff",
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
