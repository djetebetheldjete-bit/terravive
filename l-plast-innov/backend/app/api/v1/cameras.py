"""Routes de gestion des caméras (CamSCA)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.database.session import get_db
from app.models.camera import Camera
from app.schemas.entities import CameraCreate, CameraOut, CameraUpdate

router = APIRouter(prefix="/cameras", tags=["Caméras"])


@router.get("", response_model=list[CameraOut])
def list_cameras(db: Session = Depends(get_db)):
    return db.scalars(select(Camera).order_by(Camera.code)).all()


@router.get("/{camera_code}", response_model=CameraOut)
def get_camera(camera_code: str, db: Session = Depends(get_db)):
    cam = db.scalar(select(Camera).where(Camera.code == camera_code))
    if cam is None:
        raise HTTPException(404, "Caméra introuvable.")
    return cam


@router.post("", response_model=CameraOut, status_code=201, dependencies=[Depends(require_admin)])
def create_camera(payload: CameraCreate, db: Session = Depends(get_db)):
    if db.scalar(select(Camera).where(Camera.code == payload.code)):
        raise HTTPException(409, "Ce code de caméra existe déjà.")
    cam = Camera(**payload.model_dump())
    db.add(cam)
    db.commit()
    db.refresh(cam)
    return cam


@router.patch("/{camera_code}", response_model=CameraOut, dependencies=[Depends(require_admin)])
def update_camera(camera_code: str, payload: CameraUpdate, db: Session = Depends(get_db)):
    cam = db.scalar(select(Camera).where(Camera.code == camera_code))
    if cam is None:
        raise HTTPException(404, "Caméra introuvable.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cam, field, value)
    db.commit()
    db.refresh(cam)
    return cam
