"""
Rolling beta endpoint (Story 2.3). Router dispatches only — business logic lives
in app.services.beta (AD-1).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.services.auth import get_current_user
from app.services.asset_price_provider import ASSET_TYPES
from app.services.beta import compute_beta_series

router = APIRouter(prefix="/api/beta", tags=["beta"])


class BetaWindowOut(BaseModel):
    dates: list[str]
    values: list[float | None]


class BetaOut(BaseModel):
    windows: dict[str, BetaWindowOut]
    current: dict[str, float | None]


@router.get("", response_model=BetaOut)
def get_beta(
    asset_type: str,
    asset_id: str,
    benchmark_type: str,
    benchmark_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if asset_type not in ASSET_TYPES or benchmark_type not in ASSET_TYPES:
        raise HTTPException(status_code=400, detail=f"asset_type must be one of {ASSET_TYPES}")
    return compute_beta_series(db, asset_type, asset_id, benchmark_type, benchmark_id)
