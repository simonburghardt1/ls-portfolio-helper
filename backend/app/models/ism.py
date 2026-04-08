from datetime import date, datetime, timezone
from sqlalchemy import Date, DateTime, Float, Integer, SmallInteger, String, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base


class IsmMfgReport(Base):
    """One row per monthly ISM Manufacturing report — headline component values."""
    __tablename__ = "ism_mfg_report"

    date: Mapped[date] = mapped_column(Date, primary_key=True)          # YYYY-MM-01

    # 11 components (index value, e.g. 52.4)
    pmi:                    Mapped[float | None] = mapped_column(Float)
    new_orders:             Mapped[float | None] = mapped_column(Float)
    production:             Mapped[float | None] = mapped_column(Float)
    employment:             Mapped[float | None] = mapped_column(Float)
    supplier_deliveries:    Mapped[float | None] = mapped_column(Float)
    inventories:            Mapped[float | None] = mapped_column(Float)
    customers_inventories:  Mapped[float | None] = mapped_column(Float)
    prices:                 Mapped[float | None] = mapped_column(Float)
    backlog_of_orders:      Mapped[float | None] = mapped_column(Float)
    new_export_orders:      Mapped[float | None] = mapped_column(Float)
    imports:                Mapped[float | None] = mapped_column(Float)

    source_url:  Mapped[str | None] = mapped_column(String(500))
    scraped_at:  Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class IsmMfgIndustryRank(Base):
    """
    Industry ranking score per component per month.

    score > 0  → growth  (first listed = highest score, e.g. +12 of 12)
    score < 0  → decline (first listed = most negative, e.g. -3 of 3)
    score = 0  → not mentioned / neutral
    """
    __tablename__ = "ism_mfg_industry_rank"

    id:        Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date:      Mapped[date] = mapped_column(Date, ForeignKey("ism_mfg_report.date"), nullable=False)
    component: Mapped[str]  = mapped_column(String(50),  nullable=False)   # e.g. "new_orders"
    industry:  Mapped[str]  = mapped_column(String(120), nullable=False)
    score:     Mapped[int]  = mapped_column(SmallInteger, nullable=False)   # signed rank

    __table_args__ = (
        UniqueConstraint("date", "component", "industry", name="uq_ism_rank"),
    )


class IsmMfgComment(Base):
    """One respondent quote per industry per monthly report (from 'WHAT RESPONDENTS ARE SAYING')."""
    __tablename__ = "ism_mfg_comment"

    id:       Mapped[int]  = mapped_column(Integer, primary_key=True, autoincrement=True)
    date:     Mapped[date] = mapped_column(Date, ForeignKey("ism_mfg_report.date"), nullable=False)
    industry: Mapped[str]  = mapped_column(String(120), nullable=False)
    comment:  Mapped[str]  = mapped_column(String(2000), nullable=False)

    __table_args__ = (UniqueConstraint("date", "industry", name="uq_ism_comment"),)
