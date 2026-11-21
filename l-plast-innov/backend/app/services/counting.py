"""Comptage des déchets — TROIS indicateurs à ne JAMAIS confondre.

1. present_now        : nombre de déchets UNIQUES présents à un instant donné.
2. new_in_period      : nombre de NOUVEAUX déchets uniques détectés sur une période
                        (objets dont la première détection tombe dans la période).
3. detections_in_period : nombre total d'ÉVÉNEMENTS de détection sur la période
                        (un même déchet peut compter plusieurs fois).

« Présent » = déchet non retiré (statut != REMOVED). Un déchet retiré quitte le
stock des présents mais reste dans l'historique (ses détections et sa ligne
WasteObject sont conservées avec removed_at).
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.timezone import local_day, local_day_bounds_utc
from app.models.enums import WasteObjectStatus
from app.models.waste import Detection, WasteObject

# Statuts considérés comme « présents sur la plage » (= non retirés).
PRESENT_STATUSES = (
    WasteObjectStatus.NEW,
    WasteObjectStatus.PRESENT,
    WasteObjectStatus.NOT_VISIBLE,
    WasteObjectStatus.UNCERTAIN,
)


def present_now(db: Session, *, zone_id: int | None = None) -> int:
    """Indicateur 1 : déchets uniques actuellement présents."""
    q = select(func.count(WasteObject.id)).where(
        WasteObject.status.in_(PRESENT_STATUSES)
    )
    if zone_id is not None:
        q = q.where(WasteObject.zone_id == zone_id)
    return int(db.scalar(q) or 0)


def present_now_by_category(db: Session, *, zone_id: int | None = None) -> dict[str, int]:
    from app.models.waste import WasteCategory

    q = (
        select(WasteCategory.code, func.count(WasteObject.id))
        .join(WasteObject, WasteObject.category_id == WasteCategory.id)
        .where(WasteObject.status.in_(PRESENT_STATUSES))
        .group_by(WasteCategory.code)
    )
    if zone_id is not None:
        q = q.where(WasteObject.zone_id == zone_id)
    return {code: int(n) for code, n in db.execute(q).all()}


def new_in_period(
    db: Session, start_utc: datetime, end_utc: datetime, *, zone_id: int | None = None
) -> int:
    """Indicateur 2 : nouveaux déchets uniques (première détection dans la période)."""
    q = select(func.count(WasteObject.id)).where(
        WasteObject.first_seen_at >= start_utc,
        WasteObject.first_seen_at < end_utc,
    )
    if zone_id is not None:
        q = q.where(WasteObject.zone_id == zone_id)
    return int(db.scalar(q) or 0)


def detections_in_period(
    db: Session, start_utc: datetime, end_utc: datetime, *, zone_id: int | None = None
) -> int:
    """Indicateur 3 : nombre total d'événements de détection sur la période."""
    q = select(func.count(Detection.id)).where(
        Detection.detected_at >= start_utc,
        Detection.detected_at < end_utc,
    )
    if zone_id is not None:
        q = q.where(Detection.zone_id == zone_id)
    return int(db.scalar(q) or 0)


def removed_in_period(
    db: Session, start_utc: datetime, end_utc: datetime, *, zone_id: int | None = None
) -> int:
    """Déchets retirés (nettoyage vérifié) sur la période."""
    q = select(func.count(WasteObject.id)).where(
        WasteObject.status == WasteObjectStatus.REMOVED,
        WasteObject.removed_at >= start_utc,
        WasteObject.removed_at < end_utc,
    )
    if zone_id is not None:
        q = q.where(WasteObject.zone_id == zone_id)
    return int(db.scalar(q) or 0)


def daily_counts(db: Session, day: date | None = None, *, zone_id: int | None = None) -> dict:
    """Trois indicateurs pour une JOURNÉE locale (fuseau Africa/Abidjan)."""
    day = day or local_day()
    start_utc, end_utc = local_day_bounds_utc(day)
    return {
        "day": day.isoformat(),
        "timezone": "Africa/Abidjan",
        "present_now": present_now(db, zone_id=zone_id),
        "new_waste": new_in_period(db, start_utc, end_utc, zone_id=zone_id),
        "total_detections": detections_in_period(db, start_utc, end_utc, zone_id=zone_id),
        "removed": removed_in_period(db, start_utc, end_utc, zone_id=zone_id),
    }
