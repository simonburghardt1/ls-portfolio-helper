"""
Heatmap API — returns latest price, % change, and market cap for a watchlist.

POST /api/portfolio/heatmap — accepts a list of tickers, returns heatmap data
"""

from datetime import date

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.portfolio import fetch_heatmap_data

router = APIRouter(prefix="/api/portfolio", tags=["heatmap"])


class HeatmapRequest(BaseModel):
    tickers: list[str]
    include_sector: bool = False


@router.post("/heatmap")
def get_heatmap(req: HeatmapRequest):
    """Return price, daily % change, market cap (and optionally sector) for each ticker."""
    data = fetch_heatmap_data([t.upper() for t in req.tickers], include_sector=req.include_sector)
    return {"data": data, "as_of": date.today().isoformat()}
