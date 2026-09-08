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
from app.services import basket_regime as basket_regime_service

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
    ytd_change_pct: float | None
    nav_change_pct: float | None
    tickers: list[str]
    cagr: float | None = None
    beta_vs_spy: float | None = None
    num_holdings: int | None = None


class HoldingOut(BaseModel):
    ticker: str
    weight: float
    prices: list[float]


class BasketSeriesOut(BaseModel):
    dates: list[str]
    index_level: list[float]
    holdings: list[HoldingOut]


class BasketCompareOut(BaseModel):
    ticker: str
    dates: list[str]
    prices: list[float]


class RegimeComponentsOut(BaseModel):
    bmsb: list[float | None]
    vol: list[float | None]
    breadth: list[float | None]
    relative_strength: list[float | None]


class BasketRegimeOut(BaseModel):
    dates: list[str]
    score01: list[float | None]
    components: RegimeComponentsOut
    breadth_pct: list[float | None]
    basket_vix: float | None
    realized_vol_last: float | None
    iv_rv_ratio: float | None
    prices: list[float | None]
    ema21: list[float | None]
    sma20: list[float | None]


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


@router.get("/{basket_id}/compare", response_model=BasketCompareOut)
def get_basket_compare(
    basket_id: int,
    ticker: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        compare = basket_service.get_basket_compare(db, basket_id, user_id=current_user.id, ticker=ticker)
    except BasketValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if compare is None:
        raise HTTPException(status_code=404, detail="Basket not found.")
    return compare


@router.get("/{basket_id}/regime", response_model=BasketRegimeOut)
def get_basket_regime(
    basket_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    regime = basket_regime_service.compute_basket_regime(db, basket_id, user_id=current_user.id)
    if regime is None:
        raise HTTPException(status_code=404, detail="Basket not found.")
    return regime


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

    return basket_service.get_basket_detail(db, basket.id, user_id=current_user.id)


@router.put("/{basket_id}", response_model=BasketOut)
def update_basket(
    basket_id: int,
    payload: BasketCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Edits a Basket's name/tickers/weighting, effective immediately — it never touches
    BasketNav or rewrites an already-effective weight-set (see services.basket.update_basket).
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
