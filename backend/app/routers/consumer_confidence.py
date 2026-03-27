"""
Consumer Confidence API.

GET  /api/consumer-confidence/series   – all three series from cache
POST /api/consumer-confidence/import   – paste CSV data for ICC / ICE
GET  /api/consumer-confidence/status   – cache summary
"""

import re
import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.macro_cache import MacroCache
from app.services.fred import FredClient
from app.services.macro_cache import get_series
from app.services.uom_scraper import scrape_and_upsert
from app.core.config import settings

router = APIRouter(prefix="/api/consumer-confidence", tags=["consumer-confidence"])
log = logging.getLogger(__name__)
fred = FredClient(api_key=settings.FRED_API_KEY)

# ── Series metadata ────────────────────────────────────────────────────────────

SERIES_META = {
    "UMCSENT":   {"label": "Consumer Sentiment",    "color": "#3b82f6", "source": "fred"},
    "UMICH_ICC": {"label": "Current Conditions",    "color": "#10b981", "source": "manual"},
    "UMICH_ICE": {"label": "Consumer Expectations", "color": "#f59e0b", "source": "manual"},
}

MONTH_ABBR = {
    # English
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    "january": 1, "february": 2, "march": 3, "april": 4,
    "june": 6, "july": 7, "august": 8, "september": 9,
    "october": 10, "november": 11, "december": 12,
    # German
    "mrz": 3, "mär": 3, "märz": 3, "mai": 5, "okt": 10, "dez": 12,
    "januar": 1, "februar": 2, "juni": 6, "juli": 7,
    "august": 8, "september": 9, "oktober": 10, "november": 11, "dezember": 12,
}


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/series")
async def get_all_series(db: Session = Depends(get_db)):
    """Returns all available series. UMCSENT fetched from FRED; ICC/ICE from manual cache."""
    result = {}

    # UMCSENT from FRED (uses MacroCache with 24h TTL)
    try:
        data = await get_series(db, fred, "UMCSENT")
        result["UMCSENT"] = {
            "dates":  data["dates"],
            "values": data["values"],
            **SERIES_META["UMCSENT"],
        }
    except Exception as exc:
        log.warning("Failed to fetch UMCSENT from FRED: %s", exc)

    # ICC and ICE from manual cache
    for series_id in ("UMICH_ICC", "UMICH_ICE"):
        row = db.get(MacroCache, series_id)
        if row and row.dates:
            result[series_id] = {
                "dates":  row.dates,
                "values": row.values,
                **SERIES_META[series_id],
            }

    return {"series": result}


class ImportPayload(BaseModel):
    series_id: Literal["UMICH_ICC", "UMICH_ICE"]
    csv_text:  str   # pasted CSV content


@router.post("/import")
def import_series(payload: ImportPayload, db: Session = Depends(get_db)):
    """
    Import historical ICC or ICE data from a pasted CSV.

    Accepted date formats (auto-detected):
      YYYY-MM-DD, MM/DD/YYYY, Mon YYYY, Mon DD YYYY, Mon DD, YYYY
    Value: first numeric column that isn't a date column.
    Lines starting with # or non-numeric date tokens are skipped.
    """
    dates, values = _parse_csv(payload.csv_text)
    if not dates:
        raise HTTPException(status_code=422, detail="No valid rows parsed. Check the CSV format.")

    # Sort ascending by date
    pairs = sorted(zip(dates, values))
    dates  = [p[0] for p in pairs]
    values = [p[1] for p in pairs]

    row = db.get(MacroCache, payload.series_id)
    if row:
        row.dates     = dates
        row.values    = values
        row.fetched_at = datetime.now(timezone.utc)
    else:
        db.add(MacroCache(
            series_id  = payload.series_id,
            dates      = dates,
            values     = values,
            fetched_at = datetime.now(timezone.utc),
        ))
    db.commit()
    log.info("Imported %d rows for %s", len(dates), payload.series_id)
    return {"series_id": payload.series_id, "saved": len(dates),
            "earliest": dates[0], "latest": dates[-1]}


@router.post("/scrape")
async def scrape_uom(db: Session = Depends(get_db)):
    """
    Fetch the latest ICS / ICC / ICE values from https://www.sca.isr.umich.edu
    and upsert them into MacroCache (UMCSENT, UMICH_ICC, UMICH_ICE).
    Returns a summary of what was updated.
    """
    try:
        result = await scrape_and_upsert(db)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Scrape failed: {exc}")

    updated = [
        {"series_id": sid, "value": cur}
        for sid, (cur, _) in result["values"].items()
    ]
    log.info("UoM scrape complete: %s", updated)
    return {"scraped": updated, "period": result["period"], "prev_period": result["prev_period"]}


@router.post("/refresh")
async def refresh_all(db: Session = Depends(get_db)):
    """
    Full refresh for all Consumer Confidence series:
      1. Force re-fetch UMCSENT history from FRED (clears cache).
      2. Scrape UoM website for the latest month's final values and merge them
         into the FRED history (covers months where FRED lags behind UoM releases).
      3. Update ICC and ICE from the same UoM scrape.
    """
    # Step 1: clear and re-fetch UMCSENT from FRED
    row = db.get(MacroCache, "UMCSENT")
    if row:
        db.delete(row)
        db.commit()
    fred_error = None
    try:
        await get_series(db, fred, "UMCSENT")
    except Exception as exc:
        fred_error = str(exc)
        log.warning("FRED fetch failed for UMCSENT: %s", exc)

    # Step 2 & 3: scrape UoM for the latest values and merge into all three series
    scrape_result = None
    scrape_error  = None
    try:
        scrape_result = await scrape_and_upsert(db)
    except Exception as exc:
        scrape_error = str(exc)
        log.warning("UoM scrape failed: %s", exc)

    # Build response
    result = {}
    for series_id, meta in SERIES_META.items():
        row2 = db.get(MacroCache, series_id)
        if row2 and row2.dates:
            result[series_id] = {
                "label":        meta["label"],
                "count":        len(row2.dates),
                "latest_date":  row2.dates[-1],
                "latest_value": row2.values[-1],
            }
        else:
            result[series_id] = {"label": meta["label"], "count": 0}

    response = {"refreshed": result}
    if fred_error:
        response["fred_warning"]   = fred_error
    if scrape_error:
        response["scrape_warning"] = scrape_error
    if scrape_result:
        response["scrape_period"]  = scrape_result.get("period")
    return response


@router.get("/status")
def get_status(db: Session = Depends(get_db)):
    out = {}
    for series_id, meta in SERIES_META.items():
        row = db.get(MacroCache, series_id)
        if row and row.dates:
            out[series_id] = {
                "label":    meta["label"],
                "count":    len(row.dates),
                "earliest": row.dates[0],
                "latest":   row.dates[-1],
                "fetched_at": row.fetched_at.isoformat(),
            }
        else:
            out[series_id] = {"label": meta["label"], "count": 0}
    return out


# ── CSV parser ────────────────────────────────────────────────────────────────

def _parse_csv(text: str) -> tuple[list[str], list[float]]:
    """
    Flexible parser for pasted historical data.
    Returns (dates_iso, values).
    """
    dates:  list[str]   = []
    values: list[float] = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        # Split on common delimiters
        parts = re.split(r"[,;\t|]+", line)
        parts = [p.strip().strip('"').strip("'") for p in parts if p.strip()]
        if len(parts) < 2:
            continue

        date_str = _try_parse_date(parts)
        if date_str is None:
            continue

        value = _try_parse_value(parts)
        if value is None:
            continue

        dates.append(date_str)
        values.append(value)

    return dates, values


def _try_parse_date(parts: list[str]) -> str | None:
    """Try each part as a date; return ISO YYYY-MM-01 string or None."""
    for part in parts:
        d = _parse_one_date(part)
        if d:
            return d
    return None


def _expand_year(y: int) -> int | None:
    if y > 99:   return y if 1900 <= y <= 2100 else None  # 4-digit: use as-is
    if y >= 50:  return 1900 + y   # 2-digit 50–99 → 1950–1999
    return 2000 + y                # 2-digit 00–49 → 2000–2049


def _parse_one_date(s: str) -> str | None:
    s = s.strip()

    # YYYY-MM-DD or YYYY-MM
    m = re.match(r"^(\d{4})-(\d{1,2})(?:-\d{1,2})?$", s)
    if m:
        y, mo = int(m.group(1)), int(m.group(2))
        if 1950 <= y <= 2100 and 1 <= mo <= 12:
            return f"{y:04d}-{mo:02d}-01"

    # MM/DD/YYYY or MM/YYYY
    m = re.match(r"^(\d{1,2})/(\d{2,4})(?:/(\d{4}))?$", s)
    if m:
        if m.group(3):  # MM/DD/YYYY
            mo, y = int(m.group(1)), int(m.group(3))
        else:           # MM/YYYY
            mo, y = int(m.group(1)), int(m.group(2))
        if 1 <= mo <= 12 and 1950 <= y <= 2100:
            return f"{y:04d}-{mo:02d}-01"

    # "Mar 2026" / "March 2026" / "Mar 26" / "Mrz 26"
    m = re.match(r"^([A-Za-zäöüÄÖÜ]+)\.?\s+(\d{2,4})$", s)
    if m:
        mon = MONTH_ABBR.get(m.group(1).lower())
        y = _expand_year(int(m.group(2)))
        if mon and y:
            return f"{y:04d}-{mon:02d}-01"

    # "Mar 01, 2026" or "March 1, 2026"
    m = re.match(r"^([A-Za-zäöüÄÖÜ]+)\.?\s+\d{1,2},?\s+(\d{2,4})$", s)
    if m:
        mon = MONTH_ABBR.get(m.group(1).lower())
        y = _expand_year(int(m.group(2)))
        if mon and y:
            return f"{y:04d}-{mon:02d}-01"

    return None


def _try_parse_value(parts: list[str]) -> float | None:
    """Return the first part that is a clean number (skip date-like parts and % strings)."""
    for part in parts:
        # Skip obvious date parts
        if re.search(r"[A-Za-z]", part):
            continue
        if re.match(r"^\d{4}-\d", part) or re.match(r"^\d{1,2}/\d", part):
            continue
        # Strip %, commas, trailing text
        clean = re.sub(r"[%,\s]", "", part)
        if not clean:
            continue
        try:
            v = float(clean)
            if 0 < v < 1000:   # sanity: sentiment index is 0–200 range
                return v
        except ValueError:
            continue
    return None
