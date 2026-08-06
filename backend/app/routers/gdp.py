"""
GDP endpoints (US only for now — region selector on the frontend is a
placeholder for other regions to be wired up later).

GET /api/gdp/series              – Nominal GDP + Real GDP, with YoY% arrays
GET /api/gdp/market-correlation  – Real GDP YoY vs. S&P 500 YoY, plus rolling
                                    10Y correlation at 0-4 quarter lags
"""

import logging
import re
from datetime import datetime, timezone, timedelta

import httpx
import pandas as pd
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.macro_cache import MacroCache
from app.services.fred import FredClient
from app.services.macro_cache import get_series

router = APIRouter(prefix="/api/gdp", tags=["gdp"])
log = logging.getLogger(__name__)
fred = FredClient(api_key=settings.FRED_API_KEY)

GDP_SERIES = {
    "GDP":   {"label": "Nominal GDP", "color": "#3b82f6"},
    "GDPC1": {"label": "Real GDP",    "color": "#10b981"},
}

# Real (not period-average) monthly S&P 500 index levels, back to 1871 — from
# multpl.com's public table (sourced from Robert Shiller's dataset). Used
# instead of FRED (whose own "SP500" series only starts 2016-08, and whose
# OECD-sourced "SPASTT01USQ661N" is a quarterly *average*, not a point-in-time
# level, which distorts lag/lead correlation timing).
SP500_HISTORY_CACHE_KEY = "SP500_MULTPL_MONTHLY"
SP500_HISTORY_URL = "https://www.multpl.com/s-p-500-historical-prices/table/by-month"
SP500_HISTORY_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
}

CORR_WINDOW_QUARTERS = 40   # 10 years of quarterly data
LAGS = [0, 1, 2, 3, 4]      # quarters the S&P side is shifted back before correlating


async def _scrape_sp500_history() -> dict:
    """Monthly S&P 500 index levels (real, point-in-time), oldest first."""
    async with httpx.AsyncClient(headers=SP500_HISTORY_HEADERS, timeout=30, follow_redirects=True) as client:
        resp = await client.get(SP500_HISTORY_URL)
        resp.raise_for_status()

    rows = re.findall(r"<tr[^>]*>.*?</tr>", resp.text, re.S)
    parsed: list[tuple[str, float]] = []
    for row in rows:
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        if len(cells) != 2:
            continue
        date_txt = re.sub(r"<[^>]+>", "", cells[0]).strip()
        val_txt = re.sub(r"<[^>]+>", "", cells[1])
        val_txt = re.sub(r"&#x2002;|,|\s", "", val_txt)
        try:
            date = datetime.strptime(date_txt, "%b %d, %Y")
            value = float(val_txt)
        except (ValueError, TypeError):
            continue
        parsed.append((date.strftime("%Y-%m-%d"), value))

    parsed.sort(key=lambda p: p[0])
    return {"dates": [p[0] for p in parsed], "values": [p[1] for p in parsed]}


async def _get_sp500_history(db: Session) -> dict:
    """Cached wrapper around _scrape_sp500_history, reusing the generic MacroCache table."""
    cached: MacroCache | None = db.get(MacroCache, SP500_HISTORY_CACHE_KEY)
    if cached:
        age = datetime.now(timezone.utc) - cached.fetched_at.replace(tzinfo=timezone.utc)
        if age < timedelta(hours=24 * 7):
            return {"dates": cached.dates, "values": cached.values}

    payload = await _scrape_sp500_history()
    if not payload["dates"]:
        if cached:
            return {"dates": cached.dates, "values": cached.values}
        raise RuntimeError("Failed to scrape S&P 500 history and no cache available.")

    if cached:
        cached.dates = payload["dates"]
        cached.values = payload["values"]
        cached.fetched_at = datetime.now(timezone.utc)
    else:
        db.add(MacroCache(series_id=SP500_HISTORY_CACHE_KEY, dates=payload["dates"], values=payload["values"]))
    db.commit()
    return payload


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
async def get_gdp_series(db: Session = Depends(get_db)):
    """Nominal + Real GDP, quarterly, with pre-computed YoY% (4-quarter) arrays."""
    result: dict = {}
    for sid, meta in GDP_SERIES.items():
        try:
            data = await get_series(db, fred, sid, ttl_hours=24 * 32)
            dates:  list[str] = data["dates"]
            values: list[float | None] = data["values"]
            yoy = _pct_change(values, 4)

            result[sid] = {
                **meta,
                "dates":  dates,
                "values": values,
                "yoy_dates": dates[4:],
                "yoy":       yoy,
            }
        except Exception as exc:
            log.warning("gdp series: failed to fetch %s: %s", sid, exc)

    return {"series": result}


@router.get("/market-correlation")
async def get_market_correlation(db: Session = Depends(get_db)):
    """
    Real GDP YoY vs. S&P 500 YoY, plus rolling 10-year correlation at lag 0-4
    quarters (lag N = S&P YoY from N quarters earlier vs. current-quarter GDP
    YoY — tests whether the market leads GDP).
    """
    gdp_data   = await get_series(db, fred, "GDPC1", ttl_hours=24 * 32)
    sp500_data = await _get_sp500_history(db)

    gdp_s = pd.Series(gdp_data["values"], index=pd.to_datetime(gdp_data["dates"]))

    # S&P history is monthly; use the *last* month of each quarter (quarter-end
    # level), then relabel it onto GDP's quarter-*start* dating convention (e.g.
    # GDP's "2026-04-01" = Q2 2026 <-> S&P's June-2026 quarter-end level).
    sp500_monthly = pd.Series(sp500_data["values"], index=pd.to_datetime(sp500_data["dates"]))
    sp500_qend = sp500_monthly[sp500_monthly.index.month.isin([3, 6, 9, 12])]
    sp500_s = sp500_qend.copy()
    sp500_s.index = sp500_s.index - pd.DateOffset(months=2)

    # GDP's release dates define the quarterly date axis; S&P is NaN wherever
    # its own history doesn't reach back as far as GDP's.
    df = pd.DataFrame({"gdp": gdp_s, "sp500": sp500_s}).sort_index()
    df = df[df["gdp"].notna()]

    dates        = [d.strftime("%Y-%m-%d") for d in df.index]
    gdp_values   = [None if pd.isna(v) else float(v) for v in df["gdp"]]
    sp500_values = [None if pd.isna(v) else float(v) for v in df["sp500"]]

    gdp_yoy   = _pct_change(gdp_values, 4)
    sp500_yoy = _pct_change(sp500_values, 4)
    yoy_dates = dates[4:]   # both trimmed identically by _pct_change(periods=4)

    corr_df = pd.DataFrame({"gdp_yoy": gdp_yoy, "sp500_yoy": sp500_yoy}, index=yoy_dates)

    # lag N = S&P YoY from N quarters earlier vs. the current quarter's GDP YoY
    # (S&P leads, GDP lags — the market is a leading indicator of the economy)
    correlation: dict[str, list[float | None]] = {}
    for lag in LAGS:
        shifted_sp500 = corr_df["sp500_yoy"].shift(lag)
        roll = corr_df["gdp_yoy"].rolling(CORR_WINDOW_QUARTERS).corr(shifted_sp500)
        correlation[f"lag{lag}"] = [None if pd.isna(v) else round(float(v), 4) for v in roll]

    return {
        "dates":           yoy_dates,
        "gdp_yoy":         gdp_yoy,
        "sp500_yoy":       sp500_yoy,
        "correlation":     correlation,
        "window_quarters": CORR_WINDOW_QUARTERS,
    }
