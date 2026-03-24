"""
NFIB Small Business Confidence API.

GET  /api/nfib/components                        – all component series from cache
POST /api/nfib/refresh                           – force re-fetch components from NFIB
GET  /api/nfib/industries                        – OPT_INDEX by industry from cache
GET  /api/nfib/industries/{id}/components        – component nets for one industry (cache + fallback)
POST /api/nfib/refresh-industries                – force re-fetch industry index + component cache
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.macro_cache import MacroCache
from app.services.nfib import (
    COMPONENTS, INDUSTRIES,
    refresh_all_components, refresh_all_industries,
    get_industry_components,
)

router = APIRouter(prefix="/api/nfib", tags=["nfib"])
log = logging.getLogger(__name__)


@router.get("/components")
def get_components(db: Session = Depends(get_db)):
    """Return all NFIB component series from cache."""
    result = {}
    for series_id, meta in COMPONENTS.items():
        row = db.get(MacroCache, series_id)
        if row and row.dates:
            result[series_id] = {
                "dates":  row.dates,
                "values": row.values,
                "label":  meta["label"],
                "color":  meta["color"],
            }
    return {"series": result}


@router.post("/refresh")
async def refresh(db: Session = Depends(get_db)):
    """Force re-fetch all NFIB components from the NFIB API."""
    try:
        summary = await refresh_all_components(db)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"NFIB refresh failed: {exc}")
    return {"refreshed": summary}


@router.get("/industries")
def get_industries(db: Session = Depends(get_db)):
    """Return OPT_INDEX by industry from cache."""
    result = {}
    for series_id, meta in INDUSTRIES.items():
        row = db.get(MacroCache, series_id)
        if row and row.dates:
            result[series_id] = {
                "dates":  row.dates,
                "values": row.values,
                "label":  meta["label"],
                "color":  meta["color"],
            }
    return {"series": result}


@router.get("/industries/{series_id}/components")
async def get_industry_components_endpoint(series_id: str, db: Session = Depends(get_db)):
    """Return all 10 component nets for a single industry. Served from cache; fetches live on miss."""
    if series_id not in INDUSTRIES:
        raise HTTPException(status_code=404, detail=f"Unknown industry series: {series_id}")
    try:
        data = await get_industry_components(db, series_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"NFIB fetch failed: {exc}")

    result = {
        comp_id: {
            "dates":  dates,
            "values": values,
            "label":  COMPONENTS[comp_id]["label"],
            "color":  COMPONENTS[comp_id]["color"],
        }
        for comp_id, (dates, values) in data.items()
    }
    return {"series": result, "industry": INDUSTRIES[series_id]["label"]}


@router.post("/refresh-industries")
async def refresh_industries(db: Session = Depends(get_db)):
    """Force re-fetch OPT_INDEX for all 8 industries."""
    try:
        summary = await refresh_all_industries(db)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"NFIB industry refresh failed: {exc}")
    return {"refreshed": summary}
