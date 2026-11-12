"""
ISM Services (Non-Manufacturing) Report scraper.
Sources:
  - PRNewswire press releases (historical, ~10 years)
URL discovery uses PRNewswire's search page, which returns static HTML.
"""

import re
import logging
from datetime import date, datetime, timezone
from typing import Optional

import httpx
from bs4 import BeautifulSoup

from app.services.ism_parsing import (
    SUPPLIER_DELIVERIES_DIRECTION,
    IsmReportParser,
    extract_report_html,
    report_month_from_dateline,
)

log = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]
MONTH_MAP = {m: i + 1 for i, m in enumerate(MONTH_NAMES)}

# Maps text found in press release tables → DB column name
COMPONENT_MAP: dict[str, str] = {
    "services pmi":                 "pmi",
    "pmi":                          "pmi",
    "business activity/production": "business_activity",
    "business activity":            "business_activity",
    "new orders":                   "new_orders",
    "employment":                   "employment",
    "supplier deliveries":          "supplier_deliveries",
    "inventories":                  "inventories",
    "prices":                       "prices",
    "backlog of orders":            "backlog_of_orders",
    "new export orders":            "new_export_orders",
    "exports":                      "new_export_orders",
    "imports":                      "imports",
    "inventory sentiment":          "inventory_sentiment",
}

# Human-readable labels for each DB column
COMPONENT_LABELS: dict[str, str] = {
    "pmi":                  "PMI",
    "business_activity":    "Business Activity/Production",
    "new_orders":           "New Orders",
    "employment":           "Employment",
    "supplier_deliveries":  "Supplier Deliveries",
    "inventories":          "Inventories",
    "prices":               "Prices",
    "backlog_of_orders":    "Backlog of Orders",
    "new_export_orders":    "New Export Orders",
    "imports":              "Imports",
    "inventory_sentiment":  "Inventory Sentiment",
}

ALL_COMPONENTS = list(COMPONENT_LABELS.keys())


# ── URL Discovery ─────────────────────────────────────────────────────────────

async def discover_report_urls(max_pages: int = 15) -> list[str]:
    """
    Search PRNewswire for ISM Services report URLs.
    Returns a deduplicated list of absolute URLs.
    """
    found: set[str] = set()

    search_queries = [
        "ism+services+pmi+report",
        "services+ism+report+on+business",
    ]

    async with httpx.AsyncClient(headers=HEADERS, timeout=20, follow_redirects=True) as client:
        for query in search_queries:
            for page in range(1, max_pages + 1):
                url = (
                    f"https://www.prnewswire.com/news-releases/"
                    f"news-releases-list.html?r={query}&p={page}"
                )
                try:
                    resp = await client.get(url)
                    if resp.status_code != 200:
                        break

                    soup = BeautifulSoup(resp.text, "html.parser")
                    links_on_page = 0

                    for a in soup.find_all("a", href=True):
                        href: str = a["href"]
                        if not href.startswith("http"):
                            href = "https://www.prnewswire.com" + href

                        if _is_ism_services_url(href) and href not in found:
                            found.add(href)
                            links_on_page += 1

                    if links_on_page == 0:
                        break   # no more results for this query

                except Exception as exc:
                    log.warning("URL discovery error (page %d): %s", page, exc)
                    break

    log.info("Discovered %d ISM Services URLs", len(found))
    return list(found)


def _is_ism_services_url(href: str) -> bool:
    href_lower = href.lower()
    if "prnewswire.com/news-releases" not in href_lower:
        return False
    keywords = [
        "ism-services-pmi",
        "services-ism-report",
        "services-pmi-at-",
        "ism-non-manufacturing",
    ]
    return any(kw in href_lower for kw in keywords)


# ── Single report scraper ──────────────────────────────────────────────────────

async def scrape_report(url: str) -> Optional[dict]:
    """
    Fetch and parse one ISM Services press release.
    Returns a dict ready for DB insertion, or None on failure.
    """
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=20, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
    except Exception as exc:
        log.warning("Failed to fetch %s: %s", url, exc)
        return None

    return parse_html(resp.text, url)


def parse_html(html: str, url: str) -> Optional[dict]:
    """Parse PRNewswire ISM Services HTML. Returns structured dict or None."""
    soup = BeautifulSoup(html, "html.parser")

    report_date = _extract_date(url, soup)
    if report_date is None:
        log.warning("Could not determine date for %s", url)
        return None

    components = _parse_component_table(soup)
    if not components:
        log.warning("No component values found for %s", url)
        return None

    industry_rankings = _PARSER.parse_rankings(soup)
    respondent_comments = _PARSER.parse_respondent_comments(soup)

    return {
        "date":                report_date,
        "components":          components,
        "industry_rankings":   industry_rankings,
        "respondent_comments": respondent_comments,
        "source_url":          url,
        "report_html":         extract_report_html(html),
    }


# ── Date extraction ────────────────────────────────────────────────────────────

def _extract_date(url: str, soup: BeautifulSoup) -> Optional[date]:
    """
    Report month, from the release's own dateline first, then the URL, then the <title>.
    Page headings are deliberately never used: pre-2020 releases have no year in URL or
    title, and the first heading with a month+year on the page is PRNewswire's "related news"
    sidebar — which stamps such a release with whatever month that sidebar shows at import time.
    """
    d = report_month_from_dateline(soup)
    if d:
        return d

    d = _date_from_text(url.lower())
    if d:
        return d

    title = soup.find("title")
    if title:
        return _date_from_text(title.get_text().lower())

    return None


def _date_from_text(text: str) -> Optional[date]:
    for month_name, month_num in MONTH_MAP.items():
        m = re.search(rf"{month_name}[^a-z]*(20\d{{2}})", text)
        if m:
            return date(int(m.group(1)), month_num, 1)
    return None


# ── Component table parser ─────────────────────────────────────────────────────

def _parse_component_table(soup: BeautifulSoup) -> dict[str, float]:
    """
    Extract component values from the "Services at a Glance" table.
    The current-month value is the first numeric cell after the label
    (the table also lists prior month, % change, and the comparison
    Manufacturing column further right — those are skipped).
    """
    components: dict[str, float] = {}

    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            cells = row.find_all(["td", "th"])
            if len(cells) < 2:
                continue

            raw_label = _clean_text(cells[0].get_text())
            col = _map_component(raw_label)
            if not col or col in components:
                continue

            for cell in cells[1:]:
                val = _try_float(cell.get_text(strip=True))
                if val is not None and 0.0 < val < 100.0:
                    components[col] = val
                    break

    return components


def _map_component(label: str) -> Optional[str]:
    label = label.lower().strip()
    label = re.sub(r"[®™©\*]", "", label).strip()

    if label in COMPONENT_MAP:
        return COMPONENT_MAP[label]

    for key, col in COMPONENT_MAP.items():
        if key in label:
            return col

    return None


def _try_float(text: str) -> Optional[float]:
    try:
        return float(text.replace(",", "."))
    except (ValueError, AttributeError):
        return None


# ── Industry rankings & respondent comments ─────────────────────────────────────

# The 18 NAICS-based industries ISM reports on for Services.
CANONICAL_INDUSTRIES = [
    "Accommodation & Food Services", "Agriculture, Forestry, Fishing & Hunting",
    "Arts, Entertainment & Recreation", "Construction", "Educational Services",
    "Finance & Insurance", "Health Care & Social Assistance", "Information",
    "Management of Companies & Support Services", "Mining", "Other Services",
    "Professional, Scientific & Technical Services", "Public Administration",
    "Real Estate, Rental & Leasing", "Retail Trade", "Transportation & Warehousing",
    "Utilities", "Wholesale Trade",
]

_PARSER = IsmReportParser(
    component_keywords=[
        ("new_export_orders",   r"export"),
        ("imports",             r"\bimports?\b"),
        ("inventory_sentiment", r"sentiment|too\s+(?:high|low)"),
        ("backlog_of_orders",   r"backlog"),
        ("new_orders",          r"new\s+orders"),
        ("business_activity",   r"business\s+activity"),
        ("employment",          r"\bemploy"),
        ("supplier_deliveries", r"deliver"),
        ("inventories",         r"inventor"),
        ("prices",              r"\bprices?\b"),
    ],
    section_names=(
        r"new export orders|new orders|business activity|employment|supplier deliveries|"
        r"inventory sentiment|inventories|prices|backlog of orders|imports"
    ),
    direction_overrides={
        "supplier_deliveries": SUPPLIER_DELIVERIES_DIRECTION,
        # Inventories "too high" relative to business needs = negative for future activity,
        # "too low" (reported as "a decrease in inventory sentiment") = positive. Same
        # convention as Manufacturing's Customers' Inventories.
        "inventory_sentiment": [
            (re.compile(r"too\s+high|\bincreas|\bhigher\b", re.I), -1),
            (re.compile(r"too\s+low|decreas|\blower\b", re.I), +1),
        ],
    },
    canonical_industries=CANONICAL_INDUSTRIES,
)


def _clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


# ── Latest report from PRNewswire (fast, 1-page search) ───────────────────────

async def scrape_latest_from_prnewswire() -> Optional[dict]:
    """
    Find and scrape the most recent ISM Services PRNewswire release.
    Uses Bing News RSS (machine-readable, no JS required) to locate the article URL,
    then scrapes it with the existing PRNewswire parser.
    """
    import xml.etree.ElementTree as ET
    import urllib.parse

    rss_queries = [
        "ISM services PMI report prnewswire",
        "services ISM report on business prnewswire",
    ]

    found: list[str] = []

    async with httpx.AsyncClient(headers=HEADERS, timeout=20, follow_redirects=True) as client:
        for query in rss_queries:
            rss_url = f"https://www.bing.com/news/search?q={urllib.parse.quote(query)}&format=RSS"
            try:
                resp = await client.get(rss_url)
                root = ET.fromstring(resp.text)
                for item in root.findall(".//item"):
                    link_el = item.find("link")
                    if link_el is None or not link_el.text:
                        continue
                    href = link_el.text.strip()
                    if "apiclick.aspx" in href and "url=" in href:
                        params = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
                        href = params.get("url", [href])[0]
                    if href not in found:
                        found.append(href)
                if found:
                    break
            except Exception as exc:
                log.warning("Bing RSS error: %s", exc)

    if not found:
        log.warning("No URLs found via Bing News RSS.")
        return None

    log.info("Bing RSS candidates: %s", found)

    for url in found:
        try:
            data = await scrape_report(url)
            if data is not None:
                log.info("Latest ISM Services report scraped from %s: %s", url, data["date"])
                return data
        except Exception as exc:
            log.warning("Failed to scrape %s: %s", url, exc)

    return None
