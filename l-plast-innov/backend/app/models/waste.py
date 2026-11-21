"""Entités WasteCategories, WasteObjects, Detections.

Distinction clé imposée par le cahier des charges :
- **WasteObject** = un déchet UNIQUE, suivi dans le temps (object tracking).
- **Detection** = un ÉVÉNEMENT de détection (une observation sur une image).

Un même WasteObject peut avoir des dizaines de Detections sans être compté
plusieurs fois dans les déchets « présents ».
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, SimulationMixin, TimestampMixin
from app.models.enums import DetectionKind, WasteObjectStatus


class WasteCategory(Base, TimestampMixin):
    """Catégorie de déchet. Extensible : on peut en ajouter de nouvelles."""

    __tablename__ = "waste_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(48), unique=True, nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    is_plastic: Mapped[bool] = mapped_column(default=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    waste_objects: Mapped[list["WasteObject"]] = relationship(back_populates="category")


class WasteObject(Base, TimestampMixin, SimulationMixin):
    """Un déchet plastique unique, identifié et suivi dans le temps."""

    __tablename__ = "waste_objects"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Identifiant de suivi stable, attribué par le système de tracking (UUID court).
    track_uid: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )

    category_id: Mapped[int] = mapped_column(
        ForeignKey("waste_categories.id"), nullable=False, index=True
    )
    category: Mapped[WasteCategory] = relationship(back_populates="waste_objects")

    zone_id: Mapped[int | None] = mapped_column(ForeignKey("zones.id"), index=True)
    zone: Mapped["Zone | None"] = relationship(back_populates="waste_objects")  # noqa: F821

    status: Mapped[WasteObjectStatus] = mapped_column(
        Enum(WasteObjectStatus), default=WasteObjectStatus.NEW, nullable=False, index=True
    )

    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Dernière position géographique connue.
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)

    # Nombre total de fois que cet objet a été observé (sert aux statistiques,
    # jamais au comptage des déchets présents).
    detection_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float)  # dernière confiance IA

    detections: Mapped[list["Detection"]] = relationship(
        back_populates="waste_object", cascade="all, delete-orphan"
    )


class Detection(Base, TimestampMixin, SimulationMixin):
    """Un événement de détection (observation unique sur une image)."""

    __tablename__ = "detections"
    __table_args__ = (
        # Anti-double traitement réseau : un même event_uid n'est enregistré qu'une fois.
        UniqueConstraint("event_uid", name="uq_detection_event_uid"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Identifiant unique de l'événement fourni par la CamSCA (idempotence réseau).
    event_uid: Mapped[str | None] = mapped_column(String(80), index=True)

    waste_object_id: Mapped[int] = mapped_column(
        ForeignKey("waste_objects.id"), nullable=False, index=True
    )
    waste_object: Mapped[WasteObject] = relationship(back_populates="detections")

    camera_id: Mapped[int | None] = mapped_column(ForeignKey("cameras.id"), index=True)
    camera: Mapped["Camera | None"] = relationship(back_populates="detections")  # noqa: F821

    zone_id: Mapped[int | None] = mapped_column(ForeignKey("zones.id"), index=True)

    kind: Mapped[DetectionKind] = mapped_column(
        Enum(DetectionKind), default=DetectionKind.FIRST_SEEN, nullable=False
    )

    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    confidence: Mapped[float | None] = mapped_column(Float)

    # Boîte englobante dans l'image (JSON [x,y,w,h]) et chemin de l'image associée.
    bbox_json: Mapped[str | None] = mapped_column(String(120))
    image_ref: Mapped[str | None] = mapped_column(String(255))
