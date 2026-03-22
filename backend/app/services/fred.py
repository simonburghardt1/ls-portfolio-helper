import time
import httpx
import pandas as pd

FRED_URL = "https://api.stlouisfed.org/fred/series/observations"


class FredClient:
    def __init__(self, api_key: str, ttl_seconds: int = 60):
        self.api_key = api_key
        self.ttl = ttl_seconds
        self._cache: dict[str, tuple[float, dict]] = {}

    async def observations(self, series_id: str, start: str = "2010-01-01") -> dict:
        if not self.api_key:
            raise RuntimeError(
                "FRED_API_KEY is empty. Set it in .env or environment variables."
            )

        cache_key = f"{series_id}:{start}"
        now = time.time()
        if cache_key in self._cache and now - self._cache[cache_key][0] < self.ttl:
            return self._cache[cache_key][1]

        params = {
            "series_id": series_id,
            "api_key": self.api_key,
            "file_type": "json",
            "observation_start": start,
        }

        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(FRED_URL, params=params)
            r.raise_for_status()
            j = r.json()

        obs = pd.DataFrame(j.get("observations", []))
        if obs.empty:
            payload = {"dates": [], "values": []}
        else:
            obs["value"] = pd.to_numeric(obs["value"], errors="coerce")
            obs = obs.dropna(subset=["value"])
            payload = {
                "dates": obs["date"].tolist(),
                "values": obs["value"].astype(float).tolist(),
            }

        self._cache[cache_key] = (now, payload)
        return payload


def latest_value(values: list[float]) -> float | None:
    return float(values[-1]) if values else None


def latest_cpi_yoy(dates: list[str], values: list[float]) -> float | None:
    if not dates or not values:
        return None
    s = pd.Series(values, index=pd.to_datetime(dates)).sort_index()
    m = s.resample("ME").last()
    yoy = (m / m.shift(12) - 1.0) * 100.0
    yoy = yoy.dropna()
    return float(yoy.iloc[-1]) if not yoy.empty else None
