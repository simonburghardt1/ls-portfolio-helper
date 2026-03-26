import pandas as pd
import yfinance as yf

SLOPE_THRESHOLD = 0.003  # 0.3% over 20 days


def compute_market_regime(start: str = "1998-01-01") -> dict:
    raw = yf.download(
        "SPY",
        start=start,
        interval="1d",
        auto_adjust=True,
        progress=False,
    )
    closes = raw["Close"].squeeze().dropna()

    sma50 = closes.rolling(50).mean()
    sma200 = closes.rolling(200).mean()
    slope = (sma50 - sma50.shift(20)) / sma50.shift(20)

    regimes = []
    for i in range(len(closes)):
        s50 = sma50.iloc[i]
        s200 = sma200.iloc[i]
        sl = slope.iloc[i]
        if pd.isna(s50) or pd.isna(s200) or pd.isna(sl):
            regimes.append(None)
        elif s50 > s200 and sl > SLOPE_THRESHOLD:
            regimes.append("up")
        elif s50 < s200 and sl < -SLOPE_THRESHOLD:
            regimes.append("down")
        else:
            regimes.append("ranging")

    dates = [d.strftime("%Y-%m-%d") for d in closes.index]
    return {
        "dates": dates,
        "prices": closes.round(2).tolist(),
        "sma50": [round(float(v), 2) if not pd.isna(v) else None for v in sma50],
        "sma200": [round(float(v), 2) if not pd.isna(v) else None for v in sma200],
        "regimes": regimes,
    }
