# Module IA — détection des macro-déchets plastiques (YOLO)

Ce module fournit la **chaîne complète** de détection d'objets par YOLO :
entraînement, inférence, évaluation. Il est volontairement **honnête** sur son état.

## ⚠️ État réel du modèle

> Aucun modèle n'est, à ce jour, entraîné sur les déchets de la plage de Balmer.
> Aucune base d'images annotées de Balmer n'est fournie dans ce dépôt.

Par défaut, l'inférence utilise un modèle **pré-entraîné générique** (YOLO COCO),
qui ne connaît PAS les catégories de déchets du projet. Il sert uniquement à
valider la chaîne technique, **pas** à produire des détections fiables de déchets.

Pour obtenir un modèle utile à Balmer, il faut :
1. Collecter et **annoter** des images réelles de la plage (catégories du projet).
2. Les répartir dans `datasets/balmer/{train,val,test}` (voir `classes.yaml`).
3. Entraîner : `python -m app.ai.train --data app/ai/classes.yaml --epochs 100`.
4. Évaluer : `python -m app.ai.evaluate --weights runs/.../best.pt`.
5. Déployer : copier `best.pt` et pointer `LPLAST_YOLO_WEIGHTS` dessus.

## Installation des dépendances IA (lourdes, séparées)

```bash
pip install ultralytics opencv-python-headless torch
```

## Catégories

Définies dans `classes.yaml` (extensible). Elles correspondent aux
`WasteCategory.code` de la base de données :

`plastic_bottle, plastic_bag, food_packaging, plastic_cap, plastic_fragment,
other_plastic, non_plastic, unidentified`

## Du détecteur au serveur central

`inference.py` produit, pour chaque objet détecté, un dictionnaire prêt à être
envoyé à l'API `/api/v1/detections/ingest` (catégorie, bbox, confiance, et —
après calibration de la caméra — latitude/longitude). Le **suivi d'objets**
(tracking, attribution d'un `track_uid` stable) et l'anti-double-comptage sont
assurés côté serveur central par `app/services/tracking.py` ; `inference.py`
peut aussi utiliser le tracker intégré d'Ultralytics pour fournir un `track_uid`.
