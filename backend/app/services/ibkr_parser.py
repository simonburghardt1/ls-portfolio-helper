"""
Parse IBKR activity statement CSV (German locale, section-based format).

Row structure:  SectionName, Header|Data|SubTotal|Total, col1, col2, ...
The file may begin with a UTF-8 BOM (ï»¿).
"""
import csv
import datetime
import io
import logging
from collections import defaultdict, deque

log = logging.getLogger(__name__)


# ─── Low-level CSV parser ──────────────────────────────────────────────────────

def _parse_sections(content: str) -> dict:
    """
    Return {section_name: {"headers": [...], "rows": [[...], ...]}}
    Skips SubTotal / Total rows.
    """
    content = content.lstrip("\ufeff").lstrip("ï»¿")

    sections: dict[str, dict] = {}
    reader = csv.reader(io.StringIO(content))

    for row in reader:
        if len(row) < 2:
            continue
        section  = row[0].strip()
        row_type = row[1].strip()
        data     = row[2:]

        if row_type == "Header":
            sections.setdefault(section, {"headers": [], "rows": []})
            sections[section]["headers"] = [c.strip() for c in data]
        elif row_type == "Data":
            sections.setdefault(section, {"headers": [], "rows": []})
            sections[section]["rows"].append([c.strip() for c in data])

    return sections


def _float(s: str) -> float:
    """Convert IBKR number string (comma thousands-sep, or '--') to float."""
    try:
        return float(s.replace(",", "").replace("--", "0") or 0)
    except ValueError:
        return 0.0


def _parse_datetime(s: str) -> datetime.date:
    """'2026-01-02, 10:19:34' → date(2026, 1, 2)."""
    return datetime.date.fromisoformat(s.split(",")[0].strip())


def _idx(headers: list[str], name: str, fallback: int) -> int:
    try:
        return headers.index(name)
    except ValueError:
        return fallback


# ─── Section helpers ──────────────────────────────────────────────────────────

def _get_field(sections: dict, section: str, field_name: str) -> str | None:
    sec     = sections.get(section, {})
    headers = sec.get("headers", [])
    rows    = sec.get("rows",    [])
    try:
        key_col = headers.index("Feldname")
        val_col = headers.index("Feldwert")
    except ValueError:
        key_col, val_col = 0, 1
    for row in rows:
        if len(row) > max(key_col, val_col) and row[key_col] == field_name:
            return row[val_col]
    return None


def _extract_period_end(sections: dict) -> datetime.date:
    when = _get_field(sections, "Statement", "WhenGenerated")
    if when:
        try:
            return datetime.date.fromisoformat(when.split(",")[0].strip())
        except Exception:
            pass
    tx_rows = sections.get("Transaktionen", {}).get("rows", [])
    dates   = []
    for row in tx_rows:
        if len(row) >= 5:
            try:
                dates.append(_parse_datetime(row[4]))
            except Exception:
                pass
    return max(dates) if dates else datetime.date.today()


def _extract_nav(sections: dict) -> dict:
    return {
        "start": _float(_get_field(sections, "Veränderung des NAV", "Anfangswert") or "0"),
        "end":   _float(_get_field(sections, "Veränderung des NAV", "Endwert")     or "0"),
        "fees":  abs(_float(_get_field(sections, "Veränderung des NAV", "Provisionen") or "0")),
    }


# ─── Security multipliers ─────────────────────────────────────────────────────

def _extract_multipliers(sections: dict) -> dict[str, int]:
    """
    Return {symbol: multiplier} from Informationen zum Finanzinstrument.
    Stocks = 1, Options = 100 (or whatever IBKR reports).
    """
    sec     = sections.get("Informationen zum Finanzinstrument", {})
    headers = sec.get("headers", [])
    rows    = sec.get("rows",    [])

    col_sym  = _idx(headers, "Symbol",       1)
    col_mult = _idx(headers, "Multiplikator", 7)

    result: dict[str, int] = {}
    for row in rows:
        if len(row) <= max(col_sym, col_mult):
            continue
        sym  = row[col_sym].strip()
        mult = int(_float(row[col_mult]) or 1)
        if sym:
            result[sym] = mult
    return result


# ─── Trade extraction ──────────────────────────────────────────────────────────

def _compute_pnl(side: str, shares: float, avg_entry: float, avg_exit: float):
    """Mirrors compute_trade_pnl in services/track_record.py (no fees, trade currency)."""
    sign       = 1.0 if side == "long" else -1.0
    pnl_dollar = round((avg_exit - avg_entry) * shares * sign, 2)
    invested   = avg_entry * shares
    pnl_pct    = round(pnl_dollar / invested * 100, 2) if invested else 0.0
    return pnl_dollar, pnl_pct


def _extract_trades(sections: dict, multipliers: dict[str, int]) -> list[dict]:
    """
    Match O (open) and C (close) rows via FIFO.

    Handles:
    - Multiple C;P rows closing one O position (accumulates until qty balanced).
    - Options multiplier: shares stored as contracts × multiplier.
    - PnL computed from prices (no fees, trade currency) — consistent with UI re-save.
    """
    sec     = sections.get("Transaktionen", {})
    headers = sec.get("headers", [])
    rows    = sec.get("rows",    [])

    if not headers or not rows:
        return []

    col_disc  = _idx(headers, "DataDiscriminator", 0)
    col_ccy   = _idx(headers, "Währung",            2)
    col_sym   = _idx(headers, "Symbol",             3)
    col_dt    = _idx(headers, "Datum/Zeit",         4)
    col_qty   = _idx(headers, "Menge",              5)
    col_price = _idx(headers, "T.-Kurs",            6)
    col_real  = _idx(headers, "Realisierter G&V",  11)   # net of fees, trade currency
    col_code  = _idx(headers, "Code",               13)

    # Only "Order" rows
    order_rows = [r for r in rows if len(r) > col_disc and r[col_disc] == "Order"]
    order_rows.sort(key=lambda r: (r[col_sym] if len(r) > col_sym else "",
                                   _parse_datetime(r[col_dt]) if len(r) > col_dt else datetime.date.min))

    # Per-symbol FIFO queue of open positions
    open_q: dict[str, deque] = defaultdict(deque)
    # Per-symbol accumulator for in-progress close groups
    pending: dict[str, dict] = {}

    trades: list[dict] = []

    for row in order_rows:
        if len(row) <= col_code:
            continue

        codes  = {c.strip() for c in row[col_code].split(";")}
        sym    = row[col_sym].strip()
        qty    = _float(row[col_qty])
        price  = _float(row[col_price])
        dt     = _parse_datetime(row[col_dt]) if len(row) > col_dt else datetime.date.today()
        mult   = multipliers.get(sym, 1)

        # ── Opening row ──────────────────────────────────────────────────────
        if "O" in codes:
            open_q[sym].append({"date": dt, "price": price, "qty": qty, "mult": mult})

        # ── Closing row ──────────────────────────────────────────────────────
        if "C" in codes:
            close_qty  = abs(qty)
            real_pnl   = _float(row[col_real]) if len(row) > col_real else 0.0

            # Start accumulator if not already open for this symbol
            if sym not in pending:
                if not open_q[sym]:
                    log.warning("IBKR: closing row for %s with no matching open (prior period?)", sym)
                    trades.append({
                        "ticker":          sym,
                        "side":            "long" if qty < 0 else "short",
                        "shares":          close_qty * mult,
                        "avg_entry_price": 0.0,
                        "avg_exit_price":  price,
                        "entry_date":      dt.isoformat(),
                        "exit_date":       dt.isoformat(),
                        "pnl_dollar":      real_pnl,
                        "pnl_pct":         0.0,
                        "comment":         "IBKR import (open in prior period)",
                    })
                    continue
                open_entry = open_q[sym].popleft()
                pending[sym] = {
                    "open_entry":  open_entry,
                    "close_fills": [],   # list of (qty, price)
                    "pnl_sum":     0.0,  # cumulative Realisierter G&V from all C rows
                    "closed_qty":  0,
                }

            pc  = pending[sym]
            pc["close_fills"].append((close_qty, price))
            pc["pnl_sum"]    += real_pnl
            pc["closed_qty"] += close_qty

            expected = abs(pc["open_entry"]["qty"])

            # ── Fully closed → create trade ──────────────────────────────────
            if pc["closed_qty"] >= expected:
                oe   = pc["open_entry"]
                m    = oe["mult"]
                side = "short" if oe["qty"] < 0 else "long"

                # Weighted avg close price across all partial fills
                total_close_qty = sum(q for q, _ in pc["close_fills"])
                avg_close       = sum(q * p for q, p in pc["close_fills"]) / total_close_qty
                shares          = total_close_qty * m   # contracts × multiplier

                # Use IBKR's Realisierter G&V (net of commissions) as authoritative PnL
                pnl_dollar = round(pc["pnl_sum"], 2)
                invested   = oe["price"] * shares
                pnl_pct    = round(pnl_dollar / invested * 100, 2) if invested else 0.0

                trades.append({
                    "ticker":          sym,
                    "side":            side,
                    "shares":          shares,
                    "avg_entry_price": oe["price"],
                    "avg_exit_price":  round(avg_close, 6),
                    "entry_date":      oe["date"].isoformat(),
                    "exit_date":       dt.isoformat(),
                    "pnl_dollar":      pnl_dollar,
                    "pnl_pct":         pnl_pct,
                    "comment":         "IBKR import",
                })
                del pending[sym]

    return trades


# ─── Open positions ───────────────────────────────────────────────────────────

def _extract_open_positions(sections: dict, multipliers: dict[str, int]) -> list[dict]:
    sec     = sections.get("Offene Positionen", {})
    headers = sec.get("headers", [])
    rows    = sec.get("rows",    [])

    if not headers or not rows:
        return []

    col_sym   = _idx(headers, "Symbol",       2)
    col_qty   = _idx(headers, "Menge",        4)
    col_price = _idx(headers, "Einstands Kurs", 5)

    positions = []
    for row in rows:
        if len(row) <= max(col_sym, col_qty, col_price):
            continue
        sym   = row[col_sym].strip()
        qty   = _float(row[col_qty])
        price = _float(row[col_price])
        if not sym or qty == 0:
            continue
        mult = multipliers.get(sym, 1)
        positions.append({
            "ticker":       sym,
            "side":         "long" if qty > 0 else "short",
            "shares":       abs(qty) * mult,
            "avg_price_in": price,
            "entry_date":   datetime.date.today().isoformat(),
        })
    return positions


# ─── Unrealized PnL ───────────────────────────────────────────────────────────

def _extract_unrealized_pnl(sections: dict) -> float:
    """Sum unrealized PnL from Mark-to-Market section (already in base currency)."""
    sec     = sections.get("Mark-to-Market-Performance-Überblick", {})
    headers = sec.get("headers", [])
    rows    = sec.get("rows",    [])

    if not headers or not rows:
        return 0.0

    # Look for a "Gesamt (Alle Vermögenswerte)" total row
    col_total = _idx(headers, "Mark-to-Market P/L Position", 4)

    for row in rows:
        if len(row) > 0 and "Alle" in row[0]:
            if len(row) > col_total:
                return _float(row[col_total])
    return 0.0


# ─── Main entry point ─────────────────────────────────────────────────────────

def parse_ibkr_csv(content: str) -> dict:
    """
    Parse an IBKR activity statement CSV.

    Returns:
    {
        period_start, period_end, base_currency,
        trades:          list of dicts compatible with RealizedTrade,
        open_positions:  list of dicts compatible with LivePosition,
        equity_entry:    dict | None,
        parse_warnings:  list[str],
    }
    PnL is in trade currency (no FX conversion) — consistent with compute_trade_pnl.
    """
    warnings: list[str] = []

    try:
        sections = _parse_sections(content)
    except Exception as e:
        return {"error": f"CSV parse failed: {e}", "trades": [], "open_positions": [], "equity_entry": None}

    base_currency = _get_field(sections, "Kontoinformation", "Basiswährung") or "EUR"
    period_end    = _extract_period_end(sections)
    period_start  = period_end

    period_str = _get_field(sections, "Statement", "Period")
    if period_str:
        parts = period_str.split(" - ")
        if len(parts) == 2:
            try:
                period_start = datetime.date.fromisoformat(parts[0].strip())
            except ValueError:
                pass

    multipliers = _extract_multipliers(sections)
    nav         = _extract_nav(sections)
    trades      = _extract_trades(sections, multipliers)
    positions   = _extract_open_positions(sections, multipliers)
    unrealized  = _extract_unrealized_pnl(sections)

    equity_entry = None
    if nav["end"] > 0:
        equity_entry = {
            "date":            period_end.isoformat(),
            "portfolio_value": round(nav["end"], 2),
            "fees":            round(nav["fees"], 2),
            "unrealized_pnl":  round(unrealized, 2),
        }

    return {
        "period_start":   period_start.isoformat(),
        "period_end":     period_end.isoformat(),
        "base_currency":  base_currency,
        "trades":         trades,
        "open_positions": positions,
        "equity_entry":   equity_entry,
        "parse_warnings": warnings,
    }
