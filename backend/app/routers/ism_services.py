"""
ISM Services (Non-Manufacturing) API endpoints.

POST /api/ism/services/load       – scrape & persist historical data
GET  /api/ism/services/series     – component time-series
GET  /api/ism/services/rankings   – industry scores per component
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
from app.models.ism_services import IsmSvcReport, IsmSvcIndustryRank, IsmSvcComment
from app.services.ism_services_scraper import (
    discover_report_urls,
    scrape_report,
    scrape_latest_from_prnewswire,
    ALL_COMPONENTS,
    COMPONENT_LABELS,
)

router = APIRouter(prefix="/api/ism/services", tags=["ism"])
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


@router.post("/fetch-latest")
async def fetch_latest(db: Session = Depends(get_db)):
    """
    Scrape the most recent ISM Services report from PRNewswire (page 1 search).
    Returns synchronously so the admin UI gets immediate feedback.
    """
    data = await scrape_latest_from_prnewswire()
    if data is None:
        return {
            "status": "error",
            "message": "Could not find or parse the latest ISM Services report on PRNewswire.",
        }

    _upsert_report(db, data)
    db.commit()

    return {
        "status": "ok",
        "message": f"ISM Services {data['date'].strftime('%B %Y')} saved successfully.",
        "date": data["date"].isoformat(),
        "components_found": len(data["components"]),
        "components": data["components"],
    }


async def _scrape_and_persist(db: Session):
    log.info("ISM Services scrape started")
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
    log.info("ISM Services scrape done. Saved/updated %d reports.", saved)


def _upsert_report(db: Session, data: dict):
    report_date = data["date"]

    existing = db.get(IsmSvcReport, report_date)
    if existing is None:
        existing = IsmSvcReport(date=report_date)
        db.add(existing)

    for col, val in data["components"].items():
        setattr(existing, col, val)

    existing.source_url = data["source_url"]
    existing.scraped_at = datetime.now(timezone.utc)

    db.flush()

    db.query(IsmSvcIndustryRank).filter(IsmSvcIndustryRank.date == report_date).delete()

    for component, entries in data["industry_rankings"].items():
        for entry in entries:
            db.add(IsmSvcIndustryRank(
                date=report_date,
                component=component,
                industry=entry["industry"],
                score=entry["score"],
            ))

    db.query(IsmSvcComment).filter(IsmSvcComment.date == report_date).delete()
    for industry, comment_text in data.get("respondent_comments", {}).items():
        if industry and comment_text:
            db.add(IsmSvcComment(date=report_date, industry=industry, comment=comment_text))


# ── Series endpoint ────────────────────────────────────────────────────────────

@router.get("/series")
def get_series(db: Session = Depends(get_db)):
    """
    Returns time-series data for all 11 components.
    Shape: { component_col: { dates: [...], values: [...] }, labels: {...} }
    """
    rows = db.execute(
        select(IsmSvcReport).order_by(IsmSvcReport.date)
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
    """
    if component not in ALL_COMPONENTS:
        raise HTTPException(status_code=400, detail=f"Unknown component: {component}")

    rows = db.execute(
        select(IsmSvcIndustryRank)
        .where(IsmSvcIndustryRank.component == component)
        .order_by(IsmSvcIndustryRank.date, IsmSvcIndustryRank.score.desc())
    ).scalars().all()

    if not rows:
        return {"dates": [], "industries": [], "scores": {}}

    all_dates = sorted({r.date for r in rows})
    all_industries = sorted({r.industry for r in rows})

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
    count = db.query(IsmSvcReport).count()
    if count == 0:
        return {"count": 0, "earliest": None, "latest": None}

    earliest = db.query(IsmSvcReport).order_by(IsmSvcReport.date.asc()).first()
    latest   = db.query(IsmSvcReport).order_by(IsmSvcReport.date.desc()).first()

    return {
        "count":    count,
        "earliest": earliest.date.isoformat(),
        "latest":   latest.date.isoformat(),
    }


# ── Comments endpoints ─────────────────────────────────────────────────────────

@router.get("/comment-dates")
def get_comment_dates(db: Session = Depends(get_db)):
    """Returns distinct dates that have at least one respondent comment, newest first."""
    rows = (
        db.query(IsmSvcComment.date)
        .distinct()
        .order_by(IsmSvcComment.date.desc())
        .all()
    )
    return {"dates": [r.date.isoformat() for r in rows]}


@router.get("/comments")
def get_comments(date: str, component: str = "pmi", db: Session = Depends(get_db)):
    """
    Returns industry comments joined with ranking scores for a given date and component.
    """
    if component not in ALL_COMPONENTS:
        raise HTTPException(status_code=400, detail=f"Unknown component: {component}")

    from datetime import date as date_type
    try:
        report_date = date_type.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    comments = db.query(IsmSvcComment).filter(IsmSvcComment.date == report_date).all()
    rankings = (
        db.query(IsmSvcIndustryRank)
        .filter(IsmSvcIndustryRank.date == report_date, IsmSvcIndustryRank.component == component)
        .all()
    )

    score_map   = {r.industry: r.score for r in rankings}
    comment_map = {c.industry: c.comment for c in comments}

    all_industries = set(score_map) | set(comment_map)

    def sort_key(ind):
        s = score_map.get(ind, 0)
        return (0 if s != 0 else 1, -abs(s), ind)

    rows = [
        {
            "industry": ind,
            "score":    score_map.get(ind, 0),
            "comment":  comment_map.get(ind),
        }
        for ind in sorted(all_industries, key=sort_key)
    ]

    return {
        "date":      report_date.isoformat(),
        "component": component,
        "label":     COMPONENT_LABELS.get(component, component),
        "rows":      rows,
    }


@router.get("/industry-history")
def get_industry_history(industry: str, component: str = "pmi", db: Session = Depends(get_db)):
    """
    Returns month-by-month history for a specific industry: score, totals, and comment.
    """
    if component not in ALL_COMPONENTS:
        raise HTTPException(status_code=400, detail=f"Unknown component: {component}")

    all_ranks = db.query(IsmSvcIndustryRank).filter(
        IsmSvcIndustryRank.component == component
    ).all()

    from collections import defaultdict
    date_scores: dict = defaultdict(list)
    for r in all_ranks:
        date_scores[r.date].append(r.score)

    totals = {}
    for d, scores in date_scores.items():
        pos_scores = [s for s in scores if s > 0]
        neg_scores = [s for s in scores if s < 0]
        totals[d] = {
            "total_growing":     max(pos_scores) if pos_scores else 0,
            "total_contracting": abs(min(neg_scores)) if neg_scores else 0,
        }

    industry_ranks = {
        r.date: r.score
        for r in db.query(IsmSvcIndustryRank).filter(
            IsmSvcIndustryRank.component == component,
            IsmSvcIndustryRank.industry == industry,
        ).all()
    }

    industry_comments = {
        c.date: c.comment
        for c in db.query(IsmSvcComment).filter(IsmSvcComment.industry == industry).all()
    }

    all_dates = sorted(set(industry_ranks) | set(industry_comments), reverse=True)

    rows = [
        {
            "date":               d.isoformat(),
            "score":              industry_ranks.get(d, 0),
            "total_growing":      totals.get(d, {}).get("total_growing", 0),
            "total_contracting":  totals.get(d, {}).get("total_contracting", 0),
            "comment":            industry_comments.get(d),
        }
        for d in all_dates
    ]

    return {
        "industry": industry,
        "component": component,
        "label":     COMPONENT_LABELS.get(component, component),
        "rows":      rows,
    }
