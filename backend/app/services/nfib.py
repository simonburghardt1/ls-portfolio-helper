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

# The 10 questions that compose OPT_INDEX
OPT_QUESTIONS = ",".join([
    "emp_count_change_expect", "cap_ex_expect", "inventory_expect",
    "bus_cond_expect", "sales_expect", "inventory_current",
    "job_opening_unfilled", "credit_access_expect", "expand_good", "earn_change",
])


async def _fetch_industry_index(industry_id: str) -> tuple[list[str], list[float]]:
    """
    Compute OPT_INDEX for a single industry by fetching all 10 sub-components
    via getTotals2 with industry filter, then applying:
        OPT_INDEX = (sum_of_10_nets / 10) + 100
    (unajusted equivalent of the seasonally-adjusted official series)
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

    # Group by (monthyear, question) → totalcounts per acode
    by_month_quest: dict[str, dict[str, dict[int, int]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    for row in rows:
        my   = row.get("monthyear", "")
        q    = row.get("resp_q_short", "")
        code = row.get("resp_acode")
        cnt  = row.get("totalcount", 0)
        if my and q and code is not None:
            by_month_quest[my][q][int(code)] += int(cnt or 0)

    dates, values = [], []
    for my, quests in by_month_quest.items():
        nets = []
        for q, formula in NET_FORMULA.items():
            if q in quests:
                pos_c, neg_c = formula
                nets.append(_net(quests[q], pos_c, neg_c))
        if len(nets) == 10:          # only publish months where all 10 questions present
            try:
                dates.append(_to_iso(my))
                values.append(round(sum(nets) / 10 + 100, 3))
            except (ValueError, IndexError):
                continue

    pairs = sorted(zip(dates, values))
    return [p[0] for p in pairs], [p[1] for p in pairs]


async def refresh_all_industries(db) -> dict:
    """Fetch OPT_INDEX for all 8 industries and upsert into MacroCache."""
    from app.models.macro_cache import MacroCache

    summary = {}
    for series_id, meta in INDUSTRIES.items():
        try:
            dates, values = await _fetch_industry_index(meta["id"])
            row = db.get(MacroCache, series_id)
            if row is None:
                row = MacroCache(series_id=series_id, dates=[], values=[],
                                 fetched_at=datetime.now(timezone.utc))
                db.add(row)
            row.dates      = dates
            row.values     = values
            row.fetched_at = datetime.now(timezone.utc)
            summary[series_id] = len(dates)
            log.info("NFIB industry %s (%s): %d rows", series_id, meta["label"], len(dates))
        except Exception as exc:
            log.warning("NFIB industry %s failed: %s", series_id, exc)

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
