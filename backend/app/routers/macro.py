import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from app.core.config import settings
from app.services.fred import FredClient, latest_value, latest_cpi_yoy

router = APIRouter()
fred = FredClient(api_key=settings.FRED_API_KEY)


SERIES_MAP = {
    "US_CPI_YOY": {
        "fred_code": "CPIAUCSL",
        "name": "US CPI YoY",
        "unit": "%",
        "transform": "yoy",
    },
    "US_UNRATE": {
        "fred_code": "UNRATE",
        "name": "US Unemployment Rate",
        "unit": "%",
        "transform": None,
    },
    "US_FEDFUNDS": {
        "fred_code": "FEDFUNDS",
        "name": "Fed Funds Rate",
        "unit": "%",
        "transform": None,
    },
    "US_2Y": {
        "fred_code": "DGS2",
        "name": "US 2Y Treasury",
        "unit": "%",
        "transform": None,
    },
    "US_10Y": {
        "fred_code": "DGS10",
        "name": "US 10Y Treasury",
        "unit": "%",
        "transform": None,
    },
    "VIX": {
        "fred_code": "VIXCLS",
        "name": "VIX",
        "unit": "index",
        "transform": None,
    },
}


def identity_series(dates: list[str], values: list[float]) -> dict:
    return {
        "dates": dates,
        "values": values,
    }


def yoy_series(dates: list[str], values: list[float]) -> dict:
    s = pd.Series(values, index=pd.to_datetime(dates)).sort_index()
    m = s.resample("ME").last()
    yoy = (m / m.shift(12) - 1.0) * 100.0
    yoy = yoy.dropna()

    return {
        "dates": [d.strftime("%Y-%m-%d") for d in yoy.index],
        "values": yoy.round(3).tolist(),
    }


def range_to_start_date(range_value: str) -> str:
    mapping = {
        "1Y": "2024-01-01",
        "5Y": "2020-01-01",
        "10Y": "2015-01-01",
        "MAX": "2010-01-01",
    }
    return mapping.get(range_value.upper(), "2010-01-01")


@router.get("/api/macro/kpis")
async def macro_kpis():
    try:
        cpi = await fred.observations("CPIAUCSL")
        unrate = await fred.observations("UNRATE")
        fedfunds = await fred.observations("FEDFUNDS")
        us2y = await fred.observations("DGS2")
        us10y = await fred.observations("DGS10")
        vix = await fred.observations("VIXCLS")

        return {
            "kpis": [
                {
                    "id": "US_CPI_YOY",
                    "name": "US CPI YoY",
                    "value": latest_cpi_yoy(cpi["dates"], cpi["values"]),
                    "unit": "%",
                },
                {
                    "id": "US_UNRATE",
                    "name": "US Unemployment Rate",
                    "value": latest_value(unrate["values"]),
                    "unit": "%",
                },
                {
                    "id": "US_FEDFUNDS",
                    "name": "Fed Funds Rate",
                    "value": latest_value(fedfunds["values"]),
                    "unit": "%",
                },
                {
                    "id": "US_2Y",
                    "name": "US 2Y Treasury",
                    "value": latest_value(us2y["values"]),
                    "unit": "%",
                },
                {
                    "id": "US_10Y",
                    "name": "US 10Y Treasury",
                    "value": latest_value(us10y["values"]),
                    "unit": "%",
                },
                {
                    "id": "VIX",
                    "name": "VIX",
                    "value": latest_value(vix["values"]),
                    "unit": "",
                },
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"macro_kpis failed: {repr(e)}")


@router.get("/api/macro/series/{series_id}")
async def macro_series(series_id: str, range: str = Query("MAX")):
    try:
        if series_id not in SERIES_MAP:
            raise HTTPException(
                status_code=404, detail=f"Unknown series_id: {series_id}"
            )

        config = SERIES_MAP[series_id]
        start_date = range_to_start_date(range)
        raw = await fred.observations(config["fred_code"], start=start_date)

        if config["transform"] == "yoy":
            series = yoy_series(raw["dates"], raw["values"])
        else:
            series = identity_series(raw["dates"], raw["values"])

        return {
            "id": series_id,
            "name": config["name"],
            "unit": config["unit"],
            "dates": series["dates"],
            "values": series["values"],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"macro_series failed: {repr(e)}")
