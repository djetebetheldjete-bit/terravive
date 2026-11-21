"""Énumérations partagées du domaine métier."""
from __future__ import annotations

import enum


class RoleName(str, enum.Enum):
    VISITOR = "visitor"            # Visiteur volontaire
    CLEANER = "cleaner"            # Responsable du nettoyage
    ADMIN = "admin"               # Administrateur


class CameraStatus(str, enum.Enum):
    ACTIVE = "active"             # En ligne, transmet
    OFFLINE = "offline"          # Hors ligne
    MAINTENANCE = "maintenance"
    DISABLED = "disabled"


class ZoneStatus(str, enum.Enum):
    CLEAN = "clean"              # Propre (sous le seuil préventif)
    MONITORED = "monitored"      # En surveillance (seuil préventif atteint)
    ALERT = "alert"             # En alerte (seuil critique atteint)
    DISABLED = "disabled"


class WasteObjectStatus(str, enum.Enum):
    """Cycle de vie d'un déchet UNIQUE suivi dans le temps.

    Un objet disparu d'une image n'est PAS automatiquement « retiré ».
    """
    NEW = "new"                   # Nouvellement détecté
    PRESENT = "present"           # Toujours observé / présent sur la plage
    NOT_VISIBLE = "not_visible"   # Plus visible (sans preuve de retrait)
    UNCERTAIN = "uncertain"       # Suivi incertain
    REMOVED = "removed"           # Retiré (nettoyage vérifié)


class DetectionKind(str, enum.Enum):
    """Nature d'un événement de détection pour un objet donné."""
    FIRST_SEEN = "first_seen"     # Première détection de l'objet
    RE_SEEN = "re_seen"           # Objet déjà connu revu
    MOVED = "moved"               # Objet déplacé (changement de position/zone)
    LOST = "lost"                 # Objet perdu de vue


class AlertLevel(str, enum.Enum):
    PREVENTIVE = "preventive"     # Seuil préventif franchi (orange)
    CRITICAL = "critical"         # Seuil critique franchi (rouge)


class AlertStatus(str, enum.Enum):
    OPEN = "open"                 # Active, non traitée
    ACKNOWLEDGED = "acknowledged" # Prise en compte
    IN_CLEANING = "in_cleaning"   # Intervention en cours
    RESOLVED = "resolved"         # Clôturée après vérification


class CleaningStatus(str, enum.Enum):
    PENDING = "pending"               # En attente
    IN_PROGRESS = "in_progress"       # En cours
    DONE = "done"                     # Nettoyage effectué
    AWAITING_VERIFICATION = "awaiting_verification"  # En attente de vérification
    VERIFIED = "verified"             # Vérifié
    TO_REDO = "to_redo"               # À reprendre


class NotificationChannel(str, enum.Enum):
    PUSH = "push"
    IN_APP = "in_app"
    WEB = "web"


class DeviceEventStatus(str, enum.Enum):
    RECEIVED = "received"
    PROCESSED = "processed"
    DUPLICATE = "duplicate"        # Rejeté : déjà reçu (anti-double traitement réseau)
    REJECTED = "rejected"
