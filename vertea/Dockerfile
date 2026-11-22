# Dockerfile — recette de la boite (conteneur) AgriScan pour Cloud Run

# Image de base : Python 3.12 (stable et bien supporte par earthengine-api)
FROM python:3.12-slim

# Dossier de travail dans la boite
WORKDIR /app

# Installer les dependances d'abord (mise en cache plus efficace)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copier le reste du code (le .dockerignore exclut la cle et les fichiers inutiles)
COPY . .

# Cloud Run fournit le port via la variable PORT ; gunicorn ecoute dessus.
# 1 worker, 4 threads, timeout large car les calculs GEE peuvent etre longs.
CMD exec gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 120 passerelle:app
