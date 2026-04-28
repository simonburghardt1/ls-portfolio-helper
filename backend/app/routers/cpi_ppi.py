"""
CPI & PPI endpoints.

GET  /api/cpi-ppi/series      – headline series (CPI, Core CPI, PCE, Core PCE, PPI)
                                 with pre-computed MoM% and YoY% arrays
GET  /api/cpi-ppi/components  – all CPI subcategory series with MoM%, YoY%, streak
GET  /api/cpi-ppi/insights    – outlier analysis: biggest movers, streaks, hot spots
POST /api/cpi-ppi/refresh     – force re-fetch all series from FRED
"""

import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.macro_cache import MacroCache
from app.services.fred import FredClient
from app.services.macro_cache import get_series
from app.core.config import settings

router = APIRouter(prefix="/api/cpi-ppi", tags=["cpi-ppi"])
log = logging.getLogger(__name__)
fred = FredClient(api_key=settings.FRED_API_KEY)

# ── Headline series ───────────────────────────────────────────────────────────

HEADLINE_SERIES = {
    "CPIAUCSL": {"label": "CPI All Items",          "color": "#3b82f6"},
    "CPILFESL": {"label": "CPI Core (ex F&E)",      "color": "#10b981"},
    "PCEPI":    {"label": "PCE All Items",           "color": "#f59e0b"},
    "PCEPILFE": {"label": "PCE Core (ex F&E)",       "color": "#8b5cf6"},
    "PPIACO":   {"label": "PPI All Commodities",     "color": "#ef4444"},
}

# ── CPI subcategory series ────────────────────────────────────────────────────
# (series_id, label, parent_id or None, approx CPI weight %)

CPI_COMPONENTS: dict[str, tuple[str, str | None, float]] = {
    # ── Food ─────────────────────────────────────────────────────────────────
    "CPIUFDSL":        ("Food & Beverages",                    None,             13.5),
    "CPIFABNS":        ("Food at Home",                        "CPIUFDSL",        8.2),
    "CUSR0000SAF111":  ("Cereals & Bakery Products",           "CPIFABNS",        1.0),
    "CUSR0000SAF112":  ("Meats, Poultry, Fish & Eggs",         "CPIFABNS",        1.9),
    "CUSR0000SAF113":  ("Fruits & Vegetables",                 "CPIFABNS",        1.1),
    "CUSR0000SEFJ":    ("Dairy & Related Products",            "CPIFABNS",        0.8),
    "CUSR0000SAF114":  ("Nonalcoholic Beverages",              "CPIFABNS",        1.0),
    "CUSR0000SEFV":    ("Food Away from Home",                 "CPIUFDSL",        5.3),
    # ── Housing ───────────────────────────────────────────────────────────────
    "CPIHOSNS":        ("Housing",                             None,             36.2),
    "CUSR0000SAH1":    ("Shelter",                             "CPIHOSNS",       32.5),
    "CUSR0000SEHA":    ("Rent of Primary Residence",           "CUSR0000SAH1",    7.7),
    "CUSR0000SEHC01":  ("Owners' Equivalent Rent",             "CUSR0000SAH1",   26.8),
    "CUSR0000SEHB":    ("Lodging Away from Home",              "CUSR0000SAH1",    0.9),
    "CUSR0000SAH2":    ("Fuels & Utilities",                   "CPIHOSNS",        3.7),
    # ── Apparel ───────────────────────────────────────────────────────────────
    "CPIAPPSL":        ("Apparel",                             None,              2.6),
    "CUSR0000SAA1":    ("Men's & Boys' Apparel",               "CPIAPPSL",        0.7),
    "CUSR0000SAA2":    ("Women's & Girls' Apparel",            "CPIAPPSL",        1.1),
    "CUSR0000SEAE":    ("Footwear",                            "CPIAPPSL",        0.7),
    # ── Transportation ────────────────────────────────────────────────────────
    "CPITRNSL":        ("Transportation",                      None,             15.1),
    "CUSR0000SETA01":  ("New Vehicles",                        "CPITRNSL",        3.9),
    "CUSR0000SETA02":  ("Used Cars & Trucks",                  "CPITRNSL",        2.4),
    "CUSR0000SETB":    ("Motor Fuel",                          "CPITRNSL",        3.3),
    "CUSR0000SETD":    ("Motor Vehicle Maintenance & Repair",  "CPITRNSL",        1.0),
    "CUSR0000SETG":    ("Public Transportation",               "CPITRNSL",        1.3),
    # ── Medical Care ─────────────────────────────────────────────────────────
    "CPIMEDSL":        ("Medical Care",                        None,              8.3),
    "CUSR0000SAM1":    ("Medical Care Commodities",            "CPIMEDSL",        1.4),
    "CUSR0000SAM2":    ("Medical Care Services",               "CPIMEDSL",        6.9),
    "CUSR0000SEMD":    ("Hospital & Related Services",         "CUSR0000SAM2",    2.4),
    # ── Recreation ───────────────────────────────────────────────────────────
    "CPIRECSL":        ("Recreation",                          None,              5.5),
    # ── Education & Communication ─────────────────────────────────────────────
    "CPIEDUSL":        ("Education & Communication",           None,              6.9),
    "CUSR0000SAE1":    ("Education",                           "CPIEDUSL",        3.0),
    "CUSR0000SAE2":    ("Communication",                       "CPIEDUSL",        3.5),
    # ── Other ────────────────────────────────────────────────────────────────
    "CPIOGSSL":        ("Other Goods & Services",              None,              3.2),
}

ALL_CPI_SERIES_IDS  = list(CPI_COMPONENTS.keys())
ALL_SERIES_IDS      = list(HEADLINE_SERIES.keys()) + ALL_CPI_SERIES_IDS


# ── Helpers ───────────────────────────────────────────────────────────────────

def _pct_change(values: list[float | None], periods: int = 1) -> list[float | None]:
    """Return period-over-period % changes. Output length = len(values) - periods."""
    result = []
    for i in range(periods, len(values)):
        curr = values[i]
        prev = values[i - periods]
        if curr is None or prev is None or prev == 0:
            result.append(None)
        else:
            result.append(round((curr - prev) / prev * 100, 4))
    return result


def _trailing_streak(changes: list[float | None]) -> int:
    """
    Count trailing consecutive same-sign moves in the last N values.
    Returns positive int for consecutive increases, negative for decreases, 0 otherwise.
    """
    # Strip trailing Nones
    trimmed = [v for v in changes if v is not None]
    if not trimmed:
        return 0
    sign = 1 if trimmed[-1] > 0 else (-1 if trimmed[-1] < 0 else 0)
    if sign == 0:
        return 0
    count = 0
    for v in reversed(trimmed):
        if v is None:
            break
        if (v > 0) == (sign > 0):
            count += 1
        else:
            break
    return count * sign


def _align(dates: list[str], values: list[float | None], periods: int) -> tuple[list[str], list[float | None]]:
    """Return dates and values trimmed to match pct_change output (drop first `periods` entries)."""
    return dates[periods:], values[periods:]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/series")
async def get_headline_series(db: Session = Depends(get_db)):
    """
    Returns all headline series with raw values plus pre-computed MoM% and YoY% arrays.
    All arrays are aligned: index i in mom/yoy corresponds to index i in dates/values.
    """
    result: dict = {}
    for sid, meta in HEADLINE_SERIES.items():
        try:
            data = await get_series(db, fred, sid, ttl_hours=24 * 32)
            raw_dates:  list[str]             = data["dates"]
            raw_values: list[float | None]    = data["values"]

            mom = _pct_change(raw_values, 1)
            yoy = _pct_change(raw_values, 12)

            # Align everything to the shortest common window (YoY trims 12 from front)
            dates_aligned  = raw_dates[12:]
            values_aligned = raw_values[12:]
            mom_aligned    = mom[11:]   # mom already 1 shorter; trim 11 more → same length as yoy
            yoy_aligned    = yoy       # already trimmed 12

            result[sid] = {
                **meta,
                "dates":  dates_aligned,
                "values": values_aligned,
                "mom":    mom_aligned,
                "yoy":    yoy_aligned,
            }
        except Exception as exc:
            log.warning("cpi-ppi series: failed to fetch %s: %s", sid, exc)

    return {"series": result}


@router.get("/components")
async def get_components(db: Session = Depends(get_db)):
    """
    Returns all CPI subcategory series with MoM%, YoY%, trailing streak,
    and the last 5 years of monthly data for charting.
    """
    result: dict = {}
    for sid, (label, parent, weight) in CPI_COMPONENTS.items():
        try:
            data = await get_series(db, fred, sid, ttl_hours=24 * 32)
            raw_dates:  list[str]          = data["dates"]
            raw_values: list[float | None] = data["values"]

            if not raw_values:
                continue

            mom_full = _pct_change(raw_values, 1)
            yoy_full = _pct_change(raw_values, 12)

            latest_mom = next((v for v in reversed(mom_full) if v is not None), None)
            latest_yoy = next((v for v in reversed(yoy_full) if v is not None), None)
            streak     = _trailing_streak(mom_full)

            # Last 5 years for chart (60 months)
            chart_dates  = raw_dates[-60:]
            chart_values = raw_values[-60:]
            chart_mom    = mom_full[-60:]
            chart_yoy    = yoy_full[-48:]   # yoy is 12 shorter; -48 ≈ same window

            result[sid] = {
                "label":      label,
                "parent":     parent,
                "weight":     weight,
                "latest_mom": round(latest_mom, 3) if latest_mom is not None else None,
                "latest_yoy": round(latest_yoy, 3) if latest_yoy is not None else None,
                "streak":     streak,
                "dates":      chart_dates,
                "values":     chart_values,
                "mom":        chart_mom,
                "yoy":        chart_yoy,
            }
        except Exception as exc:
            log.warning("cpi-ppi components: failed to fetch %s: %s", sid, exc)

    return {"components": result}


@router.get("/insights")
async def get_insights(db: Session = Depends(get_db)):
    """
    Returns pre-computed outlier analysis over all CPI component series:
    - biggest_movers: top 5 and bottom 5 by latest MoM%
    - hot_spots:      components with YoY% > 5%
    - persistent_up:  components with streak >= 3 consecutive monthly increases
    - persistent_dn:  components with streak <= -3 consecutive monthly decreases
    """
    entries: list[dict] = []
    for sid, (label, parent, weight) in CPI_COMPONENTS.items():
        try:
            data = await get_series(db, fred, sid, ttl_hours=24 * 32)
            raw_values: list[float | None] = data["values"]
            raw_dates:  list[str]          = data["dates"]
            if not raw_values:
                continue

            mom_full = _pct_change(raw_values, 1)
            yoy_full = _pct_change(raw_values, 12)

            latest_mom    = next((v for v in reversed(mom_full) if v is not None), None)
            latest_yoy    = next((v for v in reversed(yoy_full) if v is not None), None)
            latest_date   = next((d for d, v in zip(reversed(raw_dates), reversed(raw_values)) if v is not None), None)
            streak        = _trailing_streak(mom_full)

            entries.append({
                "id":         sid,
                "label":      label,
                "parent":     parent,
                "weight":     weight,
                "mom":        round(latest_mom, 3) if latest_mom is not None else None,
                "yoy":        round(latest_yoy, 3) if latest_yoy is not None else None,
                "streak":     streak,
                "date":       latest_date,
            })
        except Exception as exc:
            log.warning("cpi-ppi insights: failed to fetch %s: %s", sid, exc)

    valid = [e for e in entries if e["mom"] is not None]

    sorted_mom     = sorted(valid, key=lambda e: e["mom"], reverse=True)
    biggest_movers = {"up": sorted_mom[:5], "down": sorted_mom[-5:][::-1]}
    hot_spots      = [e for e in valid if e["yoy"] is not None and e["yoy"] > 5.0]
    persistent_up  = [e for e in valid if e["streak"] >= 3]
    persistent_dn  = [e for e in valid if e["streak"] <= -3]

    return {
        "biggest_movers": biggest_movers,
        "hot_spots":      sorted(hot_spots, key=lambda e: e["yoy"], reverse=True),
        "persistent_up":  sorted(persistent_up, key=lambda e: e["streak"], reverse=True),
        "persistent_dn":  sorted(persistent_dn, key=lambda e: e["streak"]),
    }


@router.get("/status")
def get_status(db: Session = Depends(get_db)):
    """Return cache state: how many series are cached and when they were last fetched."""
    cached_count = 0
    latest_date: str | None = None
    fetched_at = None
    for sid in ALL_SERIES_IDS:
        row = db.get(MacroCache, sid)
        if row:
            cached_count += 1
            if row.fetched_at and (fetched_at is None or row.fetched_at > fetched_at):
                fetched_at = row.fetched_at
            if row.dates and (latest_date is None or row.dates[-1] > latest_date):
                latest_date = row.dates[-1]
    return {
        "count":        cached_count,
        "total_series": len(ALL_SERIES_IDS),
        "latest_date":  latest_date,
        "fetched_at":   fetched_at.isoformat() if fetched_at else None,
    }


@router.post("/refresh")
async def refresh_all(db: Session = Depends(get_db)):
    """Force cache expiry and re-fetch all CPI/PPI series from FRED."""
    result: dict = {}
    for sid in ALL_SERIES_IDS:
        row = db.get(MacroCache, sid)
        if row:
            row.fetched_at = datetime.now(timezone.utc) - timedelta(hours=25)
        db.commit()

    for sid in ALL_SERIES_IDS:
        label = (HEADLINE_SERIES.get(sid) or {}).get("label") \
             or (CPI_COMPONENTS.get(sid) or ("?",))[0]
        try:
            data = await get_series(db, fred, sid, ttl_hours=24 * 32)
            result[sid] = {
                "label": label,
                "count": len(data["dates"]),
                "latest_date":  data["dates"][-1]  if data["dates"]  else None,
                "latest_value": data["values"][-1] if data["values"] else None,
            }
        except Exception as exc:
            log.warning("cpi-ppi refresh: failed for %s: %s", sid, exc)
            result[sid] = {"label": label, "error": str(exc)}

    return {"refreshed": result}
