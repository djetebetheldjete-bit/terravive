"""Routes de gestion des catégories de déchets (extensibles)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.database.session import get_db
from app.models.waste import WasteCategory
from app.schemas.entities import WasteCategoryCreate, WasteCategoryOut

router = APIRouter(prefix="/categories", tags=["Catégories"])


@router.get("", response_model=list[WasteCategoryOut])
def list_categories(db: Session = Depends(get_db)):
    return db.scalars(select(WasteCategory).order_by(WasteCategory.code)).all()


@router.post("", response_model=WasteCategoryOut, status_code=201, dependencies=[Depends(require_admin)])
def create_category(payload: WasteCategoryCreate, db: Session = Depends(get_db)):
    if db.scalar(select(WasteCategory).where(WasteCategory.code == payload.code)):
        raise HTTPException(409, "Cette catégorie existe déjà.")
    cat = WasteCategory(**payload.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat
