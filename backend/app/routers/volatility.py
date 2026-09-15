"""
ATR and Distribution of Returns endpoints (Story 2.1). Router dispatches only — business
logic lives in app.services.volatility (AD-1).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.services.auth import get_current_user
from app.services.asset_price_provider import ASSET_TYPES
from app.services.volatility import compute_atr_series, compute_return_distribution, WINDOW_WEEKS

router = APIRouter(prefix="/api/volatility", tags=["volatility"])


class AtrOut(BaseModel):
    dates: list[str]
    values: list[float | None]
    current: float | None


class HistogramBinOut(BaseModel):
    range_label: str
    lower: float | None
    upper: float | None
    count: int
    probability: float
    cumulative_pct: float
    dates: list[str]


class NormalCheckOut(BaseModel):
    sigma: int
    upper: float
    lower: float
    actual_count: int
    actual_pct: float
    normal_pct: float


class PercentileOut(BaseModel):
    p: int
    value: float


class BreakdownGroupOut(BaseModel):
    avg: float
    count: int
    freq_pct: float
    freq_adjusted: float


class BreakdownOut(BaseModel):
    positive: BreakdownGroupOut | None = None
    negative: BreakdownGroupOut | None = None
    zero: BreakdownGroupOut | None = None


class StatsOut(BaseModel):
    mean: float | None = None
    std_error: float | None = None
    median: float | None = None
    mode: float | None = None
    stdev: float | None = None
    variance: float | None = None
    kurtosis: float | None = None
    skewness: float | None = None
    range: float | None = None
    min: float | None = None
    max: float | None = None
    sum: float | None = None
    count: int | None = None


class PriceSeriesOut(BaseModel):
    dates: list[str]
    values: list[float]


class DistributionOut(BaseModel):
    bins: list[HistogramBinOut]
    stats: StatsOut
    normal_check: list[NormalCheckOut]
    percentiles: list[PercentileOut]
    breakdown: BreakdownOut
    prices: PriceSeriesOut = PriceSeriesOut(dates=[], values=[])


@router.get("/atr", response_model=AtrOut)
def get_atr(
    asset_type: str,
    asset_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if asset_type not in ASSET_TYPES:
        raise HTTPException(status_code=400, detail=f"asset_type must be one of {ASSET_TYPES}")
    return compute_atr_series(db, asset_type, asset_id)


@router.get("/distribution", response_model=DistributionOut)
def get_distribution(
    asset_type: str,
    asset_id: str,
    window: str = "1y",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if asset_type not in ASSET_TYPES:
        raise HTTPException(status_code=400, detail=f"asset_type must be one of {ASSET_TYPES}")
    if window not in WINDOW_WEEKS:
        raise HTTPException(status_code=400, detail=f"window must be one of {list(WINDOW_WEEKS)}")
    return compute_return_distribution(db, asset_type, asset_id, window)
