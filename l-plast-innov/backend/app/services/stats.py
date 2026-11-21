"""Tableau de bord statistique — indicateurs calculés sur données RÉELLES.

Aucun chiffre n'est inventé : tout provient des tables enregistrées. Les données
de simulation (is_simulated) sont incluses mais restent identifiables.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.timezone import local_day, local_day_bounds_utc, utcnow
from app.models.alert import Alert
from app.models.camera import Camera
from app.models.cleaning import CleaningOperation
from app.models.enums import (
    AlertStatus,
    CameraStatus,
    CleaningStatus,
    WasteObjectStatus,
    ZoneStatus,
)
from app.models.zone import Zone
from app.services import counting


def dashboard_overview(db: Session) -> dict:
    """Chiffres clés du tableau de bord d'administration."""
    today = local_day()
    start_utc, end_utc = local_day_bounds_utc(today)

    zones_total = int(db.scalar(select(func.count(Zone.id))) or 0)
    zones_alert = int(
        db.scalar(select(func.count(Zone.id)).where(Zone.status == ZoneStatus.ALERT)) or 0
    )
    zones_monitored = int(
        db.scalar(select(func.count(Zone.id)).where(Zone.status == ZoneStatus.MONITORED)) or 0
    )

    cams_active = int(
        db.scalar(select(func.count(Camera.id)).where(Camera.status == CameraStatus.ACTIVE)) or 0
    )
    cams_offline = int(
        db.scalar(select(func.count(Camera.id)).where(Camera.status == CameraStatus.OFFLINE)) or 0
    )

    alerts_open = int(
        db.scalar(
            select(func.count(Alert.id)).where(
                Alert.status.in_([AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED, AlertStatus.IN_CLEANING])
            )
        )
        or 0
    )
    cleanings = int(db.scalar(select(func.count(CleaningOperation.id))) or 0)

    return {
        "as_of": utcnow().isoformat(),
        "timezone": "Africa/Abidjan",
        "present_waste": counting.present_now(db),
        "new_waste_today": counting.new_in_period(db, start_utc, end_utc),
        "removed_today": counting.removed_in_period(db, start_utc, end_utc),
        "total_detections_today": counting.detections_in_period(db, start_utc, end_utc),
        "zones_total": zones_total,
        "zones_monitored": zones_monitored,
        "zones_alert": zones_alert,
        "cameras_active": cams_active,
        "cameras_offline": cams_offline,
        "alerts_open": alerts_open,
        "cleaning_operations": cleanings,
        "waste_by_category": counting.present_now_by_category(db),
    }


def period_series(db: Session, days: int = 14, *, zone_id: int | None = None) -> list[dict]:
    """Série journalière (jours locaux) sur `days` jours pour les graphiques."""
    out: list[dict] = []
    today = local_day()
    for i in range(days - 1, -1, -1):
        day = today - timedelta(days=i)
        out.append(counting.daily_counts(db, day, zone_id=zone_id))
    return out


def compare_periods(
    db: Session, a_start: date, a_end: date, b_start: date, b_end: date
) -> dict:
    """Compare deux périodes (nouveaux déchets, détections, retraits)."""

    def agg(start: date, end: date) -> dict:
        s_utc, _ = local_day_bounds_utc(start)
        _, e_utc = local_day_bounds_utc(end)
        return {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "new_waste": counting.new_in_period(db, s_utc, e_utc),
            "total_detections": counting.detections_in_period(db, s_utc, e_utc),
            "removed": counting.removed_in_period(db, s_utc, e_utc),
        }

    return {"period_a": agg(a_start, a_end), "period_b": agg(b_start, b_end)}


def cleaning_effectiveness(db: Session) -> dict:
    """Taux de diminution après nettoyage et délai moyen de réaction."""
    verified = db.scalars(
        select(CleaningOperation).where(CleaningOperation.status == CleaningStatus.VERIFIED)
    ).all()
    reductions, reaction_minutes = [], []
    for op in verified:
        for v in op.verifications:
            if v.waste_count_before and v.waste_count_before > 0 and v.waste_count_after is not None:
                reductions.append(
                    (v.waste_count_before - v.waste_count_after) / v.waste_count_before
                )
        if op.started_at and op.created_at:
            reaction_minutes.append((op.started_at - op.created_at).total_seconds() / 60.0)

    avg_reduction = round(100 * sum(reductions) / len(reductions), 1) if reductions else None
    avg_reaction = round(sum(reaction_minutes) / len(reaction_minutes), 1) if reaction_minutes else None
    return {
        "verified_operations": len(verified),
        "avg_reduction_percent": avg_reduction,
        "avg_reaction_minutes": avg_reaction,
    }
