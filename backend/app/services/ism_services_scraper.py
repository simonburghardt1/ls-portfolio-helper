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

    industry_rankings = _parse_industry_rankings(soup)
    respondent_comments = _parse_respondent_comments(soup)

    return {
        "date":                report_date,
        "components":          components,
        "industry_rankings":   industry_rankings,
        "respondent_comments": respondent_comments,
        "source_url":          url,
    }


# ── Date extraction ────────────────────────────────────────────────────────────

def _extract_date(url: str, soup: BeautifulSoup) -> Optional[date]:
    """Try URL first, then page title, then first heading."""
    d = _date_from_text(url.lower())
    if d:
        return d

    title = soup.find("title")
    if title:
        d = _date_from_text(title.get_text().lower())
        if d:
            return d

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


# ── Industry rankings parser ───────────────────────────────────────────────────

_MONTHS_RE = r"(?:january|february|march|april|may|june|july|august|september|october|november|december)"

# Each entry: (component_col, direction_sign, keyword_regex)
# The full compiled pattern is: keyword + up to 150 chars (non-period) + "are:"/"order:" + LIST.
_COMP_DIR_PATTERNS: list[tuple[str, int, str]] = [
    # Overall PMI — "services industries reporting growth in June — listed in order — are: ..."
    # Month name distinguishes this from component-specific paragraphs ("increase in new orders")
    ("pmi", +1, r"services\s+industries\s+reporting\s+growth\s+in\s+" + _MONTHS_RE),
    ("pmi", -1, r"industries\s+reporting\s+a\s+contraction\s+in\s+(?:the\s+month\s+of\s+)?" + _MONTHS_RE),
    # Business Activity/Production
    ("business_activity", +1, r"(?:an?\s+)?increase\s+in\s+business\s+activity"),
    ("business_activity", -1, r"(?:a\s+)?decrease\s+in\s+business\s+activity"),
    # New Orders
    ("new_orders", +1, r"(?:an?\s+)?increase\s+in\s+new\s+orders"),
    ("new_orders", -1, r"(?:a\s+)?decrease\s+in\s+new\s+orders"),
    # Employment
    ("employment", +1, r"(?:an?\s+)?increase\s+in\s+employment"),
    ("employment", -1, r"(?:a\s+)?decrease\s+in\s+employment"),
    # Supplier Deliveries — slower = expansion (positive), faster = contraction (negative)
    ("supplier_deliveries", +1, r"slower\s+(?:supplier\s+)?deliveries"),
    ("supplier_deliveries", -1, r"faster\s+(?:supplier\s+)?deliveries"),
    # Inventories
    ("inventories", +1, r"(?:an?\s+)?increase\s+in\s+inventories"),
    ("inventories", -1, r"(?:a\s+)?decrease\s+in\s+inventories"),
    # Prices — this section uses "..., in the following order: LIST." (no "are")
    ("prices", +1, r"(?:an?\s+)?increase\s+in\s+prices\s+paid"),
    ("prices", -1, r"(?:a\s+)?decrease\s+in\s+prices\s+paid"),
    # Backlog of Orders — press release calls the list "order backlogs"
    ("backlog_of_orders", +1, r"(?:an?\s+)?increase\s+in\s+order\s+backlogs"),
    ("backlog_of_orders", -1, r"(?:a\s+)?decrease\s+in\s+order\s+backlogs"),
    # New Export Orders
    ("new_export_orders", +1, r"(?:an?\s+)?increase\s+in\s+new\s+export\s+orders"),
    ("new_export_orders", -1, r"(?:a\s+)?decrease\s+in\s+new\s+export\s+orders"),
    # Imports
    ("imports", +1, r"(?:an?\s+)?increase\s+in\s+imports"),
    ("imports", -1, r"(?:a\s+)?decrease\s+in\s+imports"),
    # Inventory Sentiment — "too high" mentions are the expansion-side list;
    # the report labels the other side "a decrease in inventory sentiment" (not "too low")
    ("inventory_sentiment", +1, r"sentiment\s+that\s+their\s+inventories\s+were\s+too\s+high"),
    ("inventory_sentiment", -1, r"(?:a\s+)?decrease\s+in\s+inventory\s+sentiment"),
]

# Middle span allows any char except period so commas/dashes/colons don't break matching.
# Accepts either "...are: LIST." (most sections) or "...order: LIST." (Prices section).
_COMPILED_PATTERNS: list[tuple[str, int, re.Pattern]] = [
    (col, sign, re.compile(kw_re + r"[^.]{0,150}?(?:are?|order):\s+([^.]{5,})\.", re.IGNORECASE))
    for col, sign, kw_re in _COMP_DIR_PATTERNS
]


def _parse_industry_rankings(soup: BeautifulSoup) -> dict[str, list[dict]]:
    """
    Returns: {component_col: [{"industry": str, "score": int}, ...]}
    Positive score = growth/increase rank, negative = decline/decrease rank.
    Industries not mentioned are NOT included (score = 0 implied).
    """
    paragraphs = [p.get_text(" ", strip=True) for p in soup.find_all("p")]
    full_text = " ".join(paragraphs)

    rankings: dict[str, list[dict]] = {}

    for comp, direction, pattern in _COMPILED_PATTERNS:
        # Only the first match: some press releases repeat a component's lead-in
        # phrase later in unrelated boilerplate (observed for "employment" in one
        # report), which would otherwise produce duplicate (date, component,
        # industry) rows and violate the DB unique constraint on insert.
        match = pattern.search(full_text)
        if not match:
            continue
        industries = _split_industry_list(match.group(1))
        if not industries:
            continue
        n = len(industries)
        entries = rankings.setdefault(comp, [])
        for i, ind in enumerate(industries):
            entries.append({"industry": ind, "score": (n - i) * direction})

    return rankings


# ── Respondent comments parser ─────────────────────────────────────────────────

_COMMENT_RE = re.compile(
    r'["“‘]'          # opening quote (straight, curly double, or curly single)
    r'(.+?)'                     # quote body (non-greedy)
    r'["”’]'          # closing quote
    r'\s*'
    r'[\(\[]?'                   # optional open paren/bracket
    r'([A-Z][^)\]\n]{3,80})'    # industry name: capital start, 4-80 chars
    r'[\)\]]?\s*$',
    re.DOTALL,
)


def _parse_respondent_comments(soup: BeautifulSoup) -> dict[str, str]:
    """
    Parse the "WHAT RESPONDENTS ARE SAYING" section.
    Returns {industry_name: comment_text}.
    """
    comments: dict[str, str] = {}

    target_ul = None
    for tag in soup.find_all(["h2", "h3", "h4", "p", "b", "strong"]):
        if "what respondents are saying" in tag.get_text().lower():
            for sib in tag.find_next_siblings():
                if sib.name == "ul":
                    target_ul = sib
                    break
                if sib.name in ("h2", "h3", "h4"):
                    break
            break

    items = target_ul.find_all("li") if target_ul else soup.find_all("li")

    for li in items:
        text = li.get_text(" ", strip=True)
        m = _COMMENT_RE.search(text)
        if not m:
            continue
        quote   = m.group(1).strip()
        industry = _title_case_industry(m.group(2).strip().rstrip(".,;"))
        if industry and quote and industry not in comments:
            comments[industry] = quote

    return comments


def _split_industry_list(raw: str) -> list[str]:
    """Parse '; '-separated industry list, stripping 'and', trailing punctuation."""
    raw = raw.strip().rstrip(".")
    parts = re.split(r";\s*", raw)
    result = []
    for part in parts:
        part = re.sub(r"^\s*and\s+", "", part, flags=re.IGNORECASE).strip()
        part = re.sub(r"\s+and\s*$", "", part, flags=re.IGNORECASE).strip()
        if part and len(part) > 2:
            result.append(_title_case_industry(part))
    return result


def _title_case_industry(name: str) -> str:
    """Normalise capitalisation: 'PRINTING & RELATED' → 'Printing & Related'."""
    if name != name.upper() and name != name.lower():
        return name
    return name.title()


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
