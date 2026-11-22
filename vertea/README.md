# Vertea — moteur satellite de Terravive

Service Python (Flask + Google Earth Engine) appelé **uniquement par le serveur Terravive** (`/api/sat/*`).
Il calcule sur la zone d'une parcelle : NDVI (Sentinel-2, nuages masqués pixel par pixel), évolution et
anomalie du NDVI, besoin en eau FAO-56 (ERA5-Land + CHIRPS), conseil de plantation, et fournit les
séries climatiques journalières d'un point (`/climat` : pluie CHIRPS, températures ERA5-Land).

## Variables d'environnement
| Variable | Rôle |
| --- | --- |
| `GEE_KEY_JSON` | Contenu de la clé du compte de service Earth Engine (ou `GEE_KEY_FILE` : chemin d'un fichier secret) |
| `GEE_PROJECT` | Projet Google Cloud (par défaut celui du prototype) |
| `VERTEA_TOKEN` | Jeton partagé avec Terravive : si défini, les requêtes sans ce jeton sont refusées (401) |

La clé n'est **jamais** dans le dépôt (`.dockerignore`, `.gitignore`).

## Déploiement
Render lit `render.yaml` à la racine du dépôt : service Docker `vertea` (dossier `vertea/`).
Côté Terravive, renseigner `VERTEA_URL` (adresse du service) et le même `VERTEA_TOKEN`.
