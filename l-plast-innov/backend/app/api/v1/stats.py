"""Routes du tableau de bord statistique."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.services import counting, stats

router = APIRouter(prefix="/stats", tags=["Statistiques"])


@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    """Chiffres clés du tableau de bord (données réelles enregistrées)."""
    return stats.dashboard_overview(db)


@router.get("/daily")
def daily(db: Session = Depends(get_db), zone_id: int | None = None, day: date | None = None):
    return counting.daily_counts(db, day, zone_id=zone_id)


@router.get("/series")
def series(
    db: Session = Depends(get_db),
    days: int = Query(14, ge=1, le=120),
    zone_id: int | None = None,
):
    return stats.period_series(db, days=days, zone_id=zone_id)


@router.get("/compare")
def compare(
    a_start: date,
    a_end: date,
    b_start: date,
    b_end: date,
    db: Session = Depends(get_db),
):
    return stats.compare_periods(db, a_start, a_end, b_start, b_end)


@router.get("/cleaning-effectiveness")
def cleaning_effectiveness(db: Session = Depends(get_db)):
    return stats.cleaning_effectiveness(db)
