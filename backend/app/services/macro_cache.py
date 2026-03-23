from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from app.models.macro_cache import MacroCache
from app.services.fred import FredClient

CACHE_TTL_HOURS = 24
FULL_HISTORY_START = "1950-01-01"


async def get_series(db: Session, fred_client: FredClient, series_id: str) -> dict:
    """
    Return full date/value arrays for a FRED series.
    Serves from DB cache if fresh (<24h), otherwise fetches from FRED and updates cache.
    """
    cached: MacroCache | None = db.get(MacroCache, series_id)

    if cached:
        age = datetime.now(timezone.utc) - cached.fetched_at.replace(tzinfo=timezone.utc)
        if age < timedelta(hours=CACHE_TTL_HOURS):
            return {"dates": cached.dates, "values": cached.values}

    # Cache miss or stale — fetch from FRED
    payload = await fred_client.observations(series_id, start=FULL_HISTORY_START)

    if cached:
        cached.dates = payload["dates"]
        cached.values = payload["values"]
        cached.fetched_at = datetime.now(timezone.utc)
    else:
        db.add(MacroCache(
            series_id=series_id,
            dates=payload["dates"],
            values=payload["values"],
            fetched_at=datetime.now(timezone.utc),
        ))

    db.commit()
    return payload
