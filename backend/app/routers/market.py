from fastapi import APIRouter, HTTPException
from app.services.market_regime import compute_market_regime

router = APIRouter()


@router.get("/api/market/regime")
async def market_regime(start: str = "1998-01-01"):
    try:
        return compute_market_regime(start=start)
    except Exception as e:
        raise HTTPException(status_code=500, detail=repr(e))
