"""Entité Cameras (CamSCA)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, SimulationMixin, TimestampMixin
from app.models.enums import CameraStatus


class Camera(Base, TimestampMixin, SimulationMixin):
    __tablename__ = "cameras"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    status: Mapped[CameraStatus] = mapped_column(
        Enum(CameraStatus), default=CameraStatus.OFFLINE, nullable=False, index=True
    )

    # Position GPS FIXE de la caméra (≠ position d'un objet dans son champ).
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)

    # Paramètres de calibration (homographie image→sol) sérialisés en JSON.
    # Permet de transformer des coordonnées pixel en coordonnées géographiques.
    calibration_json: Mapped[str | None] = mapped_column(Text)

    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    zone_id: Mapped[int | None] = mapped_column(ForeignKey("zones.id"), index=True)
    zone: Mapped["Zone | None"] = relationship(back_populates="cameras")  # noqa: F821

    detections: Mapped[list["Detection"]] = relationship(back_populates="camera")  # noqa: F821
