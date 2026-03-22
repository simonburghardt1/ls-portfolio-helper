import pandas as pd
from fastapi import APIRouter, HTTPException, Query, Depends
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.session import get_db
from app.services.fred import FredClient, latest_value, latest_cpi_yoy
from app.services.macro_cache import get_series

router = APIRouter()
fred = FredClient(api_key=settings.FRED_API_KEY)

SERIES_MAP = {
    "US_CPI_YOY": {"fred_code": "CPIAUCSL", "name": "US CPI YoY",          "unit": "%",     "transform": "yoy"},
    "US_UNRATE":  {"fred_code": "UNRATE",   "name": "US Unemployment Rate", "unit": "%",     "transform": None},
    "US_FEDFUNDS":{"fred_code": "FEDFUNDS", "name": "Fed Funds Rate",       "unit": "%",     "transform": None},
    "US_2Y":      {"fred_code": "DGS2",     "name": "US 2Y Treasury",       "unit": "%",     "transform": None},
    "US_10Y":     {"fred_code": "DGS10",    "name": "US 10Y Treasury",      "unit": "%",     "transform": None},
    "VIX":        {"fred_code": "VIXCLS",   "name": "VIX",                  "unit": "index", "transform": None},
}


def filter_by_range(dates: list, values: list, range_value: str) -> tuple[list, list]:
    """Filter date/value arrays to the requested range."""
    cutoffs = {"1Y": "2025-01-01", "5Y": "2021-01-01", "10Y": "2016-01-01", "MAX": "1990-01-01"}
    start = cutoffs.get(range_value.upper(), "1990-01-01")
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


@router.get("/api/macro/kpis")
async def macro_kpis(db: Session = Depends(get_db)):
    try:
        results = {}
        for key, cfg in SERIES_MAP.items():
            raw = await get_series(db, fred, cfg["fred_code"])
            results[key] = raw

        cpi = results["US_CPI_YOY"]

        return {
            "kpis": [
                {"id": "US_CPI_YOY",   "name": "US CPI YoY",          "unit": "%",     "value": latest_cpi_yoy(cpi["dates"], cpi["values"])},
                {"id": "US_UNRATE",    "name": "US Unemployment Rate", "unit": "%",     "value": latest_value(results["US_UNRATE"]["values"])},
                {"id": "US_FEDFUNDS",  "name": "Fed Funds Rate",       "unit": "%",     "value": latest_value(results["US_FEDFUNDS"]["values"])},
                {"id": "US_2Y",        "name": "US 2Y Treasury",       "unit": "%",     "value": latest_value(results["US_2Y"]["values"])},
                {"id": "US_10Y",       "name": "US 10Y Treasury",      "unit": "%",     "value": latest_value(results["US_10Y"]["values"])},
                {"id": "VIX",          "name": "VIX",                  "unit": "index", "value": latest_value(results["VIX"]["values"])},
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"macro_kpis failed: {repr(e)}")


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

        return {"id": series_id, "name": cfg["name"], "unit": cfg["unit"], "dates": dates, "values": values}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"macro_series failed: {repr(e)}")
