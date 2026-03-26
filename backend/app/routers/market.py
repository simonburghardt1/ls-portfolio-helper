import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.market_regime import get_regime_from_db, seed_market_data, update_market_data

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


@router.post("/api/market/regime/refresh")
def market_regime_refresh(db: Session = Depends(get_db)):
    """Manual trigger for incremental update (fetches any new weekly bars)."""
    try:
        update_market_data(db)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=repr(e))
