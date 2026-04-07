import datetime
import logging

import numpy as np
import pandas as pd
import yfinance as yf
from sqlalchemy import select, delete
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.market_data import MarketPrice, MarketRegimeRow

log = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

THRESHOLD_UP   =  0.25
THRESHOLD_DOWN = -0.25
WEIGHTS        = {"bmsb": 0.35, "breadth": 0.30, "vix": 0.20, "credit": 0.15}
BAND_BREACH_PCT = 0.01

# Daily-bar equivalents of weekly periods (1 week ≈ 5 trading days):
#   21W EMA → span=105   |  20W SMA → 100  |  52W VIX → 260  |  10W MA → 50
#   Composite smoother: 2W EMA → span=10
EMA_SPAN    = 105   # 21-week EMA on daily bars
SMA_PERIOD  = 100   # 20-week SMA on daily bars
VIX_WINDOW  = 260   # 52-week rolling VIX normalisation
RATIO_MA    = 50    # 10-week MA for breadth & credit ratios
SMOOTH_SPAN = 10    # 2-week EMA smoother on composite

LOOKBACK_DAYS = 455  # 65 weeks in calendar days (context window for incremental updates)

TICKER_STARTS = {
    "SPY":  "1998-01-01",
    "^VIX": "1998-01-01",
    "RSP":  "2003-11-01",
    "LQD":  "2002-08-01",
    "HYG":  "2007-04-01",
}

# ─── Score helpers ─────────────────────────────────────────────────────────────

def _score_bmsb(price, ema21, sma20):
    band_upper = max(ema21, sma20)
    band_lower = min(ema21, sma20)
    if price > band_upper and ema21 > sma20:
        return 1.0
    if price < band_lower * (1 - BAND_BREACH_PCT):
        return -1.0
    return 0.0


def _score_breadth(ratio, ratio_ma):
    if pd.isna(ratio) or pd.isna(ratio_ma) or ratio_ma == 0:
        return None
    return float(np.clip((ratio / ratio_ma - 1) * 20, -1.0, 1.0))


def _score_vix(vix, vix_min, vix_max):
    if pd.isna(vix) or pd.isna(vix_min) or pd.isna(vix_max) or vix_max == vix_min:
        return None
    return float(1.0 - 2.0 * np.clip((vix - vix_min) / (vix_max - vix_min), 0, 1))


def _score_credit(ratio, ratio_ma):
    if pd.isna(ratio) or pd.isna(ratio_ma) or ratio_ma == 0:
        return None
    return float(np.clip((ratio / ratio_ma - 1) * 20, -1.0, 1.0))


def _composite(scores):
    total_w = total_s = 0.0
    for key, w in WEIGHTS.items():
        s = scores.get(key)
        if s is not None:
            total_s += w * s
            total_w += w
    return total_s / total_w if total_w else None


def _regime_from_score(score):
    if score is None or (isinstance(score, float) and pd.isna(score)):
        return None
    if score > THRESHOLD_UP:
        return "up"
    if score < THRESHOLD_DOWN:
        return "down"
    return "ranging"


def _fmt(val):
    return round(float(val), 4) if val is not None and not pd.isna(val) else None

# ─── yfinance download ─────────────────────────────────────────────────────────

def _dl(ticker: str, start: str) -> pd.Series:
    try:
        raw = yf.download(ticker, start=start, interval="1d",
                          auto_adjust=True, progress=False)
        if raw.empty:
            return pd.Series(dtype=float, name=ticker)
        if isinstance(raw.columns, pd.MultiIndex):
            for key in [("Close", ticker), (ticker, "Close")]:
                if key in raw.columns:
                    return raw[key].rename(ticker)
            return pd.Series(dtype=float, name=ticker)
        return raw["Close"].squeeze().rename(ticker)
    except Exception as e:
        log.warning("_dl(%s) failed: %s", ticker, e)
        return pd.Series(dtype=float, name=ticker)


def _download_all(spy_start: str) -> dict[str, pd.Series]:
    spy = _dl("SPY", spy_start).dropna()
    tol = pd.Timedelta("4d")
    def align(s):
        return s.reindex(spy.index, method="nearest", tolerance=tol)
    return {
        "spy": spy,
        "rsp": align(_dl("RSP",  TICKER_STARTS["RSP"])),
        "vix": align(_dl("^VIX", spy_start)),
        "hyg": align(_dl("HYG",  TICKER_STARTS["HYG"])),
        "lqd": align(_dl("LQD",  TICKER_STARTS["LQD"])),
    }

# ─── Core computation ──────────────────────────────────────────────────────────

def _compute(series: dict) -> pd.DataFrame:
    """
    Given a dict of aligned pd.Series (spy, rsp, vix, hyg, lqd),
    return a DataFrame with one row per date containing all score columns.
    """
    spy = series["spy"]
    rsp = series["rsp"]
    vix = series["vix"]
    hyg = series["hyg"]
    lqd = series["lqd"]

    ema21      = spy.ewm(span=EMA_SPAN, adjust=False).mean()
    sma20      = spy.rolling(SMA_PERIOD).mean()
    rsp_spy    = (rsp / spy).where(spy > 0)
    rsp_spy_ma = rsp_spy.rolling(RATIO_MA).mean()
    vix_min    = vix.rolling(VIX_WINDOW).min()
    vix_max    = vix.rolling(VIX_WINDOW).max()
    hyg_lqd    = (hyg / lqd).where(lqd > 0)
    hyg_lqd_ma = hyg_lqd.rolling(RATIO_MA).mean()

    rows = []
    for i in range(len(spy)):
        e21, s20, p = ema21.iloc[i], sma20.iloc[i], spy.iloc[i]
        sb  = None if pd.isna(e21) or pd.isna(s20) else _score_bmsb(p, e21, s20)
        sb2 = _score_breadth(rsp_spy.iloc[i], rsp_spy_ma.iloc[i])
        sv  = _score_vix(vix.iloc[i], vix_min.iloc[i], vix_max.iloc[i])
        sc  = _score_credit(hyg_lqd.iloc[i], hyg_lqd_ma.iloc[i])
        rows.append({
            "spy_price":     _fmt(p),
            "ema21":         _fmt(e21),
            "sma20":         _fmt(s20),
            "score_bmsb":    sb,
            "score_breadth": sb2,
            "score_vix":     sv,
            "score_credit":  sc,
            "composite_raw": _composite({"bmsb": sb, "breadth": sb2, "vix": sv, "credit": sc}),
        })

    df = pd.DataFrame(rows, index=spy.index)
    comp_smooth = pd.Series(df["composite_raw"].values, index=spy.index, dtype=float)\
                    .ewm(span=SMOOTH_SPAN, adjust=False).mean()
    df["composite"] = comp_smooth.values
    df["regime"]    = [_regime_from_score(v) for v in comp_smooth]
    return df

# ─── DB helpers ───────────────────────────────────────────────────────────────

def _upsert_prices(db: Session, series: dict):
    """Bulk-upsert raw price data into market_prices."""
    spy = series["spy"]
    ticker_map = {
        "SPY":  series["spy"],
        "RSP":  series["rsp"],
        "^VIX": series["vix"],
        "HYG":  series["hyg"],
        "LQD":  series["lqd"],
    }
    rows = []
    for ticker, s in ticker_map.items():
        for date, val in s.items():
            close = None if pd.isna(val) else round(float(val), 4)
            rows.append({"date": date.date(), "ticker": ticker, "close": close})
    if rows:
        stmt = pg_insert(MarketPrice).values(rows)\
                 .on_conflict_do_update(
                     index_elements=["date", "ticker"],
                     set_={"close": pg_insert(MarketPrice).excluded.close}
                 )
        db.execute(stmt)
        db.commit()


def _upsert_regime(db: Session, df: pd.DataFrame):
    """Bulk-upsert computed regime rows."""
    rows = []
    for date, row in df.iterrows():
        rows.append({
            "date":          date.date(),
            "spy_price":     _fmt(row["spy_price"]),
            "ema21":         _fmt(row["ema21"]),
            "sma20":         _fmt(row["sma20"]),
            "regime":        row["regime"],
            "composite":     _fmt(row["composite"]),
            "score_bmsb":    _fmt(row["score_bmsb"]),
            "score_breadth": _fmt(row["score_breadth"]),
            "score_vix":     _fmt(row["score_vix"]),
            "score_credit":  _fmt(row["score_credit"]),
        })
    if rows:
        stmt = pg_insert(MarketRegimeRow).values(rows)\
                 .on_conflict_do_update(
                     index_elements=["date"],
                     set_={c: pg_insert(MarketRegimeRow).excluded[c]
                           for c in ("spy_price","ema21","sma20","regime","composite",
                                     "score_bmsb","score_breadth","score_vix","score_credit")}
                 )
        db.execute(stmt)
        db.commit()

# ─── Public API ───────────────────────────────────────────────────────────────

def seed_market_data(db: Session):
    """Full historical download + compute + save. Clears existing rows first (schema: daily bars)."""
    log.info("Seeding market regime data from 1998 (daily bars)…")
    from sqlalchemy import delete as sa_delete
    db.execute(sa_delete(MarketRegimeRow))
    db.execute(sa_delete(MarketPrice))
    db.commit()
    series = _download_all("1998-01-01")
    _upsert_prices(db, series)
    df = _compute(series)
    _upsert_regime(db, df)
    log.info("Seed complete: %d weeks saved.", len(df))


def update_market_data(db: Session):
    """Incremental daily refresh — only downloads and saves new weeks."""
    last = db.execute(
        select(MarketRegimeRow.date).order_by(MarketRegimeRow.date.desc()).limit(1)
    ).scalar()

    if last is None:
        seed_market_data(db)
        return

    # Load context window from DB (prices only — no re-download needed for old data)
    context_start = last - datetime.timedelta(days=LOOKBACK_DAYS)
    price_rows = db.execute(
        select(MarketPrice)
        .where(MarketPrice.date >= context_start)
        .order_by(MarketPrice.date)
    ).scalars().all()

    if not price_rows:
        seed_market_data(db)
        return

    # Pivot DB prices into per-ticker Series
    ticker_data: dict[str, dict] = {}
    for row in price_rows:
        ticker_data.setdefault(row.ticker, {})[row.date] = row.close

    def to_series(ticker):
        d = ticker_data.get(ticker, {})
        return pd.Series(d, dtype=float).rename(ticker)\
                 .pipe(lambda s: s.set_axis(pd.to_datetime(list(s.index))))

    db_series = {
        "spy": to_series("SPY"),
        "rsp": to_series("RSP"),
        "vix": to_series("^VIX"),
        "hyg": to_series("HYG"),
        "lqd": to_series("LQD"),
    }

    # Download only new data (from last stored date onwards)
    new_start = (last + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    new_series = _download_all(new_start)

    if new_series["spy"].empty:
        log.info("Market regime: no new data since %s.", last)
        return

    # Filter new_series to dates strictly after last
    last_ts = pd.Timestamp(last)
    def new_only(s):
        return s[s.index > last_ts]

    # Combine context + new for computation
    tickers_map = [("spy","SPY"), ("rsp","RSP"), ("vix","^VIX"), ("hyg","HYG"), ("lqd","LQD")]
    combined = {}
    for key, ticker in tickers_map:
        combined[key] = pd.concat([db_series[key], new_only(new_series[key])]).sort_index()

    # Upsert new raw prices
    new_price_series = {k: new_only(new_series[k]) for k in ["spy","rsp","vix","hyg","lqd"]}
    _upsert_prices(db, {
        "spy": new_price_series["spy"],
        "rsp": new_price_series["rsp"],
        "vix": new_price_series["vix"],
        "hyg": new_price_series["hyg"],
        "lqd": new_price_series["lqd"],
    })

    # Recompute scores for the full window, save only new rows
    df = _compute(combined)
    new_rows = df[df.index > last_ts]
    if new_rows.empty:
        log.info("Market regime: no new completed weeks yet.")
        return

    _upsert_regime(db, new_rows)
    log.info("Market regime updated: %d new week(s) saved (latest: %s).",
             len(new_rows), new_rows.index[-1].date())


def get_regime_from_db(db: Session) -> dict:
    """Read all regime rows from DB and return the standard response dict."""
    rows = db.execute(
        select(MarketRegimeRow).order_by(MarketRegimeRow.date)
    ).scalars().all()

    if not rows:
        return {"dates": [], "prices": [], "ema21": [], "sma20": [],
                "regimes": [], "composite": [],
                "scores": {"bmsb": [], "breadth": [], "vix": [], "credit": []}}

    return {
        "dates":     [r.date.strftime("%Y-%m-%d") for r in rows],
        "prices":    [r.spy_price  for r in rows],
        "ema21":     [r.ema21      for r in rows],
        "sma20":     [r.sma20      for r in rows],
        "regimes":   [r.regime     for r in rows],
        "composite": [r.composite  for r in rows],
        "scores": {
            "bmsb":    [r.score_bmsb    for r in rows],
            "breadth": [r.score_breadth for r in rows],
            "vix":     [r.score_vix     for r in rows],
            "credit":  [r.score_credit  for r in rows],
        },
    }


def compute_market_regime(start: str = "1998-01-01") -> dict:
    """Legacy live-compute path (no DB). Still used as fallback."""
    series = _download_all(start)
    df = _compute(series)
    spy = series["spy"]
    return {
        "dates":     [d.strftime("%Y-%m-%d") for d in df.index],
        "prices":    [_fmt(v) for v in spy],
        "ema21":     [_fmt(v) for v in df["ema21"]],
        "sma20":     [_fmt(v) for v in df["sma20"]],
        "regimes":   list(df["regime"]),
        "composite": [_fmt(v) for v in df["composite"]],
        "scores": {
            "bmsb":    [_fmt(v) for v in df["score_bmsb"]],
            "breadth": [_fmt(v) for v in df["score_breadth"]],
            "vix":     [_fmt(v) for v in df["score_vix"]],
            "credit":  [_fmt(v) for v in df["score_credit"]],
        },
    }
