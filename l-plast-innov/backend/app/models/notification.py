"""Entités NotificationSubscriptions & NotificationHistory."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, SimulationMixin, TimestampMixin
from app.models.enums import AlertLevel, NotificationChannel


class NotificationSubscription(Base, TimestampMixin):
    """Préférences et abonnement d'un utilisateur aux notifications."""

    __tablename__ = "notification_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    user: Mapped["User"] = relationship(back_populates="subscriptions")  # noqa: F821

    channel: Mapped[NotificationChannel] = mapped_column(
        Enum(NotificationChannel), nullable=False
    )
    # Jeton d'appareil (FCM) pour les push ; nul pour in_app/web.
    device_token: Mapped[str | None] = mapped_column(String(512))

    # Filtre : zone surveillée (nul = toutes) et niveau minimal d'alerte reçu.
    zone_id: Mapped[int | None] = mapped_column(ForeignKey("zones.id"))
    min_level: Mapped[AlertLevel] = mapped_column(
        Enum(AlertLevel), default=AlertLevel.PREVENTIVE, nullable=False
    )

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class NotificationHistory(Base, TimestampMixin, SimulationMixin):
    """Journal des notifications effectivement émises."""

    __tablename__ = "notification_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    alert_id: Mapped[int | None] = mapped_column(ForeignKey("alerts.id"), index=True)

    channel: Mapped[NotificationChannel] = mapped_column(
        Enum(NotificationChannel), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)

    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
