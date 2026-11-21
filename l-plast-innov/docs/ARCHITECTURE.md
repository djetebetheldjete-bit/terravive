# Architecture — L-PLAST-INNOV

## Les 14 composantes du cahier des charges → implémentation

| # | Composante | Où |
|---|---|---|
| A | CamSCA (détection) | `backend/app/ai/inference.py` + API d'ingestion |
| B | IA (reconnaissance) | `backend/app/ai/` (YOLO : train/inference/evaluate) |
| C | Comptage | `backend/app/services/counting.py` |
| D | Géolocalisation | `backend/app/services/geolocation.py` |
| E | Gestion des zones | `backend/app/services` + `api/v1/zones.py` |
| F | Serveur central | `backend/app` (FastAPI) |
| G | Base de données | `backend/app/models` + Alembic |
| H | Seuils | `backend/app/services/thresholds.py` |
| I | Alertes | `backend/app/services/alerts.py` |
| J | Cartographie | GeoJSON des zones → frontend (Leaflet) *(à venir)* |
| K | App mobile | `mobile/` (Flutter) *(à venir)* |
| L | Plateforme web | `frontend/` (React) *(à venir)* |
| M | Nettoyage | `backend/app/services/cleaning.py` |
| N | Tableau de bord | `backend/app/services/stats.py` |

## Flux d'une détection (bout en bout)

```
CamSCA (image)
   │  YOLO (inference.py) → [{category, bbox, confidence, track_uid}]
   │  + géolocalisation (homographie si caméra calibrée)
   ▼
POST /api/v1/detections/ingest   (idempotent via event_uid)
   │
   ├─ idempotence réseau (DeviceEvent)
   ├─ tracking : nouvel objet ou objet connu (WasteObject)
   ├─ enregistrement de l'événement (Detection)
   ├─ réévaluation des seuils de la zone
   │      └─ franchissement → Alert (une par niveau/zone)
   │             └─ notifications (responsables + visiteurs abonnés)
   ▼
Tableau de bord / carte / app mobile
```

## Modes

- **Simulation** (`SIMULATION_MODE=true`) : routes `/api/v1/simulation/*`, données
  marquées `is_simulated`. Permet de tout tester sans matériel.
- **Réel** : caméras physiques → `/detections/ingest` avec `is_simulated=false`.

## Pile technique

- Backend : Python 3.12+, FastAPI, SQLAlchemy 2, Pydantic 2, Alembic.
- Base : SQLite (démo) / PostgreSQL + PostGIS (prod).
- IA : YOLO (Ultralytics), OpenCV, PyTorch.
- Frontend : React + TypeScript + Tailwind + Leaflet + Recharts.
- Mobile : Flutter / Dart + Firebase Cloud Messaging.
- Infra : Docker, Docker Compose.
