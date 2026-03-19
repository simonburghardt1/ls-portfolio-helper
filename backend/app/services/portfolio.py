import pandas as pd
import yfinance as yf


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
