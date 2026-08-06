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
import yfinance as yf
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

GDP_SERIES_META = {
    "nominal": {"label": "Nominal GDP", "color": "#3b82f6"},
    "real":    {"label": "Real GDP",    "color": "#10b981"},
}

# US only has live FRED data; UK/DE/JP are fully wired (nominal+real GDP,
# real point-in-time market proxy); EU ships real-GDP-only (its quarterly
# nominal series was discontinued by the OECD ~2022/2023); China has no
# live quarterly GDP series on FRED at all and stays out of this registry
# (the frontend keeps it disabled in the region dropdown).
REGIONS: dict[str, dict] = {
    "US": {
        "label": "United States", "unit": "Billions of USD",
        "gdp": {"nominal": "GDP", "real": "GDPC1"},
        "market": {"type": "multpl", "name": "S&P 500"},
    },
    "UK": {
        "label": "United Kingdom", "unit": "Millions of GBP",
        "gdp": {"nominal": "NGDPSAXDCGBQ", "real": "NGDPRSAXDCGBQ"},
        "market": {"type": "yfinance", "ticker": "^FTSE", "cache_key": "FTSE_YFINANCE_MONTHLY", "name": "FTSE 100"},
    },
    "DE": {
        "label": "Germany", "unit": "Millions of EUR",
        "gdp": {"nominal": "NGDPSAXDCDEQ", "real": "NGDPRSAXDCDEQ"},
        "market": {"type": "yfinance", "ticker": "^GDAXI", "cache_key": "GDAXI_YFINANCE_MONTHLY", "name": "DAX"},
    },
    "JP": {
        "label": "Japan", "unit": "Millions of JPY",
        "gdp": {"nominal": "NGDPSAXDCJPQ", "real": "NGDPRSAXDCJPQ"},
        "market": {"type": "fred-daily", "series_id": "NIKKEI225", "name": "Nikkei 225"},
    },
    "EU": {
        "label": "EU Region", "unit": "Millions of EUR (chain-linked, 2010 prices)",
        "gdp": {"nominal": None, "real": "CLV10MNACB1GQSCAEA20Q"},
        "market": {"type": "yfinance", "ticker": "^STOXX50E", "cache_key": "STOXX50E_YFINANCE_MONTHLY", "name": "Euro Stoxx 50"},
    },
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
async def get_gdp_series(region: str = "US", db: Session = Depends(get_db)):
    """Nominal + Real GDP, quarterly, with pre-computed YoY% (4-quarter) arrays."""
    cfg = REGIONS.get(region.upper())
    if not cfg:
        return {"series": {}, "error": f"Unknown region: {region}"}

    result: dict = {}
    for kind in ("nominal", "real"):
        sid = cfg["gdp"][kind]
        if sid is None:
            continue  # e.g. EU nominal — intentionally absent, not a fetch failure
        try:
            data = await get_series(db, fred, sid, ttl_hours=24 * 32)
            dates:  list[str] = data["dates"]
            values: list[float | None] = data["values"]

            result[kind] = {
                **GDP_SERIES_META[kind],
                "dates":  dates,
                "values": values,
                "yoy_dates": dates[4:],
                "yoy":       _pct_change(values, 4),
            }
        except Exception as exc:
            log.warning("gdp series: failed to fetch %s (%s/%s): %s", sid, region, kind, exc)

    return {"region": region.upper(), "unit": cfg["unit"], "series": result}


async def _get_market_history(db: Session, cfg: dict) -> dict:
    """Returns {'dates': [...monthly...], 'values': [...]} regardless of source type."""
    m = cfg["market"]
    if m["type"] == "multpl":
        return await _get_sp500_history(db)
    if m["type"] == "fred-daily":
        daily = await get_series(db, fred, m["series_id"], ttl_hours=24 * 7)
        return _resample_daily_to_monthly(daily)
    if m["type"] == "yfinance":
        return await _get_yfinance_monthly_history(db, m["ticker"], m["cache_key"])
    raise ValueError(f"Unknown market source type: {m['type']}")


def _resample_daily_to_monthly(data: dict) -> dict:
    s = pd.Series(data["values"], index=pd.to_datetime(data["dates"])).sort_index()
    m = s.resample("ME").last().dropna()
    return {"dates": [d.strftime("%Y-%m-%d") for d in m.index], "values": [float(v) for v in m]}


def _download_yfinance_monthly(ticker: str) -> dict:
    """Real (point-in-time) daily closes -> resampled to last-trading-day-of-month."""
    raw = yf.download(ticker, period="max", interval="1d", auto_adjust=True, progress=False)
    if raw.empty:
        return {"dates": [], "values": []}
    if isinstance(raw.columns, pd.MultiIndex):
        close = raw["Close"][ticker] if ticker in raw["Close"].columns else raw["Close"].iloc[:, 0]
    else:
        close = raw["Close"]
    monthly = close.dropna().resample("ME").last().dropna()
    return {
        "dates":  [d.strftime("%Y-%m-%d") for d in monthly.index],
        "values": [float(v) for v in monthly],
    }


async def _get_yfinance_monthly_history(db: Session, ticker: str, cache_key: str) -> dict:
    """Cached wrapper around _download_yfinance_monthly, same convention as _get_sp500_history."""
    cached: MacroCache | None = db.get(MacroCache, cache_key)
    if cached:
        age = datetime.now(timezone.utc) - cached.fetched_at.replace(tzinfo=timezone.utc)
        if age < timedelta(hours=24 * 7):
            return {"dates": cached.dates, "values": cached.values}

    payload = _download_yfinance_monthly(ticker)
    if not payload["dates"]:
        if cached:
            return {"dates": cached.dates, "values": cached.values}
        raise RuntimeError(f"Failed to download {ticker} from yfinance and no cache available.")

    if cached:
        cached.dates = payload["dates"]
        cached.values = payload["values"]
        cached.fetched_at = datetime.now(timezone.utc)
    else:
        db.add(MacroCache(series_id=cache_key, dates=payload["dates"], values=payload["values"]))
    db.commit()
    return payload


@router.get("/market-correlation")
async def get_market_correlation(region: str = "US", db: Session = Depends(get_db)):
    """
    Real GDP YoY vs. the region's market proxy YoY, plus rolling 10-year
    correlation at lag 0-4 quarters (lag N = market YoY from N quarters
    earlier vs. current-quarter GDP YoY — tests whether the market leads GDP).
    """
    cfg = REGIONS.get(region.upper())
    if not cfg:
        return {"error": f"Unknown region: {region}"}

    gdp_data = await get_series(db, fred, cfg["gdp"]["real"], ttl_hours=24 * 32)
    try:
        market_data = await _get_market_history(db, cfg)
    except Exception as exc:
        log.warning("market-correlation: failed to fetch market history for %s: %s", region, exc)
        return {"error": f"Market data unavailable for {region}: {exc}"}

    return {
        "region": region.upper(),
        "market_name": cfg["market"]["name"],
        **_compute_gdp_market_correlation(gdp_data, market_data),
    }


def _compute_gdp_market_correlation(gdp_data: dict, market_data: dict) -> dict:
    gdp_s = pd.Series(gdp_data["values"], index=pd.to_datetime(gdp_data["dates"]))

    # Market history is monthly; use the *last* month of each quarter (quarter-end
    # level), then relabel it onto GDP's quarter-*start* dating convention (e.g.
    # GDP's "2026-04-01" = Q2 2026 <-> market's June-2026 quarter-end level).
    sp500_monthly = pd.Series(market_data["values"], index=pd.to_datetime(market_data["dates"]))
    sp500_qend = sp500_monthly[sp500_monthly.index.month.isin([3, 6, 9, 12])]
    sp500_s = sp500_qend.copy()
    # Normalize to the 1st of the (shifted) month — market_data dates may be
    # month-*end* (e.g. yfinance/FRED-daily resampled via .resample("ME").last())
    # or already month-*start* (multpl's scrape), so day-of-month must be
    # dropped explicitly rather than assumed, or the join with GDP's
    # always-day-1 dates silently produces zero matches.
    sp500_s.index = (sp500_s.index - pd.DateOffset(months=2)).to_period("M").to_timestamp()

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
