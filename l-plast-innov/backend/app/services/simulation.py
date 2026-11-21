"""Mode simulation — tester tout le système SANS caméra physique.

Toutes les données produites ici sont marquées `is_simulated = True`. Elles ne
doivent JAMAIS être présentées comme des observations réellement faites sur la
plage de Balmer.

On peut simuler :
- la détection d'un déchet (bouteille, sachet, etc.) ;
- plusieurs caméras / zones ;
- une montée de la pollution (jusqu'au franchissement des seuils → alertes) ;
- une opération de nettoyage.
"""
from __future__ import annotations

import random
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.timezone import utcnow
from app.models.camera import Camera
from app.models.waste import WasteCategory
from app.models.zone import Zone
from app.services import ingestion

# Catégories plastiques les plus probables en simulation.
_PLASTIC_CODES = [
    "plastic_bottle",
    "plastic_bag",
    "food_packaging",
    "plastic_cap",
    "plastic_fragment",
    "other_plastic",
]


def _ensure_simulation_allowed() -> None:
    if not settings.simulation_mode:
        raise PermissionError("Le mode simulation est désactivé (SIMULATION_MODE=false).")


def _jitter(lat: float | None, lon: float | None) -> tuple[float | None, float | None]:
    if lat is None or lon is None:
        return lat, lon
    return lat + random.uniform(-0.00008, 0.00008), lon + random.uniform(-0.00008, 0.00008)


def simulate_detection(
    db: Session,
    *,
    zone_code: str | None = None,
    camera_code: str | None = None,
    category_code: str | None = None,
    new_object: bool = True,
    track_uid: str | None = None,
) -> ingestion.IngestResult:
    """Injecte UNE détection simulée dans le pipeline réel d'ingestion."""
    _ensure_simulation_allowed()

    # Résolution de la zone visée (si précisée).
    zone: Zone | None = None
    if zone_code:
        zone = db.scalar(select(Zone).where(Zone.code == zone_code))
        if zone is None:
            raise ValueError(f"Zone inconnue : {zone_code}")

    camera: Camera | None = None
    if camera_code:
        camera = db.scalar(select(Camera).where(Camera.code == camera_code))
    if camera is None and zone is not None:
        # Caméra rattachée à la zone visée (cohérence zone/caméra).
        camera = db.scalar(
            select(Camera).where(Camera.zone_id == zone.id).limit(1)
        )
    if camera is None:
        camera = db.scalar(
            select(Camera).where(Camera.is_simulated.is_(True)).limit(1)
        ) or db.scalar(select(Camera).limit(1))
    if camera is None:
        raise ValueError("Aucune caméra disponible. Lancez d'abord `python -m app.seed`.")

    if zone is None:
        zone = camera.zone

    cat_code = category_code or random.choice(_PLASTIC_CODES)
    if db.scalar(select(WasteCategory).where(WasteCategory.code == cat_code)) is None:
        cat_code = "other_plastic"

    lat, lon = _jitter(zone.center_lat if zone else camera.lat,
                       zone.center_lon if zone else camera.lon)

    # Un nouvel objet reçoit un track_uid frais (simule le tracker CamSCA) ;
    # sinon on réutilise le track_uid fourni (même déchet revu).
    effective_track = f"sim_{uuid.uuid4().hex[:12]}" if new_object else track_uid

    return ingestion.ingest_detection(
        db,
        category_code=cat_code,
        camera_code=camera.code,
        zone_code=zone.code if zone else None,
        track_uid=effective_track,
        event_uid=f"sim_{uuid.uuid4().hex}",
        detected_at=utcnow(),
        lat=lat,
        lon=lon,
        confidence=round(random.uniform(0.62, 0.97), 2),
        source="simulation",
        is_simulated=True,
    )


def simulate_pollution_surge(
    db: Session, *, zone_code: str, count: int = 12, category_code: str | None = None
) -> dict:
    """Simule l'arrivée de `count` nouveaux déchets dans une zone.

    Utile pour voir le franchissement du seuil préventif puis critique et la
    génération automatique des alertes.
    """
    _ensure_simulation_allowed()
    results = []
    last_alert_level = None
    for _ in range(count):
        r = simulate_detection(
            db, zone_code=zone_code, category_code=category_code, new_object=True
        )
        results.append(r)
        if r.alert_level:
            last_alert_level = r.alert_level
    return {
        "zone_code": zone_code,
        "injected": len(results),
        "present_in_zone": results[-1].present_in_zone if results else None,
        "last_alert_level": last_alert_level,
        "note": "DONNÉES SIMULÉES — ne correspondent à aucune observation réelle.",
    }
