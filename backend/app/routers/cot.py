from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.cot import (
    CONTRACTS,
    ASSET_CLASS_LABELS,
    get_cot_overview,
    get_cot_series,
    get_cot_status,
    seed_cot_data,
    update_cot_data,
)

router = APIRouter(tags=["cot"])


@router.get("/api/cot/overview")
def cot_overview(db: Session = Depends(get_db)):
    return get_cot_overview(db)


@router.get("/api/cot/contracts")
def cot_contracts():
    return {
        key: {
            "label":       meta["label"],
            "asset_class": meta["asset_class"],
            "asset_class_label": ASSET_CLASS_LABELS.get(meta["asset_class"], meta["asset_class"]),
        }
        for key, meta in CONTRACTS.items()
    }


@router.get("/api/cot/series/{contract_key}")
def cot_series(contract_key: str, db: Session = Depends(get_db)):
    if contract_key not in CONTRACTS:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Unknown contract: {contract_key}")
    return get_cot_series(db, contract_key)


@router.get("/api/cot/status")
def cot_status(db: Session = Depends(get_db)):
    return get_cot_status(db)


@router.post("/api/cot/refresh")
async def cot_refresh(db: Session = Depends(get_db)):
    summary = await update_cot_data(db)
    return {"updated": summary}


@router.post("/api/cot/seed")
async def cot_seed(db: Session = Depends(get_db)):
    summary = await seed_cot_data(db)
    return {"seeded": summary}
