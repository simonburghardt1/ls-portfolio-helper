from datetime import datetime, timezone
from sqlalchemy import String, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base


class MacroCache(Base):
    __tablename__ = "macro_cache"

    series_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    dates: Mapped[list] = mapped_column(JSON, nullable=False)
    values: Mapped[list] = mapped_column(JSON, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
