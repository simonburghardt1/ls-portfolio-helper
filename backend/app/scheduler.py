"""
Background scheduler — runs once on app startup.

Jobs:
  07:00  Scrape University of Michigan (ICS / ICC / ICE)
  07:05  Refresh FRED series (UMCSENT, PERMIT, HOUST, COMPUTSA)
  07:10  Refresh NFIB component series
  07:20  Refresh NFIB OPT_INDEX + components by industry
  07:30  Refresh NFIB OPT_INDEX + components by Census region
  22:00  Market Regime daily update (after US market close 16:00 ET = 20:00 UTC + buffer)
"""

import logging
from datetime import datetime, timezone, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.db.session import SessionLocal
from app.models.macro_cache import MacroCache
from app.services.uom_scraper import scrape_and_upsert
from app.services.fred import FredClient
from app.services.macro_cache import get_series
from app.services.nfib import refresh_all_components, refresh_all_industries, refresh_all_regions
from app.services.market_regime import update_market_data
from app.core.config import settings

log = logging.getLogger(__name__)

# Add series IDs here to include them in the daily FRED refresh
FRED_SERIES = ["UMCSENT", "PERMIT", "HOUST", "COMPUTSA"]


async def _job_uom():
    db = SessionLocal()
    try:
        result = await scrape_and_upsert(db)
        log.info("UoM daily scrape OK: period=%s", result["period"])
    except Exception as exc:
        log.warning("UoM daily scrape failed: %s", exc)
    finally:
        db.close()


async def _job_nfib():
    db = SessionLocal()
    try:
        summary = await refresh_all_components(db)
        log.info("NFIB daily refresh OK: %s", summary)
    except Exception as exc:
        log.warning("NFIB daily refresh failed: %s", exc)
    finally:
        db.close()


async def _job_nfib_industries():
    db = SessionLocal()
    try:
        summary = await refresh_all_industries(db)
        log.info("NFIB industry daily refresh OK: %s", summary)
    except Exception as exc:
        log.warning("NFIB industry daily refresh failed: %s", exc)
    finally:
        db.close()


async def _job_nfib_regions():
    db = SessionLocal()
    try:
        summary = await refresh_all_regions(db)
        log.info("NFIB region daily refresh OK: %s", summary)
    except Exception as exc:
        log.warning("NFIB region daily refresh failed: %s", exc)
    finally:
        db.close()


async def _job_fred():
    db = SessionLocal()
    fred = FredClient(api_key=settings.FRED_API_KEY)
    try:
        for series_id in FRED_SERIES:
            try:
                # Expire cache so get_series fetches from FRED unconditionally
                row = db.get(MacroCache, series_id)
                if row:
                    row.fetched_at = datetime.now(timezone.utc) - timedelta(hours=25)
                    db.commit()
                await get_series(db, fred, series_id)
                log.info("FRED daily refresh OK: %s", series_id)
            except Exception as exc:
                log.warning("FRED daily refresh failed for %s: %s", series_id, exc)
    finally:
        db.close()


async def _job_market_regime():
    db = SessionLocal()
    try:
        update_market_data(db)
        log.info("Market regime daily update OK.")
    except Exception as exc:
        log.warning("Market regime daily update failed: %s", exc)
    finally:
        db.close()


def create_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler()
    scheduler.add_job(_job_uom,  CronTrigger(hour=7, minute=0),  id="uom_daily")
    scheduler.add_job(_job_fred, CronTrigger(hour=7, minute=5),  id="fred_daily")
    scheduler.add_job(_job_nfib,            CronTrigger(hour=7, minute=10), id="nfib_daily")
    scheduler.add_job(_job_nfib_industries, CronTrigger(hour=7, minute=20), id="nfib_industries_daily")
    scheduler.add_job(_job_nfib_regions,    CronTrigger(hour=7, minute=30), id="nfib_regions_daily")
    scheduler.add_job(_job_market_regime,   CronTrigger(hour=22, minute=0), id="market_regime_daily")
    return scheduler
