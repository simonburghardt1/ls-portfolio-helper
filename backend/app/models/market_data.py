import datetime

from sqlalchemy import Date, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class MarketPrice(Base):
    """Raw weekly closing price per ticker."""
    __tablename__ = "market_prices"

    date:   Mapped[datetime.date] = mapped_column(Date,       primary_key=True)
    ticker: Mapped[str]           = mapped_column(String(10), primary_key=True)
    close:  Mapped[float | None]  = mapped_column(Float,      nullable=True)


class MarketRegimeRow(Base):
    """Computed regime data for one weekly bar."""
    __tablename__ = "market_regime"

    date:          Mapped[datetime.date] = mapped_column(Date,       primary_key=True)
    spy_price:     Mapped[float | None]  = mapped_column(Float,      nullable=True)
    ema21:         Mapped[float | None]  = mapped_column(Float,      nullable=True)
    sma20:         Mapped[float | None]  = mapped_column(Float,      nullable=True)
    regime:        Mapped[str | None]    = mapped_column(String(10), nullable=True)
    composite:     Mapped[float | None]  = mapped_column(Float,      nullable=True)
    score_bmsb:    Mapped[float | None]  = mapped_column(Float,      nullable=True)
    score_breadth: Mapped[float | None]  = mapped_column(Float,      nullable=True)
    score_vix:     Mapped[float | None]  = mapped_column(Float,      nullable=True)
    score_credit:  Mapped[float | None]  = mapped_column(Float,      nullable=True)
