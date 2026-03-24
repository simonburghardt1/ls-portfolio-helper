import pandas as pd
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor


def _fetch_ticker_meta(args: tuple) -> dict:
    """Fetch market cap (and optionally sector) for a single ticker.

    Runs inside a thread pool so all tickers are fetched in parallel.
    Falls back gracefully on any error so one bad ticker doesn't break
    the whole watchlist.
    """
    ticker, include_sector = args
    try:
        t = yf.Ticker(ticker)
        if include_sector:
            info    = t.info
            mkt_cap = info.get("marketCap") or 1
            sector  = info.get("sector") or "Unknown"
        else:
            mkt_cap = getattr(t.fast_info, "market_cap", None) or 1
            sector  = None
    except Exception:
        mkt_cap = 1
        sector  = "Unknown" if include_sector else None
    return {"mkt_cap": mkt_cap, "sector": sector}


def fetch_heatmap_data(tickers: list[str], include_sector: bool = False) -> list[dict]:
    """
    Fetch latest price, daily % change, market cap, and optionally sector
    for a list of tickers.

    Price data is fetched in a single batch call via yfinance. Metadata
    (market cap / sector) is fetched in parallel via a thread pool so
    the total latency is ~1–2s regardless of watchlist size.
    """
    if not tickers:
        return []

    # --- Price data (single batch download) ---
    raw = yf.download(
        tickers=tickers,
        period="5d",
        interval="1d",
        auto_adjust=True,
        progress=False,
    )

    # Normalise to a per-ticker DataFrame regardless of how many tickers were requested
    if isinstance(raw.columns, pd.MultiIndex):
        closes = raw["Close"]
    else:
        closes = raw[["Close"]].copy()
        closes.columns = tickers

    # --- Metadata (parallel per-ticker fetch) ---
    with ThreadPoolExecutor(max_workers=min(10, len(tickers))) as pool:
        metas = list(pool.map(_fetch_ticker_meta, [(t, include_sector) for t in tickers]))

    # --- Combine ---
    results = []
    for ticker, meta in zip(tickers, metas):
        try:
            series = closes[ticker].dropna()
            if len(series) >= 2:
                price      = float(series.iloc[-1])
                change_pct = float((series.iloc[-1] / series.iloc[-2] - 1) * 100)
            elif len(series) == 1:
                price      = float(series.iloc[-1])
                change_pct = None
            else:
                price = change_pct = None
        except Exception:
            price = change_pct = None

        entry = {
            "ticker":     ticker,
            "price":      price,
            "change_pct": change_pct,
            "market_cap": meta["mkt_cap"],
        }
        if include_sector:
            entry["sector"] = meta["sector"]

        results.append(entry)

    return results


def download_prices(tickers: list[str], period: str = "2y") -> pd.DataFrame:
    data = yf.download(
        tickers=tickers,
        period=period,
        interval="1d",
        auto_adjust=True,
        progress=False,
    )

    if data.empty:
        raise ValueError("No price data returned.")

    if isinstance(data.columns, pd.MultiIndex):
        prices = data["Close"].copy()
    else:
        prices = data[["Close"]].copy()
        prices.columns = tickers

    prices = prices.dropna(how="all")
    return prices


def build_portfolio_return_series(
    prices: pd.DataFrame, positions: list[dict]
) -> pd.Series:
    returns = prices.pct_change().dropna()

    weighted_returns = []

    for pos in positions:
        ticker = pos["ticker"].upper()
        weight = float(pos["weight"])
        side = pos["side"].lower()

        if ticker not in returns.columns:
            raise ValueError(f"Ticker {ticker} not found in downloaded data.")

        sign = 1.0 if side == "long" else -1.0
        weighted_returns.append(returns[ticker] * weight * sign)

    portfolio_returns = pd.concat(weighted_returns, axis=1).sum(axis=1)
    return portfolio_returns


def cumulative_series(portfolio_returns: pd.Series) -> pd.Series:
    return (1 + portfolio_returns).cumprod() - 1


def rolling_period_return(cumulative: pd.Series, lookback_days: int) -> float | None:
    if len(cumulative) <= lookback_days:
        return None

    start_value = 1 + cumulative.iloc[-(lookback_days + 1)]
    end_value = 1 + cumulative.iloc[-1]
    return float(end_value / start_value - 1)


def summary_returns(cumulative: pd.Series) -> dict:
    return {
        "3M": rolling_period_return(cumulative, 63),
        "6M": rolling_period_return(cumulative, 126),
        "12M": rolling_period_return(cumulative, 252),
    }


def benchmark_return_series(prices: pd.DataFrame, ticker: str = "SPY") -> pd.Series:
    if ticker not in prices.columns:
        raise ValueError(f"Benchmark ticker {ticker} not found in downloaded data.")

    benchmark_returns = prices[ticker].pct_change().dropna()
    return benchmark_returns
