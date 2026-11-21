"""Inférence YOLO : détecter des déchets sur une image et produire des événements.

S'importe SANS ultralytics installé (pour ne pas casser le backend léger). Les
fonctions qui exécutent réellement un modèle lèvent une erreur explicite si les
dépendances IA manquent.

Sortie normalisée par détection (prête pour POST /api/v1/detections/ingest) :
    {
      "category_code": "plastic_bottle",
      "confidence": 0.87,
      "bbox": [x, y, w, h],          # pixels
      "track_uid": "cam1-42",         # si tracking activé
      "lat": None, "lon": None,       # à remplir via calibration (voir geolocation)
    }
"""
from __future__ import annotations

import os
from dataclasses import asdict, dataclass

# Index → code catégorie (doit rester cohérent avec classes.yaml et la base).
CLASS_CODES = [
    "plastic_bottle",
    "plastic_bag",
    "food_packaging",
    "plastic_cap",
    "plastic_fragment",
    "other_plastic",
    "non_plastic",
    "unidentified",
]

# Poids par défaut : modèle GÉNÉRIQUE (ne connaît pas les déchets de Balmer).
DEFAULT_WEIGHTS = os.environ.get("LPLAST_YOLO_WEIGHTS", "yolov8n.pt")


@dataclass
class DetectionDict:
    category_code: str
    confidence: float
    bbox: list[float]
    track_uid: str | None = None
    lat: float | None = None
    lon: float | None = None


def _require_ultralytics():
    try:
        from ultralytics import YOLO  # noqa: F401
    except ImportError as e:  # pragma: no cover
        raise RuntimeError(
            "Dépendances IA absentes. Installez-les : "
            "pip install ultralytics opencv-python-headless torch"
        ) from e


class WasteDetector:
    """Encapsule un modèle YOLO pour la détection de déchets."""

    def __init__(self, weights: str | None = None, conf: float = 0.35):
        self.weights = weights or DEFAULT_WEIGHTS
        self.conf = conf
        self._model = None
        self._is_generic = self.weights in ("yolov8n.pt", "yolov8s.pt", "yolov8m.pt")

    def load(self):
        _require_ultralytics()
        from ultralytics import YOLO

        self._model = YOLO(self.weights)
        return self

    def _map_class(self, cls_index: int, cls_name: str) -> str:
        """Associe la classe du modèle à un code catégorie du projet.

        Avec un modèle spécifique Balmer, l'indice correspond directement à
        CLASS_CODES. Avec un modèle générique (COCO), on ne connaît pas les
        déchets : tout est classé `unidentified` pour ne rien affirmer à tort.
        """
        if self._is_generic:
            return "unidentified"
        if 0 <= cls_index < len(CLASS_CODES):
            return CLASS_CODES[cls_index]
        return "unidentified"

    def predict_image(self, image_path: str, track: bool = False) -> list[dict]:
        if self._model is None:
            self.load()
        if track:
            results = self._model.track(image_path, conf=self.conf, persist=True, verbose=False)
        else:
            results = self._model.predict(image_path, conf=self.conf, verbose=False)

        out: list[dict] = []
        for r in results:
            names = r.names
            for box in r.boxes:
                cls_index = int(box.cls[0])
                cls_name = names.get(cls_index, str(cls_index))
                x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
                track_id = None
                if getattr(box, "id", None) is not None:
                    track_id = f"cam-{int(box.id[0])}"
                out.append(
                    asdict(
                        DetectionDict(
                            category_code=self._map_class(cls_index, cls_name),
                            confidence=round(float(box.conf[0]), 3),
                            bbox=[x1, y1, x2 - x1, y2 - y1],
                            track_uid=track_id,
                        )
                    )
                )
        return out


if __name__ == "__main__":  # pragma: no cover
    import argparse
    import json

    p = argparse.ArgumentParser(description="Inférence YOLO L-PLAST-INNOV")
    p.add_argument("image")
    p.add_argument("--weights", default=None)
    p.add_argument("--track", action="store_true")
    args = p.parse_args()
    det = WasteDetector(weights=args.weights).load()
    print(json.dumps(det.predict_image(args.image, track=args.track), indent=2))
