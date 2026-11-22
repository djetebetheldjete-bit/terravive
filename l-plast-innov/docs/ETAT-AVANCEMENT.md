# État d'avancement — L-PLAST-INNOV

Mise à jour : phases 1 (backend), 2 (frontend web) et 3 (app mobile) livrées.

## ✅ Livré et testé (backend)

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

## ✅ Livré, compilé (frontend web)

React + TypeScript + Tailwind + Leaflet + Recharts — `npm run build` passe.
- [x] Connexion JWT, routes protégées, menu selon le rôle.
- [x] Tableau de bord (3 indicateurs, évolution 14 j, catégories).
- [x] Carte interactive des zones (coordonnées DEMO signalées).
- [x] Gestion caméras / zones / seuils / alertes / utilisateurs.
- [x] Rapports (export CSV + impression PDF).

## ✅ Livré, à compiler sur machine Flutter (app mobile)

Flutter / Dart — « Macro Plastique Balmer ». ⚠️ Le code source est complet mais
**n'a pas pu être compilé dans l'environnement cloud** (SDK Flutter absent) :
à lancer avec `flutter create . && flutter pub get && flutter run` (voir mobile/README.md).
- [x] 6 écrans : Accueil, Carte, Statistiques, Alertes, Nettoyage, Profil.
- [x] Connexion/inscription, rôles, abonnements, géolocalisation facultative.
- [x] Service de notifications push (FCM) documenté, activation en 1 étape.

## 🚧 À venir (phases suivantes)

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
