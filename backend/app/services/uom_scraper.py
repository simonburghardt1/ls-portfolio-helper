"""
University of Michigan Survey of Consumers scraper.
Fetches the latest ICS / ICC / ICE values from https://www.sca.isr.umich.edu
and upserts them into MacroCache.

Series mapping:
  ICS  (Index of Consumer Sentiment)    → UMCSENT
  ICC  (Current Economic Conditions)    → UMICH_ICC
  ICE  (Index of Consumer Expectations) → UMICH_ICE
"""

import re
import logging
from datetime import datetime, timezone

import httpx
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)

UOM_URL = "https://www.sca.isr.umich.edu"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# Row label fragments → series_id
ROW_MAP = {
    "sentiment":    "UMCSENT",
    "conditions":   "UMICH_ICC",
    "expectations": "UMICH_ICE",
}

MONTH_ABBR = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}


def _parse_month_year(text: str) -> str | None:
    """
    Parse strings like 'March 2026', 'Preliminary Results for March 2026',
    'February 2026' → 'YYYY-MM-01'.
    """
    m = re.search(r"(january|february|march|april|may|june|july|august|"
                  r"september|october|november|december)\s+(\d{4})", text.lower())
    if m:
        mo = MONTH_ABBR[m.group(1)]
        yr = int(m.group(2))
        return f"{yr:04d}-{mo:02d}-01"
    return None


async def scrape_and_upsert(db) -> dict:
    """Scrape UoM and upsert into MacroCache. Returns the scrape result dict."""
    from app.models.macro_cache import MacroCache

    result = await scrape_latest()

    for series_id, (cur_val, prev_val) in result["values"].items():
        row = db.get(MacroCache, series_id)
        if row is None:
            row = MacroCache(series_id=series_id, dates=[], values=[],
                             fetched_at=datetime.now(timezone.utc))
            db.add(row)
        dates  = list(row.dates  or [])
        values = list(row.values or [])
        for date_str, val in [(result["period"], cur_val), (result["prev_period"], prev_val)]:
            if date_str is None or val is None:
                continue
            if date_str in dates:
                values[dates.index(date_str)] = val
            else:
                dates.append(date_str)
                values.append(val)
        pairs      = sorted(zip(dates, values))
        row.dates  = [p[0] for p in pairs]
        row.values = [p[1] for p in pairs]
        row.fetched_at = datetime.now(timezone.utc)

    db.commit()
    return result


async def scrape_latest() -> dict:
    """
    Fetch the UoM page and return a dict of:
      {
        "period":    "YYYY-MM-01",       # current-month date string
        "prev_period": "YYYY-MM-01",     # previous-month date string (if parsed)
        "values": {
          "UMCSENT":   (current_val, prev_val),
          "UMICH_ICC": (current_val, prev_val),
          "UMICH_ICE": (current_val, prev_val),
        }
      }
    Raises RuntimeError on parse failure.
    """
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=20) as client:
        resp = await client.get(UOM_URL)
        resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    # ── Detect current-month heading ──────────────────────────────────────────
    period = None
    prev_period = None

    # Look for heading text like "Preliminary Results for March 2026"
    for tag in soup.find_all(["h1", "h2", "h3", "h4", "p", "td", "th", "b", "strong"]):
        text = tag.get_text(" ", strip=True)
        d = _parse_month_year(text)
        if d:
            if period is None:
                period = d
            elif prev_period is None and d != period:
                prev_period = d
                break

    if period is None:
        raise RuntimeError("Could not detect current month from UoM page")

    # ── Parse the data table ──────────────────────────────────────────────────
    # The table has rows for each index; first numeric column = current month,
    # second numeric column = previous month.
    values: dict[str, tuple[float, float | None]] = {}

    tables = soup.find_all("table")
    for table in tables:
        rows = table.find_all("tr")
        for row in rows:
            cells = [td.get_text(" ", strip=True) for td in row.find_all(["td", "th"])]
            if len(cells) < 2:
                continue

            label = cells[0].lower()
            series_id = None
            for keyword, sid in ROW_MAP.items():
                if keyword in label:
                    series_id = sid
                    break
            if series_id is None:
                continue

            # Extract numeric values from remaining cells
            nums: list[float] = []
            for cell in cells[1:]:
                clean = re.sub(r"[^\d.]", "", cell)
                try:
                    v = float(clean)
                    if 0 < v < 500:
                        nums.append(v)
                except ValueError:
                    pass

            if nums:
                cur  = nums[0]
                prev = nums[1] if len(nums) > 1 else None
                values[series_id] = (cur, prev)

    if not values:
        raise RuntimeError("Could not extract index values from UoM page table")

    return {
        "period":      period,
        "prev_period": prev_period,
        "values":      values,
    }
