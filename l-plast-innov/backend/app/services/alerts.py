"""Gestion des alertes : création, accusé de réception, clôture.

Règles :
- Une alerte naît au FRANCHISSEMENT d'un seuil, pas à chaque détection.
- Au plus une alerte OUVERTE d'un niveau donné par zone (anti-répétition).
- Une alerte se clôture après nettoyage VÉRIFIÉ (jamais parce que la caméra ne
  voit plus les déchets).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.timezone import utcnow
from app.models.alert import Alert
from app.models.enums import AlertLevel, AlertStatus
from app.models.zone import Zone

_OPEN_STATUSES = (AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED, AlertStatus.IN_CLEANING)


def get_open_alert(db: Session, zone_id: int, level: AlertLevel) -> Alert | None:
    return db.scalar(
        select(Alert).where(
            Alert.zone_id == zone_id,
            Alert.level == level,
            Alert.status.in_(_OPEN_STATUSES),
        )
    )


def create_alert(
    db: Session,
    *,
    zone: Zone,
    level: AlertLevel,
    present_count: int,
    threshold_value: int,
    is_simulated: bool,
) -> Alert:
    label = "préventive" if level == AlertLevel.PREVENTIVE else "critique (prioritaire)"
    msg = (
        f"Alerte {label} — zone {zone.code} ({zone.name}) : "
        f"{present_count} déchets présents, seuil {threshold_value}."
    )
    alert = Alert(
        zone_id=zone.id,
        level=level,
        status=AlertStatus.OPEN,
        waste_count_at_trigger=present_count,
        threshold_value=threshold_value,
        message=msg,
        triggered_at=utcnow(),
        is_simulated=is_simulated,
    )
    db.add(alert)
    db.flush()
    return alert


def acknowledge(db: Session, alert: Alert) -> Alert:
    if alert.status == AlertStatus.OPEN:
        alert.status = AlertStatus.ACKNOWLEDGED
        alert.acknowledged_at = utcnow()
        db.flush()
    return alert


def resolve(db: Session, alert: Alert) -> Alert:
    alert.status = AlertStatus.RESOLVED
    alert.resolved_at = utcnow()
    db.flush()
    return alert
