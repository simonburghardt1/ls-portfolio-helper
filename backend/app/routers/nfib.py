"""
NFIB Small Business Confidence API.

GET  /api/nfib/components   – all component series from cache
POST /api/nfib/refresh      – force re-fetch from NFIB API
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.macro_cache import MacroCache
from app.services.nfib import COMPONENTS, INDUSTRIES, refresh_all_components, refresh_all_industries

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


@router.post("/refresh-industries")
async def refresh_industries(db: Session = Depends(get_db)):
    """Force re-fetch OPT_INDEX for all 8 industries."""
    try:
        summary = await refresh_all_industries(db)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"NFIB industry refresh failed: {exc}")
    return {"refreshed": summary}
