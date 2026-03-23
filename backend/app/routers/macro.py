from datetime import datetime, timedelta
import pandas as pd
from fastapi import APIRouter, HTTPException, Query, Depends
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.session import get_db
from app.services.fred import FredClient
from app.services.macro_cache import get_series

router = APIRouter()
fred = FredClient(api_key=settings.FRED_API_KEY)

SERIES_MAP = {
    # ── Yields ──────────────────────────────────────────────────────────────
    "US_2Y":       {"fred_code": "DGS2",     "name": "US 2Y",              "unit": "%",     "transform": None,       "good_direction": "down", "group": "Yields",     "daily": True},
    "US_10Y":      {"fred_code": "DGS10",    "name": "US 10Y",             "unit": "%",     "transform": None,       "good_direction": "down", "group": "Yields",     "daily": True},
    "US_30Y":      {"fred_code": "DGS30",    "name": "US 30Y",             "unit": "%",     "transform": None,       "good_direction": "down", "group": "Yields",     "daily": True},
    "US_FEDFUNDS": {"fred_code": "FEDFUNDS", "name": "Fed Funds Rate",     "unit": "%",     "transform": None,       "good_direction": "down", "group": "Yields",     "daily": False},
    # ── Inflation ────────────────────────────────────────────────────────────
    "US_CPI_YOY":  {"fred_code": "CPIAUCSL", "name": "US CPI YoY",        "unit": "%",     "transform": "yoy",      "good_direction": "down", "group": "Inflation",  "daily": False},
    "US_PPI_YOY":  {"fred_code": "PPIACO",   "name": "US PPI YoY",        "unit": "%",     "transform": "yoy",      "good_direction": "down", "group": "Inflation",  "daily": False},
    "ISM_MFG_PRC": {"fred_code": "NAPMPRI",  "name": "ISM Mfg Prices",    "unit": "index", "transform": None,       "good_direction": "down", "group": "Inflation",  "daily": False},
    "ISM_SVC_PRC": {"fred_code": "NMFPRI",   "name": "ISM Svc Prices",    "unit": "index", "transform": None,       "good_direction": "down", "group": "Inflation",  "daily": False},
    # ── Employment ───────────────────────────────────────────────────────────
    "US_UNRATE":   {"fred_code": "UNRATE",   "name": "Unemployment Rate", "unit": "%",     "transform": None,       "good_direction": "down", "group": "Employment", "daily": False},
    "US_NFP":      {"fred_code": "PAYEMS",   "name": "Non Farm Payrolls", "unit": "K",     "transform": "mom_diff", "good_direction": "up",   "group": "Employment", "daily": False},
    "US_JOBLESS":  {"fred_code": "ICSA",     "name": "Jobless Claims",    "unit": "K",     "transform": None,       "good_direction": "down", "group": "Employment", "daily": False},
}


def filter_by_range(dates: list, values: list, range_value: str) -> tuple[list, list]:
    today = datetime.now()
    cutoffs = {
        "1Y":  (today - timedelta(days=365)).strftime("%Y-%m-%d"),
        "5Y":  (today - timedelta(days=365 * 5)).strftime("%Y-%m-%d"),
        "10Y": (today - timedelta(days=365 * 10)).strftime("%Y-%m-%d"),
        "MAX": "1900-01-01",
    }
    start = cutoffs.get(range_value.upper(), "1900-01-01")
    pairs = [(d, v) for d, v in zip(dates, values) if d >= start]
    if not pairs:
        return [], []
    d, v = zip(*pairs)
    return list(d), list(v)


def apply_yoy(dates: list, values: list) -> tuple[list, list]:
    s = pd.Series(values, index=pd.to_datetime(dates)).sort_index()
    m = s.resample("ME").last()
    yoy = ((m / m.shift(12)) - 1.0) * 100.0
    yoy = yoy.dropna()
    return [d.strftime("%Y-%m-%d") for d in yoy.index], yoy.round(3).tolist()


def apply_mom_diff(dates: list, values: list) -> tuple[list, list]:
    s = pd.Series(values, index=pd.to_datetime(dates)).sort_index()
    diff = s.diff(1).dropna()
    return [d.strftime("%Y-%m-%d") for d in diff.index], diff.round(1).tolist()


def compute_kpi(dates: list, values: list, cfg: dict) -> tuple[float | None, float | None]:
    """Return (latest_value, mom_change) after applying transforms."""
    if not dates or not values:
        return None, None

    s = pd.Series(values, index=pd.to_datetime(dates)).sort_index()

    # Resample daily series to monthly before comparing
    if cfg.get("daily"):
        s = s.resample("ME").last().dropna()

    transform = cfg.get("transform")
    if transform == "yoy":
        m = s.resample("ME").last()
        s = ((m / m.shift(12)) - 1.0) * 100.0
        s = s.dropna()
    elif transform == "mom_diff":
        s = s.diff(1).dropna()

    if len(s) == 0:
        return None, None

    value = round(float(s.iloc[-1]), 2)
    change = round(float(s.iloc[-1] - s.iloc[-2]), 2) if len(s) >= 2 else None
    return value, change


@router.get("/api/macro/kpis")
async def macro_kpis(db: Session = Depends(get_db)):
    kpis = []
    for key, cfg in SERIES_MAP.items():
        try:
            raw = await get_series(db, fred, cfg["fred_code"])
            value, change = compute_kpi(raw["dates"], raw["values"], cfg)
        except Exception:
            value, change = None, None

        kpis.append({
            "id":             key,
            "name":           cfg["name"],
            "unit":           cfg["unit"],
            "value":          value,
            "change":         change,
            "good_direction": cfg["good_direction"],
            "group":          cfg["group"],
        })

    return {"kpis": kpis}


@router.get("/api/macro/series/{series_id}")
async def macro_series(series_id: str, range: str = Query("MAX"), db: Session = Depends(get_db)):
    if series_id not in SERIES_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown series_id: {series_id}")
    try:
        cfg = SERIES_MAP[series_id]
        raw = await get_series(db, fred, cfg["fred_code"])
        dates, values = filter_by_range(raw["dates"], raw["values"], range)

        if cfg["transform"] == "yoy":
            dates, values = apply_yoy(dates, values)
        elif cfg["transform"] == "mom_diff":
            dates, values = apply_mom_diff(dates, values)

        return {"id": series_id, "name": cfg["name"], "unit": cfg["unit"], "dates": dates, "values": values}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"macro_series failed: {repr(e)}")
