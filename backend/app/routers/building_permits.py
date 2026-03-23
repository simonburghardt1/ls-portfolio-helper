"""
US Building Permits API.

GET /api/building-permits/series  – all three series from cache
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
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
