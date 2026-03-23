"""
Universal data import API.

GET  /api/import/series-list   – all importable series with groups/labels
POST /api/import               – paste CSV for any supported series
POST /api/import/clear-cache   – force re-fetch from FRED for a cached series
"""

import re
import logging
from datetime import date as date_type, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.macro_cache import MacroCache
from app.models.ism import IsmMfgReport

router = APIRouter(prefix="/api/import", tags=["import"])
log = logging.getLogger(__name__)

# ── Series registry ────────────────────────────────────────────────────────────

SERIES_REGISTRY = {
    # Consumer Confidence
    "UMCSENT":   {"label": "Consumer Sentiment",    "group": "Consumer Confidence", "storage": "cache"},
    "UMICH_ICC": {"label": "Current Conditions",    "group": "Consumer Confidence", "storage": "cache"},
    "UMICH_ICE": {"label": "Consumer Expectations", "group": "Consumer Confidence", "storage": "cache"},
    # ISM Manufacturing components → stored in ism_mfg_report
    "pmi":                   {"label": "PMI",                    "group": "ISM Manufacturing", "storage": "ism"},
    "new_orders":            {"label": "New Orders",             "group": "ISM Manufacturing", "storage": "ism"},
    "production":            {"label": "Production",             "group": "ISM Manufacturing", "storage": "ism"},
    "employment":            {"label": "Employment",             "group": "ISM Manufacturing", "storage": "ism"},
    "supplier_deliveries":   {"label": "Supplier Deliveries",    "group": "ISM Manufacturing", "storage": "ism"},
    "inventories":           {"label": "Inventories",            "group": "ISM Manufacturing", "storage": "ism"},
    "customers_inventories": {"label": "Customers' Inventories", "group": "ISM Manufacturing", "storage": "ism"},
    "prices":                {"label": "Prices",                 "group": "ISM Manufacturing", "storage": "ism"},
    "backlog_of_orders":     {"label": "Backlog of Orders",      "group": "ISM Manufacturing", "storage": "ism"},
    "new_export_orders":     {"label": "New Export Orders",      "group": "ISM Manufacturing", "storage": "ism"},
    "imports":               {"label": "Imports",                "group": "ISM Manufacturing", "storage": "ism"},
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

@router.get("/series-list")
def get_series_list():
    return SERIES_REGISTRY


class ImportPayload(BaseModel):
    series_id: str
    csv_text:  str


@router.post("")
def import_data(payload: ImportPayload, db: Session = Depends(get_db)):
    if payload.series_id not in SERIES_REGISTRY:
        raise HTTPException(400, f"Unknown series: {payload.series_id}")

    meta = SERIES_REGISTRY[payload.series_id]
    dates, values = _parse_csv(payload.csv_text)

    if not dates:
        raise HTTPException(422, "No valid rows parsed. Check the CSV format.")

    pairs  = sorted(zip(dates, values))
    dates  = [p[0] for p in pairs]
    values = [p[1] for p in pairs]

    if meta["storage"] == "cache":
        _upsert_cache(db, payload.series_id, dates, values)
    else:
        _upsert_ism(db, payload.series_id, dates, values)

    db.commit()
    log.info("Imported %d rows for %s", len(dates), payload.series_id)
    return {
        "series_id": payload.series_id,
        "label":     meta["label"],
        "saved":     len(dates),
        "earliest":  dates[0],
        "latest":    dates[-1],
    }


class ClearCachePayload(BaseModel):
    series_id: str


@router.post("/clear-cache")
def clear_cache(payload: ClearCachePayload, db: Session = Depends(get_db)):
    """Delete a MacroCache entry so it will be re-fetched from FRED on next request."""
    row = db.get(MacroCache, payload.series_id)
    if row:
        db.delete(row)
        db.commit()
        return {"deleted": True, "series_id": payload.series_id}
    return {"deleted": False, "series_id": payload.series_id}


# ── Storage helpers ────────────────────────────────────────────────────────────

def _upsert_cache(db: Session, series_id: str, dates: list, values: list):
    row = db.get(MacroCache, series_id)
    if row:
        row.dates      = dates
        row.values     = values
        row.fetched_at = datetime.now(timezone.utc)
    else:
        db.add(MacroCache(
            series_id=series_id, dates=dates, values=values,
            fetched_at=datetime.now(timezone.utc),
        ))


def _upsert_ism(db: Session, component: str, dates: list, values: list):
    for date_str, value in zip(dates, values):
        report_date = date_type.fromisoformat(date_str)
        row = db.get(IsmMfgReport, report_date)
        if row is None:
            row = IsmMfgReport(date=report_date)
            db.add(row)
        setattr(row, component, value)


# ── CSV parser ────────────────────────────────────────────────────────────────

def _parse_csv(text: str) -> tuple[list[str], list[float]]:
    dates:  list[str]   = []
    values: list[float] = []

    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip().strip('"').strip("'")
                 for p in re.split(r"[,;\t|]+", line) if p.strip()]
        if len(parts) < 2:
            continue
        date_str = _try_parse_date(parts)
        value    = _try_parse_value(parts)
        if date_str and value is not None:
            dates.append(date_str)
            values.append(value)

    return dates, values


def _try_parse_date(parts: list[str]) -> str | None:
    for p in parts:
        d = _parse_one_date(p)
        if d:
            return d
    return None


def _expand_year(y: int) -> int | None:
    if y > 99:     return y if 1900 <= y <= 2100 else None  # 4-digit: use as-is
    if y >= 50:    return 1900 + y   # 2-digit 50–99 → 1950–1999
    return 2000 + y                  # 2-digit 00–49 → 2000–2049


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
        mo, y = (int(m.group(1)), int(m.group(3))) if m.group(3) else (int(m.group(1)), int(m.group(2)))
        y = _expand_year(y)
        if y and 1 <= mo <= 12:
            return f"{y:04d}-{mo:02d}-01"

    # "Mar 2026" / "Mrz 26" / "March 2026"
    m = re.match(r"^([A-Za-zäöüÄÖÜ]+)\.?\s+(\d{2,4})$", s)
    if m:
        mon = MONTH_ABBR.get(m.group(1).lower())
        y   = _expand_year(int(m.group(2)))
        if mon and y:
            return f"{y:04d}-{mon:02d}-01"

    # "Mar 01, 2026"
    m = re.match(r"^([A-Za-zäöüÄÖÜ]+)\.?\s+\d{1,2},?\s+(\d{2,4})$", s)
    if m:
        mon = MONTH_ABBR.get(m.group(1).lower())
        y   = _expand_year(int(m.group(2)))
        if mon and y:
            return f"{y:04d}-{mon:02d}-01"

    return None


def _try_parse_value(parts: list[str]) -> float | None:
    for p in parts:
        if re.search(r"[A-Za-z]", p):
            continue
        if re.match(r"^\d{4}-\d", p) or re.match(r"^\d{1,2}/\d", p):
            continue
        clean = re.sub(r"[%,\s]", "", p)
        if not clean:
            continue
        try:
            v = float(clean)
            if 0 < v < 10000:
                return v
        except ValueError:
            continue
    return None
