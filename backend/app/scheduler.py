"""
Background scheduler — runs once on app startup. All times UTC. Jobs are persisted in
Postgres, so a run missed while the backend was down is caught up on the next startup
(see create_scheduler).

Jobs:
  07:00  Scrape University of Michigan (ICS / ICC / ICE)
  07:05  Refresh FRED series (UMCSENT, PERMIT, HOUST, COMPUTSA, all CPI/PPI components)
  07:10  Refresh NFIB component series
  07:20  Refresh NFIB OPT_INDEX + components by industry
  07:30  Refresh NFIB OPT_INDEX + components by Census region
  22:00  Market Regime daily update (after US market close 16:00 ET = 20:00 UTC + buffer)
  22:10  Commodity Prices daily update (WTI, Brent, Copper COMEX, Lumber, Iron Ore CME)
  22:20  Basket Regime daily update (per-Basket BMSB/Vol/Breadth/RelStrength + composite,
         persisted to basket_regime — Story 3.2/AD-4; offset after the other 22:xx jobs)

  Monthly (days 1-3 of each month, 23:00 UTC):
    High Beta Momentum basket — single-month incremental rebalance (no-ops if
    no historical baseline exists yet; run POST /api/high-beta-momentum/build first).

  Monthly (days 1-3 of each month, 16:00 UTC):
    ISM Manufacturing PMI — releases on the 1st business day of each month at 10:00 ET.

  Monthly (days 10-15 of each month, 15:00 UTC):
    CPI/PPI refresh — BLS CPI releases on the 10th–15th of each month.
"""

import logging
from datetime import datetime, timezone, timedelta

from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.db.session import SessionLocal, engine
from app.models.macro_cache import MacroCache
from app.services.uom_scraper import scrape_and_upsert
from app.services.fred import FredClient
from app.services.macro_cache import get_series
from app.services.nfib import refresh_all_components, refresh_all_industries, refresh_all_regions
from app.services.market_regime import update_market_data
from app.services.commodities import update_all_commodities
from app.services.basket_regime import compute_and_persist_all_basket_regimes
from app.services.high_beta_momentum import update_high_beta_momentum
from app.core.config import settings
from app.services.ism_scraper import scrape_latest_from_prnewswire
from app.routers.ism import _upsert_report as _ism_upsert
from app.routers.cpi_ppi import ALL_CPI_SERIES_IDS

log = logging.getLogger(__name__)

# Add series IDs here to include them in the daily FRED refresh
FRED_SERIES = [
    "UMCSENT", "PERMIT", "HOUST", "COMPUTSA",
    # CPI / PPI headline
    "CPIAUCSL", "CPILFESL", "PCEPI", "PCEPILFE", "PPIACO",
    # CPI components — kept in sync with ALL_CPI_SERIES_IDS from cpi_ppi router
    *ALL_CPI_SERIES_IDS,
    # GDP — quarterly, but the daily job is a harmless no-op via get_series' own TTL
    "GDP", "GDPC1",
]


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


async def _job_ism():
    """Scrape the latest ISM Manufacturing report from PRNewswire."""
    db = SessionLocal()
    try:
        data = await scrape_latest_from_prnewswire()
        if data is None:
            log.warning("ISM monthly scrape returned no data.")
            return
        _ism_upsert(db, data)
        db.commit()
        log.info("ISM monthly scrape OK: %s, %d components.", data["date"], len(data["components"]))
    except Exception as exc:
        log.warning("ISM monthly scrape failed: %s", exc)
    finally:
        db.close()


async def _job_fred_cpi():
    """Monthly CPI refresh — runs on days 10-15 to catch the BLS release (around the 10th-15th)."""
    db = SessionLocal()
    fred = FredClient(api_key=settings.FRED_API_KEY)
    try:
        for series_id in ALL_CPI_SERIES_IDS + ["CPIAUCSL", "CPILFESL", "PCEPI", "PCEPILFE", "PPIACO"]:
            try:
                row = db.get(MacroCache, series_id)
                if row:
                    row.fetched_at = datetime.now(timezone.utc) - timedelta(hours=25)
                    db.commit()
                await get_series(db, fred, series_id)
                log.info("CPI monthly refresh OK: %s", series_id)
            except Exception as exc:
                log.warning("CPI monthly refresh failed for %s: %s", series_id, exc)
    finally:
        db.close()


# The four evening jobs below are plain (sync) functions on purpose: their work is blocking
# (yfinance downloads, pandas), and the AsyncIOExecutor runs a non-coroutine job in a worker
# thread instead of on the event loop. As `async def` they would freeze the API for the whole
# run — which matters now that missed runs are caught up right at startup.
def _job_market_regime():
    db = SessionLocal()
    try:
        update_market_data(db)
        log.info("Market regime daily update OK.")
    except Exception as exc:
        log.warning("Market regime daily update failed: %s", exc)
    finally:
        db.close()


def _job_commodities():
    db = SessionLocal()
    try:
        update_all_commodities(db)
        log.info("Commodity prices daily update OK.")
    except Exception as exc:
        log.warning("Commodity prices daily update failed: %s", exc)
    finally:
        db.close()


def _job_basket_regime():
    db = SessionLocal()
    try:
        updated = compute_and_persist_all_basket_regimes(db)
        log.info("Basket regime daily update OK: %d baskets.", updated)
    except Exception as exc:
        log.warning("Basket regime daily update failed: %s", exc)
    finally:
        db.close()


def _job_high_beta_momentum():
    db = SessionLocal()
    try:
        update_high_beta_momentum(db)
        log.info("High Beta Momentum daily update OK.")
    except Exception as exc:
        log.warning("High Beta Momentum daily update failed: %s", exc)
    finally:
        db.close()


def _cron(**fields) -> CronTrigger:
    # Explicit UTC: a CronTrigger without a timezone silently takes the machine's local zone
    # (here CET), which put the 22:00 market job right on the US close instead of after it.
    return CronTrigger(timezone="UTC", **fields)


_JOBS = [
    (_job_uom,                 _cron(hour=7, minute=0),   "uom_daily"),
    (_job_fred,                _cron(hour=7, minute=5),   "fred_daily"),
    (_job_nfib,                _cron(hour=7, minute=10),  "nfib_daily"),
    (_job_nfib_industries,     _cron(hour=7, minute=20),  "nfib_industries_daily"),
    (_job_nfib_regions,        _cron(hour=7, minute=30),  "nfib_regions_daily"),
    (_job_market_regime,       _cron(hour=22, minute=0),  "market_regime_daily"),
    (_job_commodities,         _cron(hour=22, minute=10), "commodities_daily"),
    (_job_basket_regime,       _cron(hour=22, minute=20), "basket_regime_daily"),
    (_job_high_beta_momentum,  _cron(hour=23, minute=0),  "hbm_daily"),
    (_job_ism,                 _cron(day="1,2,3", hour=16, minute=0),             "ism_monthly"),
    (_job_fred_cpi,            _cron(day="10,11,12,13,14,15", hour=15, minute=0), "cpi_monthly"),
]


def create_scheduler() -> AsyncIOScheduler:
    """
    Jobs live in Postgres (table apscheduler_jobs, managed by APScheduler itself — excluded
    from Alembic in alembic/env.py) together with their next run time. The app doesn't run
    24/7, so with an in-memory store a job whose time passed while the backend was down was
    simply never run. Persisted, the scheduler sees on startup that the stored next run time
    lies in the past and runs the job once (coalesce: several missed runs → one run;
    misfire_grace_time=None: no matter how late — also covers the PC waking from sleep).
    """
    return AsyncIOScheduler(
        jobstores={"default": SQLAlchemyJobStore(engine=engine)},
        job_defaults={"coalesce": True, "misfire_grace_time": None, "max_instances": 1},
        timezone="UTC",
    )


def start_scheduler(scheduler: AsyncIOScheduler) -> None:
    """
    Starts paused, syncs the stored jobs with _JOBS, then resumes. A stored job is only
    replaced when its function or trigger changed in code: re-adding an unchanged job would
    reset its next run time to the future and throw away exactly the missed run we want to
    catch up on.
    """
    scheduler.start(paused=True)
    wanted_ids = set()
    for func, trigger, job_id in _JOBS:
        wanted_ids.add(job_id)
        existing = scheduler.get_job(job_id)
        if existing is not None and existing.func is func and repr(existing.trigger) == repr(trigger):
            if existing.next_run_time and existing.next_run_time <= datetime.now(timezone.utc):
                log.info("Scheduler: %s missed its run at %s — catching up now.", job_id, existing.next_run_time)
            continue
        scheduler.add_job(func, trigger, id=job_id, replace_existing=True)
    for job in scheduler.get_jobs():
        if job.id not in wanted_ids:
            job.remove()
    scheduler.resume()
