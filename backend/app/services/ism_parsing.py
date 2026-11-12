"""
Parsing shared by the ISM Manufacturing and ISM Services PRNewswire scrapers.

Both reports are written to the same template: a dateline, a headline table, one detail
section per component with ranked industry lists, and respondent comments. What differs is
the component set and the industry taxonomy, which each scraper passes to IsmReportParser.
"""

import difflib
import re
from datetime import date
from typing import Optional

from bs4 import BeautifulSoup

MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]
MONTH_MAP_ABBR = {m[:3]: i + 1 for i, m in enumerate(MONTH_NAMES)}  # "dec", "sep" ("Sept." → "sep")


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


def extract_report_html(html: str) -> Optional[str]:
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


def report_month_from_dateline(soup: BeautifulSoup) -> Optional[date]:
    """Report month from the release's own dateline ("TEMPE, Ariz., Dec. 1, 2016 /PRNewswire/"):
    ISM releases in the month after the data, so that is November 2016. None without a dateline."""
    body = soup.select_one("section.release-body")
    if body is None:
        return None
    m = _DATELINE_RE.search(body.get_text(" ", strip=True))
    month = MONTH_MAP_ABBR.get(m.group(1)[:3].lower()) if m else None
    if not month:
        return None
    year = int(m.group(2))
    return date(year - 1, 12, 1) if month == 1 else date(year, month - 1, 1)


# ── Industry rankings ──────────────────────────────────────────────────────────

# ISM words the same ranked list many different ways across years ("The 13 industries reporting
# growth in new orders in May — in the following order — are: …", "Of 18 manufacturing
# industries, 11 reported employment growth in May: …", "…paying increased prices for raw
# materials, in order, are: …"; 235 distinct lead-ins across 2016-2026 in Manufacturing alone).
# So instead of one rigid pattern per phrasing, find every "<lead-in mentioning industries>: <list>."
# sentence, then classify the lead-in by keyword: which component, and growth vs. contraction list.

_LIST_SENTENCE_RE = re.compile(
    r"(?:^|(?<=[.!?]\s))([^.:]{0,300}?\bindustr[^.:]{0,300}?):\s*([^.]{3,})\.", re.IGNORECASE
)

# Lists that name industries but aren't rankings: NAICS panel composition, BEA/GDP size
# ordering, "all of the six biggest industries expanded", and no-change lists.
_NOT_A_RANKING_RE = re.compile(r"naics|\bbea\b|\bgdp\b|biggest|largest|composition|no change|unchanged|the same", re.I)

_POSITIVE_RE = re.compile(r"growth|grow|increas|higher|expan|greater|ris(?:e|ing)", re.I)
_NEGATIVE_RE = re.compile(r"decreas|declin|contract|lower|reduc|fewer|falling", re.I)

# Slower deliveries = expansion; this holds for both reports.
SUPPLIER_DELIVERIES_DIRECTION = [(re.compile(r"slower", re.I), +1), (re.compile(r"faster", re.I), -1)]

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
_COMMENT_WHOLE_ITEM_RE = re.compile(
    r'\s*["“‘](.+)["”’]\s*[\(\[]([A-Z][^()\[\]\n]{3,80})[\)\]]\s*$', re.DOTALL
)


def title_case_industry(name: str) -> str:
    """Normalise capitalisation: 'PRINTING & RELATED' → 'Printing & Related'."""
    if name != name.upper() and name != name.lower():
        return name
    return name.title()


class IsmReportParser:
    """
    Rankings and respondent-comment parser for one ISM report family.

    component_keywords:  [(component_col, regex)] checked in order against a list's lead-in —
                         more specific phrases first ("new export orders" before "new orders").
                         No match → the section the list is in (PMI before the first section).
    section_names:       regex alternation of the component section names. Each detail section
                         opens with its name inline at the start of a paragraph ("Imports ISM®'s
                         Imports Index…"), which some lead-ins rely on by dropping the component
                         noun ("The 13 industries that reported lower volumes in December…").
                         Section name → component col by lowercasing and joining words with "_".
    direction_overrides: {component_col: [(regex, sign)]} for components whose good direction
                         isn't growth/decline wording; first matching regex wins, none → not a ranking.
    canonical_industries: the report's industry taxonomy. Releases spell names inconsistently
                         ("Plastics and Rubber Products", non-breaking spaces, …), which would
                         otherwise split one industry into several heatmap rows.
    """

    def __init__(
        self,
        component_keywords: list[tuple[str, str]],
        section_names: str,
        direction_overrides: dict[str, list[tuple[re.Pattern, int]]],
        canonical_industries: list[str],
    ):
        self.component_keywords = [(col, re.compile(kw, re.I)) for col, kw in component_keywords]
        self.section_heading_re = re.compile(rf"^({section_names})\b[^.]{{0,12}}?\bism\b", re.I)
        self.direction_overrides = direction_overrides
        self.canonical_industries = canonical_industries
        self._canonical_by_key = {c.lower(): c for c in canonical_industries}

    # ── Lead-in classification ────────────────────────────────────────────────

    def classify_list_lead_in(self, lead_in: str, section_component: str = "pmi") -> Optional[tuple[str, int]]:
        """(component_col, +1 growth list / -1 contraction list), or None if not a ranking."""
        if _NOT_A_RANKING_RE.search(lead_in):
            return None
        component = next((col for col, kw in self.component_keywords if kw.search(lead_in)), section_component)

        if component in self.direction_overrides:
            return next(
                ((component, sign) for rx, sign in self.direction_overrides[component] if rx.search(lead_in)),
                None,
            )

        pos, neg = _POSITIVE_RE.search(lead_in), _NEGATIVE_RE.search(lead_in)
        if pos and neg:  # take whichever direction word comes first
            return component, (+1 if pos.start() < neg.start() else -1)
        if pos:
            return component, +1
        if neg:
            return component, -1
        return None

    def parse_rankings(self, soup: BeautifulSoup) -> dict[str, list[dict]]:
        """
        Returns: {component_col: [{"industry": str, "score": int}, ...]}
        Positive score = growth rank, negative = decline rank.
        Industries not mentioned are NOT included (score = 0 implied).
        """
        rankings: dict[str, list[dict]] = {}
        seen_lists: set[tuple[str, int]] = set()
        section = "pmi"
        carry = ""

        for p in soup.find_all("p"):
            text = p.get_text(" ", strip=True)
            if not text:
                continue
            # A list the release broke across two paragraphs ("…; Construction;" | "Finance &
            # Insurance; …") continues in the next one.
            text = f"{carry} {text}" if carry else text
            if text[-1] in ";,":
                carry = text
                continue
            carry = ""
            heading = self.section_heading_re.match(text)
            if heading:
                section = re.sub(r"\W+", "_", heading.group(1).lower()).strip("_")
            if text[-1] not in ".!?:;":
                text += "."  # so a list that runs to the end of the paragraph still terminates

            for match in _LIST_SENTENCE_RE.finditer(text):
                classified = self.classify_list_lead_in(match.group(1), section)
                if classified is None or classified in seen_lists:
                    continue  # not a ranking, or a repeat of a list already taken for this component/direction
                industries = self.split_industry_list(match.group(2))
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

    # ── Respondent comments ───────────────────────────────────────────────────

    def parse_respondent_comments(self, soup: BeautifulSoup) -> dict[str, str]:
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
                        break  # hit the next section heading without finding a <ul>
                break

        # Collect <li> elements from the target <ul>, or fall back to all <li>s in the doc
        items = target_ul.find_all("li") if target_ul else soup.find_all("li")

        for li in items:
            text = li.get_text(" ", strip=True)
            # Whole item = quote + "(Industry)": take the quote up to the LAST closing quote, so a
            # quote nested inside the comment ('… "Get out of China now" is resonating."') stays in it.
            m = _COMMENT_WHOLE_ITEM_RE.match(text) or _COMMENT_RE.search(text)
            if not m:
                continue
            quote = m.group(1).strip()
            raw_industry = m.group(2).strip().rstrip(".,;")
            industry = self.canonical_industry(raw_industry) or title_case_industry(raw_industry)
            if industry and quote and industry not in comments:
                comments[industry] = quote

        return comments

    # ── Industry names ────────────────────────────────────────────────────────

    def canonical_industry(self, name: str) -> Optional[str]:
        key = re.sub(r"\s+", " ", name.replace(" ", " ")).strip()
        key = re.sub(r"\s+and\s+", " & ", key, flags=re.IGNORECASE)
        key = re.sub(r"\s*&\s*", " & ", key).lower()
        if key in self._canonical_by_key:
            return self._canonical_by_key[key]
        # Typos like "Petroleum & Coal Product" (0.98). The 0.9 cutoff deliberately leaves
        # genuinely ambiguous ones alone ("Plastic & Related Products": 0.81 Plastics & Rubber
        # vs 0.74 Furniture & Related) rather than guessing.
        close = difflib.get_close_matches(key, self._canonical_by_key.keys(), n=1, cutoff=0.9)
        return self._canonical_by_key[close[0]] if close else None

    def resolve_industries(self, part: str) -> list[str]:
        """One list entry → canonical industry name(s). Also splits an entry where ISM's text
        used a comma or "and" instead of a semicolon between industries ("Machinery, Miscellaneous
        Manufacturing", "Construction and Information"), which a plain split can't do since some
        names contain commas or "and" ("Accommodation and Food Services").
        Unknown names are kept as-is rather than dropped, in case ISM's taxonomy changes."""
        canonical = self.canonical_industry(part)
        if canonical:
            return [canonical]
        tokens = re.split(r"(,\s*(?:and\s+)?|\s+and\s+)", part)  # pieces at even, separators at odd indexes
        pieces = tokens[0::2]
        resolved, i = [], 0
        while i < len(pieces):
            for j in range(len(pieces), i, -1):  # longest run of pieces that forms one known name
                name = self.canonical_industry("".join(tokens[2 * i:2 * j - 1]))
                if name:
                    resolved.append(name)
                    i = j
                    break
            else:
                # Longer than any real industry name (max 45 chars) = a sentence that ran into
                # the list, not an industry.
                return [] if len(part) > 60 else [title_case_industry(part)]
        return resolved

    def split_industry_list(self, raw: str) -> list[str]:
        """Parse a ';'-separated industry list (a stray ':' is treated as a separator too),
        stripping 'and' and trailing punctuation, normalized to canonical industry names."""
        raw = raw.strip().rstrip(".")
        result = []
        for part in re.split(r"[;:]\s*", raw):
            part = re.sub(r"^\s*and\s+", "", part, flags=re.IGNORECASE).strip()
            part = re.sub(r"\s+and\s*$", "", part, flags=re.IGNORECASE).strip()
            if part and len(part) > 2:
                result.extend(self.resolve_industries(part))
        return result
