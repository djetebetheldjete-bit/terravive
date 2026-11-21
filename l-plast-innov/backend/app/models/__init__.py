"""Regroupe toutes les entités pour qu'Alembic et Base.metadata les voient."""
from app.database.base import Base  # noqa: F401
from app.models.alert import Alert  # noqa: F401
from app.models.camera import Camera  # noqa: F401
from app.models.cleaning import CleaningOperation, CleaningVerification  # noqa: F401
from app.models.device import DeviceEvent  # noqa: F401
from app.models.enums import (  # noqa: F401
    AlertLevel,
    AlertStatus,
    CameraStatus,
    CleaningStatus,
    DetectionKind,
    DeviceEventStatus,
    NotificationChannel,
    RoleName,
    WasteObjectStatus,
    ZoneStatus,
)
from app.models.notification import (  # noqa: F401
    NotificationHistory,
    NotificationSubscription,
)
from app.models.user import Role, User  # noqa: F401
from app.models.waste import Detection, WasteCategory, WasteObject  # noqa: F401
from app.models.zone import Threshold, Zone  # noqa: F401

__all__ = [
    "Base",
    "Role",
    "User",
    "Camera",
    "Zone",
    "Threshold",
    "WasteCategory",
    "WasteObject",
    "Detection",
    "Alert",
    "CleaningOperation",
    "CleaningVerification",
    "NotificationSubscription",
    "NotificationHistory",
    "DeviceEvent",
]
