# L-PLAST-INNOV — Littoral Plastic Innovation

Système intelligent de **surveillance, cartographie et suivi des déchets plastiques**
sur le littoral. Premier terrain d'expérimentation : la **plage de Balmer**, à San Pedro
(Côte d'Ivoire).

> ⚠️ **Statut** : projet en construction. Le dépôt contient aujourd'hui le **backend**
> complet (API + logique métier + mode simulation + tests) ainsi que les squelettes
> documentés du frontend web et de l'application mobile. Voir [`docs/ETAT-AVANCEMENT.md`](docs/ETAT-AVANCEMENT.md).

---

## Les trois grandes composantes

| Composante | Rôle |
|---|---|
| **CamSCA** | Caméra intelligente de surveillance et de détection (capture + IA + géoloc + transmission). |
| **Serveur central L-PLAST-INNOV** | Traitement, stockage, comptage, seuils, alertes, API. |
| **App Macro Plastique Balmer** | Information, alertes et mobilisation citoyenne (mobile). |

## Architecture du monorepo

```
l-plast-innov/
├── backend/        FastAPI + SQLAlchemy + (SQLite en démo / PostgreSQL+PostGIS en prod)
│   ├── app/
│   │   ├── core/        configuration, sécurité, temps (fuseau Africa/Abidjan)
│   │   ├── database/    session + base déclarative
│   │   ├── models/      les 14 entités de la base de données
│   │   ├── schemas/     validation Pydantic
│   │   ├── services/    comptage, suivi d'objets, seuils, alertes, zones…
│   │   ├── api/         routes REST versionnées (/api/v1)
│   │   └── ai/          détection YOLO : entraînement, inférence, évaluation
│   └── tests/
├── frontend/       React + TypeScript + Tailwind + Leaflet + Recharts (admin web)
├── mobile/         Flutter — « Macro Plastique Balmer » (citoyens)
└── docs/           documentation
```

## Démarrage ultra-rapide (mode simulation, sans Docker)

Le backend tourne **sans caméra physique et sans base de données externe** : il crée une
base SQLite locale et peut générer des données de démonstration clairement étiquetées.

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # (Windows : .venv\Scripts\activate)
pip install -r requirements.txt
cp .env.example .env
python -m app.seed            # crée la base + données DEMO + un admin
uvicorn app.main:app --reload # http://localhost:8000  — doc interactive : /docs
```

Identifiants admin de démonstration (modifiables dans `.env`) :
`admin@l-plast-innov.ci` / `ChangeMoi123!`

## Démarrage en conditions réelles (Docker + PostgreSQL/PostGIS)

```bash
docker compose up --build     # depuis la racine l-plast-innov/
```

## Principes de vérité des données

Ce projet distingue strictement **données réelles** et **données simulées** :

- Toute donnée simulée porte le drapeau `is_simulated = true` et/ou la mention `DEMO`.
- Les statistiques du tableau de bord sont calculées à partir des données enregistrées,
  jamais inventées.
- Aucun modèle d'IA n'est présenté comme « déjà entraîné » : le dossier `ai/` fournit la
  chaîne d'entraînement et un modèle de base, pas un modèle spécifique à Balmer.
- Les coordonnées GPS fournies sont des **données de démonstration** tant que les relevés
  réels de la plage de Balmer ne sont pas disponibles.

Voir [`docs/PRINCIPES.md`](docs/PRINCIPES.md).
