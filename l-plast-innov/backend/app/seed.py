"""Amorçage de la base : tables, rôles, catégories, admin, données DEMO.

Lancement :  python -m app.seed

En mode SQLite (démo), les tables sont créées directement. En PostgreSQL, il est
recommandé d'utiliser les migrations Alembic (voir alembic/). Ce script crée
ensuite les référentiels et un jeu de données de DÉMONSTRATION.

⚠️ Les zones et caméras créées ici sont marquées is_simulated=True et leurs
coordonnées sont des données de DÉMONSTRATION proches de San Pedro : elles ne
constituent PAS un relevé GPS réel de la plage de Balmer.
"""
from __future__ import annotations

from sqlalchemy import select

from app.core.config import settings
from app.core.security import hash_password
from app.database.base import Base
from app.database.session import SessionLocal, engine
from app.models.camera import Camera
from app.models.enums import CameraStatus, RoleName, ZoneStatus
from app.models.user import Role, User
from app.models.waste import WasteCategory
from app.models.zone import Threshold, Zone

# Les 8 catégories de départ (extensibles).
CATEGORIES = [
    ("plastic_bottle", "Bouteille plastique", True),
    ("plastic_bag", "Sachet plastique", True),
    ("food_packaging", "Emballage alimentaire", True),
    ("plastic_cap", "Bouchon plastique", True),
    ("plastic_fragment", "Fragment plastique", True),
    ("other_plastic", "Autre déchet plastique", True),
    ("non_plastic", "Déchet non plastique", False),
    ("unidentified", "Objet non identifié", False),
]

ROLES = [
    (RoleName.VISITOR, "Visiteur volontaire"),
    (RoleName.CLEANER, "Responsable du nettoyage"),
    (RoleName.ADMIN, "Administrateur"),
]

# Données de DÉMONSTRATION (proches de San Pedro, Côte d'Ivoire).
# ⚠️ NON OFFICIELLES — à remplacer par les relevés GPS réels de Balmer.
DEMO_ZONES = [
    # code, nom, centre lat/lon, préventif, critique
    ("BAL-A", "Balmer — Zone A (Est) [DEMO]", 4.7490, -6.6360, 10, 20),
    ("BAL-B", "Balmer — Zone B (Centre) [DEMO]", 4.7485, -6.6380, 10, 15),
    ("BAL-C", "Balmer — Zone C (Ouest) [DEMO]", 4.7480, -6.6400, 15, 30),
]


def _demo_polygon(lat: float, lon: float) -> str:
    """Petit carré GeoJSON autour du centre (démonstration)."""
    d = 0.0007
    coords = [
        [lon - d, lat - d],
        [lon + d, lat - d],
        [lon + d, lat + d],
        [lon - d, lat + d],
        [lon - d, lat - d],
    ]
    import json

    return json.dumps({"type": "Polygon", "coordinates": [coords]})


def create_tables() -> None:
    import app.models  # noqa: F401  (enregistre toutes les tables)

    Base.metadata.create_all(bind=engine)


def seed() -> None:
    create_tables()
    db = SessionLocal()
    try:
        # Rôles
        roles: dict[RoleName, Role] = {}
        for name, desc in ROLES:
            r = db.scalar(select(Role).where(Role.name == name))
            if r is None:
                r = Role(name=name, description=desc)
                db.add(r)
                db.flush()
            roles[name] = r

        # Catégories
        for code, label, is_plastic in CATEGORIES:
            if db.scalar(select(WasteCategory).where(WasteCategory.code == code)) is None:
                db.add(WasteCategory(code=code, label=label, is_plastic=is_plastic))

        # Admin initial
        admin = db.scalar(select(User).where(User.email == settings.first_admin_email))
        if admin is None:
            db.add(
                User(
                    email=settings.first_admin_email,
                    full_name="Administrateur L-PLAST-INNOV",
                    hashed_password=hash_password(settings.first_admin_password),
                    role_id=roles[RoleName.ADMIN].id,
                    is_active=True,
                )
            )

        # Zones + seuils + caméras DEMO
        for code, name, lat, lon, prev, crit in DEMO_ZONES:
            zone = db.scalar(select(Zone).where(Zone.code == code))
            if zone is None:
                th = Threshold(zone_code=code, preventive=prev, critical=crit)
                db.add(th)
                db.flush()
                zone = Zone(
                    code=code,
                    name=name,
                    description="Zone de DÉMONSTRATION. Coordonnées non officielles.",
                    area_m2=1200.0,
                    geojson=_demo_polygon(lat, lon),
                    center_lat=lat,
                    center_lon=lon,
                    status=ZoneStatus.CLEAN,
                    threshold_id=th.id,
                    is_simulated=True,
                )
                db.add(zone)
                db.flush()
                cam_code = f"CAM-{code}"
                db.add(
                    Camera(
                        code=cam_code,
                        name=f"CamSCA {code} [DEMO]",
                        description="Caméra de DÉMONSTRATION (mode simulation).",
                        status=CameraStatus.ACTIVE,
                        lat=lat,
                        lon=lon,
                        zone_id=zone.id,
                        is_simulated=True,
                    )
                )

        db.commit()
        print("✅ Base amorcée.")
        print(f"   Admin : {settings.first_admin_email} / (mot de passe défini dans .env)")
        print(f"   Catégories : {len(CATEGORIES)} | Zones DEMO : {len(DEMO_ZONES)}")
        print("   ⚠️ Les coordonnées des zones sont des données de DÉMONSTRATION.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
