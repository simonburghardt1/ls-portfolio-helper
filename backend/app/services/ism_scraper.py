"""
ISM Manufacturing Report scraper.
Sources:
  - PRNewswire press releases (historical, ~10 years)
  - ismworld.org (current/recent reports, monthly scheduler)
URL discovery uses PRNewswire's search page, which returns static HTML.
"""

import difflib
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
MONTH_MAP_ABBR = {m[:3]: i + 1 for i, m in enumerate(MONTH_NAMES)}  # "dec", "sep" ("Sept." → "sep")

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
    respondent_comments = _parse_respondent_comments(soup)

    return {
        "date":                report_date,
        "components":          components,
        "industry_rankings":   industry_rankings,
        "respondent_comments": respondent_comments,
        "source_url":          url,
        "report_html":         _extract_report_html(html),
    }


# ── Full report body ───────────────────────────────────────────────────────────

# The body is rendered as HTML on the Full Report tab, so everything outside this
# formatting/table whitelist is dropped or unwrapped, and every attribute except
# colspan/rowspan is removed — no links, scripts, styles, images or event handlers survive.
_REPORT_ALLOWED_TAGS = {
    "p", "br", "b", "strong", "i", "em", "u", "sup", "sub",
    "ul", "ol", "li", "h2", "h3", "h4",
    "table", "thead", "tbody", "tr", "th", "td",
}
_REPORT_DROPPED_TAGS = {"script", "style", "noscript", "iframe", "img", "svg", "form", "button", "input", "object", "embed"}
_REPORT_ALLOWED_ATTRS = {"colspan", "rowspan"}


def _extract_report_html(html: str) -> Optional[str]:
    """Sanitized HTML of the PRNewswire release body, or None if the page has none
    (e.g. a non-PRNewswire mirror picked up by scrape_latest_from_prnewswire)."""
    body = BeautifulSoup(html, "html.parser").select_one("section.release-body")
    if body is None:
        return None

    for tag in body.find_all(_REPORT_DROPPED_TAGS):
        tag.decompose()
    for tag in body.find_all(True):
        if tag.name not in _REPORT_ALLOWED_TAGS:
            tag.unwrap()
        else:
            tag.attrs = {k: v for k, v in tag.attrs.items() if k in _REPORT_ALLOWED_ATTRS}

    return body.decode_contents().strip() or None


# ── Date extraction ────────────────────────────────────────────────────────────

_DATELINE_RE = re.compile(r"\b([A-Z][a-z]{2,8})\.?\s+\d{1,2},\s+(20\d{2})\s*/PRNewswire/")


def _extract_date(url: str, soup: BeautifulSoup) -> Optional[date]:
    """
    Report month, from the release's own dateline first ("TEMPE, Ariz., Dec. 1, 2016
    /PRNewswire/" → released the month after the data, so November 2016), then the URL,
    then the <title>. Page headings are deliberately never used: pre-2020 releases have
    no year in URL or title, and the first heading with a month+year on the page is
    PRNewswire's "related news" sidebar — which stamped every such release with whatever
    month that sidebar showed at import time.
    """
    body = soup.select_one("section.release-body")
    if body is not None:
        m = _DATELINE_RE.search(body.get_text(" ", strip=True))
        month = MONTH_MAP_ABBR.get(m.group(1)[:3].lower()) if m else None
        if month:
            year = int(m.group(2))
            return date(year - 1, 12, 1) if month == 1 else date(year, month - 1, 1)

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


# ── Industry rankings parser ───────────────────────────────────────────────────

# ISM words the same ranked list many different ways across years ("The 13 industries reporting
# growth in new orders in May — in the following order — are: …", "Of 18 manufacturing
# industries, 11 reported employment growth in May: …", "…paying increased prices for raw
# materials, in order, are: …"; 235 distinct lead-ins across 2016-2026). So instead of one
# rigid pattern per phrasing, find every "<lead-in mentioning industries>: <list>." sentence,
# then classify the lead-in by keyword: which component, and growth vs. contraction list.

_LIST_SENTENCE_RE = re.compile(
    r"(?:^|(?<=[.!?]\s))([^.:]{0,300}?\bindustr[^.:]{0,300}?):\s*([^.]{3,})\.", re.IGNORECASE
)

# Lists that name industries but aren't rankings: NAICS panel composition, BEA/GDP size
# ordering, "all of the six biggest industries expanded", and no-change lists.
_NOT_A_RANKING_RE = re.compile(r"naics|\bbea\b|\bgdp\b|biggest|largest|composition|no change|unchanged|the same", re.I)

# Checked in order — more specific phrases first ("new export orders" before "new orders",
# "customers' inventories" before "inventories"). No match → the overall PMI list.
_COMPONENT_KEYWORDS: list[tuple[str, re.Pattern]] = [
    ("new_export_orders",     re.compile(r"export", re.I)),
    ("imports",               re.compile(r"\bimports?\b", re.I)),
    ("customers_inventories", re.compile(r"customers?['’]?\s*inventor", re.I)),
    ("backlog_of_orders",     re.compile(r"backlog", re.I)),
    ("new_orders",            re.compile(r"new\s+orders", re.I)),
    ("production",            re.compile(r"\bproduction\b", re.I)),
    ("employment",            re.compile(r"\bemploy", re.I)),
    ("supplier_deliveries",   re.compile(r"deliver", re.I)),
    ("inventories",           re.compile(r"inventor", re.I)),
    ("prices",                re.compile(r"\bprices?\b", re.I)),
]

_POSITIVE_RE = re.compile(r"growth|grow|increas|higher|expan|greater|ris(?:e|ing)", re.I)
_NEGATIVE_RE = re.compile(r"decreas|declin|contract|lower|reduc|fewer|falling", re.I)

# Each component's detail section opens with its name inline at the start of a paragraph:
# "Imports ISM®'s Imports Index remained in contraction…". Some lead-ins inside a section drop
# the component noun ("The 13 industries that reported lower volumes in December…" under
# Imports; "…reporting a decrease in April…" under New Orders), so they fall back to the
# section they're in. Before the first section heading (the intro), the fallback is the PMI.
_SECTION_HEADING_RE = re.compile(
    r"^(new export orders|new orders|production|employment|supplier deliveries|"
    r"customers\W{0,2}\s*inventories|inventories|prices|backlog of orders|imports)\b[^.]{0,12}?\bism\b",
    re.I,
)


def _classify_list_lead_in(lead_in: str, section_component: str = "pmi") -> Optional[tuple[str, int]]:
    """(component_col, +1 growth list / -1 contraction list), or None if not a ranking."""
    if _NOT_A_RANKING_RE.search(lead_in):
        return None
    component = next((col for col, kw in _COMPONENT_KEYWORDS if kw.search(lead_in)), section_component)

    # Components whose "good" direction isn't growth/decline wording
    if component == "supplier_deliveries":
        if re.search(r"slower", lead_in, re.I):
            return component, +1
        if re.search(r"faster", lead_in, re.I):
            return component, -1
        return None
    if component == "customers_inventories":  # too low = positive for future output, too high = negative
        if re.search(r"too\s+low|\blower\b", lead_in, re.I):
            return component, +1
        if re.search(r"too\s+high|\bhigher\b", lead_in, re.I):
            return component, -1
        return None

    pos, neg = _POSITIVE_RE.search(lead_in), _NEGATIVE_RE.search(lead_in)
    if pos and neg:  # take whichever direction word comes first
        return component, (+1 if pos.start() < neg.start() else -1)
    if pos:
        return component, +1
    if neg:
        return component, -1
    return None


def _parse_industry_rankings(soup: BeautifulSoup) -> dict[str, list[dict]]:
    """
    Returns: {component_col: [{"industry": str, "score": int}, ...]}
    Positive score = growth rank, negative = decline rank.
    Industries not mentioned are NOT included (score = 0 implied).
    """
    rankings: dict[str, list[dict]] = {}
    seen_lists: set[tuple[str, int]] = set()
    section = "pmi"

    for p in soup.find_all("p"):
        text = p.get_text(" ", strip=True)
        if not text:
            continue
        heading = _SECTION_HEADING_RE.match(text)
        if heading:
            section = re.sub(r"\W+", "_", heading.group(1).lower()).strip("_")
        if text[-1] not in ".!?:;":
            text += "."  # so a list that runs to the end of the paragraph still terminates

        for match in _LIST_SENTENCE_RE.finditer(text):
            classified = _classify_list_lead_in(match.group(1), section)
            if classified is None or classified in seen_lists:
                continue  # not a ranking, or a repeat of a list already taken for this component/direction
            industries = _split_industry_list(match.group(2))
            if not industries:
                continue
            seen_lists.add(classified)
            comp, direction = classified
            entries = rankings.setdefault(comp, [])
            already = {e["industry"] for e in entries}
            n = len(industries)
            for i, ind in enumerate(industries):
                if ind not in already:  # (date, component, industry) is unique in the DB
                    entries.append({"industry": ind, "score": (n - i) * direction})

    return rankings


# ── Respondent comments parser ─────────────────────────────────────────────────

_COMMENT_RE = re.compile(
    r'["\u201c\u2018]'          # opening quote (straight, curly double, or curly single)
    r'(.+?)'                     # quote body (non-greedy)
    r'["\u201d\u2019]'          # closing quote
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

    # Find the section heading
    target_ul = None
    for tag in soup.find_all(["h2", "h3", "h4", "p", "b", "strong"]):
        if "what respondents are saying" in tag.get_text().lower():
            # Walk siblings until we hit a <ul>
            for sib in tag.find_next_siblings():
                if sib.name == "ul":
                    target_ul = sib
                    break
                if sib.name in ("h2", "h3", "h4"):
                    break  # hit the next section heading without finding a <ul>
            break

    # Collect <li> elements from the target <ul>, or fall back to all <li>s in the doc
    items = target_ul.find_all("li") if target_ul else soup.find_all("li")

    for li in items:
        text = li.get_text(" ", strip=True)
        m = _COMMENT_RE.search(text)
        if not m:
            continue
        quote   = m.group(1).strip()
        raw_industry = m.group(2).strip().rstrip(".,;")
        industry = _canonical_industry(raw_industry) or _title_case_industry(raw_industry)
        if industry and quote and industry not in comments:
            comments[industry] = quote

    return comments


# The 18 NAICS-based industries ISM reports on. Releases spell them inconsistently
# ("Plastics and Rubber Products", non-breaking spaces, …), which would otherwise split one
# industry into several heatmap rows.
CANONICAL_INDUSTRIES = [
    "Apparel, Leather & Allied Products", "Chemical Products", "Computer & Electronic Products",
    "Electrical Equipment, Appliances & Components", "Fabricated Metal Products",
    "Food, Beverage & Tobacco Products", "Furniture & Related Products", "Machinery",
    "Miscellaneous Manufacturing", "Nonmetallic Mineral Products", "Paper Products",
    "Petroleum & Coal Products", "Plastics & Rubber Products", "Primary Metals",
    "Printing & Related Support Activities", "Textile Mills", "Transportation Equipment", "Wood Products",
]
_CANONICAL_BY_KEY = {c.lower(): c for c in CANONICAL_INDUSTRIES}


def _canonical_industry(name: str) -> Optional[str]:
    key = re.sub(r"\s+", " ", name.replace(" ", " ")).strip()
    key = re.sub(r"\s+and\s+", " & ", key, flags=re.IGNORECASE)
    key = re.sub(r"\s*&\s*", " & ", key).lower()
    if key in _CANONICAL_BY_KEY:
        return _CANONICAL_BY_KEY[key]
    # Typos like "Petroleum & Coal Product" (0.98). The 0.9 cutoff deliberately leaves
    # genuinely ambiguous ones alone ("Plastic & Related Products": 0.81 Plastics & Rubber
    # vs 0.74 Furniture & Related) rather than guessing.
    close = difflib.get_close_matches(key, _CANONICAL_BY_KEY.keys(), n=1, cutoff=0.9)
    return _CANONICAL_BY_KEY[close[0]] if close else None


def _resolve_industries(part: str) -> list[str]:
    """One list entry → canonical industry name(s). Also splits an entry where ISM's text
    used a comma instead of a semicolon between two industries ("Machinery, Miscellaneous
    Manufacturing"), which a plain comma split can't do since some names contain commas.
    Unknown names are kept as-is rather than dropped, in case ISM's taxonomy changes."""
    canonical = _canonical_industry(part)
    if canonical:
        return [canonical]
    pieces = [p.strip() for p in part.split(",")]
    resolved, i = [], 0
    while i < len(pieces):
        for j in range(len(pieces), i, -1):  # longest run of pieces that forms one known name
            name = _canonical_industry(", ".join(pieces[i:j]))
            if name:
                resolved.append(name)
                i = j
                break
        else:
            # Longer than any real industry name (max 45 chars) = a sentence that ran into
            # the list, not an industry.
            return [] if len(part) > 60 else [_title_case_industry(part)]
    return resolved


def _split_industry_list(raw: str) -> list[str]:
    """Parse a ';'-separated industry list (a stray ':' is treated as a separator too),
    stripping 'and' and trailing punctuation, normalized to canonical industry names."""
    raw = raw.strip().rstrip(".")
    result = []
    for part in re.split(r"[;:]\s*", raw):
        # Remove leading "and "
        part = re.sub(r"^\s*and\s+", "", part, flags=re.IGNORECASE).strip()
        # Remove trailing " and ..."
        part = re.sub(r"\s+and\s*$", "", part, flags=re.IGNORECASE).strip()
        if part and len(part) > 2:
            result.extend(_resolve_industries(part))
    return result


def _title_case_industry(name: str) -> str:
    """Normalise capitalisation: 'PRINTING & RELATED' → 'Printing & Related'."""
    # If already mixed case, leave it
    if name != name.upper() and name != name.lower():
        return name
    return name.title()


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
    industry_rankings = _parse_industry_rankings(soup)

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
