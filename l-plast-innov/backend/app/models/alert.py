"""Entité Alerts.

Règle : une alerte est créée au **franchissement** d'un seuil, pas à chaque
détection. Le service de seuils garantit qu'une seule alerte ouverte d'un niveau
donné existe par zone à la fois (anti-répétition).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, SimulationMixin, TimestampMixin
from app.models.enums import AlertLevel, AlertStatus


class Alert(Base, TimestampMixin, SimulationMixin):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)

    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id"), nullable=False, index=True)
    zone: Mapped["Zone"] = relationship(back_populates="alerts")  # noqa: F821

    level: Mapped[AlertLevel] = mapped_column(Enum(AlertLevel), nullable=False, index=True)
    status: Mapped[AlertStatus] = mapped_column(
        Enum(AlertStatus), default=AlertStatus.OPEN, nullable=False, index=True
    )

    # Nombre de déchets UNIQUES présents au moment du déclenchement.
    waste_count_at_trigger: Mapped[int] = mapped_column(Integer, nullable=False)
    threshold_value: Mapped[int] = mapped_column(Integer, nullable=False)

    message: Mapped[str | None] = mapped_column(Text)

    triggered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    cleaning_operation_id: Mapped[int | None] = mapped_column(
        ForeignKey("cleaning_operations.id")
    )
