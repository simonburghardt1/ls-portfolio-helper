"""
Trading Track Record service.

Handles price fetching (yfinance), position metrics, trade statistics,
equity curve statistics, and portfolio volatility/correlation.
"""

import datetime
import logging
import math

import numpy as np
import pandas as pd
import yfinance as yf

log = logging.getLogger(__name__)

# yfinance prints noisy "possibly delisted" warnings for illiquid/expired options —
# suppress at WARNING level since we handle failures gracefully in our own code.
logging.getLogger("yfinance").setLevel(logging.CRITICAL)


# ─── Options: IBKR → OCC format ──────────────────────────────────────────────

_MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}


def ibkr_to_occ(ticker: str) -> str | None:
    """Convert IBKR option format 'EOSE 17APR26 10 C' → OCC 'EOSE260417C00010000'.

    yfinance accepts OCC-format option tickers natively.
    Returns None if the ticker is not a recognised IBKR option string.
    """
    parts = ticker.split()
    if len(parts) != 4:
        return None
    sym, date_str, strike_str, opt_type = parts
    try:
        day    = int(date_str[:2])
        mon    = _MONTHS[date_str[2:5].upper()]
        yr     = int(date_str[5:7])
        strike = int(round(float(strike_str) * 1000))
        return f"{sym}{yr:02d}{mon:02d}{day:02d}{opt_type.upper()}{strike:08d}"
    except (ValueError, KeyError):
        return None


def _option_display_name(sym: str, date_str: str, strike_str: str, opt_type: str) -> str:
    """Human-readable name, e.g. 'ETHA Call $15 Apr-26'."""
    label    = "Call" if opt_type.upper() == "C" else "Put"
    mon_abbr = date_str[2:5].capitalize()
    yr       = date_str[5:7]
    return f"{sym} {label} ${strike_str} {mon_abbr}-{yr}"


def _fetch_option_price(occ: str) -> float | None:
    """Fetch latest price for an OCC-format option ticker.

    fast_info.last_price can raise KeyError('currentTradingPeriod') for illiquid
    or near-expiry options; fall through to history in that case.
    """
    try:
        t = yf.Ticker(occ)
        price = None
        try:
            price = t.fast_info.last_price
        except Exception:
            pass  # fall through to history
        if price is None:
            hist = t.history(period="5d")
            if not hist.empty:
                price = float(hist["Close"].dropna().iloc[-1])
        return round(float(price), 4) if price is not None else None
    except Exception:
        return None  # silently return None for expired / illiquid options


# ─── Price / ticker info ──────────────────────────────────────────────────────

async def fetch_prices(tickers: list[str]) -> dict[str, float | None]:
    """Batch-fetch latest close prices for a list of tickers via yfinance.

    Stock tickers are downloaded in one batch.
    IBKR-format option tickers (e.g. 'ONDS 17APR26 11 C') are converted to OCC
    format and fetched individually.
    """
    if not tickers:
        return {}
    stock_tickers  = [t for t in tickers if " " not in t]
    option_tickers = [t for t in tickers if " " in t]
    result: dict[str, float | None] = {t.upper(): None for t in tickers}

    # ── Stocks: batch download ───────────────────────────────────────────────
    if stock_tickers:
        try:
            data   = yf.download(stock_tickers, period="5d", progress=False, auto_adjust=True)
            closes = data["Close"] if len(stock_tickers) > 1 else data["Close"].rename(stock_tickers[0])
            for ticker in stock_tickers:
                try:
                    series = closes[ticker] if len(stock_tickers) > 1 else closes
                    val    = series.dropna().iloc[-1]
                    result[ticker.upper()] = round(float(val), 4)
                except Exception:
                    pass
        except Exception as exc:
            log.warning("fetch_prices (stocks) failed: %s", exc)

    # ── Options: OCC conversion + individual fetch ───────────────────────────
    for ticker in option_tickers:
        occ = ibkr_to_occ(ticker)
        if not occ:
            continue
        price = _fetch_option_price(occ)
        if price is not None:
            result[ticker.upper()] = price

    return result


async def fetch_ticker_info(ticker: str) -> dict:
    """Fetch company name and current price for a single ticker.

    Handles both plain stock tickers and IBKR-format option strings
    (e.g. 'ETHA 17APR26 15 C').
    """
    result = {"company_name": None, "current_price": None}

    # ── Options ──────────────────────────────────────────────────────────────
    parts = ticker.split()
    if len(parts) == 4:
        occ = ibkr_to_occ(ticker)
        if occ:
            sym, date_str, strike_str, opt_type = parts
            result["company_name"] = _option_display_name(sym, date_str, strike_str, opt_type)
            price = _fetch_option_price(occ)
            if price is not None:
                result["current_price"] = price
        return result

    # ── Stocks ───────────────────────────────────────────────────────────────
    try:
        t    = yf.Ticker(ticker)
        info = t.info
        result["company_name"] = info.get("shortName") or info.get("longName") or ticker.upper()
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


async def fetch_fx_rate(ccy: str, base: str = "EUR") -> float | None:
    """Fetch live exchange rate: how many `base` units equal 1 `ccy` unit."""
    if ccy == base:
        return 1.0
    try:
        t     = yf.Ticker(f"{ccy}{base}=X")
        price = t.fast_info.last_price
        return round(float(price), 6) if price else None
    except Exception as exc:
        log.warning("fetch_fx_rate(%s/%s) failed: %s", ccy, base, exc)
        return None


# ─── Position metrics ─────────────────────────────────────────────────────────

def compute_position_metrics(pos, current_price: float | None) -> dict:
    """Compute derived fields for one live position.

    Option positions (IBKR format: 'ETHA 17APR26 15 C') store shares as the
    number of contracts.  Multiply by 100 (the standard equity-option contract
    size) to convert to notional exposure and dollar P&L.
    """
    today = datetime.date.today()
    entry = pos.entry_date if hasattr(pos, "entry_date") else pos["entry_date"]
    if isinstance(entry, str):
        entry = datetime.date.fromisoformat(entry)

    days_in_trade = int(np.busday_count(entry, today))
    ticker = pos.ticker if hasattr(pos, "ticker") else (pos.get("ticker", "") if hasattr(pos, "get") else "")
    sign   = 1.0 if (pos.side if hasattr(pos, "side") else pos["side"]) == "long" else -1.0
    shares = pos.shares if hasattr(pos, "shares") else pos["shares"]
    avg_in = pos.avg_price_in if hasattr(pos, "avg_price_in") else pos["avg_price_in"]
    stop   = pos.stop   if hasattr(pos, "stop")   else pos.get("stop")
    target = pos.target if hasattr(pos, "target") else pos.get("target")

    # Options: 1 contract = 100 underlying shares
    is_option      = len(ticker.split()) == 4
    contract_mult  = 100 if is_option else 1

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
        notional       = shares * current_price * contract_mult
        gross_exposure = round(abs(notional), 2)
        net_exposure   = round(notional * sign, 2)
        pnl_dollar     = round((current_price - avg_in) * shares * contract_mult * sign, 2)
        invested       = avg_in * shares * contract_mult
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


# ─── Portfolio volatility / correlation ──────────────────────────────────────

async def compute_volatility(
    tickers: list[str],
    weights: list[float],       # signed fractions; sum(|w|) should be ~1
    allocations: list[float] | None,  # $ net exposure per ticker, or None
    weeks: int = 52,
) -> dict:
    """
    Download weekly price history for each ticker, compute the
    variance-covariance and correlation matrices, and return portfolio
    risk metrics.
    """
    # Download weekly closes for each stock ticker
    price_data: dict[str, pd.Series] = {}
    skipped: list[str] = []
    ticker_to_weight = dict(zip(tickers, weights))
    ticker_to_alloc  = dict(zip(tickers, allocations)) if allocations else {}

    for t in tickers:
        if " " in t:                        # skip OCC-format options
            skipped.append(t)
            continue
        try:
            hist = (
                yf.Ticker(t)
                .history(period=f"{weeks + 15}wk", interval="1wk")["Close"]
                .dropna()
            )
            if len(hist) > 1:
                price_data[t] = hist.iloc[-(weeks + 1):]   # keep at most weeks+1 rows
        except Exception as exc:
            log.warning("compute_volatility: price fetch failed for %s: %s", t, exc)
            skipped.append(t)

    if len(price_data) < 2:
        return {"error": "Not enough price data", "tickers": [], "skipped": skipped}

    # Align all series on common dates → weekly returns matrix
    prices_df = pd.DataFrame(price_data).dropna()
    returns_df = prices_df.pct_change().dropna()
    actual_tickers = list(returns_df.columns)

    # Re-align weights / allocations to surviving tickers
    w = np.array([ticker_to_weight.get(t, 0.0) for t in actual_tickers])
    gross = float(np.abs(w).sum())
    if gross > 0:
        w = w / gross                       # renormalize

    actual_allocs: list[float] | None = None
    if allocations is not None:
        actual_allocs = [ticker_to_alloc.get(t, 0.0) for t in actual_tickers]

    cov  = returns_df.cov().values
    corr = returns_df.corr().values
    asset_vols = np.sqrt(np.diag(cov))

    port_var   = float(w @ cov @ w)
    port_std_w = float(np.sqrt(max(port_var, 0.0)))
    port_std_a = port_std_w * math.sqrt(52)
    av_vol_w   = float(asset_vols.mean())
    av_vol_a   = av_vol_w * math.sqrt(52)
    port_corr  = (port_std_w / av_vol_w) if av_vol_w > 0 else None

    return {
        "tickers":             actual_tickers,
        "weights":             w.tolist(),
        "allocations":         actual_allocs,
        "cov_matrix":          cov.tolist(),
        "corr_matrix":         corr.tolist(),
        "asset_vols_weekly":   asset_vols.tolist(),
        "portfolio_variance":  round(port_var,   6),
        "portfolio_std_weekly": round(port_std_w, 6),
        "portfolio_std_annual": round(port_std_a, 6),
        "av_asset_std_weekly":  round(av_vol_w,   6),
        "av_asset_std_annual":  round(av_vol_a,   6),
        "portfolio_correlation": round(port_corr, 6) if port_corr is not None else None,
        "weeks_used":          len(returns_df),
        "skipped":             skipped,
    }


# ─── PnL computation (server-side on trade write) ─────────────────────────────

def compute_trade_pnl(side: str, shares: float, avg_entry: float, avg_exit: float) -> tuple[float, float]:
    """Return (pnl_dollar, pnl_pct) for a trade."""
    sign = 1.0 if side == "long" else -1.0
    pnl_dollar = round((avg_exit - avg_entry) * shares * sign, 2)
    invested   = avg_entry * shares
    pnl_pct    = round(pnl_dollar / invested * 100, 2) if invested else 0.0
    return pnl_dollar, pnl_pct
