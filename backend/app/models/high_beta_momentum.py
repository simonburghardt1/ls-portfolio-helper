from datetime import date
from sqlalchemy import Date, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base


class HbmIndexLevel(Base):
    """Daily NAV of the reconstructed High Beta Momentum basket (base=100)."""
    __tablename__ = "hbm_index_level"

    date:                Mapped[date]        = mapped_column(Date, primary_key=True)
    index_level:         Mapped[float]       = mapped_column(Float, nullable=False)
    daily_return:        Mapped[float | None] = mapped_column(Float)
    num_holdings_active: Mapped[int | None]   = mapped_column(Integer)  # of the 50, how many had price data that day


class HbmHolding(Base):
    """One row per (rebalance_date, ticker) — the top-50 selection for that month."""
    __tablename__ = "hbm_holding"

    rebalance_date: Mapped[date]        = mapped_column(Date, primary_key=True)
    ticker:         Mapped[str]         = mapped_column(String(10), primary_key=True)
    rank:           Mapped[int]         = mapped_column(Integer, nullable=False)  # 1 = highest combined score
    beta:           Mapped[float | None] = mapped_column(Float)
    momentum:        Mapped[float | None] = mapped_column(Float)  # 12-1 trailing cumulative return
    z_beta:          Mapped[float | None] = mapped_column(Float)
    z_momentum:      Mapped[float | None] = mapped_column(Float)
    combined_score:  Mapped[float | None] = mapped_column(Float)
    market_cap:      Mapped[float | None] = mapped_column(Float)  # approx cap used for the $3B-$50B filter
    weight:          Mapped[float]        = mapped_column(Float, nullable=False)  # 1/N
