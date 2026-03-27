from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.market_regime import get_regime_from_db
from app.services.portfolio import (
    download_prices,
    build_portfolio_return_series,
    cumulative_series,
    summary_returns,
    benchmark_return_series,
    beta_adjust,
    compute_portfolio_analytics,
    _compute_beta,
    _build_daily_regime_series,
    _compute_regime_scaled_returns,
)

router = APIRouter()


class Position(BaseModel):
    ticker: str
    weight: float
    side: str


class RegimeTargets(BaseModel):
    up:      float = 0.5
    down:    float = -0.5
    ranging: float = 0.0


class BacktestRequest(BaseModel):
    positions:      list[Position]
    regime_adjust:  bool          = False
    regime_targets: RegimeTargets = RegimeTargets()


@router.post("/api/portfolio/backtest")
async def portfolio_backtest(payload: BacktestRequest, db: Session = Depends(get_db)):
    try:
        positions = [p.model_dump() for p in payload.positions]

        portfolio_tickers = list({p["ticker"].upper() for p in positions})
        all_tickers = portfolio_tickers + ["SPY"]

        prices = download_prices(all_tickers, period="2y")

        portfolio_returns = build_portfolio_return_series(
            prices[portfolio_tickers], positions
        )
        portfolio_cumulative = cumulative_series(portfolio_returns)

        spy_returns = benchmark_return_series(prices, "SPY")
        spy_cumulative = cumulative_series(spy_returns)

        # Align both series to common dates
        combined = (
            portfolio_cumulative.rename("portfolio")
            .to_frame()
            .join(spy_cumulative.rename("spy"), how="inner")
        )

        daily_rows = []
        aligned_portfolio_returns = portfolio_returns.reindex(combined.index)

        for d in combined.index:
            daily_rows.append(
                {
                    "date": d.strftime("%Y-%m-%d"),
                    "daily_return": round(float(aligned_portfolio_returns.loc[d]), 6),
                    "cumulative_return": round(float(combined.loc[d, "portfolio"]), 6),
                    "benchmark_cumulative_return": round(
                        float(combined.loc[d, "spy"]), 6
                    ),
                }
            )

        response = {
            "summary": summary_returns(combined["portfolio"]),
            "benchmark_summary": summary_returns(combined["spy"]),
            "series": {
                "dates": [d.strftime("%Y-%m-%d") for d in combined.index],
                "portfolio": combined["portfolio"].round(6).tolist(),
                "benchmark": combined["spy"].round(6).tolist(),
            },
            "daily": daily_rows,
        }

        if payload.regime_adjust:
            returns_2y = prices.pct_change().dropna()
            betas = {
                t: _compute_beta(returns_2y[t], returns_2y["SPY"])
                for t in portfolio_tickers
                if t in returns_2y.columns
            }
            regime_data   = get_regime_from_db(db)
            daily_regime  = _build_daily_regime_series(regime_data, combined.index)
            targets       = payload.regime_targets.model_dump()
            regime_returns = _compute_regime_scaled_returns(
                prices[portfolio_tickers], positions, betas, daily_regime, targets
            )
            regime_cum = cumulative_series(regime_returns.reindex(combined.index))
            response["series"]["regime_adjusted"] = regime_cum.round(6).tolist()
            response["summary_regime"] = summary_returns(regime_cum)

        return response

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"portfolio_backtest failed: {repr(e)}"
        )


@router.post("/api/portfolio/analytics")
async def portfolio_analytics(payload: BacktestRequest):
    try:
        return compute_portfolio_analytics([p.model_dump() for p in payload.positions])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"portfolio_analytics failed: {repr(e)}")


@router.post("/api/portfolio/beta-adjust")
async def portfolio_beta_adjust(payload: BacktestRequest):
    try:
        result = beta_adjust([p.model_dump() for p in payload.positions])
        # Also compute correlation on the adjusted positions
        analytics = compute_portfolio_analytics(result["positions"])
        result["correlation"] = analytics["correlation"]
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"beta_adjust failed: {repr(e)}")
