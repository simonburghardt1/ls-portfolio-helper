from datetime import date, datetime, timezone
from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base


class Basket(Base):
    """A user-curated Basket (5-20 holdings). user_id is NULL for a system/global Basket."""
    __tablename__ = "basket"

    id:               Mapped[int]      = mapped_column(Integer, primary_key=True, autoincrement=True)
    name:             Mapped[str]      = mapped_column(String(120), nullable=False)
    user_id:          Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    weighting_method: Mapped[str]      = mapped_column(String(20), nullable=False)  # "equal" | "market_cap"
    created_at:       Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


class BasketConstituent(Base):
    """One row per (basket_id, ticker, effective_date) — the weight-set effective from that date."""
    __tablename__ = "basket_constituent"

    basket_id:      Mapped[int]  = mapped_column(ForeignKey("basket.id"), primary_key=True)
    ticker:         Mapped[str]  = mapped_column(String(20), primary_key=True)
    effective_date: Mapped[date] = mapped_column(Date, primary_key=True)
    weight:         Mapped[float] = mapped_column(Float, nullable=False)


class BasketNav(Base):
    """Daily NAV of a Basket (base=100), append-only once written (AD-8)."""
    __tablename__ = "basket_nav"

    basket_id:   Mapped[int]   = mapped_column(ForeignKey("basket.id"), primary_key=True)
    date:        Mapped[date]  = mapped_column(Date, primary_key=True)
    index_level: Mapped[float] = mapped_column(Float, nullable=False)


class BasketRegime(Base):
    """Computed per-Basket regime data for one daily bar (AD-10, Story 3.2) — mirrors
    MarketRegimeRow's shape (market_data.py), written by the basket_regime_daily job."""
    __tablename__ = "basket_regime"

    basket_id:               Mapped[int]         = mapped_column(ForeignKey("basket.id"), primary_key=True)
    date:                    Mapped[date]        = mapped_column(Date, primary_key=True)
    regime:                  Mapped[str | None]  = mapped_column(String(10), nullable=True)  # "up" | "down" | "ranging"
    score01:                 Mapped[float | None] = mapped_column(Float, nullable=True)
    score_bmsb:              Mapped[float | None] = mapped_column(Float, nullable=True)
    score_vol:               Mapped[float | None] = mapped_column(Float, nullable=True)
    score_breadth:           Mapped[float | None] = mapped_column(Float, nullable=True)
    score_relative_strength: Mapped[float | None] = mapped_column(Float, nullable=True)
