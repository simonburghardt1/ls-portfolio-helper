"""
US Building Permits API.

GET /api/building-permits/series  – all three series from cache
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.macro_cache import MacroCache
from app.services.fred import FredClient
from app.services.macro_cache import get_series
from app.core.config import settings

router = APIRouter(prefix="/api/building-permits", tags=["building-permits"])
log = logging.getLogger(__name__)
fred = FredClient(api_key=settings.FRED_API_KEY)

SERIES_META = {
    "PERMIT":   {"label": "Building Permits",      "color": "#3b82f6"},
    "HOUST":    {"label": "Housing Starts",         "color": "#10b981"},
    "COMPUTSA": {"label": "Housing Completions",    "color": "#f59e0b"},
}


@router.get("/status")
def get_status(db: Session = Depends(get_db)):
    out = {}
    for series_id, meta in SERIES_META.items():
        row = db.get(MacroCache, series_id)
        if row and row.dates:
            out[series_id] = {
                "label":      meta["label"],
                "count":      len(row.dates),
                "latest_date":  row.dates[-1],
                "latest_value": row.values[-1],
                "fetched_at": row.fetched_at.isoformat(),
            }
        else:
            out[series_id] = {"label": meta["label"], "count": 0}
    return out


@router.post("/refresh")
async def refresh_fred(db: Session = Depends(get_db)):
    """Force re-fetch all building permit series from FRED by clearing cache."""
    for series_id in SERIES_META:
        row = db.get(MacroCache, series_id)
        if row:
            db.delete(row)
    db.commit()
    result = {}
    for series_id, meta in SERIES_META.items():
        try:
            data = await get_series(db, fred, series_id)
            result[series_id] = {
                "label":        meta["label"],
                "count":        len(data["dates"]),
                "latest_date":  data["dates"][-1]  if data["dates"]  else None,
                "latest_value": data["values"][-1] if data["values"] else None,
            }
        except Exception as exc:
            log.warning("Failed to refresh %s: %s", series_id, exc)
            result[series_id] = {"label": meta["label"], "error": str(exc)}
    return {"refreshed": result}


@router.get("/series")
async def get_all_series(db: Session = Depends(get_db)):
    result = {}
    for series_id, meta in SERIES_META.items():
        try:
            data = await get_series(db, fred, series_id)
            result[series_id] = {
                "dates":  data["dates"],
                "values": data["values"],
                **meta,
            }
        except Exception as exc:
            log.warning("Failed to fetch %s from FRED: %s", series_id, exc)
    return {"series": result}
