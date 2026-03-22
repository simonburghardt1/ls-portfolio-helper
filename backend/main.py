from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.routers.health import router as health_router
from app.routers.macro import router as macro_router
from app.routers.portfolio import router as portfolio_router
from app.routers.auth import router as auth_router

app = FastAPI(title="Macro Dashboard API")

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


# Keep your hello endpoint if you want
@app.get("/")
def root():
    return {"message": "Hello from Python 🚀"}
