"""
Background scheduler — runs once on app startup.

Jobs:
  07:00  Scrape University of Michigan (ICC / ICE / ICS)
  07:05  Refresh FRED series (UMCSENT, ...)
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
from app.core.config import settings

log = logging.getLogger(__name__)

# Add series IDs here to include them in the daily FRED refresh
FRED_SERIES = ["UMCSENT"]


async def _job_uom():
    db = SessionLocal()
    try:
        result = await scrape_and_upsert(db)
        log.info("UoM daily scrape OK: period=%s", result["period"])
    except Exception as exc:
        log.warning("UoM daily scrape failed: %s", exc)
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


def create_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler()
    scheduler.add_job(_job_uom,  CronTrigger(hour=7, minute=0), id="uom_daily")
    scheduler.add_job(_job_fred, CronTrigger(hour=7, minute=5), id="fred_daily")
    return scheduler
