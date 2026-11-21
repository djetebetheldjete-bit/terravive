"""Routes d'ingestion des détections (depuis la CamSCA) et consultation."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_staff
from app.database.session import get_db
from app.models.waste import WasteObject
from app.schemas.entities import DetectionIngest, IngestOut, WasteObjectOut
from app.services import ingestion

router = APIRouter(tags=["Détections"])


@router.post(
    "/detections/ingest",
    response_model=IngestOut,
    dependencies=[Depends(require_staff)],
)
def ingest(payload: DetectionIngest, db: Session = Depends(get_db)):
    """Point d'entrée d'une détection transmise par une CamSCA.

    Idempotent : un `event_uid` déjà reçu est rejeté sans double comptage.
    """
    result = ingestion.ingest_detection(db, **payload.model_dump())
    return result


@router.get("/waste-objects", response_model=list[WasteObjectOut])
def list_waste_objects(
    db: Session = Depends(get_db),
    zone_id: int | None = None,
    present_only: bool = Query(True, description="N'afficher que les déchets présents."),
    limit: int = Query(200, le=1000),
):
    from app.services.counting import PRESENT_STATUSES

    q = select(WasteObject).order_by(WasteObject.last_seen_at.desc())
    if zone_id is not None:
        q = q.where(WasteObject.zone_id == zone_id)
    if present_only:
        q = q.where(WasteObject.status.in_(PRESENT_STATUSES))
    return db.scalars(q.limit(limit)).all()
