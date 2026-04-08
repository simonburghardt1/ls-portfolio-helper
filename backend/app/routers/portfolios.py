"""
Portfolio CRUD endpoints.

Portfolios are named collections of positions (ticker, side, weight) stored
in PostgreSQL. They can be loaded into the Backtester from the frontend.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.portfolio import Portfolio
from app.services.track_record import compute_volatility

router = APIRouter(prefix="/api/portfolios", tags=["portfolios"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class PositionSchema(BaseModel):
    ticker: str
    side: str    # "long" | "short"
    weight: float


class PortfolioCreate(BaseModel):
    name: str
    positions: list[PositionSchema]


class PortfolioUpdate(BaseModel):
    name: str
    positions: list[PositionSchema]


class PortfolioOut(BaseModel):
    id: int
    name: str
    positions: list[PositionSchema]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("", response_model=list[PortfolioOut])
def list_portfolios(db: Session = Depends(get_db)):
    return db.query(Portfolio).order_by(Portfolio.updated_at.desc()).all()


@router.post("", response_model=PortfolioOut, status_code=201)
def create_portfolio(payload: PortfolioCreate, db: Session = Depends(get_db)):
    if db.query(Portfolio).filter_by(name=payload.name).first():
        raise HTTPException(status_code=409, detail=f"Portfolio '{payload.name}' already exists.")
    portfolio = Portfolio(
        name=payload.name,
        positions=[p.model_dump() for p in payload.positions],
    )
    db.add(portfolio)
    db.commit()
    db.refresh(portfolio)
    return portfolio


@router.put("/{portfolio_id}", response_model=PortfolioOut)
def update_portfolio(portfolio_id: int, payload: PortfolioUpdate, db: Session = Depends(get_db)):
    portfolio = db.get(Portfolio, portfolio_id)
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    # Check name uniqueness if the name changed
    if payload.name != portfolio.name:
        if db.query(Portfolio).filter_by(name=payload.name).first():
            raise HTTPException(status_code=409, detail=f"Portfolio '{payload.name}' already exists.")
    portfolio.name = payload.name
    portfolio.positions = [p.model_dump() for p in payload.positions]
    portfolio.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(portfolio)
    return portfolio


@router.delete("/{portfolio_id}", status_code=204)
def delete_portfolio(portfolio_id: int, db: Session = Depends(get_db)):
    portfolio = db.get(Portfolio, portfolio_id)
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    db.delete(portfolio)
    db.commit()


@router.get("/{portfolio_id}/volatility")
async def portfolio_volatility(portfolio_id: int, weeks: int = 52, db: Session = Depends(get_db)):
    """Variance-covariance + correlation matrices for a saved portfolio."""
    portfolio = db.get(Portfolio, portfolio_id)
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found.")

    positions = portfolio.positions   # list of {ticker, side, weight}
    if not positions:
        return {"error": "Portfolio has no positions", "tickers": []}

    tickers = [p["ticker"].upper() for p in positions]
    weights = [
        p["weight"] if p["side"] == "long" else -p["weight"]
        for p in positions
    ]
    gross = sum(abs(w) for w in weights) or 1.0
    weights = [w / gross for w in weights]

    return await compute_volatility(tickers, weights, allocations=None, weeks=weeks)
