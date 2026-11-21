"""Routes des opérations de nettoyage et de leur vérification."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_staff
from app.database.session import get_db
from app.models.cleaning import CleaningOperation
from app.models.user import User
from app.models.zone import Zone
from app.schemas.entities import (
    CleaningCreate,
    CleaningOut,
    CleaningStatusUpdate,
    CleaningVerifyRequest,
)
from app.services import cleaning as cleaning_service

router = APIRouter(prefix="/cleaning", tags=["Nettoyage"])


@router.get("", response_model=list[CleaningOut])
def list_operations(db: Session = Depends(get_db), zone_id: int | None = None):
    q = select(CleaningOperation).order_by(CleaningOperation.created_at.desc())
    if zone_id is not None:
        q = q.where(CleaningOperation.zone_id == zone_id)
    return db.scalars(q).all()


@router.post("", response_model=CleaningOut, status_code=201, dependencies=[Depends(require_staff)])
def create_operation(
    payload: CleaningCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    zone = db.get(Zone, payload.zone_id)
    if zone is None:
        raise HTTPException(404, "Zone introuvable.")
    return cleaning_service.create_operation(
        db, zone=zone, responsible_user_id=user.id, notes=payload.notes
    )


@router.patch("/{op_id}/status", response_model=CleaningOut, dependencies=[Depends(require_staff)])
def update_status(op_id: int, payload: CleaningStatusUpdate, db: Session = Depends(get_db)):
    op = db.get(CleaningOperation, op_id)
    if op is None:
        raise HTTPException(404, "Opération introuvable.")
    return cleaning_service.set_status(db, op, payload.status)


@router.post("/{op_id}/verify", response_model=CleaningOut, dependencies=[Depends(require_staff)])
def verify(
    op_id: int,
    payload: CleaningVerifyRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Vérifie une opération. Si confirmée, retire les déchets du stock présent.

    La zone n'est jamais déclarée propre automatiquement : cette confirmation
    humaine est obligatoire.
    """
    op = db.get(CleaningOperation, op_id)
    if op is None:
        raise HTTPException(404, "Opération introuvable.")
    cleaning_service.verify_operation(
        db,
        op=op,
        verified_by_user_id=user.id,
        confirmed=payload.confirmed,
        removed_track_uids=payload.removed_track_uids,
        comment=payload.comment,
    )
    db.refresh(op)
    return op
