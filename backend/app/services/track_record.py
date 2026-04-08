"""
Trading Track Record service.

Handles price fetching (yfinance), position metrics, trade statistics,
and equity curve statistics.
"""

import datetime
import logging
import math

import numpy as np
import yfinance as yf

log = logging.getLogger(__name__)


# ─── Price / ticker info ──────────────────────────────────────────────────────

async def fetch_prices(tickers: list[str]) -> dict[str, float | None]:
    """Batch-fetch latest close prices for a list of tickers via yfinance.
    Option tickers (OCC format with spaces, e.g. 'ONDS 17APR26 11 C') are skipped silently.
    """
    if not tickers:
        return {}
    # Options can't be priced via yfinance — exclude them upfront
    stock_tickers = [t for t in tickers if " " not in t]
    result: dict[str, float | None] = {t.upper(): None for t in tickers}
    if not stock_tickers:
        return result
    try:
        data = yf.download(stock_tickers, period="5d", progress=False, auto_adjust=True)
        closes = data["Close"] if len(stock_tickers) > 1 else data["Close"].rename(stock_tickers[0])
        for ticker in stock_tickers:
            try:
                series = closes[ticker] if len(stock_tickers) > 1 else closes
                val = series.dropna().iloc[-1]
                result[ticker.upper()] = round(float(val), 4)
            except Exception:
                pass
        return result
    except Exception as exc:
        log.warning("fetch_prices failed: %s", exc)
        return result


async def fetch_ticker_info(ticker: str) -> dict:
    """Fetch company name and current price for a single ticker."""
    result = {"company_name": None, "current_price": None}
    try:
        t = yf.Ticker(ticker)
        info = t.info
        result["company_name"] = info.get("shortName") or info.get("longName") or ticker.upper()
        # Fast price: use regularMarketPrice first, fall back to history
        price = info.get("regularMarketPrice") or info.get("currentPrice")
        if price is None:
            hist = t.history(period="5d")
            if not hist.empty:
                price = float(hist["Close"].dropna().iloc[-1])
        if price is not None:
            result["current_price"] = round(float(price), 4)
    except Exception as exc:
        log.warning("fetch_ticker_info(%s) failed: %s", ticker, exc)
    return result


# ─── Position metrics ─────────────────────────────────────────────────────────

def compute_position_metrics(pos, current_price: float | None) -> dict:
    """Compute derived fields for one live position."""
    today = datetime.date.today()
    entry = pos.entry_date if hasattr(pos, "entry_date") else pos["entry_date"]
    if isinstance(entry, str):
        entry = datetime.date.fromisoformat(entry)

    days_in_trade = (today - entry).days
    sign = 1.0 if (pos.side if hasattr(pos, "side") else pos["side"]) == "long" else -1.0
    shares = pos.shares if hasattr(pos, "shares") else pos["shares"]
    avg_in = pos.avg_price_in if hasattr(pos, "avg_price_in") else pos["avg_price_in"]
    stop   = pos.stop   if hasattr(pos, "stop")   else pos.get("stop")
    target = pos.target if hasattr(pos, "target") else pos.get("target")

    r_r = None
    if stop is not None and target is not None and avg_in != stop:
        risk   = abs(avg_in - stop)
        reward = abs(target - avg_in)
        r_r    = round(reward / risk, 2) if risk > 0 else None

    gross_exposure = None
    net_exposure   = None
    pnl_dollar     = None
    pnl_pct        = None

    if current_price is not None:
        gross_exposure = round(shares * current_price, 2)
        net_exposure   = round(gross_exposure * sign, 2)
        pnl_dollar     = round((current_price - avg_in) * shares * sign, 2)
        invested       = avg_in * shares
        pnl_pct        = round(pnl_dollar / invested * 100, 2) if invested else None

    return {
        "days_in_trade": days_in_trade,
        "r_r":           r_r,
        "gross_exposure": gross_exposure,
        "net_exposure":   net_exposure,
        "pnl_dollar":     pnl_dollar,
        "pnl_pct":        pnl_pct,
    }


# ─── Trade statistics ─────────────────────────────────────────────────────────

def compute_trade_stats(trades) -> dict:
    """Compute win/loss stats and Kelly fractions from a list of RealizedTrade rows."""
    if not trades:
        return {
            "wins": 0, "losses": 0, "total": 0,
            "win_dollars": 0.0, "loss_dollars": 0.0, "total_dollars": 0.0,
            "win_rate": 0.0, "loss_rate": 0.0,
            "r_score": 0.0, "full_kelly": 0.0, "bet_kelly": 0.0,
        }

    wins = [t for t in trades if (t.win_score if hasattr(t, "win_score") else t["win_score"]) == 1]
    losses = [t for t in trades if (t.win_score if hasattr(t, "win_score") else t["win_score"]) == -1]
    total = len(trades)

    def pnl(t):
        return t.pnl_dollar if hasattr(t, "pnl_dollar") else t["pnl_dollar"]

    win_dollars  = sum(pnl(t) for t in wins)
    loss_dollars = sum(pnl(t) for t in losses)  # negative values
    total_dollars = win_dollars + loss_dollars

    win_rate  = len(wins)  / total
    loss_rate = len(losses) / total

    avg_win  = win_dollars  / len(wins)   if wins   else 0.0
    avg_loss = loss_dollars / len(losses) if losses else 0.0  # negative

    r_score    = 0.0
    full_kelly = 0.0
    if losses and avg_loss != 0:
        r_score    = round(win_dollars / abs(loss_dollars), 3)
        full_kelly = round(win_rate - loss_rate / (avg_win / abs(avg_loss)), 4) if avg_win > 0 else 0.0
    bet_kelly = round(full_kelly / 2, 4)

    return {
        "wins":         len(wins),
        "losses":       len(losses),
        "total":        total,
        "win_dollars":  round(win_dollars, 2),
        "loss_dollars": round(loss_dollars, 2),
        "total_dollars": round(total_dollars, 2),
        "win_rate":     round(win_rate * 100, 1),
        "loss_rate":    round(loss_rate * 100, 1),
        "r_score":      r_score,
        "full_kelly":   round(full_kelly * 100, 2),
        "bet_kelly":    round(bet_kelly * 100, 2),
    }


# ─── Equity curve statistics ─────────────────────────────────────────────────

def compute_equity_stats(portfolio_values: list[float]) -> dict:
    """Compute risk/performance statistics from a time series of portfolio values."""
    if len(portfolio_values) < 2:
        return {
            "mean_return_weekly": None, "mean_return_annual": None,
            "total_return": None,
            "std_weekly": None, "std_annual": None,
            "downside_dev_weekly": None, "downside_dev_annual": None,
            "max_drawdown": None,
            "sharpe": None, "calmar": None, "sortino": None,
        }

    values = np.array(portfolio_values, dtype=float)
    returns = np.diff(values) / values[:-1]  # period-over-period returns

    mean_r  = float(np.mean(returns))
    std_r   = float(np.std(returns, ddof=1)) if len(returns) > 1 else 0.0
    neg_r   = returns[returns < 0]
    down_dev = float(np.std(neg_r, ddof=1)) if len(neg_r) > 1 else 0.0

    # Annualize assuming weekly periods
    mean_annual = mean_r * 52
    std_annual  = std_r  * math.sqrt(52)
    down_annual = down_dev * math.sqrt(52)

    total_return = float((values[-1] / values[0] - 1) * 100) if values[0] != 0 else None

    # Max drawdown
    peak = values[0]
    max_dd = 0.0
    for v in values:
        if v > peak:
            peak = v
        dd = (v - peak) / peak if peak != 0 else 0.0
        if dd < max_dd:
            max_dd = dd
    max_dd_pct = float(max_dd * 100)  # negative number

    sharpe  = round(mean_r / std_r * math.sqrt(52), 3)   if std_r   > 0 else None
    calmar  = round(mean_annual / abs(max_dd_pct) * 100, 3) if max_dd_pct < 0 else None
    sortino = round(mean_annual / down_annual, 3)           if down_annual > 0 else None

    def pct(v):
        return round(v * 100, 3) if v is not None else None

    return {
        "mean_return_weekly": pct(mean_r),
        "mean_return_annual": pct(mean_annual),
        "total_return":       round(total_return, 2) if total_return is not None else None,
        "std_weekly":         pct(std_r),
        "std_annual":         pct(std_annual),
        "downside_dev_weekly": pct(down_dev),
        "downside_dev_annual": pct(down_annual),
        "max_drawdown":       round(max_dd_pct, 2),
        "sharpe":             sharpe,
        "calmar":             calmar,
        "sortino":            sortino,
    }


# ─── PnL computation (server-side on trade write) ─────────────────────────────

def compute_trade_pnl(side: str, shares: float, avg_entry: float, avg_exit: float) -> tuple[float, float]:
    """Return (pnl_dollar, pnl_pct) for a trade."""
    sign = 1.0 if side == "long" else -1.0
    pnl_dollar = round((avg_exit - avg_entry) * shares * sign, 2)
    invested   = avg_entry * shares
    pnl_pct    = round(pnl_dollar / invested * 100, 2) if invested else 0.0
    return pnl_dollar, pnl_pct
