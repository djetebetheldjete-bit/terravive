"""Pipeline d'ingestion d'un événement de détection (depuis la CamSCA ou la simulation).

Étapes :
1. Idempotence : si l'event_uid a déjà été traité, on n'enregistre rien (anti
   double traitement des messages rejoués par le réseau).
2. Résolution de la caméra, de la catégorie et de la zone.
3. Suivi d'objet (tracking) : nouvel objet OU objet déjà connu.
4. Enregistrement de la détection (événement).
5. Réévaluation des seuils de la zone → éventuelle alerte.

Renvoie un résumé de ce qui s'est passé.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.timezone import utcnow
from app.models.camera import Camera
from app.models.device import DeviceEvent
from app.models.enums import CameraStatus, DeviceEventStatus
from app.models.waste import Detection, WasteCategory
from app.models.zone import Zone
from app.services import notifications, thresholds, tracking


@dataclass
class IngestResult:
    accepted: bool
    reason: str
    waste_object_id: int | None = None
    track_uid: str | None = None
    detection_id: int | None = None
    is_new_object: bool = False
    zone_code: str | None = None
    present_in_zone: int | None = None
    alert_id: int | None = None
    alert_level: str | None = None


def _get_category(db: Session, code: str) -> WasteCategory | None:
    return db.scalar(select(WasteCategory).where(WasteCategory.code == code))


def _get_camera(db: Session, code: str | None) -> Camera | None:
    if not code:
        return None
    return db.scalar(select(Camera).where(Camera.code == code))


def _already_processed(db: Session, event_uid: str | None) -> bool:
    if not event_uid:
        return False
    exists = db.scalar(select(DeviceEvent.id).where(DeviceEvent.event_uid == event_uid))
    return exists is not None


def ingest_detection(
    db: Session,
    *,
    category_code: str,
    camera_code: str | None = None,
    zone_code: str | None = None,
    track_uid: str | None = None,
    event_uid: str | None = None,
    detected_at: datetime | None = None,
    lat: float | None = None,
    lon: float | None = None,
    confidence: float | None = None,
    bbox: list[float] | None = None,
    image_ref: str | None = None,
    source: str = "camsca",
    is_simulated: bool = False,
) -> IngestResult:
    detected_at = detected_at or utcnow()

    # 1. Idempotence réseau : si l'event_uid a déjà été traité, on ne refait rien.
    if _already_processed(db, event_uid):
        import uuid as _uuid

        db.add(
            DeviceEvent(
                # uid unique pour le journal du doublon (la contrainte d'unicité
                # porte sur l'original déjà enregistré).
                event_uid=f"{event_uid}#dup#{_uuid.uuid4().hex[:8]}",
                source=source,
                status=DeviceEventStatus.DUPLICATE,
                received_at=utcnow(),
                note=f"Événement déjà traité (rejeu réseau) : {event_uid}",
                is_simulated=is_simulated,
            )
        )
        db.commit()
        return IngestResult(accepted=False, reason="duplicate_event")

    # 2. Résolution catégorie / caméra / zone.
    category = _get_category(db, category_code)
    if category is None:
        return IngestResult(accepted=False, reason=f"unknown_category:{category_code}")

    camera = _get_camera(db, camera_code)
    zone: Zone | None = None
    if camera is not None:
        camera.last_seen_at = utcnow()
        if camera.status == CameraStatus.OFFLINE:
            camera.status = CameraStatus.ACTIVE
        zone = camera.zone
    if zone is None and zone_code:
        zone = db.scalar(select(Zone).where(Zone.code == zone_code))

    zone_id = zone.id if zone else None

    # Journal brut (traçabilité + idempotence).
    device_event = DeviceEvent(
        event_uid=event_uid or f"auto_{utcnow().timestamp()}",
        camera_id=camera.id if camera else None,
        source=source,
        status=DeviceEventStatus.RECEIVED,
        received_at=utcnow(),
        payload_json=json.dumps(
            {
                "category": category_code,
                "camera": camera_code,
                "track_uid": track_uid,
                "lat": lat,
                "lon": lon,
                "confidence": confidence,
            }
        ),
        is_simulated=is_simulated,
    )
    db.add(device_event)
    db.flush()

    # 3. Suivi d'objet.
    tr = tracking.track_detection(
        db,
        category=category,
        track_uid=track_uid,
        zone_id=zone_id,
        lat=lat,
        lon=lon,
        detected_at=detected_at,
        confidence=confidence,
        is_simulated=is_simulated,
    )

    # 4. Enregistrement de la détection (événement).
    detection = Detection(
        event_uid=event_uid,
        waste_object_id=tr.waste_object.id,
        camera_id=camera.id if camera else None,
        zone_id=zone_id,
        kind=tr.kind,
        detected_at=detected_at,
        lat=lat,
        lon=lon,
        confidence=confidence,
        bbox_json=json.dumps(bbox) if bbox else None,
        image_ref=image_ref,
        is_simulated=is_simulated,
    )
    db.add(detection)
    device_event.status = DeviceEventStatus.PROCESSED
    db.flush()

    # 5. Réévaluation des seuils de la zone.
    result = IngestResult(
        accepted=True,
        reason="ok",
        waste_object_id=tr.waste_object.id,
        track_uid=tr.waste_object.track_uid,
        detection_id=detection.id,
        is_new_object=tr.is_new,
        zone_code=zone.code if zone else None,
    )
    if zone is not None:
        ev = thresholds.evaluate_zone(db, zone)
        result.present_in_zone = ev.present_count
        if ev.created_alert is not None:
            result.alert_id = ev.created_alert.id
            result.alert_level = ev.created_alert.level.value
            # Distribution des notifications au franchissement du seuil.
            notifications.dispatch_for_alert(db, ev.created_alert)

    db.commit()
    return result
