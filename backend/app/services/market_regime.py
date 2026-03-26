import numpy as np
import pandas as pd
import yfinance as yf

# Composite regime thresholds
THRESHOLD_UP   =  0.25
THRESHOLD_DOWN = -0.25

# Component weights (must sum to 1.0)
WEIGHTS = {"bmsb": 0.35, "breadth": 0.30, "vix": 0.20, "credit": 0.15}

# BMSB breach threshold
BAND_BREACH_PCT = 0.01


def _score_bmsb(price: float, ema21: float, sma20: float) -> float:
    band_upper = max(ema21, sma20)
    band_lower = min(ema21, sma20)
    if price > band_upper and ema21 > sma20:
        return 1.0
    elif price < band_lower * (1 - BAND_BREACH_PCT):
        return -1.0
    return 0.0


def _score_breadth(ratio: float, ratio_ma: float) -> float:
    if pd.isna(ratio) or pd.isna(ratio_ma) or ratio_ma == 0:
        return None
    deviation = (ratio / ratio_ma) - 1
    return float(np.clip(deviation * 20, -1.0, 1.0))


def _score_vix(vix: float, vix_min: float, vix_max: float) -> float:
    if pd.isna(vix) or pd.isna(vix_min) or pd.isna(vix_max) or vix_max == vix_min:
        return None
    normalized = (vix - vix_min) / (vix_max - vix_min)
    return float(1.0 - 2.0 * np.clip(normalized, 0, 1))


def _score_credit(ratio: float, ratio_ma: float) -> float:
    if pd.isna(ratio) or pd.isna(ratio_ma) or ratio_ma == 0:
        return None
    deviation = (ratio / ratio_ma) - 1
    return float(np.clip(deviation * 20, -1.0, 1.0))


def _composite(scores: dict) -> float | None:
    total_w = 0.0
    total_s = 0.0
    for key, w in WEIGHTS.items():
        s = scores.get(key)
        if s is not None:
            total_s += w * s
            total_w += w
    if total_w == 0:
        return None
    return total_s / total_w


def _regime_from_score(score: float | None) -> str | None:
    if score is None:
        return None
    if score > THRESHOLD_UP:
        return "up"
    if score < THRESHOLD_DOWN:
        return "down"
    return "ranging"


# Inception dates — downloading before these causes yfinance to fail
TICKER_STARTS = {
    "SPY":  "1998-01-01",
    "^VIX": "1998-01-01",
    "RSP":  "2003-11-01",   # RSP IPO: 2003-04-30
    "LQD":  "2002-08-01",   # LQD IPO: 2002-07-26
    "HYG":  "2007-04-01",   # HYG IPO: 2007-04-11
}


def _dl(ticker: str, start: str) -> pd.Series:
    """Download weekly closes for a single ticker; return empty Series on failure."""
    try:
        raw = yf.download(ticker, start=start, interval="1wk",
                          auto_adjust=True, progress=False)
        if raw.empty:
            return pd.Series(dtype=float, name=ticker)
        if isinstance(raw.columns, pd.MultiIndex):
            for key in [("Close", ticker), (ticker, "Close")]:
                if key in raw.columns:
                    return raw[key].rename(ticker)
            return pd.Series(dtype=float, name=ticker)
        return raw["Close"].squeeze().rename(ticker)
    except Exception:
        return pd.Series(dtype=float, name=ticker)


def compute_market_regime(start: str = "1998-01-01") -> dict:
    spy = _dl("SPY",  start)
    spy = spy.dropna()

    tol = pd.Timedelta("4d")

    def align(s):
        return s.reindex(spy.index, method="nearest", tolerance=tol)

    rsp = align(_dl("RSP",  TICKER_STARTS["RSP"]))
    vix = align(_dl("^VIX", start))
    hyg = align(_dl("HYG",  TICKER_STARTS["HYG"]))
    lqd = align(_dl("LQD",  TICKER_STARTS["LQD"]))

    # BMSB indicators
    ema21 = spy.ewm(span=21, adjust=False).mean()
    sma20 = spy.rolling(20).mean()

    # Breadth: RSP/SPY ratio and its 10W SMA
    rsp_spy = (rsp / spy).where(spy > 0)
    rsp_spy_ma = rsp_spy.rolling(10).mean()

    # VIX: rolling 52-week (52 weeks) min/max
    vix_min = vix.rolling(52).min()
    vix_max = vix.rolling(52).max()

    # Credit: HYG/LQD ratio and its 10W SMA
    hyg_lqd = (hyg / lqd).where(lqd > 0)
    hyg_lqd_ma = hyg_lqd.rolling(10).mean()

    n = len(spy)
    scores_bmsb    = []
    scores_breadth = []
    scores_vix     = []
    scores_credit  = []
    composites_raw = []

    for i in range(n):
        e21 = ema21.iloc[i]
        s20 = sma20.iloc[i]
        p   = spy.iloc[i]

        # BMSB
        sb = None if pd.isna(e21) or pd.isna(s20) else _score_bmsb(p, e21, s20)

        # Breadth
        sb2 = _score_breadth(rsp_spy.iloc[i], rsp_spy_ma.iloc[i])

        # VIX
        sv = _score_vix(vix.iloc[i], vix_min.iloc[i], vix_max.iloc[i])

        # Credit
        sc = _score_credit(hyg_lqd.iloc[i], hyg_lqd_ma.iloc[i])

        scores_bmsb.append(sb)
        scores_breadth.append(sb2)
        scores_vix.append(sv)
        scores_credit.append(sc)
        composites_raw.append(_composite({"bmsb": sb, "breadth": sb2, "vix": sv, "credit": sc}))

    # 2-week EMA smoothing on composite
    comp_series = pd.Series(composites_raw, index=spy.index, dtype=float)
    comp_smooth = comp_series.ewm(span=2, adjust=False).mean()

    regimes = [_regime_from_score(v) for v in comp_smooth]

    def fmt(val):
        return round(float(val), 4) if not pd.isna(val) else None

    dates = [d.strftime("%Y-%m-%d") for d in spy.index]
    return {
        "dates":     dates,
        "prices":    [fmt(v) for v in spy],
        "ema21":     [fmt(v) for v in ema21],
        "sma20":     [fmt(v) for v in sma20],
        "regimes":   regimes,
        "composite": [fmt(v) for v in comp_smooth],
        "scores": {
            "bmsb":    [fmt(v) if v is not None else None for v in scores_bmsb],
            "breadth": [fmt(v) if v is not None else None for v in scores_breadth],
            "vix":     [fmt(v) if v is not None else None for v in scores_vix],
            "credit":  [fmt(v) if v is not None else None for v in scores_credit],
        },
    }
