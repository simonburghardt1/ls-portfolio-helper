"""
2-asset rolling correlation endpoint (Story 2.2). Router dispatches only — business
logic lives in app.services.correlation (AD-1).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.services.auth import get_current_user
from app.services.asset_price_provider import ASSET_TYPES
from app.services.correlation import compute_correlation

router = APIRouter(prefix="/api/correlation", tags=["correlation"])


class CorrelationOut(BaseModel):
    dates: list[str]
    windows: dict[str, list[float | None]]
    prices: dict[str, list[float]]
    current: dict[str, float | None]


@router.get("", response_model=CorrelationOut)
def get_correlation(
    type_a: str,
    id_a: str,
    type_b: str,
    id_b: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if type_a not in ASSET_TYPES or type_b not in ASSET_TYPES:
        raise HTTPException(status_code=400, detail=f"asset_type must be one of {ASSET_TYPES}")
    return compute_correlation(db, type_a, id_a, type_b, id_b)
