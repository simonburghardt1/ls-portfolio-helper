import datetime

from sqlalchemy import Date, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class CotData(Base):
    """Weekly COT positioning data — one row per (date, contract)."""
    __tablename__ = "cot_data"

    date:          Mapped[datetime.date] = mapped_column(Date,       primary_key=True)
    contract:      Mapped[str]           = mapped_column(String(50), primary_key=True)
    asset_class:   Mapped[str | None]    = mapped_column(String(30), nullable=True)
    long_pos:      Mapped[int | None]    = mapped_column(Integer,    nullable=True)
    short_pos:     Mapped[int | None]    = mapped_column(Integer,    nullable=True)
    open_interest: Mapped[int | None]    = mapped_column(Integer,    nullable=True)
