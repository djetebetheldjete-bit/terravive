"""Entités CleaningOperations & CleaningVerifications.

La caméra ne conclut JAMAIS seule qu'une zone est propre : une opération passe
par une vérification explicite (statut VERIFIED) avant clôture.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, SimulationMixin, TimestampMixin
from app.models.enums import CleaningStatus


class CleaningOperation(Base, TimestampMixin, SimulationMixin):
    __tablename__ = "cleaning_operations"

    id: Mapped[int] = mapped_column(primary_key=True)

    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id"), nullable=False, index=True)
    responsible_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    status: Mapped[CleaningStatus] = mapped_column(
        Enum(CleaningStatus), default=CleaningStatus.PENDING, nullable=False, index=True
    )

    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Nombre de déchets déclarés retirés par l'équipe de nettoyage.
    reported_removed_count: Mapped[int | None] = mapped_column(Integer)

    photo_before_ref: Mapped[str | None] = mapped_column(String(255))
    photo_after_ref: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)

    verifications: Mapped[list["CleaningVerification"]] = relationship(
        back_populates="operation", cascade="all, delete-orphan"
    )


class CleaningVerification(Base, TimestampMixin, SimulationMixin):
    """Contrôle après nettoyage (nouveau passage CamSCA + validation humaine)."""

    __tablename__ = "cleaning_verifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    operation_id: Mapped[int] = mapped_column(
        ForeignKey("cleaning_operations.id"), nullable=False, index=True
    )
    operation: Mapped[CleaningOperation] = relationship(back_populates="verifications")

    verified_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Nombre de déchets encore présents constaté lors du contrôle.
    waste_count_before: Mapped[int | None] = mapped_column(Integer)
    waste_count_after: Mapped[int | None] = mapped_column(Integer)

    is_confirmed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text)
