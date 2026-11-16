from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routers.health import router as health_router
from app.routers.macro import router as macro_router
from app.routers.portfolio import router as portfolio_router
from app.routers.auth import router as auth_router
from app.routers.ism import router as ism_router
from app.routers.ism_services import router as ism_services_router
from app.routers.consumer_confidence import router as consumer_confidence_router
from app.routers.data_import import router as data_import_router
from app.routers.building_permits import router as building_permits_router
from app.routers.nfib import router as nfib_router
from app.routers.portfolios import router as portfolios_router
from app.routers.market import router as market_router
from app.routers.cot import router as cot_router
from app.routers.track_record import router as track_record_router
from app.routers.cpi_ppi import router as cpi_ppi_router
from app.routers.commodities import router as commodities_router
from app.routers.high_beta_momentum import router as high_beta_momentum_router
from app.routers.gdp import router as gdp_router
from app.routers.debt import router as debt_router
from app.routers.basket import router as basket_router
from app.routers.correlation import router as correlation_router
from app.routers.beta import router as beta_router
from app.routers.volatility import router as volatility_router
from app.routers.seasonality import router as seasonality_router
from app.scheduler import create_scheduler, start_scheduler
from app.services.auth import get_current_user, require_admin_for_writes


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = create_scheduler()
    start_scheduler(scheduler)
    yield
    scheduler.shutdown()


app = FastAPI(title="Macro Dashboard API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
# Public: health check and the auth endpoints themselves (login/register/me).
app.include_router(health_router)
app.include_router(auth_router)

# User data requires a login, enforced here for whole routers: Track Record, saved Portfolios
# and the portfolio tools. Baskets check per route (system Baskets are shared, custom ones
# belong to a user). The single-asset tools (Correlation, Beta, Volatility, Seasonality) are
# public but gate custom Baskets via get_optional_user + ensure_asset_access.
USER_DATA = [Depends(get_current_user)]
for r in [track_record_router, portfolios_router, portfolio_router]:
    app.include_router(r, dependencies=USER_DATA)

# Public data: reading is open; writes (imports, refreshes, seeds, rebuilds) need an admin.
ADMIN_WRITES = [Depends(require_admin_for_writes)]
for r in [
    macro_router, ism_router, ism_services_router, consumer_confidence_router, data_import_router,
    building_permits_router, nfib_router, market_router, cot_router, cpi_ppi_router,
    commodities_router, high_beta_momentum_router, gdp_router, debt_router,
    correlation_router, beta_router, volatility_router, seasonality_router,
]:
    app.include_router(r, dependencies=ADMIN_WRITES)

# Baskets: own per-route auth (create/edit/delete are user actions); regime refresh is admin.
app.include_router(basket_router)

# Keep your hello endpoint if you want
@app.get("/")
def root():
    return {"message": "Hello from Python 🚀"}
