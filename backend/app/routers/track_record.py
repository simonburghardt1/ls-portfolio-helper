import asyncio
import datetime
from datetime import timezone

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

import yfinance as yf

from app.db.session import get_db
from app.models.track_record import CashPosition, EquityEntry, LivePosition, RealizedTrade
from app.services.track_record import (
    compute_equity_stats,
    compute_position_metrics,
    compute_trade_pnl,
    compute_trade_stats,
    compute_volatility,
    fetch_fx_rate,
    fetch_prices,
    fetch_ticker_info,
)

router = APIRouter(prefix="/api/track-record", tags=["track-record"])


# ─── Pydantic schemas ─────────────────────────────────────────────────────────

class PositionIn(BaseModel):
    ticker:       str
    company_name: str | None = None
    entry_date:   str                   # ISO date
    side:         str = "long"
    shares:       float = 0.0
    avg_price_in: float = 0.0
    stop:         float | None = None
    target:       float | None = None
    notes:        str | None = None


class TradeIn(BaseModel):
    ticker:          str
    company_name:    str | None = None
    side:            str = "long"
    shares:          float = 0.0
    avg_entry_price: float = 0.0
    avg_exit_price:  float = 0.0
    entry_date:      str
    exit_date:       str
    win_score:       int = 1
    comment:         str | None = None


class EquityIn(BaseModel):
    date:            str
    unrealized_pnl:  float = 0.0
    fees:            float = 0.0
    deposit:         float = 0.0
    withdrawal:      float = 0.0
    portfolio_value: float = 0.0


class CapitalIn(BaseModel):
    date:   str
    amount: float


# ─── Helper ───────────────────────────────────────────────────────────────────

def _pos_to_dict(pos: LivePosition, current_price: float | None) -> dict:
    metrics = compute_position_metrics(pos, current_price)
    return {
        "id":            pos.id,
        "ticker":        pos.ticker,
        "company_name":  pos.company_name,
        "entry_date":    pos.entry_date.isoformat(),
        "side":          pos.side,
        "shares":        pos.shares,
        "avg_price_in":  pos.avg_price_in,
        "stop":          pos.stop,
        "target":        pos.target,
        "notes":         pos.notes,
        "current_price": current_price,
        **metrics,
    }


def _trade_to_dict(t: RealizedTrade) -> dict:
    days = int(np.busday_count(t.entry_date, t.exit_date))
    return {
        "id":              t.id,
        "ticker":          t.ticker,
        "company_name":    t.company_name,
        "side":            t.side,
        "shares":          t.shares,
        "avg_entry_price": t.avg_entry_price,
        "avg_exit_price":  t.avg_exit_price,
        "entry_date":      t.entry_date.isoformat(),
        "exit_date":       t.exit_date.isoformat(),
        "days_in_trade":   days,
        "pnl_dollar":      t.pnl_dollar,
        "pnl_pct":         t.pnl_pct,
        "win_score":       t.win_score,
        "comment":         t.comment,
    }


# ─── Ticker info ──────────────────────────────────────────────────────────────

@router.get("/ticker-info/{ticker:path}")
async def ticker_info(ticker: str):
    # ticker may be URL-encoded (e.g. 'ETHA%2017APR26%2015%20C') — FastAPI decodes automatically
    return await fetch_ticker_info(ticker.upper())


# ─── Live Positions ───────────────────────────────────────────────────────────

@router.get("/positions")
async def list_positions(db: Session = Depends(get_db)):
    positions = db.query(LivePosition).order_by(LivePosition.entry_date.asc(), LivePosition.id.asc()).all()
    if not positions:
        return []
    tickers = list({p.ticker.upper() for p in positions})
    prices  = await fetch_prices(tickers)
    return [_pos_to_dict(p, prices.get(p.ticker.upper())) for p in positions]


@router.get("/positions/volatility")
async def positions_volatility(weeks: int = 52, db: Session = Depends(get_db)):
    """Variance-covariance + correlation matrices for current live positions."""
    positions = db.query(LivePosition).all()
    stock_pos = [p for p in positions if " " not in p.ticker]
    if not stock_pos:
        return {"error": "No stock positions found", "tickers": []}

    tickers = [p.ticker.upper() for p in stock_pos]
    prices  = await fetch_prices(tickers)

    alloc: list[float] = []
    for p in stock_pos:
        price = prices.get(p.ticker.upper()) or p.avg_price_in
        sign  = 1.0 if p.side == "long" else -1.0
        alloc.append(round(p.shares * price * sign, 2))

    total_gross = sum(abs(a) for a in alloc) or 1.0
    weights     = [a / total_gross for a in alloc]

    return await compute_volatility(tickers, weights, alloc, weeks)


@router.post("/positions")
async def create_position(payload: PositionIn, db: Session = Depends(get_db)):
    ticker = payload.ticker.upper()
    info   = await fetch_ticker_info(ticker)
    now    = datetime.datetime.now(timezone.utc)
    pos = LivePosition(
        ticker       = ticker,
        company_name = payload.company_name or info.get("company_name"),
        entry_date   = datetime.date.fromisoformat(payload.entry_date),
        side         = payload.side,
        shares       = payload.shares,
        avg_price_in = payload.avg_price_in,
        stop         = payload.stop,
        target       = payload.target,
        notes        = payload.notes,
        created_at   = now,
        updated_at   = now,
    )
    db.add(pos)
    db.commit()
    db.refresh(pos)
    current_price = info.get("current_price")
    return _pos_to_dict(pos, current_price)


@router.put("/positions/{pos_id}")
async def update_position(pos_id: int, payload: PositionIn, db: Session = Depends(get_db)):
    pos = db.get(LivePosition, pos_id)
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found")
    ticker = payload.ticker.upper()
    pos.ticker       = ticker
    pos.company_name = payload.company_name or pos.company_name
    pos.entry_date   = datetime.date.fromisoformat(payload.entry_date)
    pos.side         = payload.side
    pos.shares       = payload.shares
    pos.avg_price_in = payload.avg_price_in
    pos.stop         = payload.stop
    pos.target       = payload.target
    pos.notes        = payload.notes
    pos.updated_at   = datetime.datetime.now(timezone.utc)
    db.commit()
    db.refresh(pos)
    prices = await fetch_prices([ticker])
    return _pos_to_dict(pos, prices.get(ticker))


@router.delete("/positions/{pos_id}", status_code=204)
def delete_position(pos_id: int, db: Session = Depends(get_db)):
    pos = db.get(LivePosition, pos_id)
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found")
    db.delete(pos)
    db.commit()


# ─── Realized Trades ─────────────────────────────────────────────────────────

@router.get("/trades")
def list_trades(db: Session = Depends(get_db)):
    trades = db.query(RealizedTrade).order_by(RealizedTrade.exit_date.desc(), RealizedTrade.id.desc()).all()
    return [_trade_to_dict(t) for t in trades]


@router.get("/trades/stats")
def trade_stats(db: Session = Depends(get_db)):
    trades = db.query(RealizedTrade).all()
    return compute_trade_stats(trades)


@router.post("/trades")
def create_trade(payload: TradeIn, db: Session = Depends(get_db)):
    pnl_dollar, pnl_pct = compute_trade_pnl(
        payload.side, payload.shares, payload.avg_entry_price, payload.avg_exit_price
    )
    trade = RealizedTrade(
        ticker          = payload.ticker.upper(),
        company_name    = payload.company_name,
        side            = payload.side,
        shares          = payload.shares,
        avg_entry_price = payload.avg_entry_price,
        avg_exit_price  = payload.avg_exit_price,
        entry_date      = datetime.date.fromisoformat(payload.entry_date),
        exit_date       = datetime.date.fromisoformat(payload.exit_date),
        pnl_dollar      = pnl_dollar,
        pnl_pct         = pnl_pct,
        win_score       = 1 if pnl_dollar >= 0 else -1,
        comment         = payload.comment,
        created_at      = datetime.datetime.now(timezone.utc),
    )
    db.add(trade)
    db.commit()
    db.refresh(trade)
    return _trade_to_dict(trade)


@router.put("/trades/{trade_id}")
def update_trade(trade_id: int, payload: TradeIn, db: Session = Depends(get_db)):
    trade = db.get(RealizedTrade, trade_id)
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")

    # Only recompute PnL if prices actually changed — preserves IBKR fee-inclusive values
    prices_changed = (
        abs((payload.avg_entry_price or 0) - (trade.avg_entry_price or 0)) > 1e-6 or
        abs((payload.avg_exit_price  or 0) - (trade.avg_exit_price  or 0)) > 1e-6 or
        abs((payload.shares          or 0) - (trade.shares          or 0)) > 1e-6 or
        payload.side != trade.side
    )
    if prices_changed:
        pnl_dollar, pnl_pct = compute_trade_pnl(
            payload.side, payload.shares, payload.avg_entry_price, payload.avg_exit_price
        )
    else:
        pnl_dollar = trade.pnl_dollar
        pnl_pct    = trade.pnl_pct

    trade.ticker          = payload.ticker.upper()
    trade.company_name    = payload.company_name
    trade.side            = payload.side
    trade.shares          = payload.shares
    trade.avg_entry_price = payload.avg_entry_price
    trade.avg_exit_price  = payload.avg_exit_price
    trade.entry_date      = datetime.date.fromisoformat(payload.entry_date)
    trade.exit_date       = datetime.date.fromisoformat(payload.exit_date)
    trade.pnl_dollar      = pnl_dollar
    trade.pnl_pct         = pnl_pct
    trade.win_score       = 1 if pnl_dollar >= 0 else -1
    trade.comment         = payload.comment
    db.commit()
    db.refresh(trade)
    return _trade_to_dict(trade)


@router.delete("/trades/{trade_id}", status_code=204)
def delete_trade(trade_id: int, db: Session = Depends(get_db)):
    trade = db.get(RealizedTrade, trade_id)
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")
    db.delete(trade)
    db.commit()


# ─── Equity Entries ───────────────────────────────────────────────────────────

def _build_equity_rows(entries: list[EquityEntry], trades: list[RealizedTrade]) -> list[dict]:
    """Build enriched equity rows: auto-fill realized_pnl, cumulative deposit, return, index, drawdown."""
    # Pre-compute cumulative realized pnl per date
    cum_realized: dict[datetime.date, float] = {}
    running = 0.0
    for t in sorted(trades, key=lambda x: x.exit_date):
        running += t.pnl_dollar
        cum_realized[t.exit_date] = running

    # For each equity entry: realized_pnl = max cum_realized with date <= entry.date
    sorted_trade_dates = sorted(cum_realized.keys())

    rows = []
    cum_deposit    = 0.0
    prev_value     = None
    base_value     = None
    peak_value     = None
    perf_index     = 100.0
    prev_total_pnl = None

    for e in sorted(entries, key=lambda x: x.date):
        cum_deposit += e.deposit - e.withdrawal

        # Realized PnL: cumulative trades up to this date
        realized = 0.0
        for td in sorted_trade_dates:
            if td <= e.date:
                realized = cum_realized[td]
            else:
                break

        ret_pct = None
        if prev_value is not None and prev_value != 0:
            ret_pct = round((e.portfolio_value / prev_value - 1) * 100, 3)

        if base_value is None:
            base_value = e.portfolio_value
        idx = round(e.portfolio_value / base_value * 100, 3) if base_value else None

        if peak_value is None or e.portfolio_value > peak_value:
            peak_value = e.portfolio_value
        drawdown = round((e.portfolio_value / peak_value - 1) * 100, 3) if peak_value else None

        # Performance index: tracks (realized_pnl + unrealized_pnl) changes relative to portfolio value
        total_pnl = realized + e.unrealized_pnl
        if prev_total_pnl is not None and prev_value and prev_value != 0:
            perf_delta = total_pnl - prev_total_pnl
            perf_index = round(perf_index * (1 + perf_delta / prev_value), 3)
        prev_total_pnl = total_pnl

        rows.append({
            "id":              e.id,
            "date":            e.date.isoformat(),
            "unrealized_pnl":  e.unrealized_pnl,
            "realized_pnl":    round(realized, 2),
            "fees":            e.fees,
            "deposit":         e.deposit,
            "withdrawal":      e.withdrawal,
            "cumulative_deposit": round(cum_deposit, 2),
            "portfolio_value": e.portfolio_value,
            "return_pct":      ret_pct,
            "index":           idx,
            "perf_index":      perf_index,
            "drawdown":        drawdown,
        })
        prev_value = e.portfolio_value

    return rows


@router.get("/equity")
def list_equity(db: Session = Depends(get_db)):
    entries = db.query(EquityEntry).order_by(EquityEntry.date.asc()).all()
    trades  = db.query(RealizedTrade).order_by(RealizedTrade.exit_date.asc()).all()
    return _build_equity_rows(entries, trades)


@router.get("/equity/stats")
def equity_stats(db: Session = Depends(get_db)):
    """Compute % return stats from weekly PnL normalized by cumulative capital."""
    from collections import defaultdict

    trades  = db.query(RealizedTrade).order_by(RealizedTrade.exit_date.asc()).all()
    entries = db.query(EquityEntry).order_by(EquityEntry.date.asc()).all()

    weekly_pnl: dict[datetime.date, float] = defaultdict(float)
    for t in trades:
        monday = t.exit_date - datetime.timedelta(days=t.exit_date.weekday())
        weekly_pnl[monday] += t.pnl_dollar

    weekly_cap: dict[datetime.date, float] = defaultdict(float)
    for e in entries:
        monday = e.date - datetime.timedelta(days=e.date.weekday())
        weekly_cap[monday] += (e.deposit or 0.0) - (e.withdrawal or 0.0)

    all_dates = set(weekly_pnl.keys()) | set(weekly_cap.keys())
    if not all_dates:
        return compute_equity_stats([])

    today       = datetime.date.today()
    current_mon = today - datetime.timedelta(days=today.weekday())
    first_mon   = min(all_dates)

    all_weeks: list[datetime.date] = []
    w = first_mon
    while w <= current_mon:
        all_weeks.append(w)
        w += datetime.timedelta(weeks=1)

    cum_pnl = 0.0
    cum_cap = 0.0
    # Build (capital + cum_pnl) series — i.e. account value = capital deployed + PnL earned
    values = []
    for week in all_weeks:
        cum_cap += weekly_cap.get(week, 0.0)
        cum_pnl += weekly_pnl.get(week, 0.0)
        # Account value = capital + running PnL
        account_value = cum_cap + cum_pnl
        values.append(account_value)

    return compute_equity_stats(values)


@router.post("/equity/deposit")
def add_deposit(payload: CapitalIn, db: Session = Depends(get_db)):
    d = datetime.date.fromisoformat(payload.date)
    entry = db.query(EquityEntry).filter(EquityEntry.date == d).first()
    if entry:
        entry.deposit = (entry.deposit or 0.0) + payload.amount
    else:
        entry = EquityEntry(
            date=d, deposit=payload.amount, withdrawal=0.0,
            unrealized_pnl=0.0, fees=0.0, portfolio_value=0.0,
            created_at=datetime.datetime.now(timezone.utc),
        )
        db.add(entry)
    db.commit()
    return {"ok": True}


@router.post("/equity/withdraw")
def add_withdrawal(payload: CapitalIn, db: Session = Depends(get_db)):
    d = datetime.date.fromisoformat(payload.date)
    entry = db.query(EquityEntry).filter(EquityEntry.date == d).first()
    if entry:
        entry.withdrawal = (entry.withdrawal or 0.0) + payload.amount
    else:
        entry = EquityEntry(
            date=d, withdrawal=payload.amount, deposit=0.0,
            unrealized_pnl=0.0, fees=0.0, portfolio_value=0.0,
            created_at=datetime.datetime.now(timezone.utc),
        )
        db.add(entry)
    db.commit()
    return {"ok": True}


@router.get("/equity/performance")
async def equity_performance(db: Session = Depends(get_db)):
    """Weekly cumulative PnL from realized trades + current unrealized, with no gaps."""
    trades    = db.query(RealizedTrade).order_by(RealizedTrade.exit_date.asc()).all()
    positions = db.query(LivePosition).all()
    entries   = db.query(EquityEntry).order_by(EquityEntry.date.asc()).all()

    from collections import defaultdict

    # Group realized PnL by ISO week (Monday)
    weekly_pnl: dict[datetime.date, float] = defaultdict(float)
    for t in trades:
        monday = t.exit_date - datetime.timedelta(days=t.exit_date.weekday())
        weekly_pnl[monday] += t.pnl_dollar

    # Group capital movements (deposits - withdrawals) by week
    weekly_cap: dict[datetime.date, float] = defaultdict(float)
    for e in entries:
        monday = e.date - datetime.timedelta(days=e.date.weekday())
        weekly_cap[monday] += (e.deposit or 0.0) - (e.withdrawal or 0.0)

    if not weekly_pnl and not weekly_cap and not positions:
        return []

    today       = datetime.date.today()
    current_mon = today - datetime.timedelta(days=today.weekday())
    all_dates   = set(weekly_pnl.keys()) | set(weekly_cap.keys())
    first_mon   = min(all_dates) if all_dates else current_mon

    # ── Historical price data for all stock tickers ──────────────────────────
    import pandas as pd

    stock_positions = [p for p in positions if " " not in p.ticker]
    option_positions = [p for p in positions if " " in p.ticker]
    stock_trades    = [t for t in trades if " " not in t.ticker]

    all_stock_tickers = list(
        {p.ticker.upper() for p in stock_positions} |
        {t.ticker.upper() for t in stock_trades}
    )
    closes_df: "pd.DataFrame | None" = None
    if all_stock_tickers:
        try:
            raw = yf.download(
                all_stock_tickers, start=first_mon.isoformat(),
                auto_adjust=True, progress=False,
            )["Close"]
            if isinstance(raw, pd.Series):
                raw = raw.to_frame(name=all_stock_tickers[0])
            # Strip timezone so asof() comparisons work with plain date timestamps
            if hasattr(raw.index, "tz") and raw.index.tz is not None:
                raw.index = raw.index.tz_localize(None)
            closes_df = raw
        except Exception as exc:
            log.warning("equity_performance: history fetch failed: %s", exc)

    # ── Option unrealized — live prices, added only to the current week ───────
    option_unrealized = 0.0
    if option_positions:
        opt_prices = await fetch_prices([p.ticker.upper() for p in option_positions])
        for pos in option_positions:
            metrics = compute_position_metrics(pos, opt_prices.get(pos.ticker.upper()))
            if metrics["pnl_dollar"] is not None:
                option_unrealized += metrics["pnl_dollar"]

    # Generate every Monday in range
    all_weeks: list[datetime.date] = []
    w = first_mon
    while w <= current_mon:
        all_weeks.append(w)
        w += datetime.timedelta(weeks=1)

    cum_pnl      = 0.0
    cum_cap      = 0.0
    cum_realized = 0.0
    result       = []
    for week in all_weeks:
        cap_delta   = weekly_cap.get(week, 0.0)
        wr          = weekly_pnl.get(week, 0.0)
        week_friday = week + datetime.timedelta(days=4)
        extra       = 0.0

        if closes_df is not None:
            fri_ts = pd.Timestamp(week_friday)

            # Stock live positions open at this week's end
            for pos in stock_positions:
                if pos.entry_date > week_friday:
                    continue
                col = pos.ticker.upper()
                if col not in closes_df.columns:
                    continue
                price = closes_df[col].asof(fri_ts)
                if pd.isna(price):
                    continue
                sign  = 1 if pos.side == "long" else -1
                extra += (float(price) - pos.avg_price_in) * pos.shares * sign

            # Stock realized trades that were open at this week's end
            for t in stock_trades:
                if t.entry_date > week_friday or t.exit_date <= week_friday:
                    continue
                col = t.ticker.upper()
                if col not in closes_df.columns:
                    continue
                price = closes_df[col].asof(fri_ts)
                if pd.isna(price):
                    continue
                sign  = 1 if t.side == "long" else -1
                extra += (float(price) - t.avg_entry_price) * t.shares * sign

        # Option unrealized only for the current week
        if week == current_mon:
            extra += option_unrealized

        weekly_total  = wr + extra
        cum_pnl      += weekly_total
        cum_cap      += cap_delta
        cum_realized += wr
        result.append({
            "date":               week.isoformat(),
            "weekly_pnl":         round(weekly_total, 2),
            "weekly_realized":    round(wr, 2),
            "weekly_unrealized":  round(extra, 2),
            "cum_pnl":            round(cum_pnl, 2),
            "cum_realized":       round(cum_realized, 2),
            "cap_delta":          round(cap_delta, 2),
            "capital":            round(cum_cap, 2),
            "account_value":      round(cum_cap + cum_pnl, 2),
        })

    return result


@router.get("/equity/spy")
def equity_spy(db: Session = Depends(get_db)):
    """Return SPY prices indexed to 100 from the first trade/equity-entry date."""
    trade_min = db.query(func.min(RealizedTrade.exit_date)).scalar()
    entry_min = db.query(func.min(EquityEntry.date)).scalar()
    candidates = [d for d in [trade_min, entry_min] if d]
    first = min(candidates) if candidates else None
    if not first:
        return {"dates": [], "values": []}
    try:
        # Start from Monday of the first week so SPY always covers the first perf week
        first_mon = first - datetime.timedelta(days=first.weekday())
        closes = yf.Ticker("SPY").history(start=first_mon.isoformat())["Close"].dropna()
        if closes.empty:
            return {"dates": [], "values": [], "raw": []}
        base = float(closes.iloc[0])
        return {
            "dates":  [str(d.date()) for d in closes.index],
            "values": [round(float(v) / base * 100, 3) for v in closes],
            "raw":    [round(float(v), 2) for v in closes],
        }
    except Exception as exc:
        return {"dates": [], "values": [], "error": str(exc)}


@router.post("/equity")
def create_equity(payload: EquityIn, db: Session = Depends(get_db)):
    entry = EquityEntry(
        date            = datetime.date.fromisoformat(payload.date),
        unrealized_pnl  = payload.unrealized_pnl,
        fees            = payload.fees,
        deposit         = payload.deposit,
        withdrawal      = payload.withdrawal,
        portfolio_value = payload.portfolio_value,
        created_at      = datetime.datetime.now(timezone.utc),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    trades = db.query(RealizedTrade).order_by(RealizedTrade.exit_date.asc()).all()
    rows = _build_equity_rows([entry], trades)
    return rows[0] if rows else {}


@router.put("/equity/{entry_id}")
def update_equity(entry_id: int, payload: EquityIn, db: Session = Depends(get_db)):
    entry = db.get(EquityEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Equity entry not found")
    entry.date            = datetime.date.fromisoformat(payload.date)
    entry.unrealized_pnl  = payload.unrealized_pnl
    entry.fees            = payload.fees
    entry.deposit         = payload.deposit
    entry.withdrawal      = payload.withdrawal
    entry.portfolio_value = payload.portfolio_value
    db.commit()
    db.refresh(entry)
    # Return full list so front-end can recompute cumulative columns
    all_entries = db.query(EquityEntry).order_by(EquityEntry.date.asc()).all()
    trades      = db.query(RealizedTrade).order_by(RealizedTrade.exit_date.asc()).all()
    return _build_equity_rows(all_entries, trades)


@router.delete("/equity/{entry_id}", status_code=204)
def delete_equity(entry_id: int, db: Session = Depends(get_db)):
    entry = db.get(EquityEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Equity entry not found")
    db.delete(entry)
    db.commit()


# ─── Cash Positions ───────────────────────────────────────────────────────────

class CashIn(BaseModel):
    amount: float


@router.get("/cash-positions")
async def list_cash_positions(db: Session = Depends(get_db)):
    """Return all cash positions with live FX rates and EUR equivalent."""
    positions = db.query(CashPosition).order_by(CashPosition.currency.asc()).all()
    result = []
    for pos in positions:
        live_rate = await fetch_fx_rate(pos.currency)
        eur_value = round(pos.amount * live_rate, 2) if live_rate is not None else None
        fx_pnl    = (
            round((live_rate - pos.rate_at_import) * pos.amount, 2)
            if live_rate is not None and pos.rate_at_import is not None
            else None
        )
        result.append({
            "currency":        pos.currency,
            "amount":          pos.amount,
            "rate_at_import":  pos.rate_at_import,
            "live_rate":       live_rate,
            "eur_value":       eur_value,
            "fx_pnl":          fx_pnl,
        })
    return result


@router.put("/cash-positions/{currency}")
async def upsert_cash_position(currency: str, payload: CashIn, db: Session = Depends(get_db)):
    """Manually create or update a cash position by currency code."""
    ccy      = currency.upper()
    live_rate = await fetch_fx_rate(ccy)
    now       = datetime.datetime.now(timezone.utc)
    existing  = db.query(CashPosition).filter(CashPosition.currency == ccy).first()
    if existing:
        existing.amount         = payload.amount
        existing.rate_at_import = live_rate
        existing.updated_at     = now
    else:
        db.add(CashPosition(currency=ccy, amount=payload.amount,
                            rate_at_import=live_rate, updated_at=now))
    db.commit()
    return {"currency": ccy, "amount": payload.amount, "rate_at_import": live_rate}


@router.delete("/cash-positions/{currency}", status_code=204)
def delete_cash_position(currency: str, db: Session = Depends(get_db)):
    pos = db.query(CashPosition).filter(CashPosition.currency == currency.upper()).first()
    if pos:
        db.delete(pos)
        db.commit()


# ─── IBKR CSV Import ───────────────────────────────────────────────────────────

from app.services.ibkr_parser import parse_ibkr_csv  # noqa: E402


class IbkrImportIn(BaseModel):
    csv_text: str


@router.delete("/clear-all", status_code=200)
def clear_all(db: Session = Depends(get_db)):
    """Delete all realized trades, live positions, equity entries, and cash positions."""
    trades    = db.query(RealizedTrade).delete()
    positions = db.query(LivePosition).delete()
    entries   = db.query(EquityEntry).delete()
    cash      = db.query(CashPosition).delete()
    db.commit()
    return {"deleted_trades": trades, "deleted_positions": positions,
            "deleted_equity_entries": entries, "deleted_cash_positions": cash}


@router.post("/ibkr/preview")
def ibkr_preview(payload: IbkrImportIn):
    """Parse IBKR CSV and return a preview without writing to DB."""
    return parse_ibkr_csv(payload.csv_text)


@router.post("/ibkr/confirm")
async def ibkr_confirm(payload: IbkrImportIn, db: Session = Depends(get_db)):
    """Parse IBKR CSV and save trades / positions / equity entry to DB."""
    parsed = parse_ibkr_csv(payload.csv_text)

    if "error" in parsed:
        raise HTTPException(status_code=400, detail=parsed["error"])

    # Pre-fetch company names for all unique tickers
    unique_tickers = {
        t["ticker"].upper() for t in parsed.get("trades", [])
    } | {
        p["ticker"].upper() for p in parsed.get("open_positions", [])
    }
    infos = await asyncio.gather(*[fetch_ticker_info(tk) for tk in unique_tickers], return_exceptions=True)
    name_map = {
        tk: (info.get("company_name") if isinstance(info, dict) else None)
        for tk, info in zip(unique_tickers, infos)
    }

    trades_imported    = 0
    trades_skipped     = 0
    positions_imported = 0
    equity_created     = False

    # ── Realized trades ─────────────────────────────────────────────────────
    for t in parsed.get("trades", []):
        entry_d = datetime.date.fromisoformat(t["entry_date"])
        exit_d  = datetime.date.fromisoformat(t["exit_date"])
        shares  = t["shares"]

        dup = db.query(RealizedTrade).filter(
            RealizedTrade.ticker     == t["ticker"].upper(),
            RealizedTrade.entry_date == entry_d,
            RealizedTrade.exit_date  == exit_d,
            RealizedTrade.shares     == shares,
        ).first()
        if dup:
            trades_skipped += 1
            continue

        # pnl_dollar and pnl_pct already computed by ibkr_parser via _compute_pnl
        # (price-based, no fees, trade currency — consistent with compute_trade_pnl)
        pnl_dollar = round(t["pnl_dollar"], 2)
        pnl_pct    = round(t.get("pnl_pct", 0.0), 2)

        trade = RealizedTrade(
            ticker          = t["ticker"].upper(),
            company_name    = name_map.get(t["ticker"].upper()),
            side            = t["side"],
            shares          = shares,
            avg_entry_price = t["avg_entry_price"],
            avg_exit_price  = t["avg_exit_price"],
            entry_date      = entry_d,
            exit_date       = exit_d,
            pnl_dollar      = pnl_dollar,
            pnl_pct         = pnl_pct,
            win_score       = 1 if pnl_dollar >= 0 else -1,
            comment         = t.get("comment"),
            created_at      = datetime.datetime.now(timezone.utc),
        )
        db.add(trade)
        trades_imported += 1

    # ── Open positions ───────────────────────────────────────────────────────
    for p in parsed.get("open_positions", []):
        entry_d = datetime.date.fromisoformat(p["entry_date"])
        dup = db.query(LivePosition).filter(
            LivePosition.ticker     == p["ticker"].upper(),
            LivePosition.entry_date == entry_d,
            LivePosition.side       == p["side"],
        ).first()
        if dup:
            continue

        pos = LivePosition(
            ticker       = p["ticker"].upper(),
            company_name = name_map.get(p["ticker"].upper()),
            entry_date   = entry_d,
            side         = p["side"],
            shares       = p["shares"],
            avg_price_in = p["avg_price_in"],
            created_at   = datetime.datetime.now(timezone.utc),
            updated_at   = datetime.datetime.now(timezone.utc),
        )
        db.add(pos)
        positions_imported += 1

    # ── Equity entry ─────────────────────────────────────────────────────────
    eq = parsed.get("equity_entry")
    if eq:
        eq_date = datetime.date.fromisoformat(eq["date"])
        existing = db.query(EquityEntry).filter(EquityEntry.date == eq_date).first()
        if existing:
            existing.portfolio_value = eq["portfolio_value"]
            existing.fees            = eq["fees"]
            existing.unrealized_pnl  = eq["unrealized_pnl"]
        else:
            db.add(EquityEntry(
                date           = eq_date,
                portfolio_value= eq["portfolio_value"],
                fees           = eq["fees"],
                unrealized_pnl = eq["unrealized_pnl"],
                deposit        = 0.0,
                withdrawal     = 0.0,
                created_at     = datetime.datetime.now(timezone.utc),
            ))
        equity_created = True

    # ── Cash positions ───────────────────────────────────────────────────────
    # Build the canonical set from the CSV (Cash-Bericht gives one row per ccy).
    # Store full dict so we carry the IBKR cost-basis rate (Einstands Kurs).
    cash_by_ccy: dict[str, dict] = {}
    for cp in parsed.get("cash_positions", []):
        ccy = cp["currency"].upper()
        cash_by_ccy[ccy] = {"amount": cp["amount"], "rate_at_import": cp.get("rate_at_import")}

    # Delete any cash positions not present in this import — removes stale
    # records (e.g. a currency that was previously parsed incorrectly).
    if cash_by_ccy:
        db.query(CashPosition).filter(
            CashPosition.currency.notin_(list(cash_by_ccy.keys()))
        ).delete(synchronize_session=False)

    cash_imported = 0
    for ccy, data in cash_by_ccy.items():
        amt             = data["amount"]
        ibkr_rate       = data.get("rate_at_import")
        # Prefer IBKR cost-basis rate (Einstands Kurs) for meaningful FX PnL.
        # Fall back to live rate only for base currency (EUR) which has no entry.
        cost_basis_rate = ibkr_rate if ibkr_rate is not None else await fetch_fx_rate(ccy)
        now = datetime.datetime.now(timezone.utc)
        existing_cp = db.query(CashPosition).filter(CashPosition.currency == ccy).first()
        if existing_cp:
            existing_cp.amount         = amt
            existing_cp.rate_at_import = cost_basis_rate
            existing_cp.updated_at     = now
        else:
            db.add(CashPosition(currency=ccy, amount=amt,
                                rate_at_import=cost_basis_rate, updated_at=now))
        cash_imported += 1

    db.commit()

    return {
        "trades_imported":    trades_imported,
        "trades_skipped":     trades_skipped,
        "positions_imported": positions_imported,
        "cash_imported":      cash_imported,
        "equity_entry_saved": equity_created,
        "parse_warnings":     parsed.get("parse_warnings", []),
    }
