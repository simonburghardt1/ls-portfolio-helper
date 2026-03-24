"""
NFIB Small Business Economic Trends (SBET) data service.

OPT_INDEX uses getIndicators2 (direct value).
All other components use getTotals2 (microdata → net formula per indicator).

Net formulas reverse-engineered from https://www.nfib-sbet.org/javascript/main-indicators.js
"""

import logging
from collections import defaultdict
from datetime import datetime, timezone

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

log = logging.getLogger(__name__)

NFIB_BASE    = "https://api.nfib-sbet.org/rest/sbetdb/_proc"
NFIB_HEADERS = {"X-DreamFactory-Application-Name": "sbet"}

# series_id → {label, indicator (NFIB key), color, source}
COMPONENTS = {
    "NFIB_OPT_INDEX":     {"label": "Small Business Optimism",       "indicator": "OPT_INDEX",              "color": "#3b82f6", "source": "index"},
    "NFIB_EMP_EXPECT":    {"label": "Plans to Increase Employment",  "indicator": "emp_count_change_expect", "color": "#10b981", "source": "totals"},
    "NFIB_CAPEX_EXPECT":  {"label": "Plans to Make Capital Outlays", "indicator": "cap_ex_expect",           "color": "#f59e0b", "source": "totals"},
    "NFIB_INV_EXPECT":    {"label": "Plans to Increase Inventories", "indicator": "inventory_expect",        "color": "#8b5cf6", "source": "totals"},
    "NFIB_BUS_COND":      {"label": "Expect Economy to Improve",     "indicator": "bus_cond_expect",         "color": "#ef4444", "source": "totals"},
    "NFIB_SALES_EXPECT":  {"label": "Expect Retail Sales Higher",    "indicator": "sales_expect",            "color": "#06b6d4", "source": "totals"},
    "NFIB_INV_CURRENT":   {"label": "Current Inventory",             "indicator": "inventory_current",       "color": "#f97316", "source": "totals"},
    "NFIB_JOB_OPENINGS":  {"label": "Current Job Openings",          "indicator": "job_opening_unfilled",    "color": "#84cc16", "source": "totals"},
    "NFIB_CREDIT_EXPECT": {"label": "Expected Credit Conditions",    "indicator": "credit_access_expect",    "color": "#ec4899", "source": "totals"},
    "NFIB_EXPAND":        {"label": "Good Time to Expand",           "indicator": "expand_good",             "color": "#14b8a6", "source": "totals"},
    "NFIB_EARN_TREND":    {"label": "Earnings Trends",               "indicator": "earn_change",             "color": "#a78bfa", "source": "totals"},
}


def _net(answers: dict, pos: list[int], neg: list[int]) -> float:
    """Compute net % = sum(positive acodes) - sum(negative acodes) over total."""
    total = sum(answers.values())
    if not total:
        return 0.0
    p = sum(answers.get(k, 0) for k in pos)
    n = sum(answers.get(k, 0) for k in neg)
    return (p - n) / total * 100


# Net formula per indicator: (positive_acodes, negative_acodes)
# Source: main-indicators.js switch statement
NET_FORMULA: dict[str, tuple[list, list]] = {
    "emp_count_change_expect": ([1],       [3]),
    "cap_ex_expect":           ([1],       []),      # % planning capex
    "inventory_expect":        ([1, 2],    [4, 5]),
    "bus_cond_expect":         ([1, 2],    [4, 5]),
    "sales_expect":            ([1, 2],    [4, 5]),
    "inventory_current":       ([3],       [1]),      # too low minus too high
    "job_opening_unfilled":    ([1, 2, 3], []),       # % with any openings
    "credit_access_expect":    ([1],       [3]),
    "expand_good":             ([1],       []),       # % saying good time
    "earn_change":             ([1, 2],    [4, 5]),
}


def _to_iso(monthyear: str) -> str:
    """Convert 'M/D/YYYY' or 'YYYY/M/D' → 'YYYY-MM-01'."""
    parts = monthyear.split("/")
    if len(parts[0]) == 4:          # YYYY/M/D
        return f"{int(parts[0]):04d}-{int(parts[1]):02d}-01"
    else:                           # M/D/YYYY
        return f"{int(parts[2]):04d}-{int(parts[0]):02d}-01"


def _base_params(min_year: int = 1986) -> dict:
    """Common date-range parameters shared by all NFIB API calls."""
    return {
        "app_name": "sbet",
        "params[0][name]": "minYear",   "params[0][param_type]": "IN", "params[0][value]": min_year,
        "params[1][name]": "minMonth",  "params[1][param_type]": "IN", "params[1][value]": 1,
        "params[2][name]": "maxYear",   "params[2][param_type]": "IN", "params[2][value]": 2100,
        "params[3][name]": "maxMonth",  "params[3][param_type]": "IN", "params[3][value]": 12,
    }


async def _fetch_index(indicator: str) -> tuple[list[str], list[float]]:
    """Fetch OPT_INDEX (and similar single-value series) via getIndicators2."""
    params = _base_params()
    params["params[4][name]"] = "indicator"
    params["params[4][param_type]"] = "IN"
    params["params[4][value]"] = indicator

    async with httpx.AsyncClient(headers=NFIB_HEADERS, timeout=30, verify=False) as client:
        resp = await client.post(f"{NFIB_BASE}/getIndicators2", data=params)
        resp.raise_for_status()
        rows = resp.json()

    dates, values = [], []
    for row in rows:
        my  = row.get("monthyear") or row.get("monthyear_new", "")
        val = row.get(indicator)
        if not my or val is None:
            continue
        try:
            dates.append(_to_iso(my))
            values.append(float(val))
        except (ValueError, IndexError):
            continue

    pairs = sorted(zip(dates, values))
    return [p[0] for p in pairs], [p[1] for p in pairs]


async def _fetch_totals(indicator: str) -> tuple[list[str], list[float]]:
    """Fetch a component series via getTotals2 and compute net value per month."""
    pos_codes, neg_codes = NET_FORMULA[indicator]

    params = _base_params()
    params["params[4][name]"] = "questions";  params["params[4][param_type]"] = "IN"; params["params[4][value]"] = indicator
    params["params[5][name]"] = "industry";   params["params[5][param_type]"] = "IN"; params["params[5][value]"] = ""
    params["params[6][name]"] = "employee";   params["params[6][param_type]"] = "IN"; params["params[6][value]"] = ""
    params["params[7][name]"] = "statev";     params["params[7][param_type]"] = "IN"; params["params[7][value]"] = ""

    async with httpx.AsyncClient(headers=NFIB_HEADERS, timeout=30, verify=False) as client:
        resp = await client.post(f"{NFIB_BASE}/getTotals2", data=params)
        resp.raise_for_status()
        rows = resp.json()

    # Group totalcount by (monthyear, acode)
    by_month: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for row in rows:
        my   = row.get("monthyear", "")
        code = row.get("resp_acode")
        cnt  = row.get("totalcount", 0)
        if my and code is not None:
            by_month[my][int(code)] += int(cnt or 0)

    dates, values = [], []
    for my, answers in by_month.items():
        try:
            dates.append(_to_iso(my))
            values.append(_net(answers, pos_codes, neg_codes))
        except (ValueError, IndexError):
            continue

    pairs = sorted(zip(dates, values))
    return [p[0] for p in pairs], [p[1] for p in pairs]


async def fetch_component(series_id: str) -> tuple[list[str], list[float]]:
    meta = COMPONENTS[series_id]
    if meta["source"] == "index":
        return await _fetch_index(meta["indicator"])
    return await _fetch_totals(meta["indicator"])


# Industries available in the NFIB SBET portal
INDUSTRIES: dict[str, dict] = {
    "NFIB_IND_1": {"id": "1", "label": "Construction",    "color": "#f59e0b"},
    "NFIB_IND_2": {"id": "2", "label": "Manufacturing",   "color": "#3b82f6"},
    "NFIB_IND_3": {"id": "3", "label": "Transportation",  "color": "#10b981"},
    "NFIB_IND_4": {"id": "4", "label": "Wholesale",       "color": "#8b5cf6"},
    "NFIB_IND_5": {"id": "5", "label": "Retail",          "color": "#ef4444"},
    "NFIB_IND_6": {"id": "6", "label": "Agriculture",     "color": "#84cc16"},
    "NFIB_IND_7": {"id": "7", "label": "Finance",         "color": "#06b6d4"},
    "NFIB_IND_8": {"id": "8", "label": "Services",        "color": "#ec4899"},
}

# NFIB regions — aligned with US Census Bureau divisions
# State abbreviations are passed as the statev parameter to getTotals2
REGIONS: dict[str, dict] = {
    "NFIB_REG_NE":  {"states": "CT,ME,MA,NH,RI,VT,NJ,NY,PA",      "label": "Northeast",          "color": "#3b82f6"},
    "NFIB_REG_SA":  {"states": "DE,MD,DC,VA,WV,NC,SC,GA,FL",       "label": "South Atlantic",     "color": "#10b981"},
    "NFIB_REG_ESC": {"states": "AL,KY,MS,TN",                      "label": "East South Central", "color": "#f59e0b"},
    "NFIB_REG_GL":  {"states": "IL,IN,MI,OH,WI",                   "label": "Great Lakes",        "color": "#8b5cf6"},
    "NFIB_REG_PL":  {"states": "IA,KS,MN,MO,NE,ND,SD",            "label": "Plains",             "color": "#ef4444"},
    "NFIB_REG_WSC": {"states": "AR,LA,OK,TX",                      "label": "West South Central", "color": "#06b6d4"},
    "NFIB_REG_MT":  {"states": "AZ,CO,ID,MT,NV,NM,UT,WY",         "label": "Mountains",          "color": "#f97316"},
    "NFIB_REG_PAC": {"states": "AK,CA,HI,OR,WA",                   "label": "Pacific",            "color": "#ec4899"},
}

# The 10 questions that compose OPT_INDEX
OPT_QUESTIONS = ",".join([
    "emp_count_change_expect", "cap_ex_expect", "inventory_expect",
    "bus_cond_expect", "sales_expect", "inventory_current",
    "job_opening_unfilled", "credit_access_expect", "expand_good", "earn_change",
])


# Reverse map: NFIB indicator name → COMPONENTS series_id (totals-sourced only)
_INDICATOR_TO_SERIES: dict[str, str] = {
    v["indicator"]: k for k, v in COMPONENTS.items() if v["source"] == "totals"
}


async def _fetch_region_raw(statev: str) -> dict[str, dict[str, dict[int, int]]]:
    """
    Single API call: fetch all 10 question responses for a geographic region via getTotals2.
    `statev` is a comma-separated list of US state abbreviations (e.g. "CT,ME,MA,NH,RI,VT,NJ,NY,PA").
    Returns by_month_quest: {monthyear → {question → {acode → count}}}
    """
    params = _base_params()
    params["params[4][name]"] = "questions";  params["params[4][param_type]"] = "IN"; params["params[4][value]"] = OPT_QUESTIONS
    params["params[5][name]"] = "industry";   params["params[5][param_type]"] = "IN"; params["params[5][value]"] = ""
    params["params[6][name]"] = "employee";   params["params[6][param_type]"] = "IN"; params["params[6][value]"] = ""
    params["params[7][name]"] = "statev";     params["params[7][param_type]"] = "IN"; params["params[7][value]"] = statev

    async with httpx.AsyncClient(headers=NFIB_HEADERS, timeout=60, verify=False) as client:
        resp = await client.post(f"{NFIB_BASE}/getTotals2", data=params)
        resp.raise_for_status()
        rows = resp.json()

    by_month_quest: dict[str, dict[str, dict[int, int]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    for row in rows:
        my   = row.get("monthyear", "")
        q    = row.get("resp_q_short", "")
        code = row.get("resp_acode")
        cnt  = row.get("totalcount", 0)
        if my and q and code is not None:
            by_month_quest[my][q][int(code)] += int(cnt or 0)

    return by_month_quest


async def _fetch_industry_raw(industry_id: str) -> dict[str, dict[str, dict[int, int]]]:
    """
    Single API call: fetch all 10 question responses for a given industry via getTotals2.
    Returns by_month_quest: {monthyear → {question → {acode → count}}}
    """
    params = _base_params()
    params["params[4][name]"] = "questions";  params["params[4][param_type]"] = "IN"; params["params[4][value]"] = OPT_QUESTIONS
    params["params[5][name]"] = "industry";   params["params[5][param_type]"] = "IN"; params["params[5][value]"] = industry_id
    params["params[6][name]"] = "employee";   params["params[6][param_type]"] = "IN"; params["params[6][value]"] = ""
    params["params[7][name]"] = "statev";     params["params[7][param_type]"] = "IN"; params["params[7][value]"] = ""

    async with httpx.AsyncClient(headers=NFIB_HEADERS, timeout=60, verify=False) as client:
        resp = await client.post(f"{NFIB_BASE}/getTotals2", data=params)
        resp.raise_for_status()
        rows = resp.json()

    by_month_quest: dict[str, dict[str, dict[int, int]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    for row in rows:
        my   = row.get("monthyear", "")
        q    = row.get("resp_q_short", "")
        code = row.get("resp_acode")
        cnt  = row.get("totalcount", 0)
        if my and q and code is not None:
            by_month_quest[my][q][int(code)] += int(cnt or 0)

    return by_month_quest


def _industry_comp_key(industry_series_id: str, comp_series_id: str) -> str:
    """MacroCache key for a single industry+component pair, e.g. NFIB_IND_1__NFIB_EMP_EXPECT."""
    return f"{industry_series_id}__{comp_series_id}"


def _compute_index_from_raw(
    by_month_quest: dict,
) -> tuple[list[str], list[float]]:
    """
    Derive OPT_INDEX from raw microdata:
        OPT_INDEX = (sum_of_10_nets / 10) + 100
    Only months where all 10 questions are present are included.
    """
    dates, values = [], []
    for my, quests in by_month_quest.items():
        nets = [_net(quests[q], *formula) for q, formula in NET_FORMULA.items() if q in quests]
        if len(nets) == 10:
            try:
                dates.append(_to_iso(my))
                values.append(round(sum(nets) / 10 + 100, 3))
            except (ValueError, IndexError):
                continue
    pairs = sorted(zip(dates, values))
    return [p[0] for p in pairs], [p[1] for p in pairs]


def _compute_components_from_raw(
    by_month_quest: dict,
) -> dict[str, tuple[list[str], list[float]]]:
    """Derive individual component net % from raw microdata. Keys are COMPONENTS series IDs."""
    result: dict[str, tuple[list, list]] = {}
    for indicator, (pos_c, neg_c) in NET_FORMULA.items():
        comp_id = _INDICATOR_TO_SERIES.get(indicator)
        if comp_id is None:
            continue
        dates, values = [], []
        for my, quests in by_month_quest.items():
            if indicator in quests:
                try:
                    dates.append(_to_iso(my))
                    values.append(_net(quests[indicator], pos_c, neg_c))
                except (ValueError, IndexError):
                    continue
        pairs = sorted(zip(dates, values))
        result[comp_id] = ([p[0] for p in pairs], [p[1] for p in pairs])
    return result


def _upsert(db, series_id: str, dates: list, values: list) -> None:
    """
    Atomic upsert into MacroCache using PostgreSQL INSERT ... ON CONFLICT DO UPDATE.
    Safe to call multiple times with the same series_id within a single transaction.
    """
    from app.models.macro_cache import MacroCache
    stmt = pg_insert(MacroCache).values(
        series_id  = series_id,
        dates      = dates,
        values     = values,
        fetched_at = datetime.now(timezone.utc),
    ).on_conflict_do_update(
        index_elements=["series_id"],
        set_={"dates": dates, "values": values, "fetched_at": datetime.now(timezone.utc)},
    )
    db.execute(stmt)


async def get_industry_components(db, series_id: str) -> dict[str, tuple[list[str], list[float]]]:
    """
    Serve industry component nets from MacroCache.
    On cache miss, fetch from NFIB, populate the cache, and return.
    """
    from app.models.macro_cache import MacroCache

    # Check whether all 10 component rows exist in cache
    cached: dict[str, tuple[list, list]] = {}
    for comp_id in _INDICATOR_TO_SERIES.values():
        key = _industry_comp_key(series_id, comp_id)
        row = db.get(MacroCache, key)
        if row and row.dates:
            cached[comp_id] = (row.dates, row.values)

    if len(cached) == len(_INDICATOR_TO_SERIES):
        return cached

    # Cache miss — fetch from NFIB and populate all rows
    log.info("NFIB industry components cache miss for %s — fetching live", series_id)
    raw        = await _fetch_industry_raw(INDUSTRIES[series_id]["id"])
    components = _compute_components_from_raw(raw)
    for comp_id, (dates, values) in components.items():
        _upsert(db, _industry_comp_key(series_id, comp_id), dates, values)
    db.commit()
    return components


async def refresh_all_industries(db) -> dict:
    """
    Fetch all 8 industry OPT_INDEX series and their component breakdowns,
    upsert everything into MacroCache.
    One API call per industry covers both the index and all 10 components.
    """
    summary = {}
    for series_id, meta in INDUSTRIES.items():
        try:
            raw = await _fetch_industry_raw(meta["id"])

            # OPT_INDEX
            dates, values = _compute_index_from_raw(raw)
            _upsert(db, series_id, dates, values)
            summary[series_id] = len(dates)
            log.info("NFIB industry %s (%s): %d rows", series_id, meta["label"], len(dates))

            # Component breakdown (free — derived from the same raw response)
            for comp_id, (comp_dates, comp_values) in _compute_components_from_raw(raw).items():
                _upsert(db, _industry_comp_key(series_id, comp_id), comp_dates, comp_values)

        except Exception as exc:
            log.warning("NFIB industry %s failed: %s", series_id, exc)

    db.commit()
    return summary


async def get_region_components(db, series_id: str) -> dict[str, tuple[list[str], list[float]]]:
    """
    Serve region component nets from MacroCache.
    On cache miss, fetch from NFIB, populate the cache, and return.
    """
    from app.models.macro_cache import MacroCache

    cached: dict[str, tuple[list, list]] = {}
    for comp_id in _INDICATOR_TO_SERIES.values():
        key = _industry_comp_key(series_id, comp_id)   # same key scheme: ID__COMP_ID
        row = db.get(MacroCache, key)
        if row and row.dates:
            cached[comp_id] = (row.dates, row.values)

    if len(cached) == len(_INDICATOR_TO_SERIES):
        return cached

    log.info("NFIB region components cache miss for %s — fetching live", series_id)
    raw        = await _fetch_region_raw(REGIONS[series_id]["states"])
    components = _compute_components_from_raw(raw)
    for comp_id, (dates, values) in components.items():
        _upsert(db, _industry_comp_key(series_id, comp_id), dates, values)
    db.commit()
    return components


async def refresh_all_regions(db) -> dict:
    """
    Fetch OPT_INDEX and component breakdowns for all 4 Census regions,
    upsert everything into MacroCache. One API call per region.
    """
    summary = {}
    for series_id, meta in REGIONS.items():
        try:
            raw = await _fetch_region_raw(meta["states"])

            dates, values = _compute_index_from_raw(raw)
            _upsert(db, series_id, dates, values)
            summary[series_id] = len(dates)
            log.info("NFIB region %s (%s): %d rows", series_id, meta["label"], len(dates))

            for comp_id, (comp_dates, comp_values) in _compute_components_from_raw(raw).items():
                _upsert(db, _industry_comp_key(series_id, comp_id), comp_dates, comp_values)

        except Exception as exc:
            log.warning("NFIB region %s failed: %s", series_id, exc)

    db.commit()
    return summary


async def refresh_all_components(db) -> dict:
    """Fetch all NFIB component series and upsert into MacroCache."""
    from app.models.macro_cache import MacroCache

    summary = {}
    for series_id in COMPONENTS:
        try:
            dates, values = await fetch_component(series_id)
            row = db.get(MacroCache, series_id)
            if row is None:
                row = MacroCache(series_id=series_id, dates=[], values=[],
                                 fetched_at=datetime.now(timezone.utc))
                db.add(row)
            row.dates      = dates
            row.values     = values
            row.fetched_at = datetime.now(timezone.utc)
            summary[series_id] = len(dates)
            log.info("NFIB %s: %d rows", series_id, len(dates))
        except Exception as exc:
            log.warning("NFIB %s failed: %s", series_id, exc)

    db.commit()
    return summary
