"""Gestion du temps et du fuseau horaire Africa/Abidjan.

Toutes les dates sont stockées en UTC (timezone-aware). Les *regroupements
statistiques quotidiens* sont calculés dans le fuseau Africa/Abidjan, comme
l'exige le cahier des charges, afin qu'une « journée » corresponde à la journée
locale ivoirienne et non à la journée UTC.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

try:  # Python 3.9+
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore

from app.core.config import settings


def _local_tz():
    if ZoneInfo is not None:
        try:
            return ZoneInfo(settings.stats_timezone)
        except Exception:  # pragma: no cover - fallback si tzdata absent
            pass
    # Repli : Abidjan = UTC+00 toute l'année (pas d'heure d'été).
    return timezone.utc


def utcnow() -> datetime:
    """Horodatage courant, timezone-aware en UTC."""
    return datetime.now(timezone.utc)


def to_local(dt: datetime) -> datetime:
    """Convertit un datetime (UTC ou naïf supposé UTC) vers l'heure locale."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_local_tz())


def local_day(dt: datetime | None = None) -> date:
    """Jour calendaire LOCAL (Africa/Abidjan) d'un instant donné."""
    dt = dt or utcnow()
    return to_local(dt).date()


def local_day_bounds_utc(day: date) -> tuple[datetime, datetime]:
    """Bornes [début, fin[ en UTC d'une journée locale donnée.

    Utilisé pour filtrer les détections d'une « journée Abidjan » dans une base
    qui stocke des horodatages UTC.
    """
    tz = _local_tz()
    start_local = datetime(day.year, day.month, day.day, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)
