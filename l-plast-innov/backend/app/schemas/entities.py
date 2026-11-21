"""Schémas Pydantic d'entrée/sortie pour les entités principales."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import (
    AlertLevel,
    AlertStatus,
    CameraStatus,
    CleaningStatus,
    WasteObjectStatus,
    ZoneStatus,
)


class ORMBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------- Users ----------------
class UserOut(ORMBase):
    id: int
    email: EmailStr
    full_name: str | None
    is_active: bool
    role_name: str
    location_consent: bool


class UserRoleUpdate(BaseModel):
    role_name: str


# ---------------- Catégories ----------------
class WasteCategoryOut(ORMBase):
    id: int
    code: str
    label: str
    is_plastic: bool
    description: str | None


class WasteCategoryCreate(BaseModel):
    code: str = Field(pattern=r"^[a-z0-9_]+$", max_length=48)
    label: str
    is_plastic: bool = True
    description: str | None = None


# ---------------- Seuils ----------------
class ThresholdOut(ORMBase):
    preventive: int
    critical: int


class ThresholdUpdate(BaseModel):
    preventive: int = Field(ge=1)
    critical: int = Field(ge=1)


# ---------------- Zones ----------------
class ZoneBase(BaseModel):
    code: str = Field(max_length=32)
    name: str
    description: str | None = None
    area_m2: float | None = None
    geojson: str | None = None
    center_lat: float | None = None
    center_lon: float | None = None


class ZoneCreate(ZoneBase):
    preventive_threshold: int | None = None
    critical_threshold: int | None = None


class ZoneUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    area_m2: float | None = None
    geojson: str | None = None
    center_lat: float | None = None
    center_lon: float | None = None
    status: ZoneStatus | None = None


class ZoneOut(ORMBase):
    id: int
    code: str
    name: str
    description: str | None
    area_m2: float | None
    geojson: str | None
    center_lat: float | None
    center_lon: float | None
    status: ZoneStatus
    present_waste_count: int
    is_simulated: bool
    threshold: ThresholdOut | None = None


# ---------------- Caméras ----------------
class CameraBase(BaseModel):
    code: str = Field(max_length=32)
    name: str
    description: str | None = None
    lat: float | None = None
    lon: float | None = None


class CameraCreate(CameraBase):
    zone_id: int | None = None
    is_simulated: bool = False


class CameraUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    lat: float | None = None
    lon: float | None = None
    zone_id: int | None = None
    status: CameraStatus | None = None


class CameraOut(ORMBase):
    id: int
    code: str
    name: str
    description: str | None
    status: CameraStatus
    lat: float | None
    lon: float | None
    zone_id: int | None
    last_seen_at: datetime | None
    is_simulated: bool


# ---------------- Détections ----------------
class DetectionIngest(BaseModel):
    """Charge utile transmise par une CamSCA (ou la simulation)."""

    category_code: str
    camera_code: str | None = None
    zone_code: str | None = None
    track_uid: str | None = None
    event_uid: str | None = Field(
        default=None, description="Identifiant idempotent de l'événement."
    )
    detected_at: datetime | None = None
    lat: float | None = None
    lon: float | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    bbox: list[float] | None = None
    image_ref: str | None = None
    is_simulated: bool = False


class IngestOut(BaseModel):
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


class WasteObjectOut(ORMBase):
    id: int
    track_uid: str
    category_id: int
    zone_id: int | None
    status: WasteObjectStatus
    first_seen_at: datetime
    last_seen_at: datetime
    removed_at: datetime | None
    lat: float | None
    lon: float | None
    detection_count: int
    confidence: float | None
    is_simulated: bool


# ---------------- Alertes ----------------
class AlertOut(ORMBase):
    id: int
    zone_id: int
    level: AlertLevel
    status: AlertStatus
    waste_count_at_trigger: int
    threshold_value: int
    message: str | None
    triggered_at: datetime
    acknowledged_at: datetime | None
    resolved_at: datetime | None
    is_simulated: bool


# ---------------- Nettoyage ----------------
class CleaningCreate(BaseModel):
    zone_id: int
    notes: str | None = None


class CleaningStatusUpdate(BaseModel):
    status: CleaningStatus


class CleaningVerifyRequest(BaseModel):
    confirmed: bool
    removed_track_uids: list[str] | None = None
    comment: str | None = None


class CleaningOut(ORMBase):
    id: int
    zone_id: int
    responsible_user_id: int | None
    status: CleaningStatus
    scheduled_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None
    reported_removed_count: int | None
    notes: str | None
    is_simulated: bool
