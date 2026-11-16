"""
Seasonality endpoint (Markets section). Router dispatches only — business logic lives in
app.services.seasonality (AD-1).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.services.auth import get_optional_user
from app.services.asset_price_provider import ASSET_TYPES, ensure_asset_access
from app.services.seasonality import compute_seasonality

router = APIRouter(prefix="/api/seasonality", tags=["seasonality"])


class YearSeasonalityOut(BaseModel):
    year: int
    cycle_phase: str
    week_cum_return: list[float | None]


class MonthlyReturnRowOut(BaseModel):
    year: int
    months: list[float | None]
    total: float | None


class MonthlyReturnsOut(BaseModel):
    rows: list[MonthlyReturnRowOut]
    avg_by_month: list[float | None]


class SeasonalityOut(BaseModel):
    years: list[YearSeasonalityOut]
    monthly_returns: MonthlyReturnsOut


@router.get("", response_model=SeasonalityOut)
def get_seasonality(
    asset_type: str,
    asset_id: str,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
):
    if asset_type not in ASSET_TYPES:
        raise HTTPException(status_code=400, detail=f"asset_type must be one of {ASSET_TYPES}")
    ensure_asset_access(db, asset_type, asset_id, current_user)
    return compute_seasonality(db, asset_type, asset_id)
