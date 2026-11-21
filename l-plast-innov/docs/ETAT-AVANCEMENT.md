# État d'avancement — L-PLAST-INNOV

Mise à jour : phase 1 (backend) livrée et vérifiée.

## ✅ Livré et testé

### Serveur central (backend FastAPI)
- [x] Architecture monorepo + configuration par `.env` (aucun secret en dur).
- [x] Base de données : les **14 entités** du cahier des charges (SQLAlchemy),
      migrations Alembic, fonctionne en SQLite (démo) et PostgreSQL/PostGIS (prod).
- [x] Sécurité : hachage bcrypt, JWT, rôles (visiteur / responsable / admin),
      contrôle d'accès, validation Pydantic.
- [x] **Suivi d'objets** (tracking) + anti-double-comptage + idempotence réseau.
- [x] **Comptage** : les 3 indicateurs distincts, par zone / catégorie / période,
      fuseau Africa/Abidjan.
- [x] **Zones** : CRUD, géométrie GeoJSON, statut de surveillance.
- [x] **Seuils** par zone (préventif/critique), modifiables.
- [x] **Alertes** : déclenchement au franchissement, anti-répétition, cycle de vie.
- [x] **Notifications** : ciblage responsables/visiteurs, historique (branchement
      FCM laissé en TODO explicite — rien n'est marqué « envoyé » sans envoi réel).
- [x] **Nettoyage** : opérations, statuts, vérification obligatoire, clôture
      d'alerte, conservation de l'historique.
- [x] **Tableau de bord statistique** : vue d'ensemble, séries, comparaison de
      périodes, efficacité des nettoyages.
- [x] **Mode simulation** : tester sans caméra (détection, montée de pollution,
      nettoyage) — toutes données marquées DEMO.
- [x] **Module IA** (YOLO) : entraînement, inférence, évaluation, classes —
      honnête sur l'absence de modèle Balmer entraîné.
- [x] **Géolocalisation** : calibration homographique + repli centre de zone.
- [x] **Tests** : suite pytest (comptage, seuils, alertes, nettoyage, rôles) — **7/7 OK**.
- [x] **Docker** : Dockerfile + docker-compose (PostGIS + backend).

## 🚧 À venir (phases suivantes)

### Frontend web (React + TypeScript + Tailwind + Leaflet + Recharts)
- [ ] Tableau de bord d'administration.
- [ ] Carte interactive des zones.
- [ ] Gestion caméras / zones / seuils / alertes / utilisateurs.
- [ ] Rapports (export PDF / CSV).

### Application mobile (Flutter — « Macro Plastique Balmer »)
- [ ] Écrans : Accueil, Carte, Statistiques, Alertes, Nettoyage, Profil.
- [ ] Notifications push (Firebase Cloud Messaging).
- [ ] Rôles et préférences, géolocalisation facultative.

### IA & terrain
- [ ] Collecte + annotation d'images réelles de Balmer, entraînement du modèle.
- [ ] Relevés GPS réels des zones (remplacer les données DEMO).
- [ ] Calibration terrain des caméras (homographies).

### GPR (phase avancée)
- [ ] Module d'ingestion des données radar, corrélation visuel/souterrain.

## Comment tester tout de suite

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m app.seed
uvicorn app.main:app --reload     # http://localhost:8000/docs
pytest                            # lance la suite de tests
```
