"""Entité DeviceEvents : journal brut des messages reçus des équipements.

Sert à l'idempotence (détecter les événements transmis plusieurs fois par le
réseau) et à la traçabilité. Le GPR (radar sous le sable) écrira aussi ici, dans
un module indépendant, ses données brutes — à traiter séparément des détections
visuelles (une anomalie souterraine n'est PAS automatiquement du plastique).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, SimulationMixin, TimestampMixin
from app.models.enums import DeviceEventStatus


class DeviceEvent(Base, TimestampMixin, SimulationMixin):
    __tablename__ = "device_events"
    __table_args__ = (
        UniqueConstraint("event_uid", name="uq_device_event_uid"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Identifiant idempotent de l'événement (fourni par l'équipement).
    event_uid: Mapped[str] = mapped_column(String(80), nullable=False, index=True)

    camera_id: Mapped[int | None] = mapped_column(ForeignKey("cameras.id"), index=True)
    # Type de source : "camsca", "gpr", "simulation", ...
    source: Mapped[str] = mapped_column(String(32), default="camsca", nullable=False)

    status: Mapped[DeviceEventStatus] = mapped_column(
        Enum(DeviceEventStatus), default=DeviceEventStatus.RECEIVED, nullable=False
    )

    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload_json: Mapped[str | None] = mapped_column(Text)  # charge utile brute
    note: Mapped[str | None] = mapped_column(Text)
