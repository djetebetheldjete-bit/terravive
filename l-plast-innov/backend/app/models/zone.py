"""Entités Zones & Thresholds (seuils).

Géométrie : stockée en **GeoJSON** (texte) pour fonctionner partout, y compris
en mode simulation SQLite. En production PostgreSQL/PostGIS, une colonne
géométrique spatiale peut être ajoutée (voir docs/BASE-DE-DONNEES.md) sans
casser ce modèle, qui reste la source portable de la géométrie.
"""
from __future__ import annotations

from sqlalchemy import Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, SimulationMixin, TimestampMixin
from app.models.enums import ZoneStatus


class Zone(Base, TimestampMixin, SimulationMixin):
    __tablename__ = "zones"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    area_m2: Mapped[float | None] = mapped_column(Float)  # superficie estimée

    # Géométrie du polygone au format GeoJSON (chaîne JSON).
    geojson: Mapped[str | None] = mapped_column(Text)
    # Point représentatif (centroïde approximatif) pour affichage rapide.
    center_lat: Mapped[float | None] = mapped_column(Float)
    center_lon: Mapped[float | None] = mapped_column(Float)

    status: Mapped[ZoneStatus] = mapped_column(
        Enum(ZoneStatus), default=ZoneStatus.CLEAN, nullable=False, index=True
    )

    # Nombre de déchets UNIQUES actuellement présents (cache tenu à jour par le
    # service de comptage ; la source de vérité reste la table waste_objects).
    present_waste_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    threshold_id: Mapped[int | None] = mapped_column(ForeignKey("thresholds.id"))
    threshold: Mapped["Threshold | None"] = relationship(
        back_populates="zone", uselist=False, foreign_keys=[threshold_id]
    )

    cameras: Mapped[list["Camera"]] = relationship(back_populates="zone")  # noqa: F821
    waste_objects: Mapped[list["WasteObject"]] = relationship(back_populates="zone")  # noqa: F821
    alerts: Mapped[list["Alert"]] = relationship(back_populates="zone")  # noqa: F821


class Threshold(Base, TimestampMixin):
    """Seuils préventif et critique propres à une zone (modifiables)."""

    __tablename__ = "thresholds"

    id: Mapped[int] = mapped_column(primary_key=True)
    zone_code: Mapped[str] = mapped_column(String(32), nullable=False, index=True)

    preventive: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    critical: Mapped[int] = mapped_column(Integer, nullable=False, default=20)

    zone: Mapped[Zone] = relationship(
        back_populates="threshold", uselist=False, foreign_keys="Zone.threshold_id"
    )
