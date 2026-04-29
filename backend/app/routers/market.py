import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from sqlalchemy import func
from app.models.market_data import MarketRegimeRow
from app.services.market_regime import (
    get_regime_from_db, seed_market_data, update_market_data, compare_regime_weights
)


class WeightConfig(BaseModel):
    bmsb:    float
    breadth: float
    vix:     float
    credit:  float


class RegimeCompareRequest(BaseModel):
    config_a: WeightConfig
    config_b: WeightConfig

log = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/market/regime")
def market_regime(db: Session = Depends(get_db)):
    try:
        result = get_regime_from_db(db)
        if not result["dates"]:
            # First ever request — seed synchronously (one-time ~30s wait)
            log.info("market_regime table empty — seeding now…")
            seed_market_data(db)
            result = get_regime_from_db(db)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=repr(e))


@router.get("/api/market/regime/status")
def market_regime_status(db: Session = Depends(get_db)):
    """Latest date, earliest date, and row count for the admin page."""
    count   = db.query(func.count(MarketRegimeRow.date)).scalar() or 0
    latest  = db.query(func.max(MarketRegimeRow.date)).scalar()
    earliest= db.query(func.min(MarketRegimeRow.date)).scalar()
    return {
        "count":         count,
        "latest_date":   latest.isoformat()   if latest   else None,
        "earliest_date": earliest.isoformat() if earliest else None,
        "interval":      "daily",
    }


@router.post("/api/market/regime/refresh")
def market_regime_refresh(db: Session = Depends(get_db)):
    """Incremental update — downloads any new daily bars since last stored date."""
    try:
        update_market_data(db)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=repr(e))


@router.post("/api/market/regime/seed")
def market_regime_seed(db: Session = Depends(get_db)):
    """Full reseed from 1998 — clears existing data and re-downloads everything."""
    try:
        seed_market_data(db)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=repr(e))


@router.post("/api/market/regime/compare")
def regime_compare(req: RegimeCompareRequest, db: Session = Depends(get_db)):
    """Re-apply two weight configs to stored component scores and return regime stats."""
    try:
        result = compare_regime_weights(db, req.config_a.model_dump(), req.config_b.model_dump())
        if not result:
            raise HTTPException(status_code=404, detail="No regime data in DB — run a seed first.")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=repr(e))
