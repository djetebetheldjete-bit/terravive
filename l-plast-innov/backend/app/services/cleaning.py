"""Gestion des opérations de nettoyage et de leur vérification.

Point crucial : une zone n'est jamais déclarée propre automatiquement. Le retrait
des déchets du stock « présents » n'a lieu qu'après une vérification confirmée.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.timezone import utcnow
from app.models.cleaning import CleaningOperation, CleaningVerification
from app.models.enums import (
    AlertStatus,
    CleaningStatus,
    WasteObjectStatus,
)
from app.models.waste import WasteObject
from app.models.zone import Zone
from app.services import alerts as alert_service
from app.services import counting, thresholds


def create_operation(
    db: Session,
    *,
    zone: Zone,
    responsible_user_id: int | None,
    scheduled_at=None,
    notes: str | None = None,
) -> CleaningOperation:
    op = CleaningOperation(
        zone_id=zone.id,
        responsible_user_id=responsible_user_id,
        status=CleaningStatus.PENDING,
        scheduled_at=scheduled_at,
        notes=notes,
        is_simulated=zone.is_simulated,
    )
    db.add(op)
    # Lier les alertes ouvertes de la zone à cette intervention.
    db.flush()
    for alert in zone.alerts:
        if alert.status in (AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED):
            alert.status = AlertStatus.IN_CLEANING
            alert.cleaning_operation_id = op.id
    db.commit()
    return op


def set_status(db: Session, op: CleaningOperation, status: CleaningStatus) -> CleaningOperation:
    op.status = status
    if status == CleaningStatus.IN_PROGRESS and op.started_at is None:
        op.started_at = utcnow()
    if status in (CleaningStatus.DONE, CleaningStatus.AWAITING_VERIFICATION):
        op.finished_at = op.finished_at or utcnow()
    db.commit()
    return op


def verify_operation(
    db: Session,
    *,
    op: CleaningOperation,
    verified_by_user_id: int | None,
    confirmed: bool,
    removed_track_uids: list[str] | None = None,
    comment: str | None = None,
) -> CleaningVerification:
    """Enregistre une vérification après nettoyage.

    Si `confirmed` est vrai, les déchets désignés (removed_track_uids) passent au
    statut REMOVED : ils quittent le stock des présents SANS disparaître de
    l'historique. Les seuils et l'état de la zone sont recalculés, et les alertes
    liées sont clôturées. Sinon, l'opération repasse « à reprendre ».
    """
    zone = db.get(Zone, op.zone_id)
    before = counting.present_now(db, zone_id=op.zone_id)

    removed = 0
    if confirmed:
        uids = removed_track_uids
        if uids is None:
            # Par défaut : tous les déchets encore présents de la zone sont retirés.
            objs = db.scalars(
                select(WasteObject).where(
                    WasteObject.zone_id == op.zone_id,
                    WasteObject.status.in_(counting.PRESENT_STATUSES),
                )
            ).all()
        else:
            objs = db.scalars(
                select(WasteObject).where(WasteObject.track_uid.in_(uids))
            ).all()
        for obj in objs:
            if obj.status != WasteObjectStatus.REMOVED:
                obj.status = WasteObjectStatus.REMOVED
                obj.removed_at = utcnow()
                removed += 1
        db.flush()

    after = counting.present_now(db, zone_id=op.zone_id)

    verif = CleaningVerification(
        operation_id=op.id,
        verified_by_user_id=verified_by_user_id,
        verified_at=utcnow(),
        waste_count_before=before,
        waste_count_after=after,
        is_confirmed=confirmed,
        comment=comment,
        is_simulated=op.is_simulated,
    )
    db.add(verif)

    if confirmed:
        op.status = CleaningStatus.VERIFIED
        op.reported_removed_count = removed
        # Recalcule l'état de la zone et clôture les alertes liées.
        if zone is not None:
            thresholds.evaluate_zone(db, zone)
            for alert in zone.alerts:
                if alert.cleaning_operation_id == op.id and alert.status != AlertStatus.RESOLVED:
                    alert_service.resolve(db, alert)
    else:
        op.status = CleaningStatus.TO_REDO

    db.commit()
    return verif
