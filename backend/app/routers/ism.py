"""
ISM Manufacturing API endpoints.

POST /api/ism/manufacturing/load       – scrape & persist historical data
GET  /api/ism/manufacturing/series     – component time-series
GET  /api/ism/manufacturing/rankings   – industry scores per component
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.ism import IsmMfgReport, IsmMfgIndustryRank
from app.services.ism_scraper import (
    discover_report_urls,
    scrape_report,
    ALL_COMPONENTS,
    COMPONENT_LABELS,
)

router = APIRouter(prefix="/api/ism/manufacturing", tags=["ism"])
log = logging.getLogger(__name__)


# ── Load / scrape ──────────────────────────────────────────────────────────────

class UrlsPayload(BaseModel):
    urls: List[str]


@router.post("/load-urls")
async def load_from_urls(payload: UrlsPayload, db: Session = Depends(get_db)):
    """
    Scrape a list of PRNewswire URLs provided by the user.
    Returns per-URL results synchronously (so the UI gets feedback).
    """
    results = []
    for url in payload.urls:
        url = url.strip()
        if not url:
            continue
        try:
            data = await scrape_report(url)
            if data is None:
                results.append({"url": url, "status": "failed", "reason": "parse error"})
                continue
            _upsert_report(db, data)
            results.append({
                "url": url,
                "status": "ok",
                "date": data["date"].isoformat(),
                "components_found": len(data["components"]),
                "components": data["components"],
                "rankings_components": len(data["industry_rankings"]),
            })
        except Exception as exc:
            results.append({"url": url, "status": "failed", "reason": str(exc)})

    db.commit()
    ok = sum(1 for r in results if r["status"] == "ok")
    return {"saved": ok, "total": len(results), "results": results}


@router.post("/load")
async def load_historical(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Legacy: auto-discover URLs (limited — use load-urls instead)."""
    background_tasks.add_task(_scrape_and_persist, db)
    return {"status": "started", "message": "Scraping running in background"}


async def _scrape_and_persist(db: Session):
    log.info("ISM scrape started")
    urls = await discover_report_urls(max_pages=15)
    log.info("Found %d URLs", len(urls))

    saved = 0
    for url in urls:
        try:
            data = await scrape_report(url)
            if data is None:
                continue
            _upsert_report(db, data)
            saved += 1
            await asyncio.sleep(0.5)   # polite rate limiting
        except Exception as exc:
            log.warning("Failed to process %s: %s", url, exc)

    db.commit()
    log.info("ISM scrape done. Saved/updated %d reports.", saved)


def _upsert_report(db: Session, data: dict):
    report_date = data["date"]

    # Upsert main report row
    existing = db.get(IsmMfgReport, report_date)
    if existing is None:
        existing = IsmMfgReport(date=report_date)
        db.add(existing)

    for col, val in data["components"].items():
        setattr(existing, col, val)

    existing.source_url = data["source_url"]
    existing.scraped_at = datetime.now(timezone.utc)

    # Flush so the report row exists in DB before FK-constrained rankings are inserted
    db.flush()

    # Delete old rankings for this date (full replace)
    db.query(IsmMfgIndustryRank).filter(IsmMfgIndustryRank.date == report_date).delete()

    # Insert new rankings
    for component, entries in data["industry_rankings"].items():
        for entry in entries:
            db.add(IsmMfgIndustryRank(
                date=report_date,
                component=component,
                industry=entry["industry"],
                score=entry["score"],
            ))


# ── Series endpoint ────────────────────────────────────────────────────────────

@router.get("/series")
def get_series(db: Session = Depends(get_db)):
    """
    Returns time-series data for all 11 components.
    Shape: { component_col: { dates: [...], values: [...] }, labels: {...} }
    """
    rows = db.execute(
        select(IsmMfgReport).order_by(IsmMfgReport.date)
    ).scalars().all()

    if not rows:
        return {"series": {}, "labels": COMPONENT_LABELS}

    series: dict[str, dict] = {col: {"dates": [], "values": []} for col in ALL_COMPONENTS}

    for row in rows:
        date_str = row.date.strftime("%Y-%m-%d")
        for col in ALL_COMPONENTS:
            val = getattr(row, col)
            if val is not None:
                series[col]["dates"].append(date_str)
                series[col]["values"].append(val)

    return {"series": series, "labels": COMPONENT_LABELS}


# ── Rankings endpoint ──────────────────────────────────────────────────────────

@router.get("/rankings")
def get_rankings(
    component: str = "new_orders",
    db: Session = Depends(get_db),
):
    """
    Returns industry ranking scores for a given component over time.
    Shape: {
      dates: ["2026-02-01", ...],
      industries: ["Printing & Related Support Activities", ...],
      scores: { industry: [score_per_date, ...] }
    }
    """
    if component not in ALL_COMPONENTS:
        raise HTTPException(status_code=400, detail=f"Unknown component: {component}")

    rows = db.execute(
        select(IsmMfgIndustryRank)
        .where(IsmMfgIndustryRank.component == component)
        .order_by(IsmMfgIndustryRank.date, IsmMfgIndustryRank.score.desc())
    ).scalars().all()

    if not rows:
        return {"dates": [], "industries": [], "scores": {}}

    # Collect all unique dates and industries
    all_dates = sorted({r.date for r in rows})
    all_industries = sorted({r.industry for r in rows})

    # Build lookup: (date, industry) → score
    lookup = {(r.date, r.industry): r.score for r in rows}

    dates_str = [d.strftime("%Y-%m-%d") for d in all_dates]

    scores = {
        ind: [lookup.get((d, ind), 0) for d in all_dates]
        for ind in all_industries
    }

    return {
        "dates":      dates_str,
        "industries": all_industries,
        "scores":     scores,
        "component":  component,
        "label":      COMPONENT_LABELS.get(component, component),
    }


@router.get("/status")
def get_status(db: Session = Depends(get_db)):
    """Returns how many reports are in the DB and the date range."""
    count = db.query(IsmMfgReport).count()
    if count == 0:
        return {"count": 0, "earliest": None, "latest": None}

    earliest = db.query(IsmMfgReport).order_by(IsmMfgReport.date.asc()).first()
    latest   = db.query(IsmMfgReport).order_by(IsmMfgReport.date.desc()).first()

    return {
        "count":    count,
        "earliest": earliest.date.isoformat(),
        "latest":   latest.date.isoformat(),
    }
