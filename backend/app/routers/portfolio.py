from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.portfolio import (
    download_prices,
    build_portfolio_return_series,
    cumulative_series,
    summary_returns,
    benchmark_return_series,
    beta_adjust,
    compute_portfolio_analytics,
)

router = APIRouter()


class Position(BaseModel):
    ticker: str
    weight: float
    side: str


class BacktestRequest(BaseModel):
    positions: list[Position]


@router.post("/api/portfolio/backtest")
async def portfolio_backtest(payload: BacktestRequest):
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

        return {
            "summary": summary_returns(combined["portfolio"]),
            "benchmark_summary": summary_returns(combined["spy"]),
            "series": {
                "dates": [d.strftime("%Y-%m-%d") for d in combined.index],
                "portfolio": combined["portfolio"].round(6).tolist(),
                "benchmark": combined["spy"].round(6).tolist(),
            },
            "daily": daily_rows,
        }
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
