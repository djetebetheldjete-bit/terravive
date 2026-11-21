"""Suivi d'objets (object tracking) et anti-double-comptage.

Objectif : un même déchet observé sur plusieurs images ne doit être compté
qu'une seule fois. Chaque déchet unique est un `WasteObject` identifié par un
`track_uid` stable.

Deux niveaux d'identité :
1. `track_uid` fourni par le tracker de la CamSCA (cas nominal, le plus fiable).
2. À défaut, appariement spatio-temporel approximatif (repli) : si un objet de
   même catégorie a été vu très récemment à proximité, on considère que c'est le
   même. Sinon on crée un nouvel objet.

Le système distingue : nouvel objet, objet déjà connu, objet déplacé, objet
perdu de vue, suivi incertain. Un objet disparu d'une image n'est JAMAIS
considéré automatiquement comme retiré (seul un nettoyage vérifié le fait).
"""
from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.timezone import utcnow
from app.models.enums import DetectionKind, WasteObjectStatus
from app.models.waste import Detection, WasteCategory, WasteObject

# Fenêtre et distance d'appariement par repli (sans track_uid fourni).
_REASSOC_WINDOW = timedelta(minutes=30)
_REASSOC_MAX_METERS = 3.0
# Déplacement au-delà duquel on marque l'objet comme « déplacé ».
_MOVED_MIN_METERS = 1.5


@dataclass
class TrackResult:
    waste_object: WasteObject
    kind: DetectionKind
    is_new: bool


def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    """Distance en mètres entre deux points GPS (formule de haversine)."""
    if None in (lat1, lon1, lat2, lon2):
        return float("inf")
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _short_uid() -> str:
    return "obj_" + uuid.uuid4().hex[:16]


def _find_by_track_uid(db: Session, track_uid: str) -> WasteObject | None:
    return db.scalar(select(WasteObject).where(WasteObject.track_uid == track_uid))


def _find_by_proximity(
    db: Session,
    category_id: int,
    zone_id: int | None,
    lat: float | None,
    lon: float | None,
    detected_at: datetime,
) -> WasteObject | None:
    """Repli : cherche un objet récent, de même catégorie, à proximité."""
    if lat is None or lon is None:
        return None
    since = detected_at - _REASSOC_WINDOW
    candidates = db.scalars(
        select(WasteObject).where(
            WasteObject.category_id == category_id,
            WasteObject.status != WasteObjectStatus.REMOVED,
            WasteObject.last_seen_at >= since,
        )
    ).all()
    best, best_d = None, _REASSOC_MAX_METERS
    for c in candidates:
        d = _haversine_m(lat, lon, c.lat, c.lon)
        if d <= best_d:
            best, best_d = c, d
    return best


def track_detection(
    db: Session,
    *,
    category: WasteCategory,
    track_uid: str | None,
    zone_id: int | None,
    lat: float | None,
    lon: float | None,
    detected_at: datetime | None,
    confidence: float | None,
    is_simulated: bool,
) -> TrackResult:
    """Résout l'identité d'un déchet détecté et met à jour son suivi.

    Ne crée PAS l'enregistrement Detection (fait par le pipeline d'ingestion) ;
    met à jour l'objet suivi et renvoie la nature de l'événement.
    """
    detected_at = detected_at or utcnow()

    # Le track_uid fourni par le tracker de la CamSCA fait AUTORITÉ :
    # - s'il est fourni et connu → objet déjà suivi ;
    # - s'il est fourni et inconnu → NOUVEL objet (on ne retombe PAS sur la
    #   proximité, sinon deux objets voisins seraient fusionnés à tort) ;
    # - s'il est absent → appariement spatio-temporel de repli.
    existing: WasteObject | None = None
    if track_uid:
        existing = _find_by_track_uid(db, track_uid)
    else:
        existing = _find_by_proximity(db, category.id, zone_id, lat, lon, detected_at)

    if existing is None:
        obj = WasteObject(
            track_uid=track_uid or _short_uid(),
            category_id=category.id,
            zone_id=zone_id,
            status=WasteObjectStatus.NEW,
            first_seen_at=detected_at,
            last_seen_at=detected_at,
            lat=lat,
            lon=lon,
            detection_count=1,
            confidence=confidence,
            is_simulated=is_simulated,
        )
        db.add(obj)
        db.flush()
        return TrackResult(waste_object=obj, kind=DetectionKind.FIRST_SEEN, is_new=True)

    # Objet déjà connu : mise à jour.
    kind = DetectionKind.RE_SEEN
    moved = _haversine_m(lat, lon, existing.lat, existing.lon)
    if lat is not None and lon is not None and moved >= _MOVED_MIN_METERS:
        kind = DetectionKind.MOVED
        existing.lat, existing.lon = lat, lon
    elif existing.lat is None and lat is not None:
        existing.lat, existing.lon = lat, lon

    # Un objet revu redevient « présent » (il n'était pas retiré).
    if existing.status in (WasteObjectStatus.NOT_VISIBLE, WasteObjectStatus.NEW,
                           WasteObjectStatus.UNCERTAIN):
        existing.status = WasteObjectStatus.PRESENT
    if zone_id is not None:
        existing.zone_id = zone_id
    existing.last_seen_at = detected_at
    existing.detection_count += 1
    if confidence is not None:
        existing.confidence = confidence
    db.flush()
    return TrackResult(waste_object=existing, kind=kind, is_new=False)


def mark_stale_objects_not_visible(
    db: Session, *, zone_id: int | None = None, max_age_minutes: int = 120
) -> int:
    """Passe en NOT_VISIBLE les objets non revus depuis un moment.

    IMPORTANT : NOT_VISIBLE n'est PAS « retiré ». Ces objets restent comptés
    comme présents (interprétation prudente) tant qu'un nettoyage vérifié ne les
    a pas retirés. Cette fonction sert surtout au suivi/qualité, pas au comptage.
    """
    threshold = utcnow() - timedelta(minutes=max_age_minutes)
    q = select(WasteObject).where(
        WasteObject.status.in_([WasteObjectStatus.NEW, WasteObjectStatus.PRESENT]),
        WasteObject.last_seen_at < threshold,
    )
    if zone_id is not None:
        q = q.where(WasteObject.zone_id == zone_id)
    count = 0
    for obj in db.scalars(q).all():
        obj.status = WasteObjectStatus.NOT_VISIBLE
        count += 1
    db.flush()
    return count
