"""Évaluation de la précision d'un modèle YOLO entraîné.

Calcule les métriques standard (précision, rappel, mAP50, mAP50-95) sur le jeu de
validation/test défini dans classes.yaml.

Exemple :
    python -m app.ai.evaluate --weights runs/balmer/train/weights/best.pt
"""
from __future__ import annotations

import argparse


def main() -> None:  # pragma: no cover (dépend des dépendances IA)
    p = argparse.ArgumentParser(description="Évaluation YOLO L-PLAST-INNOV")
    p.add_argument("--weights", required=True)
    p.add_argument("--data", default="app/ai/classes.yaml")
    p.add_argument("--split", default="test", choices=["val", "test"])
    args = p.parse_args()

    try:
        from ultralytics import YOLO
    except ImportError:
        raise SystemExit("Dépendances IA absentes : pip install ultralytics torch")

    model = YOLO(args.weights)
    metrics = model.val(data=args.data, split=args.split)
    print("Résultats d'évaluation :")
    print(f"  mAP50     : {metrics.box.map50:.3f}")
    print(f"  mAP50-95  : {metrics.box.map:.3f}")
    print(f"  Précision : {metrics.box.mp:.3f}")
    print(f"  Rappel    : {metrics.box.mr:.3f}")


if __name__ == "__main__":
    main()
