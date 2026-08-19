"""
Basket CRUD endpoints (FR-1, FR-2). Router dispatches only — business logic lives
in app.services.basket, persistence in app.repositories.basket (AD-1).
"""
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.services.auth import get_current_user
from app.services.basket import BasketValidationError
from app.services import basket as basket_service

router = APIRouter(prefix="/api/baskets", tags=["baskets"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class BasketCreate(BaseModel):
    name: str
    tickers: list[str]
    # 5-20 count and duplicate checks are enforced by services.basket.create_basket
    # (BasketValidationError -> typed 400, AD-12) rather than a Pydantic Field bound
    # here — a Field violation would short-circuit to FastAPI's automatic 422 before
    # reaching that check, which AC #3 disallows.
    weighting_method: Literal["equal", "market_cap"]


class BasketOut(BaseModel):
    id: int
    name: str
    user_id: int | None
    weighting_method: str
    created_at: datetime
    latest_nav: float | None
    nav_change_pct: float | None
    tickers: list[str]


class HoldingOut(BaseModel):
    ticker: str
    weight: float
    prices: list[float]


class BasketSeriesOut(BaseModel):
    dates: list[str]
    index_level: list[float]
    holdings: list[HoldingOut]


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("", response_model=list[BasketOut])
def list_baskets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return basket_service.list_baskets(db, user_id=current_user.id)


@router.get("/{basket_id}", response_model=BasketOut)
def get_basket(
    basket_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    detail = basket_service.get_basket_detail(db, basket_id, user_id=current_user.id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Basket not found.")
    return detail


@router.get("/{basket_id}/series", response_model=BasketSeriesOut)
def get_basket_series(
    basket_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    series = basket_service.get_basket_series(db, basket_id, user_id=current_user.id)
    if series is None:
        raise HTTPException(status_code=404, detail="Basket not found.")
    return series


@router.post("", response_model=BasketOut, status_code=201)
def create_basket(
    payload: BasketCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tickers = [t.strip().upper() for t in payload.tickers]
    try:
        basket = basket_service.create_basket(
            db,
            name=payload.name,
            user_id=current_user.id,
            tickers=tickers,
            weighting_method=payload.weighting_method,
        )
    except BasketValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return BasketOut(
        id=basket.id,
        name=basket.name,
        user_id=basket.user_id,
        weighting_method=basket.weighting_method,
        created_at=basket.created_at,
        latest_nav=100.0,
        nav_change_pct=None,
        tickers=tickers,
    )


@router.put("/{basket_id}", response_model=BasketOut)
def update_basket(
    basket_id: int,
    payload: BasketCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Edits a Basket's name/tickers/weighting. Per AD-8, the new weight-set takes effect the
    next trading day — it never touches BasketNav or rewrites an already-effective weight-set.
    """
    tickers = [t.strip().upper() for t in payload.tickers]
    try:
        basket = basket_service.update_basket(
            db,
            basket_id=basket_id,
            user_id=current_user.id,
            name=payload.name,
            tickers=tickers,
            weighting_method=payload.weighting_method,
        )
    except BasketValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if basket is None:
        raise HTTPException(status_code=404, detail="Basket not found.")

    detail = basket_service.get_basket_detail(db, basket_id, user_id=current_user.id)
    return detail
