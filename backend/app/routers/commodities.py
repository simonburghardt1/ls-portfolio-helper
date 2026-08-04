"""
Commodity Prices API endpoints.

GET  /api/commodities/list     – available commodities for the dropdown
GET  /api/commodities/prices   – daily close series for one commodity
POST /api/commodities/refresh  – manual incremental refresh (admin)
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.commodities import (
    COMMODITIES,
    get_commodity_prices,
    seed_commodity,
    update_all_commodities,
)

router = APIRouter(prefix="/api/commodities", tags=["commodities"])
log = logging.getLogger(__name__)


@router.get("/list")
def list_commodities():
    return {cid: {"label": meta["label"]} for cid, meta in COMMODITIES.items()}


@router.get("/prices")
def prices(commodity: str, db: Session = Depends(get_db)):
    if commodity not in COMMODITIES:
        raise HTTPException(status_code=400, detail=f"Unknown commodity: {commodity}")
    return get_commodity_prices(db, commodity)


@router.post("/refresh")
def refresh(db: Session = Depends(get_db)):
    """Seed any commodity with no data yet, incrementally refresh the rest."""
    from app.models.market_data import MarketPrice
    from sqlalchemy import select

    saved = {}
    for cid, meta in COMMODITIES.items():
        existing = db.execute(
            select(MarketPrice.date).where(MarketPrice.ticker == meta["ticker"]).limit(1)
        ).scalar()
        if existing is None:
            saved[cid] = seed_commodity(db, cid)
        else:
            from app.services.commodities import update_commodity
            saved[cid] = update_commodity(db, cid)

    return {"status": "ok", "rows_saved": saved}
