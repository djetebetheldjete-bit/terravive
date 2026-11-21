"""Entraînement d'un modèle YOLO sur les déchets de Balmer.

Prérequis : des images ANNOTÉES réparties selon classes.yaml. Sans ces données,
ce script ne peut rien entraîner d'utile — il le signale explicitement.

Exemple :
    python -m app.ai.train --data app/ai/classes.yaml --epochs 100 --model yolov8n.pt
"""
from __future__ import annotations

import argparse
import os


def main() -> None:  # pragma: no cover (dépend des dépendances IA)
    p = argparse.ArgumentParser(description="Entraînement YOLO L-PLAST-INNOV")
    p.add_argument("--data", default="app/ai/classes.yaml")
    p.add_argument("--model", default="yolov8n.pt", help="Modèle de base (transfer learning)")
    p.add_argument("--epochs", type=int, default=100)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--batch", type=int, default=16)
    p.add_argument("--project", default="runs/balmer")
    args = p.parse_args()

    try:
        from ultralytics import YOLO
    except ImportError:
        raise SystemExit(
            "Dépendances IA absentes : pip install ultralytics torch"
        )

    # Garde-fou : vérifier que le jeu d'entraînement existe.
    import yaml

    with open(args.data, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    train_dir = os.path.join(cfg.get("path", "."), cfg.get("train", "train/images"))
    if not os.path.isdir(train_dir) or not os.listdir(train_dir):
        raise SystemExit(
            f"Aucune image d'entraînement dans « {train_dir} ». "
            "Collectez et annotez des images réelles de Balmer avant d'entraîner. "
            "Voir app/ai/README.md."
        )

    model = YOLO(args.model)
    model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        project=args.project,
        name="train",
    )
    print("✅ Entraînement terminé. Poids : runs/balmer/train/weights/best.pt")


if __name__ == "__main__":
    main()
