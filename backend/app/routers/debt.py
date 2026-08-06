"""
Debt endpoints (US only).

GET /api/debt/series              – Gross Federal Debt (% of GDP) + Gross
                                     Federal Debt ($B), annual, with YoY% arrays
GET /api/debt/market-correlation  – Federal Debt YoY vs. S&P 500 YoY (+ Real
                                     GDP YoY), plus rolling 10-year correlation
                                     (Debt-vs-S&P500, Debt-vs-GDP), annual cadence
"""

import logging

import pandas as pd
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.services.fred import FredClient
from app.services.macro_cache import get_series
from app.routers.gdp import _get_sp500_history

router = APIRouter(prefix="/api/debt", tags=["debt"])
log = logging.getLogger(__name__)
fred = FredClient(api_key=settings.FRED_API_KEY)

DEBT_SERIES = {
    "GFDGDPA188S": {"label": "Gross Federal Debt (% of GDP)", "color": "#3b82f6", "unit": "% of GDP"},
    "FYGFD":       {"label": "Gross Federal Debt ($B)",       "color": "#3b82f6", "unit": "Billions of USD"},
}

CORR_WINDOW_YEARS = 10   # both series are annual here, unlike GDP's quarterly cadence


def _pct_change(values: list[float | None], periods: int) -> list[float | None]:
    """Period-over-period % change. Output length = len(values) - periods."""
    result = []
    for i in range(periods, len(values)):
        curr, prev = values[i], values[i - periods]
        if curr is None or prev is None or prev == 0:
            result.append(None)
        else:
            result.append(round((curr - prev) / prev * 100, 4))
    return result


@router.get("/series")
async def get_debt_series(db: Session = Depends(get_db)):
    """Both debt series, annual, with pre-computed YoY% (1-year) arrays."""
    result: dict = {}
    for sid, meta in DEBT_SERIES.items():
        try:
            data = await get_series(db, fred, sid, ttl_hours=24 * 24)
            result[sid] = {
                **meta,
                "dates":  data["dates"],
                "values": data["values"],
                "yoy_dates": data["dates"][1:],
                "yoy":       _pct_change(data["values"], 1),
            }
        except Exception as exc:
            log.warning("debt series: failed to fetch %s: %s", sid, exc)

    return {"series": result}


def _year_series(dates: list[str], values: list[float | None]) -> pd.Series:
    return pd.Series(values, index=[pd.Timestamp(d).year for d in dates])


@router.get("/market-correlation")
async def get_debt_market_correlation(db: Session = Depends(get_db)):
    """
    Gross Federal Debt (FYGFD) YoY vs. S&P 500 YoY and Real GDP YoY, aligned
    by calendar year (FYGFD's fiscal year ends Sept 30, which falls in the
    same year as GDPC1's Q3 [dated YYYY-07-01] and the S&P's September level
    — so year-number alignment avoids the exact-date-string pitfalls found
    with GDP's quarterly alignment). Rolling 10-year (annual) correlation,
    no lag variants (annual cadence makes multi-period lag not meaningful).
    """
    fygfd_data = await get_series(db, fred, "FYGFD", ttl_hours=24 * 24)
    gdpc1_data = await get_series(db, fred, "GDPC1", ttl_hours=24 * 32)
    sp500_data = await _get_sp500_history(db)

    debt_by_year = _year_series(fygfd_data["dates"], fygfd_data["values"])

    gdp_q3 = [(d, v) for d, v in zip(gdpc1_data["dates"], gdpc1_data["values"]) if pd.Timestamp(d).month == 7]
    gdp_by_year = _year_series([d for d, _ in gdp_q3], [v for _, v in gdp_q3])

    sp_sept = [(d, v) for d, v in zip(sp500_data["dates"], sp500_data["values"]) if pd.Timestamp(d).month == 9]
    sp_by_year = _year_series([d for d, _ in sp_sept], [v for _, v in sp_sept])

    df = pd.DataFrame({"debt": debt_by_year, "gdp": gdp_by_year, "sp500": sp_by_year}).sort_index()
    df = df[df["debt"].notna()]   # debt's own history defines the year axis

    debt_yoy = (df["debt"].pct_change() * 100).round(4)
    gdp_yoy  = (df["gdp"].pct_change() * 100).round(4)
    sp_yoy   = (df["sp500"].pct_change() * 100).round(4)

    years = [int(y) for y in df.index[1:]]
    debt_yoy, gdp_yoy, sp_yoy = debt_yoy.iloc[1:], gdp_yoy.iloc[1:], sp_yoy.iloc[1:]

    corr_debt_sp500 = debt_yoy.rolling(CORR_WINDOW_YEARS).corr(sp_yoy)
    corr_debt_gdp   = debt_yoy.rolling(CORR_WINDOW_YEARS).corr(gdp_yoy)

    def _clean(s: pd.Series) -> list[float | None]:
        return [None if pd.isna(v) else round(float(v), 4) for v in s]

    return {
        "years":        years,
        "debt_yoy":     _clean(debt_yoy),
        "gdp_yoy":      _clean(gdp_yoy),
        "sp500_yoy":    _clean(sp_yoy),
        "correlation":  {"debt_sp500": _clean(corr_debt_sp500), "debt_gdp": _clean(corr_debt_gdp)},
        "window_years": CORR_WINDOW_YEARS,
    }
