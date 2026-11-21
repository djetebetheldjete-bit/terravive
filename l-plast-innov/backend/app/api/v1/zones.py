"""Routes de gestion des zones et de leurs seuils."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.database.session import get_db
from app.models.zone import Threshold, Zone
from app.schemas.entities import (
    ThresholdUpdate,
    ZoneCreate,
    ZoneOut,
    ZoneUpdate,
)
from app.services import thresholds as threshold_service

router = APIRouter(prefix="/zones", tags=["Zones"])


@router.get("", response_model=list[ZoneOut])
def list_zones(db: Session = Depends(get_db)):
    """Liste des zones (accès public : affichée dans l'app citoyenne)."""
    return db.scalars(select(Zone).order_by(Zone.code)).all()


@router.get("/{zone_code}", response_model=ZoneOut)
def get_zone(zone_code: str, db: Session = Depends(get_db)):
    zone = db.scalar(select(Zone).where(Zone.code == zone_code))
    if zone is None:
        raise HTTPException(404, "Zone introuvable.")
    return zone


@router.post("", response_model=ZoneOut, status_code=201, dependencies=[Depends(require_admin)])
def create_zone(payload: ZoneCreate, db: Session = Depends(get_db)):
    if db.scalar(select(Zone).where(Zone.code == payload.code)):
        raise HTTPException(409, "Ce code de zone existe déjà.")
    threshold = Threshold(
        zone_code=payload.code,
        preventive=payload.preventive_threshold or 10,
        critical=payload.critical_threshold or 20,
    )
    db.add(threshold)
    db.flush()
    zone = Zone(
        code=payload.code,
        name=payload.name,
        description=payload.description,
        area_m2=payload.area_m2,
        geojson=payload.geojson,
        center_lat=payload.center_lat,
        center_lon=payload.center_lon,
        threshold_id=threshold.id,
    )
    db.add(zone)
    db.commit()
    db.refresh(zone)
    return zone


@router.patch("/{zone_code}", response_model=ZoneOut, dependencies=[Depends(require_admin)])
def update_zone(zone_code: str, payload: ZoneUpdate, db: Session = Depends(get_db)):
    zone = db.scalar(select(Zone).where(Zone.code == zone_code))
    if zone is None:
        raise HTTPException(404, "Zone introuvable.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(zone, field, value)
    db.commit()
    db.refresh(zone)
    return zone


@router.put(
    "/{zone_code}/threshold",
    response_model=ZoneOut,
    dependencies=[Depends(require_admin)],
)
def update_threshold(zone_code: str, payload: ThresholdUpdate, db: Session = Depends(get_db)):
    """Modifie les seuils d'une zone (réservé aux administrateurs)."""
    if payload.critical < payload.preventive:
        raise HTTPException(422, "Le seuil critique doit être ≥ au seuil préventif.")
    zone = db.scalar(select(Zone).where(Zone.code == zone_code))
    if zone is None:
        raise HTTPException(404, "Zone introuvable.")
    if zone.threshold is None:
        th = Threshold(zone_code=zone.code, preventive=payload.preventive, critical=payload.critical)
        db.add(th)
        db.flush()
        zone.threshold_id = th.id
    else:
        zone.threshold.preventive = payload.preventive
        zone.threshold.critical = payload.critical
    db.flush()
    # Réévalue l'état avec les nouveaux seuils.
    threshold_service.evaluate_zone(db, zone)
    db.commit()
    db.refresh(zone)
    return zone
