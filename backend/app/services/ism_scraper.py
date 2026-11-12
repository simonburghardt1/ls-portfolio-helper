"""
ISM Manufacturing Report scraper.
Sources:
  - PRNewswire press releases (historical, ~10 years)
  - ismworld.org (current/recent reports, monthly scheduler)
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
    "manufacturing pmi":          "pmi",
    "pmi":                        "pmi",
    "new orders":                 "new_orders",
    "production":                 "production",
    "employment":                 "employment",
    "supplier deliveries":        "supplier_deliveries",
    "inventories":                "inventories",
    "customers' inventories":     "customers_inventories",
    "customer inventories":       "customers_inventories",
    "customers inventories":      "customers_inventories",
    "prices":                     "prices",
    "backlog of orders":          "backlog_of_orders",
    "new export orders":          "new_export_orders",
    "exports":                    "new_export_orders",
    "imports":                    "imports",
}

# Human-readable labels for each DB column
COMPONENT_LABELS: dict[str, str] = {
    "pmi":                   "PMI",
    "new_orders":            "New Orders",
    "production":            "Production",
    "employment":            "Employment",
    "supplier_deliveries":   "Supplier Deliveries",
    "inventories":           "Inventories",
    "customers_inventories": "Customers' Inventories",
    "prices":                "Prices",
    "backlog_of_orders":     "Backlog of Orders",
    "new_export_orders":     "New Export Orders",
    "imports":               "Imports",
}

ALL_COMPONENTS = list(COMPONENT_LABELS.keys())


# ── URL Discovery ─────────────────────────────────────────────────────────────

async def discover_report_urls(max_pages: int = 15) -> list[str]:
    """
    Search PRNewswire for ISM Manufacturing report URLs.
    Returns a deduplicated list of absolute URLs.
    """
    found: set[str] = set()

    search_queries = [
        "ism+manufacturing+pmi+report",
        "manufacturing+ism+report+on+business",
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

                        if _is_ism_manufacturing_url(href) and href not in found:
                            found.add(href)
                            links_on_page += 1

                    if links_on_page == 0:
                        break   # no more results for this query

                except Exception as exc:
                    log.warning("URL discovery error (page %d): %s", page, exc)
                    break

    log.info("Discovered %d ISM Manufacturing URLs", len(found))
    return list(found)


def _is_ism_manufacturing_url(href: str) -> bool:
    href_lower = href.lower()
    if "prnewswire.com/news-releases" not in href_lower:
        return False
    keywords = [
        "ism-manufacturing-pmi",
        "manufacturing-ism-report",
        "manufacturing-pmi-at-",
        "ism-report-on-business",
    ]
    return any(kw in href_lower for kw in keywords)


# ── Single report scraper ──────────────────────────────────────────────────────

async def scrape_report(url: str) -> Optional[dict]:
    """
    Fetch and parse one ISM Manufacturing press release.
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
    """Parse PRNewswire ISM Manufacturing HTML. Returns structured dict or None."""
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
    sidebar — which stamped every such release with whatever month that sidebar showed at import time.
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
    Extract 11 component values from the "Manufacturing at a Glance" table.
    The current-month value is the second non-empty cell after the label.
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

            # Find the first numeric value in subsequent cells (current month)
            for cell in cells[1:]:
                val = _try_float(cell.get_text(strip=True))
                if val is not None and 0.0 < val < 100.0:
                    components[col] = val
                    break

    return components


def _map_component(label: str) -> Optional[str]:
    label = label.lower().strip()
    # Remove ® ™ and other noise
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

# The 18 NAICS-based industries ISM reports on for Manufacturing.
CANONICAL_INDUSTRIES = [
    "Apparel, Leather & Allied Products", "Chemical Products", "Computer & Electronic Products",
    "Electrical Equipment, Appliances & Components", "Fabricated Metal Products",
    "Food, Beverage & Tobacco Products", "Furniture & Related Products", "Machinery",
    "Miscellaneous Manufacturing", "Nonmetallic Mineral Products", "Paper Products",
    "Petroleum & Coal Products", "Plastics & Rubber Products", "Primary Metals",
    "Printing & Related Support Activities", "Textile Mills", "Transportation Equipment", "Wood Products",
]

_PARSER = IsmReportParser(
    component_keywords=[
        ("new_export_orders",     r"export"),
        ("imports",               r"\bimports?\b"),
        ("customers_inventories", r"customers?['’]?\s*inventor"),
        ("backlog_of_orders",     r"backlog"),
        ("new_orders",            r"new\s+orders"),
        ("production",            r"\bproduction\b"),
        ("employment",            r"\bemploy"),
        ("supplier_deliveries",   r"deliver"),
        ("inventories",           r"inventor"),
        ("prices",                r"\bprices?\b"),
    ],
    section_names=(
        r"new export orders|new orders|production|employment|supplier deliveries|"
        r"customers\W{0,2}\s*inventories|inventories|prices|backlog of orders|imports"
    ),
    direction_overrides={
        "supplier_deliveries": SUPPLIER_DELIVERIES_DIRECTION,
        # Customers' inventories too low = positive for future output, too high = negative
        "customers_inventories": [
            (re.compile(r"too\s+low|\blower\b", re.I), +1),
            (re.compile(r"too\s+high|\bhigher\b", re.I), -1),
        ],
    },
    canonical_industries=CANONICAL_INDUSTRIES,
)


def _clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


# ── Latest report from PRNewswire (fast, 1-page search) ───────────────────────

async def scrape_latest_from_prnewswire() -> Optional[dict]:
    """
    Find and scrape the most recent ISM Manufacturing PRNewswire release.
    Uses Bing News RSS (machine-readable, no JS required) to locate the article URL,
    then scrapes it with the existing PRNewswire parser.
    """
    import xml.etree.ElementTree as ET
    import urllib.parse

    rss_queries = [
        "ISM manufacturing PMI report prnewswire",
        "manufacturing ISM report on business prnewswire",
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
                    # Bing wraps links in a redirect — decode the real URL from url= param
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

    # Try each URL — our parser works on any site that publishes the full press release
    for url in found:
        try:
            data = await scrape_report(url)
            if data is not None:
                log.info("Latest ISM report scraped from %s: %s", url, data["date"])
                return data
        except Exception as exc:
            log.warning("Failed to scrape %s: %s", url, exc)

    return None


# ── ISM Website scraper ────────────────────────────────────────────────────────

ISM_BASE = (
    "https://www.ismworld.org/supply-management-news-and-reports/"
    "reports/ism-pmi-reports/pmi/{month}/"
)


async def scrape_ismworld_report(month_name: str, year: int) -> Optional[dict]:
    """
    Fetch and parse the ISM Manufacturing PMI report directly from ismworld.org.

    Args:
        month_name: lowercase month name, e.g. "march"
        year:       report year, e.g. 2026

    Returns a dict ready for DB insertion via _upsert_report, or None on failure.
    """
    url = ISM_BASE.format(month=month_name.lower())
    log.info("Fetching ISM report from %s", url)

    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=30, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
    except Exception as exc:
        log.warning("Failed to fetch ISM website (%s): %s", url, exc)
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    # ISM website blocks plain HTTP requests (returns ~1KB bot-detection shell).
    # This function is kept as a placeholder but currently returns None.
    log.warning(
        "ismworld.org returned %d bytes with no tables — site blocks plain HTTP. "
        "Use scrape_latest_from_prnewswire() instead.",
        len(resp.text),
    )
    return None

    # ── Industry rankings ─────────────────────────────────────────────────────
    # Paragraph format is identical to PRNewswire — reuse existing parser.
    industry_rankings = _PARSER.parse_rankings(soup)

    log.info(
        "ISM website scrape OK: %s %d — %d components, %d ranked components",
        month_name, year, len(components), len(industry_rankings),
    )
    return {
        "date":              report_date,
        "components":        components,
        "industry_rankings": industry_rankings,
        "source_url":        url,
    }
