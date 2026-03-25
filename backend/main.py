from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routers.health import router as health_router
from app.routers.macro import router as macro_router
from app.routers.portfolio import router as portfolio_router
from app.routers.auth import router as auth_router
from app.routers.ism import router as ism_router
from app.routers.consumer_confidence import router as consumer_confidence_router
from app.routers.data_import import router as data_import_router
from app.routers.building_permits import router as building_permits_router
from app.routers.nfib import router as nfib_router
from app.routers.heatmap import router as heatmap_router
from app.routers.portfolios import router as portfolios_router
from app.scheduler import create_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = create_scheduler()
    scheduler.start()
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
app.include_router(health_router)
app.include_router(macro_router)
app.include_router(portfolio_router)
app.include_router(auth_router)
app.include_router(ism_router)
app.include_router(consumer_confidence_router)
app.include_router(data_import_router)
app.include_router(building_permits_router)
app.include_router(nfib_router)
app.include_router(heatmap_router)
app.include_router(portfolios_router)


# Keep your hello endpoint if you want
@app.get("/")
def root():
    return {"message": "Hello from Python 🚀"}
