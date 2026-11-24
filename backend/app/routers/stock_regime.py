"""Single-stock regime endpoint — public, computed on request (app.services.stock_regime)."""
import re

from fastapi import APIRouter, HTTPException

from app.services.stock_regime import NotAStockError, get_stock_regime

router = APIRouter(prefix="/api/stocks", tags=["stock-regime"])

TICKER_RE = re.compile(r"^[A-Za-z0-9.\-]{1,12}$")


@router.get("/{ticker}/regime")
def stock_regime(ticker: str):
    if not TICKER_RE.match(ticker):
        raise HTTPException(status_code=400, detail="Invalid ticker")
    try:
        result = get_stock_regime(ticker)
    except NotAStockError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if result is None:
        raise HTTPException(status_code=404, detail=f"No price history for {ticker.upper()}")
    return result
