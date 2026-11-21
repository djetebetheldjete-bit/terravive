"""Surveillance des seuils de pollution par zone.

Le nombre comparé aux seuils est TOUJOURS le nombre de déchets UNIQUES
présents (pas le nombre d'images ni de détections brutes).

Chaque zone a deux seuils :
- préventif (orange) : par défaut 10, modifiable par zone ;
- critique (rouge)  : par défaut 20, modifiable par zone.

On ne crée une alerte qu'au franchissement, c.-à-d. en passant d'un état sous le
seuil à un état au-dessus, et s'il n'existe pas déjà une alerte ouverte de ce
niveau pour la zone.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.alert import Alert
from app.models.enums import AlertLevel, ZoneStatus
from app.models.zone import Zone
from app.services import alerts as alert_service
from app.services import counting


@dataclass
class ThresholdEvaluation:
    zone_code: str
    present_count: int
    preventive: int
    critical: int
    new_status: ZoneStatus
    created_alert: Alert | None


def _zone_thresholds(zone: Zone) -> tuple[int, int]:
    if zone.threshold is not None:
        return zone.threshold.preventive, zone.threshold.critical
    return settings.default_preventive_threshold, settings.default_critical_threshold


def evaluate_zone(db: Session, zone: Zone) -> ThresholdEvaluation:
    """Recalcule l'état d'une zone et déclenche une alerte si un seuil est franchi."""
    preventive, critical = _zone_thresholds(zone)
    present = counting.present_now(db, zone_id=zone.id)

    # Mise à jour du cache de comptage de la zone.
    zone.present_waste_count = present

    created: Alert | None = None

    if present >= critical:
        new_status = ZoneStatus.ALERT
        if alert_service.get_open_alert(db, zone.id, AlertLevel.CRITICAL) is None:
            created = alert_service.create_alert(
                db,
                zone=zone,
                level=AlertLevel.CRITICAL,
                present_count=present,
                threshold_value=critical,
                is_simulated=zone.is_simulated,
            )
    elif present >= preventive:
        new_status = ZoneStatus.MONITORED
        if alert_service.get_open_alert(db, zone.id, AlertLevel.PREVENTIVE) is None:
            created = alert_service.create_alert(
                db,
                zone=zone,
                level=AlertLevel.PREVENTIVE,
                present_count=present,
                threshold_value=preventive,
                is_simulated=zone.is_simulated,
            )
    else:
        new_status = ZoneStatus.CLEAN

    if zone.status != ZoneStatus.DISABLED:
        zone.status = new_status
    db.flush()

    return ThresholdEvaluation(
        zone_code=zone.code,
        present_count=present,
        preventive=preventive,
        critical=critical,
        new_status=new_status,
        created_alert=created,
    )
