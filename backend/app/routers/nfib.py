"""
NFIB Small Business Confidence API.

GET  /api/nfib/components                        – all component series from cache
POST /api/nfib/refresh                           – force re-fetch components from NFIB
GET  /api/nfib/industries                        – OPT_INDEX by industry from cache
GET  /api/nfib/industries/{id}/components        – component nets for one industry (cache + fallback)
POST /api/nfib/refresh-industries                – force re-fetch industry index + component cache
GET  /api/nfib/regions                           – OPT_INDEX by Census region from cache
GET  /api/nfib/regions/{id}/components           – component nets for one region (cache + fallback)
POST /api/nfib/refresh-regions                   – force re-fetch region index + component cache
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.macro_cache import MacroCache
from app.services.nfib import (
    COMPONENTS, INDUSTRIES, REGIONS,
    refresh_all_components, refresh_all_industries, refresh_all_regions,
    get_industry_components, get_region_components,
)

router = APIRouter(prefix="/api/nfib", tags=["nfib"])
log = logging.getLogger(__name__)


@router.get("/status")
def get_status(db: Session = Depends(get_db)):
    """Return cache status for the main NFIB Optimism Index without triggering a fetch."""
    row = db.get(MacroCache, "NFIB_OPT_INDEX")
    if row and row.dates:
        return {
            "count":        len(row.dates),
            "latest_date":  row.dates[-1],
            "latest_value": row.values[-1],
            "fetched_at":   row.fetched_at.isoformat(),
        }
    return {"count": 0}


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
    """Force re-fetch OPT_INDEX and components for all 8 industries."""
    try:
        summary = await refresh_all_industries(db)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"NFIB industry refresh failed: {exc}")
    return {"refreshed": summary}


@router.get("/regions")
def get_regions(db: Session = Depends(get_db)):
    """Return OPT_INDEX by Census region from cache."""
    result = {}
    for series_id, meta in REGIONS.items():
        row = db.get(MacroCache, series_id)
        if row and row.dates:
            result[series_id] = {
                "dates":  row.dates,
                "values": row.values,
                "label":  meta["label"],
                "color":  meta["color"],
            }
    return {"series": result}


@router.get("/regions/{series_id}/components")
async def get_region_components_endpoint(series_id: str, db: Session = Depends(get_db)):
    """Return all 10 component nets for a single region. Served from cache; fetches live on miss."""
    if series_id not in REGIONS:
        raise HTTPException(status_code=404, detail=f"Unknown region series: {series_id}")
    try:
        data = await get_region_components(db, series_id)
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
    return {"series": result, "region": REGIONS[series_id]["label"]}


@router.post("/refresh-regions")
async def refresh_regions(db: Session = Depends(get_db)):
    """Force re-fetch OPT_INDEX and components for all 4 Census regions."""
    try:
        summary = await refresh_all_regions(db)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"NFIB region refresh failed: {exc}")
    return {"refreshed": summary}
