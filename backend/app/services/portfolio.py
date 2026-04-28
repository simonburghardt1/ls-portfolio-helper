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


def _compute_beta(asset_returns: pd.Series, benchmark_returns: pd.Series) -> float:
    """OLS beta of an asset vs a benchmark: Cov(asset, benchmark) / Var(benchmark)."""
    aligned = pd.concat([asset_returns, benchmark_returns], axis=1).dropna()
    if len(aligned) < 10:
        return 1.0  # not enough data — fall back to market beta
    cov_matrix = aligned.cov()
    var_benchmark = cov_matrix.iloc[1, 1]
    return float(cov_matrix.iloc[0, 1] / var_benchmark) if var_benchmark else 1.0


def compute_portfolio_analytics(positions: list[dict]) -> dict:
    """
    Compute portfolio-level analytics vs SPY over 1 year:
      - per-ticker betas
      - portfolio beta  = Σ signed_weight_i × β_i
      - portfolio correlation = Corr(portfolio_returns, SPY_returns)

    Called on portfolio load so the KPIs are populated without running
    a full backtest.
    """
    tickers = list({p["ticker"].upper() for p in positions})
    prices = download_prices(tickers + ["SPY"], period="1y")
    returns = prices.pct_change().dropna()
    spy_returns = returns["SPY"]

    betas: dict[str, float] = {
        t: _compute_beta(returns[t], spy_returns)
        for t in tickers
        if t in returns.columns
    }

    # Portfolio beta: signed weighted sum
    portfolio_beta = sum(
        p["weight"] * betas.get(p["ticker"].upper(), 1.0) * (1 if p["side"] == "long" else -1)
        for p in positions
    )

    # Portfolio return series: weighted sum of signed position returns
    port_returns = pd.Series(0.0, index=returns.index)
    for p in positions:
        t = p["ticker"].upper()
        if t in returns.columns:
            sign = 1.0 if p["side"] == "long" else -1.0
            port_returns = port_returns + returns[t] * p["weight"] * sign

    # Correlation of portfolio vs SPY
    aligned = pd.concat([port_returns, spy_returns], axis=1).dropna()
    correlation: float | None = None
    if len(aligned) > 10:
        corr_matrix = aligned.corr()
        correlation = float(corr_matrix.iloc[0, 1])

    return {
        "betas":           {t: round(b, 4) for t, b in betas.items()},
        "portfolio_beta":  round(portfolio_beta, 4),
        "correlation":     round(correlation, 4) if correlation is not None else None,
    }


def beta_adjust(positions: list[dict]) -> dict:
    """
    Rescale position weights so that portfolio beta vs SPY approaches 0.

    Two-step algorithm:
      Step 1 — inverse-beta weighting within each side:
        For each side (long/short), rescale individual weights by 1/β so that
        high-beta positions receive lower weights. Side totals are preserved.
        e.g. SOFI (β=2.2) ends up with less weight than DKNG (β=1.05).

      Step 2 — side-level scale to cancel beta:
        After within-side rebalancing, compute each side's total beta exposure
        and solve for scale factors k_L, k_S such that the net portfolio beta = 0
        while total gross exposure is unchanged.
    """
    tickers = list({p["ticker"].upper() for p in positions})
    prices = download_prices(tickers + ["SPY"], period="1y")
    returns = prices.pct_change().dropna()
    spy_returns = returns["SPY"]

    betas: dict[str, float] = {
        t: _compute_beta(returns[t], spy_returns)
        for t in tickers
        if t in returns.columns
    }

    # Step 1: within each side, redistribute weight ∝ 1/β (preserving side total)
    positions_adj = [dict(p) for p in positions]
    for side in ("long", "short"):
        idx = [i for i, p in enumerate(positions_adj) if p["side"] == side]
        if not idx:
            continue
        side_total = sum(positions_adj[i]["weight"] for i in idx)
        # Clamp beta to 0.1 to avoid extreme weights on very-low-beta tickers
        inv_betas = {i: 1.0 / max(betas.get(positions_adj[i]["ticker"].upper(), 1.0), 0.1) for i in idx}
        inv_total = sum(inv_betas.values())
        for i in idx:
            positions_adj[i]["weight"] = inv_betas[i] / inv_total * side_total

    # Step 2: scale the long/short sides to cancel portfolio beta
    long_beta_exp  = sum(p["weight"] * betas.get(p["ticker"].upper(), 1.0) for p in positions_adj if p["side"] == "long")
    short_beta_exp = sum(p["weight"] * betas.get(p["ticker"].upper(), 1.0) for p in positions_adj if p["side"] == "short")

    if long_beta_exp <= 0 or short_beta_exp <= 0:
        portfolio_beta = round(long_beta_exp - short_beta_exp, 4)
        return {"positions": positions_adj, "betas": betas, "portfolio_beta": portfolio_beta}

    gross       = sum(p["weight"] for p in positions)
    long_gross  = sum(p["weight"] for p in positions_adj if p["side"] == "long")
    short_gross = sum(p["weight"] for p in positions_adj if p["side"] == "short")

    ratio = short_beta_exp / long_beta_exp   # = k_L / k_S
    k_s   = gross / (ratio * long_gross + short_gross)
    k_l   = ratio * k_s

    adjusted = [
        {**p, "weight": round(p["weight"] * (k_l if p["side"] == "long" else k_s), 6)}
        for p in positions_adj
    ]

    new_long_beta  = sum(p["weight"] * betas.get(p["ticker"].upper(), 1.0) for p in adjusted if p["side"] == "long")
    new_short_beta = sum(p["weight"] * betas.get(p["ticker"].upper(), 1.0) for p in adjusted if p["side"] == "short")
    portfolio_beta = round(new_long_beta - new_short_beta, 6)

    return {
        "positions":      adjusted,
        "betas":          {t: round(b, 4) for t, b in betas.items()},
        "portfolio_beta": portfolio_beta,
    }


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
) -> tuple[pd.Series, dict[str, pd.Series]]:
    returns = prices.pct_change().dropna()

    weighted: dict[str, pd.Series] = {}

    for pos in positions:
        ticker = pos["ticker"].upper()
        weight = float(pos["weight"])
        side = pos["side"].lower()

        if ticker not in returns.columns:
            raise ValueError(f"Ticker {ticker} not found in downloaded data.")

        sign = 1.0 if side == "long" else -1.0
        weighted[ticker] = returns[ticker] * weight * sign

    portfolio_returns = pd.concat(list(weighted.values()), axis=1).sum(axis=1)
    return portfolio_returns, weighted


def cumulative_series(portfolio_returns: pd.Series) -> pd.Series:
    return (1 + portfolio_returns).cumprod() - 1


def compute_drawdown_series(cumulative: pd.Series) -> pd.Series:
    wealth = 1 + cumulative
    running_max = wealth.cummax()
    return wealth / running_max - 1


def compute_risk_metrics(portfolio_returns: pd.Series, periods_per_year: int = 252) -> dict:
    r = portfolio_returns.dropna()
    if len(r) < 2:
        return {}
    std = float(r.std())
    mean_r = float(r.mean())
    ann_vol = std * (periods_per_year ** 0.5)
    sharpe = float((mean_r / std) * (periods_per_year ** 0.5)) if std else None
    downside = r[r < 0]
    ds_std = float(downside.std()) if len(downside) > 1 else None
    sortino = float((mean_r / ds_std) * (periods_per_year ** 0.5)) if ds_std else None
    cum = cumulative_series(r)
    max_dd = float(compute_drawdown_series(cum).min())
    return {
        "sharpe":  round(sharpe,  3) if sharpe  is not None else None,
        "sortino": round(sortino, 3) if sortino is not None else None,
        "max_dd":  round(max_dd,  4),
        "ann_vol": round(ann_vol, 4),
    }


def rolling_period_return(cumulative: pd.Series, lookback_days: int) -> float | None:
    if len(cumulative) <= lookback_days:
        return None

    start_value = 1 + cumulative.iloc[-(lookback_days + 1)]
    end_value = 1 + cumulative.iloc[-1]
    return float(end_value / start_value - 1)


def summary_returns(cumulative: pd.Series) -> dict:
    return {
        "1W":  rolling_period_return(cumulative, 5),
        "1M":  rolling_period_return(cumulative, 21),
        "3M":  rolling_period_return(cumulative, 63),
        "6M":  rolling_period_return(cumulative, 126),
        "12M": rolling_period_return(cumulative, 252),
    }


def benchmark_return_series(prices: pd.DataFrame, ticker: str = "SPY") -> pd.Series:
    if ticker not in prices.columns:
        raise ValueError(f"Benchmark ticker {ticker} not found in downloaded data.")

    benchmark_returns = prices[ticker].pct_change().dropna()
    return benchmark_returns


# ─── Regime-Adjust helpers ────────────────────────────────────────────────────

def _build_daily_regime_series(regime_data: dict, daily_index: pd.DatetimeIndex) -> pd.Series:
    """Forward-fill weekly regime labels onto a daily trading day index."""
    if not regime_data.get("dates"):
        return pd.Series("ranging", index=daily_index)
    weekly = pd.Series(
        regime_data["regimes"],
        index=pd.to_datetime(regime_data["dates"]),
        dtype=object,
    ).fillna("ranging")
    return weekly.reindex(daily_index, method="ffill").fillna("ranging")


def _compute_regime_scale_factors(
    positions: list[dict],
    betas: dict[str, float],
    targets: dict[str, float],
) -> dict[str, tuple[float, float]]:
    """
    For each regime, solve for (k_L, k_S) that hits the target net beta
    while preserving total gross exposure.

    System:
      B_L * k_L - B_S * k_S = target   (net beta)
      G_L * k_L + G_S * k_S = G_L+G_S  (gross exposure)
    """
    longs  = [p for p in positions if p["side"] == "long"]
    shorts = [p for p in positions if p["side"] == "short"]

    G_L = sum(p["weight"] for p in longs)
    G_S = sum(p["weight"] for p in shorts)
    B_L = sum(p["weight"] * betas.get(p["ticker"].upper(), 1.0) for p in longs)
    B_S = sum(p["weight"] * betas.get(p["ticker"].upper(), 1.0) for p in shorts)

    result: dict[str, tuple[float, float]] = {}
    for regime, target in targets.items():
        denom = B_L * G_S + B_S * G_L
        if G_L == 0 or G_S == 0 or abs(denom) < 1e-9:
            result[regime] = (1.0, 1.0)
            continue
        gross = G_L + G_S
        k_L = (target * G_S + gross * B_S) / denom
        k_S = (gross * B_L - target * G_L) / denom
        result[regime] = (
            max(0.1, min(3.0, k_L)),
            max(0.1, min(3.0, k_S)),
        )
    return result


def _compute_regime_scaled_returns(
    prices: pd.DataFrame,
    positions: list[dict],
    betas: dict[str, float],
    regime_series: pd.Series,
    targets: dict[str, float],
) -> pd.Series:
    """
    Compute daily portfolio returns with dynamic long/short scaling
    based on the current market regime.
    """
    scale_factors = _compute_regime_scale_factors(positions, betas, targets)
    daily_returns = prices.pct_change().dropna()
    result = pd.Series(0.0, index=daily_returns.index)
    aligned_regime = regime_series.reindex(daily_returns.index, fill_value="ranging")

    for regime in ("up", "down", "ranging"):
        if regime not in scale_factors:
            continue
        k_L, k_S = scale_factors[regime]
        mask = aligned_regime == regime
        if not mask.any():
            continue
        for pos in positions:
            ticker = pos["ticker"].upper()
            if ticker not in daily_returns.columns:
                continue
            sign = 1.0 if pos["side"] == "long" else -1.0
            k    = k_L  if pos["side"] == "long" else k_S
            result[mask] += daily_returns.loc[mask, ticker] * pos["weight"] * sign * k

    return result
