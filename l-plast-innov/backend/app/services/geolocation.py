"""Géolocalisation des déchets : de l'image aux coordonnées géographiques.

Rappel important (cahier des charges) : la position GPS d'une caméra FIXE ne
correspond PAS à la position d'un objet dans son champ de vision. Pour obtenir la
position réelle d'un objet, il faut une CALIBRATION de la caméra : une
homographie qui transforme des coordonnées pixel (x, y) en coordonnées sol
(latitude, longitude).

Ce module fournit :
- `image_to_geo` : applique une homographie 3x3 stockée dans la caméra ;
- `approximate_from_zone` : repli pour les prototypes — on prend le centre de la
  zone, en indiquant CLAIREMENT qu'il s'agit d'une position approximative.

L'homographie se calcule à partir d'au moins 4 points de correspondance
(pixel ↔ GPS relevés sur le terrain). Le calcul des coefficients se fait hors
ligne (script de calibration terrain) ; on stocke ici la matrice résultante.
"""
from __future__ import annotations

import json
from dataclasses import dataclass


@dataclass
class GeoPoint:
    lat: float
    lon: float
    approximate: bool = False
    method: str = "homography"


def image_to_geo(px: float, py: float, homography: list[list[float]]) -> GeoPoint:
    """Applique une homographie 3x3 à un point pixel → (lon, lat).

    Convention : la matrice transforme (x, y, 1) → (lon*w, lat*w, w).
    """
    h = homography
    denom = h[2][0] * px + h[2][1] * py + h[2][2]
    if abs(denom) < 1e-12:
        raise ValueError("Homographie dégénérée (dénominateur nul).")
    lon = (h[0][0] * px + h[0][1] * py + h[0][2]) / denom
    lat = (h[1][0] * px + h[1][1] * py + h[1][2]) / denom
    return GeoPoint(lat=lat, lon=lon, approximate=False, method="homography")


def approximate_from_zone(center_lat: float | None, center_lon: float | None) -> GeoPoint:
    """Repli prototype : centre de la zone, marqué APPROXIMATIF."""
    return GeoPoint(
        lat=center_lat if center_lat is not None else 0.0,
        lon=center_lon if center_lon is not None else 0.0,
        approximate=True,
        method="zone_center_approx",
    )


def locate_detection(
    *,
    bbox: list[float] | None,
    camera_calibration_json: str | None,
    zone_center_lat: float | None,
    zone_center_lon: float | None,
) -> GeoPoint:
    """Résout la position d'une détection selon ce qui est disponible.

    1. Si la caméra est calibrée (homographie) et qu'on a une bbox → position
       précise (point bas-centre de la bbox, au niveau du sol).
    2. Sinon → position approximative = centre de zone (clairement marquée).
    """
    if camera_calibration_json and bbox:
        try:
            calib = json.loads(camera_calibration_json)
            h = calib.get("homography")
            if h:
                x, y, w, hgt = bbox
                foot_x = x + w / 2.0        # centre horizontal
                foot_y = y + hgt            # bas de la boîte (contact au sol)
                return image_to_geo(foot_x, foot_y, h)
        except (ValueError, KeyError, TypeError):
            pass
    return approximate_from_zone(zone_center_lat, zone_center_lon)
