"""
ISM Manufacturing Report scraper.
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

    industry_rankings = _parse_industry_rankings(soup)

    return {
        "date":               report_date,
        "components":         components,
        "industry_rankings":  industry_rankings,
        "source_url":         url,
    }


# ── Date extraction ────────────────────────────────────────────────────────────

def _extract_date(url: str, soup: BeautifulSoup) -> Optional[date]:
    """Try URL first, then page title, then first heading."""
    # 1. URL pattern: "...-february-2026-..."
    d = _date_from_text(url.lower())
    if d:
        return d

    # 2. <title> tag
    title = soup.find("title")
    if title:
        d = _date_from_text(title.get_text().lower())
        if d:
            return d

    # 3. First h1 / h2
    for tag in soup.find_all(["h1", "h2", "h3"]):
        d = _date_from_text(tag.get_text().lower())
        if d:
            return d

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


# ── Industry rankings parser ───────────────────────────────────────────────────

# Each entry: (component_col, direction_sign, keyword_regex)
# The full compiled pattern is: keyword + up to 150 chars (non-period) + "are/is: LIST."
_COMP_DIR_PATTERNS: list[tuple[str, int, str]] = [
    # New Orders
    ("new_orders", +1, r"(?:growth|an?\s+increase|increas\w+|expan\w+)\s+in\s+new\s+orders"),
    ("new_orders", -1, r"(?:a\s+)?(?:decline|decrease|decreas\w+|contraction|contract\w+|reduction)\s+in\s+new\s+orders"),
    # Production
    ("production", +1, r"(?:growth|an?\s+increase|increas\w+|expan\w+)\s+in\s+production"),
    ("production", -1, r"(?:a\s+)?(?:decline|decrease|decreas\w+|contraction|contract\w+|reduction)\s+in\s+production"),
    # Employment
    ("employment", +1, r"(?:growth|an?\s+increase|increas\w+|expan\w+)\s+in\s+employment"),
    ("employment", -1, r"(?:a\s+)?(?:decline|decrease|decreas\w+|contraction|contract\w+|reduction)\s+in\s+employment"),
    # Supplier Deliveries — slower = expansion (positive), faster = contraction (negative)
    ("supplier_deliveries", +1, r"slower\s+(?:supplier\s+)?deliveries"),
    ("supplier_deliveries", -1, r"faster\s+(?:supplier\s+)?deliveries"),
    # Inventories
    ("inventories", +1, r"higher\s+inventories"),
    ("inventories", -1, r"lower\s+inventories"),
    # Customers' Inventories — too high = negative for outlook, too low = positive
    ("customers_inventories", -1, r"customers['\u2019]?\s*inventories\s+as\s+too\s+high"),
    ("customers_inventories", +1, r"customers['\u2019]?\s*inventories\s+as\s+too\s+low"),
    # Prices
    ("prices", +1, r"higher\s+prices"),
    ("prices", -1, r"lower\s+prices"),
    # Backlog of Orders
    ("backlog_of_orders", +1, r"(?:higher\s+backlogs?(?:\s+of\s+orders?)?|(?:growth|an?\s+increase)\s+in\s+backlog)"),
    ("backlog_of_orders", -1, r"(?:lower\s+backlogs?(?:\s+of\s+orders?)?|(?:a\s+)?(?:decline|decrease|reduction)\s+in\s+backlog)"),
    # New Export Orders
    ("new_export_orders", +1, r"(?:growth|an?\s+increase|increas\w+|expan\w+)\s+in\s+(?:new\s+)?export\s+orders"),
    ("new_export_orders", -1, r"(?:a\s+)?(?:decline|decrease|decreas\w+|contraction|contract\w+|reduction)\s+in\s+(?:new\s+)?export\s+orders"),
    # Imports (older reports use "growth in imports", newer use "higher imports")
    ("imports", +1, r"(?:higher\s+imports|increas\w+\s+imports|(?:growth|an?\s+increase|increas\w+)\s+in\s+imports)"),
    ("imports", -1, r"(?:lower\s+imports|decreas\w+\s+imports|(?:a\s+)?(?:decline|decrease|decreas\w+|reduction|contract\w+)\s+in\s+imports)"),
]

# Middle span allows any char except period so colons in the text don't break matching
_COMPILED_PATTERNS: list[tuple[str, int, re.Pattern]] = [
    (col, sign, re.compile(kw_re + r"[^.]{0,150}?are?:\s+([^.]{5,})\.", re.IGNORECASE))
    for col, sign, kw_re in _COMP_DIR_PATTERNS
]


def _parse_industry_rankings(soup: BeautifulSoup) -> dict[str, list[dict]]:
    """
    Returns: {component_col: [{"industry": str, "score": int}, ...]}
    Positive score = growth rank, negative = decline rank.
    Industries not mentioned are NOT included (score = 0 implied).
    """
    paragraphs = [p.get_text(" ", strip=True) for p in soup.find_all("p")]
    full_text = " ".join(paragraphs)

    rankings: dict[str, list[dict]] = {}

    for comp, direction, pattern in _COMPILED_PATTERNS:
        for match in pattern.finditer(full_text):
            industries = _split_industry_list(match.group(1))
            if not industries:
                continue
            n = len(industries)
            entries = rankings.setdefault(comp, [])
            for i, ind in enumerate(industries):
                entries.append({"industry": ind, "score": (n - i) * direction})

    return rankings


def _split_industry_list(raw: str) -> list[str]:
    """Parse '; '-separated industry list, stripping 'and', trailing punctuation."""
    raw = raw.strip().rstrip(".")
    # Split on semicolons
    parts = re.split(r";\s*", raw)
    result = []
    for part in parts:
        # Remove leading "and "
        part = re.sub(r"^\s*and\s+", "", part, flags=re.IGNORECASE).strip()
        # Remove trailing " and ..."
        part = re.sub(r"\s+and\s*$", "", part, flags=re.IGNORECASE).strip()
        if part and len(part) > 2:
            result.append(_title_case_industry(part))
    return result


def _title_case_industry(name: str) -> str:
    """Normalise capitalisation: 'PRINTING & RELATED' → 'Printing & Related'."""
    # If already mixed case, leave it
    if name != name.upper() and name != name.lower():
        return name
    return name.title()


def _clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()
