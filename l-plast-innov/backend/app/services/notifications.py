"""Distribution des notifications liées aux alertes.

Deux publics : responsables du nettoyage et visiteurs volontaires abonnés.

En l'absence de passerelle push réelle configurée (FCM_SERVER_KEY), les
notifications sont ENREGISTRÉES dans l'historique mais marquées non délivrées :
on ne prétend pas avoir envoyé un push qui n'est jamais parti. Le branchement
FCM réel est laissé en TODO explicite.

Respect de la vie privée : on ne diffuse jamais la position personnelle d'un
utilisateur. La géolocalisation des visiteurs est facultative (consentement).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.timezone import utcnow
from app.models.alert import Alert
from app.models.enums import AlertLevel, RoleName
from app.models.notification import NotificationHistory, NotificationSubscription
from app.models.user import Role, User


def _level_rank(level: AlertLevel) -> int:
    return 1 if level == AlertLevel.PREVENTIVE else 2


def _matching_subscriptions(db: Session, alert: Alert) -> list[NotificationSubscription]:
    subs = db.scalars(
        select(NotificationSubscription).where(NotificationSubscription.is_active.is_(True))
    ).all()
    out = []
    for s in subs:
        if s.zone_id is not None and s.zone_id != alert.zone_id:
            continue
        if _level_rank(s.min_level) > _level_rank(alert.level):
            continue
        out.append(s)
    return out


def dispatch_for_alert(db: Session, alert: Alert) -> list[NotificationHistory]:
    """Génère les entrées d'historique de notification pour une alerte.

    Les responsables du nettoyage sont toujours notifiés d'une alerte ; les
    visiteurs abonnés le sont selon leurs préférences.
    """
    records: list[NotificationHistory] = []

    title = (
        "🟠 Alerte préventive"
        if alert.level == AlertLevel.PREVENTIVE
        else "🔴 Alerte critique"
    )
    body = alert.message

    # 1. Responsables du nettoyage (rôle cleaner + admins).
    managers = db.scalars(
        select(User)
        .join(Role, User.role_id == Role.id)
        .where(Role.name.in_([RoleName.CLEANER, RoleName.ADMIN]), User.is_active.is_(True))
    ).all()
    for user in managers:
        records.append(
            _record(db, user_id=user.id, alert=alert, title=title, body=body, channel_push=True)
        )

    # 2. Visiteurs volontaires abonnés (selon préférences).
    for sub in _matching_subscriptions(db, alert):
        records.append(
            _record(
                db,
                user_id=sub.user_id,
                alert=alert,
                title=title,
                body=body,
                channel_push=(sub.channel.value == "push"),
            )
        )

    db.commit()
    return records


def _record(db, *, user_id, alert, title, body, channel_push) -> NotificationHistory:
    from app.models.enums import NotificationChannel

    delivered = False
    # TODO (mode réel) : envoyer via FCM ici si settings.fcm_server_key est défini.
    if channel_push and settings.fcm_server_key:
        delivered = _try_send_fcm(title, body)

    rec = NotificationHistory(
        user_id=user_id,
        alert_id=alert.id,
        channel=NotificationChannel.PUSH if channel_push else NotificationChannel.IN_APP,
        title=title,
        body=body,
        sent_at=utcnow() if delivered else None,
        delivered=delivered,
        is_simulated=alert.is_simulated,
    )
    db.add(rec)
    db.flush()
    return rec


def _try_send_fcm(title: str, body: str | None) -> bool:  # pragma: no cover
    """Point de branchement Firebase Cloud Messaging (mode réel).

    Laissé volontairement non implémenté : renvoyer True seulement lorsqu'un
    envoi réel a réussi. Ne jamais marquer `delivered` sans envoi effectif.
    """
    return False
