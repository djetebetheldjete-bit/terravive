"""Base déclarative SQLAlchemy et mixins communs.

Le champ `is_simulated` est présent sur toutes les tables de données terrain :
il garantit qu'aucune donnée de simulation ne sera jamais confondue avec une
observation réelle.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.timezone import utcnow


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class SimulationMixin:
    """Marque une ligne comme issue du mode simulation (données DEMO)."""

    is_simulated: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, index=True
    )
