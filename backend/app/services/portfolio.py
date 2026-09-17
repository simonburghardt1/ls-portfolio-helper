import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta

import pandas as pd
import yfinance as yf

log = logging.getLogger(__name__)


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


def _beta_neutralize_weights(positions: list[dict], betas: dict[str, float]) -> dict:
    """
    Rescale position weights so that portfolio beta (vs whatever benchmark `betas` was
    computed against — caller's choice, this function is pure arithmetic) approaches 0.
    Pulled out of beta_adjust() as its own pure function (no I/O) so a caller who already
    has betas computed under a *different* convention (e.g. the Portfolio Beta page's
    weekly/^GSPC betas, vs this module's own daily/SPY convention used elsewhere) can
    reuse the exact same algorithm against its own already-computed numbers, instead of
    getting a silently-different result recomputed under beta_adjust's own convention.

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


def beta_adjust(positions: list[dict]) -> dict:
    """Rescale position weights so that portfolio beta vs SPY (daily returns, 1Y)
    approaches 0 — see _beta_neutralize_weights for the actual algorithm."""
    tickers = list({p["ticker"].upper() for p in positions})
    prices = download_prices(tickers + ["SPY"], period="1y")
    returns = prices.pct_change().dropna()
    spy_returns = returns["SPY"]

    betas: dict[str, float] = {
        t: _compute_beta(returns[t], spy_returns)
        for t in tickers
        if t in returns.columns
    }

    return _beta_neutralize_weights(positions, betas)


# A curated (necessarily incomplete) set of well-known crypto symbols where "prefer the
# crypto pair over an as-typed match" always applies, not just when the as-typed lookup
# fails outright. Empirically confirmed this session: a large fraction of these bare
# symbols coincidentally collide with a real, unrelated stock/ETF ticker on yfinance —
# "BTC", "ETH", "XRP", "TRX", "LTC", "LINK", "ATOM", "BCH", "NEAR", "APT", and "VET" all
# resolve to *something* as typed, but not the coin. Restricting this always-prefer-crypto
# check to a known list (rather than unconditionally guessing "<ticker>-USD" for every
# ticker everywhere) keeps _download_close/_download_ohlc's hot path cheap for the
# overwhelming majority of normal stock/ETF/commodity tickers — a coin not on this list
# still gets resolved via the plain empty-result fallback, as long as it doesn't also
# happen to collide with an unrelated ticker (accepted, narrower edge case).
KNOWN_CRYPTO_SYMBOLS = {
    "BTC", "ETH", "BNB", "XRP", "SOL", "ADA", "DOGE", "TRX", "TON", "DOT",
    "MATIC", "POL", "LTC", "XMR", "ZEC", "AVAX", "LINK", "ATOM", "UNI", "XLM",
    "BCH", "NEAR", "APT", "FIL", "ICP", "ETC", "HBAR", "VET", "OP", "ARB",
    "SUI", "SHIB", "PEPE", "HYPE", "TAO", "INJ", "RENDER", "FTM", "ALGO", "EGLD",
    "SAND", "MANA", "AAVE", "MKR", "GRT", "CRV", "LDO", "RUNE", "KAS", "STX",
}


def is_known_crypto_symbol(ticker: str) -> bool:
    return ticker.upper().split("-")[0] in KNOWN_CRYPTO_SYMBOLS


def find_invalid_tickers(tickers: list[str]) -> list[str]:
    """
    Batch-checks a list of tickers via yfinance and returns the ones with no price data
    (delisted, mistyped, or otherwise unavailable) — the same all-NaN detection
    download_prices() already uses to guard a backtest, extracted here so Basket and
    Portfolio creation/edit can catch a bad ticker at entry time instead of failing much
    later when a backtest actually runs. A short 5-day window is enough to confirm a
    ticker resolves to real data; no need for the full history just to validate.
    """
    if not tickers:
        return []

    data = yf.download(tickers=tickers, period="5d", interval="1d", auto_adjust=True, progress=False)
    if data.empty:
        return list(dict.fromkeys(tickers))

    if isinstance(data.columns, pd.MultiIndex):
        prices = data["Close"]
    else:
        prices = data[["Close"]].copy()
        prices.columns = tickers

    return [t for t in dict.fromkeys(tickers) if t not in prices.columns or prices[t].isna().all()]


def resolve_crypto_ticker(raw: str) -> str | None:
    """
    Resolves a bare crypto symbol (e.g. "BTC", "HYPE") to its real yfinance ticker.
    No user types the exact yfinance symbol for a crypto pair unprompted — least of all
    one Yahoo disambiguates with an arbitrary numeric suffix (e.g. "HYPE" is really
    "HYPE32196-USD", confirmed empirically; a plain "HYPE-USD" guess has no price data).

    Strategy (cheapest first): try "<bare>-USD" via find_invalid_tickers — covers the
    vast majority of coins (BTC, ETH, BNB, XRP, SOL, TRX, ZEC, DOGE, XMR all resolve this
    way, no extra network round-trip beyond the guess-validation itself). Only on failure,
    fall back to yfinance's own symbol search (yf.Search), filtered to
    quoteType == "CRYPTOCURRENCY" and a symbol matching "<bare>" + optional digits +
    "-USD" — Search's results are mixed with unrelated equity matches and, for some
    symbols, multiple crypto pairs (e.g. ZEC-BTC, XMR-EUR), so both filters are required;
    confirmed 10/10 correct with zero false positives against BTC/ETH/BNB/XRP/SOL/TRX/
    ZEC/HYPE/DOGE/XMR. Returns None if nothing resolves — a genuinely mistyped stock
    ticker simply won't have a crypto match, so this is a no-op (not a false positive)
    for non-crypto typos.
    """
    bare = raw.upper().split("-")[0]
    guess = f"{bare}-USD"
    if not find_invalid_tickers([guess]):
        return guess

    try:
        quotes = yf.Search(bare).quotes
    except Exception:
        log.warning("Crypto ticker search failed for %s", bare, exc_info=True)
        return None

    pattern = re.compile(rf"^{re.escape(bare)}\d*-USD$")
    matches = [
        q["symbol"] for q in quotes
        if q.get("quoteType") == "CRYPTOCURRENCY" and pattern.match(q.get("symbol", ""))
    ]
    return matches[0] if matches else None


def _real_crypto_tickers(guesses: list[str], min_days: int = 200) -> set[str]:
    """
    Confirms which "<bare>-USD" guesses are a real, established cryptocurrency rather than
    a thin Yahoo-listed tokenized-stock derivative sharing the same base symbol (e.g.
    "AVGO-USD" is quoteType CRYPTOCURRENCY but only ~1 month of history — a tokenized wrapper
    around the Broadcom stock, not the actual coin). find_invalid_tickers()'s 5-day window
    is too lenient to tell these apart; a real coin has a long, continuous price history, so
    requiring ~200 non-NaN daily closes over the last year cleanly separates the two
    (confirmed empirically against ~200 known real cryptocurrencies and the AVGO/ASML/QCOM/
    INTC/CRDO/MRVL/AMAT/KLAC/LRCX/MPWR/TER derivative collisions).
    """
    if not guesses:
        return set()

    data = yf.download(tickers=guesses, period="1y", interval="1d", auto_adjust=True, progress=False)
    if data.empty:
        return set()

    if isinstance(data.columns, pd.MultiIndex):
        closes = data["Close"]
    else:
        closes = data[["Close"]].copy()
        closes.columns = guesses

    return {g for g in dict.fromkeys(guesses) if g in closes.columns and closes[g].notna().sum() >= min_days}


def resolve_and_validate_tickers(
    tickers: list[str], disambiguations: dict[str, str] | None = None
) -> tuple[dict[str, str], list[str], dict[str, dict]]:
    """
    Batch resolver for Basket/Portfolio creation and edits.

    A bare ticker "valid as typed" is not necessarily what the user meant: several major
    crypto shorthands coincidentally collide with a real, unrelated stock ticker on
    yfinance (confirmed empirically — e.g. "BTC", "ETH", "XRP", "TRX", and (less obviously)
    "STX" — Stacks the coin vs. Seagate Technology the stock — all resolve to real but
    completely unrelated equities, not just the crypto pair). Rather than a hardcoded list
    of "known crypto symbols" (tried, but doesn't generalize — STX above was already in such
    a list, an S&P 500 stock ticker collision shipped by mistake), every ticker's "<bare>-USD"
    guess is checked *in addition to* its as-typed validity, and:
      - only the crypto guess is real (see _real_crypto_tickers) -> use it
      - only the as-typed ticker is real -> use it (fixes the AVGO-style bug: the guess
        exists but is a thin tokenized derivative, not a real coin)
      - both are real -> genuinely ambiguous, can't be guessed safely either way; reported
        back to the caller instead of silently picked, unless `disambiguations` (a
        {input_ticker: "stock"|"crypto"} map, supplied once the user has picked one) says
        otherwise
      - neither -> falls back to resolve_crypto_ticker()'s yfinance Search (covers Yahoo's
        disambiguated symbols, e.g. "HYPE" -> "HYPE32196-USD")

    Returns ({original_input: final_ticker_to_store}, [inputs still unresolvable],
    {input_ticker: {"stock": {...}, "crypto": {...}}} for ones needing a user decision).
    """
    disambiguations = disambiguations or {}
    unique = list(dict.fromkeys(tickers))
    guesses = {t: f"{t.upper().split('-')[0]}-USD" for t in unique}

    invalid_as_typed = set(find_invalid_tickers(unique))
    real_crypto = _real_crypto_tickers(list(dict.fromkeys(guesses.values())))

    resolved: dict[str, str] = {}
    ambiguous: dict[str, dict] = {}
    needs_search: list[str] = []
    for t in unique:
        guess = guesses[t]
        is_crypto = guess in real_crypto
        is_stock = t not in invalid_as_typed
        choice = disambiguations.get(t)

        if choice == "stock" and is_stock:
            resolved[t] = t
        elif choice == "crypto" and is_crypto:
            resolved[t] = guess
        elif is_crypto and is_stock and _quote_type(t) == "EQUITY":
            # Only a real, distinct company is worth prompting over (the reported bug and
            # STX/Seagate are both like this). A same-ticker ETF/trust — e.g. the 2024 spot
            # Bitcoin/Ethereum ETFs that literally trade as "BTC"/"ETH" — isn't a different
            # asset a user typing the bare symbol plausibly meant instead of the coin itself,
            # so it doesn't count as a real alternative here (confirmed empirically: "BTC"/
            # "ETH" resolve as EQUITY-less ETF quoteTypes, "AVGO"/"STX" as real EQUITY).
            ambiguous[t] = {
                "stock": {"ticker": t, "name": _display_name(t)},
                "crypto": {"ticker": guess, "name": _display_name(guess)},
            }
        elif is_crypto:
            resolved[t] = guess
        elif is_stock:
            resolved[t] = t
        else:
            needs_search.append(t)

    unresolved: list[str] = []
    if needs_search:
        with ThreadPoolExecutor(max_workers=min(len(needs_search), 8)) as pool:
            results = list(pool.map(resolve_crypto_ticker, needs_search))
        for t, r in zip(needs_search, results):
            if r:
                resolved[t] = r
            else:
                unresolved.append(t)

    return (
        {t: resolved[t] for t in tickers if t in resolved},
        unresolved,
        {t: ambiguous[t] for t in tickers if t in ambiguous},
    )


def _quote_type(ticker: str) -> str | None:
    """yfinance's quoteType for the as-typed ticker (e.g. "EQUITY", "ETF") — only called for
    the rare ticker that's already confirmed real on both the stock and crypto side, to
    decide whether the "stock side" is an actual distinct company worth prompting over."""
    try:
        return yf.Ticker(ticker).info.get("quoteType")
    except Exception:
        return None


def _display_name(ticker: str) -> str:
    """Best-effort short human-readable name for a disambiguation prompt; falls back to the
    ticker itself if yfinance has nothing (never blocks the flow over a missing label)."""
    try:
        info = yf.Ticker(ticker).info
        return info.get("shortName") or info.get("longName") or ticker
    except Exception:
        return ticker


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

    # A ticker that failed entirely (e.g. delisted, mistyped, temporarily
    # unavailable from the data provider) leaves a column of all-NaN. Since
    # returns are later computed with dropna(how="any") across all tickers,
    # a single such column would silently wipe out every row and crash much
    # further downstream with a confusing IndexError — fail fast here instead
    # with a message naming the actual problem ticker(s).
    failed = [t for t in prices.columns if prices[t].isna().all()]
    if failed:
        raise ValueError(
            f"No price data available for: {', '.join(failed)} "
            "(ticker may be delisted, mistyped, or temporarily unavailable)"
        )

    return prices


def download_prices_chunked(tickers: list[str], start: str, end: str | None = None, chunk_size: int = 150) -> pd.DataFrame:
    """
    Like download_prices, but tolerant: drops failed/all-NaN tickers per chunk
    instead of raising, and downloads in batches. Meant for large (500+ ticker)
    universes (e.g. a screener-derived candidate list) where some names are
    expected to fail (delisted, mistyped, temporarily unavailable) and a single
    bad ticker must not abort the whole download.
    """
    chunks = [tickers[i:i + chunk_size] for i in range(0, len(tickers), chunk_size)]
    frames = []

    for i, chunk in enumerate(chunks):
        try:
            raw = yf.download(
                chunk, start=start, end=end, interval="1d",
                auto_adjust=True, progress=False, threads=True,
            )
            if raw.empty:
                continue
            if isinstance(raw.columns, pd.MultiIndex):
                closes = raw["Close"].copy()
            else:
                closes = raw[["Close"]].copy()
                closes.columns = chunk
            closes = closes.dropna(axis=1, how="all")
            frames.append(closes)
        except Exception as exc:
            log.warning("download_prices_chunked: chunk %d/%d failed: %s", i + 1, len(chunks), exc)
        time.sleep(0.4)  # polite spacing between batches

    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, axis=1).sort_index()


def compute_portfolio_beta(positions: list[dict], benchmark: str = "^GSPC") -> dict:
    """
    Per-position beta (1Y, weekly returns) vs `benchmark`, plus long/short subtotals and
    the portfolio's net beta — mirrors the user's own reference workbook (Beta.xlsx):
    SLOPE(stock weekly returns, benchmark weekly returns) over the most recent ~52 weekly
    points, mathematically identical to _compute_beta's Cov/Var OLS formula, just fed
    weekly- instead of daily-resampled returns.

    Deliberately separate from compute_portfolio_analytics (which already computes a
    similar per-ticker beta vs SPY, but with *daily* returns) rather than changing that
    function's behavior — it's the Backtesting page's existing KPI source and shouldn't
    silently shift for an unrelated new page.

    Uses `^GSPC` (the real S&P 500 index), not this app's usual `SPY` proxy — a deliberate,
    page-scoped exception (confirmed with the user); every other page keeps SPY for now.

    Uses download_prices_chunked (tolerant — drops a bad/delisted ticker) rather than
    download_prices (hard-fails the whole request on one bad ticker) so one stale position
    doesn't break the whole page.
    """
    tickers = list({p["ticker"].upper() for p in positions})
    start = (datetime.now(timezone.utc).date() - timedelta(days=730)).isoformat()
    prices = download_prices_chunked(tickers + [benchmark], start=start)

    weekly = prices.resample("W").last()
    returns = weekly.pct_change().dropna(how="all").tail(53)

    bench_ret = returns[benchmark] if benchmark in returns.columns else None

    betas: dict[str, float | None] = {}
    for t in tickers:
        if bench_ret is None or t not in returns.columns:
            betas[t] = None
            continue
        aligned = pd.concat([returns[t], bench_ret], axis=1).dropna()
        betas[t] = round(_compute_beta(aligned.iloc[:, 0], aligned.iloc[:, 1]), 4) if len(aligned) >= 10 else None

    rows = [
        {"ticker": p["ticker"].upper(), "side": p["side"], "weight": p["weight"], "beta": betas.get(p["ticker"].upper())}
        for p in positions
    ]

    def summarize(side_rows: list[dict]) -> dict:
        weight = sum(r["weight"] for r in side_rows)
        weighted_beta = sum(r["weight"] * r["beta"] for r in side_rows if r["beta"] is not None)
        return {"weight": round(weight, 4), "weighted_beta": round(weighted_beta, 4)}

    long_summary = summarize([r for r in rows if r["side"] == "long"])
    short_summary = summarize([r for r in rows if r["side"] == "short"])

    return {
        "rows": rows,
        "long": long_summary,
        "short": short_summary,
        "net_weight": round(long_summary["weight"] - short_summary["weight"], 4),
        "portfolio_beta": round(long_summary["weighted_beta"] - short_summary["weighted_beta"], 4),
    }


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
