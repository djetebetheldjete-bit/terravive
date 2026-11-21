"""Routes de consultation et de traitement des alertes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_staff
from app.database.session import get_db
from app.models.alert import Alert
from app.models.enums import AlertLevel, AlertStatus
from app.schemas.entities import AlertOut
from app.services import alerts as alert_service

router = APIRouter(prefix="/alerts", tags=["Alertes"])


@router.get("", response_model=list[AlertOut])
def list_alerts(
    db: Session = Depends(get_db),
    zone_id: int | None = None,
    level: AlertLevel | None = None,
    status: AlertStatus | None = None,
    open_only: bool = Query(False),
    limit: int = Query(200, le=1000),
):
    q = select(Alert).order_by(Alert.triggered_at.desc())
    if zone_id is not None:
        q = q.where(Alert.zone_id == zone_id)
    if level is not None:
        q = q.where(Alert.level == level)
    if status is not None:
        q = q.where(Alert.status == status)
    if open_only:
        q = q.where(
            Alert.status.in_(
                [AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED, AlertStatus.IN_CLEANING]
            )
        )
    return db.scalars(q.limit(limit)).all()


@router.post("/{alert_id}/acknowledge", response_model=AlertOut, dependencies=[Depends(require_staff)])
def acknowledge_alert(alert_id: int, db: Session = Depends(get_db)):
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(404, "Alerte introuvable.")
    alert_service.acknowledge(db, alert)
    db.commit()
    db.refresh(alert)
    return alert
