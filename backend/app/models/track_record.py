import datetime
from datetime import timezone

from sqlalchemy import Date, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class LivePosition(Base):
    """Open (live) portfolio positions."""
    __tablename__ = "live_positions"

    id:           Mapped[int]                  = mapped_column(Integer,              primary_key=True, autoincrement=True)
    ticker:       Mapped[str]                  = mapped_column(String(20))
    company_name: Mapped[str | None]           = mapped_column(String(200),          nullable=True)
    entry_date:   Mapped[datetime.date]        = mapped_column(Date)
    side:         Mapped[str]                  = mapped_column(String(10))           # "long" | "short"
    shares:       Mapped[float]                = mapped_column(Float)
    avg_price_in: Mapped[float]                = mapped_column(Float)
    stop:         Mapped[float | None]         = mapped_column(Float,                nullable=True)
    target:       Mapped[float | None]         = mapped_column(Float,                nullable=True)
    notes:        Mapped[str | None]           = mapped_column(String(500),          nullable=True)
    created_at:   Mapped[datetime.datetime]    = mapped_column(DateTime(timezone=True), default=lambda: datetime.datetime.now(timezone.utc))
    updated_at:   Mapped[datetime.datetime]    = mapped_column(DateTime(timezone=True), default=lambda: datetime.datetime.now(timezone.utc), onupdate=lambda: datetime.datetime.now(timezone.utc))


class RealizedTrade(Base):
    """Closed trades with realized PnL."""
    __tablename__ = "realized_trades"

    id:              Mapped[int]               = mapped_column(Integer,              primary_key=True, autoincrement=True)
    ticker:          Mapped[str]               = mapped_column(String(20))
    company_name:    Mapped[str | None]        = mapped_column(String(200),          nullable=True)
    side:            Mapped[str]               = mapped_column(String(10))           # "long" | "short"
    shares:          Mapped[float]             = mapped_column(Float)
    avg_entry_price: Mapped[float]             = mapped_column(Float)
    avg_exit_price:  Mapped[float]             = mapped_column(Float)
    entry_date:      Mapped[datetime.date]     = mapped_column(Date)
    exit_date:       Mapped[datetime.date]     = mapped_column(Date)
    pnl_dollar:      Mapped[float]             = mapped_column(Float)
    pnl_pct:         Mapped[float]             = mapped_column(Float)
    win_score:       Mapped[int]               = mapped_column(Integer)              # +1 (win) | -1 (loss)
    comment:         Mapped[str | None]        = mapped_column(String(1000),         nullable=True)
    created_at:      Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.datetime.now(timezone.utc))


class EquityEntry(Base):
    """Weekly/periodic equity curve data point."""
    __tablename__ = "equity_entries"

    id:              Mapped[int]               = mapped_column(Integer,              primary_key=True, autoincrement=True)
    date:            Mapped[datetime.date]     = mapped_column(Date,                 unique=True)
    unrealized_pnl:  Mapped[float]             = mapped_column(Float,                default=0.0)
    fees:            Mapped[float]             = mapped_column(Float,                default=0.0)
    deposit:         Mapped[float]             = mapped_column(Float,                default=0.0)
    withdrawal:      Mapped[float]             = mapped_column(Float,                default=0.0)
    portfolio_value: Mapped[float]             = mapped_column(Float)
    created_at:      Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.datetime.now(timezone.utc))
