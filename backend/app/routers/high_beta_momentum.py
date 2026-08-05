"""
High Beta Momentum basket API endpoints.

POST /api/high-beta-momentum/build     – full historical rebuild (background task)
GET  /api/high-beta-momentum/status    – build progress + DB summary
GET  /api/high-beta-momentum/index-series – daily NAV series
GET  /api/high-beta-momentum/rebalance-dates – list of monthly rebalance dates
GET  /api/high-beta-momentum/holdings  – top-50 holdings for a given (or latest) rebalance
POST /api/high-beta-momentum/refresh   – fast single-month incremental update
"""

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.high_beta_momentum import (
    _build_state,
    get_build_status,
    get_holdings,
    get_index_series,
    get_rebalance_dates,
    seed_high_beta_momentum,
    update_high_beta_momentum,
)

router = APIRouter(prefix="/api/high-beta-momentum", tags=["high-beta-momentum"])
log = logging.getLogger(__name__)


@router.post("/build")
def build(background_tasks: BackgroundTasks):
    if _build_state["running"]:
        raise HTTPException(status_code=409, detail="A build is already running.")
    background_tasks.add_task(seed_high_beta_momentum)
    return {"status": "started"}


@router.get("/status")
def status(db: Session = Depends(get_db)):
    return get_build_status(db)


@router.get("/index-series")
def index_series(db: Session = Depends(get_db)):
    return get_index_series(db)


@router.get("/rebalance-dates")
def rebalance_dates(db: Session = Depends(get_db)):
    return {"dates": get_rebalance_dates(db)}


@router.get("/holdings")
def holdings(date: str | None = None, db: Session = Depends(get_db)):
    return get_holdings(db, date)


@router.post("/refresh")
def refresh(db: Session = Depends(get_db)):
    update_high_beta_momentum(db)
    return get_build_status(db)
