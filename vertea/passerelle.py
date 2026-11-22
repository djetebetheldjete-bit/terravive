# passerelle.py — Vertea, moteur satellite de Terravive (Google Earth Engine)
# Intégré au dépôt Terravive (dossier vertea/) et appelé par le serveur Terravive (/api/sat/*).
# Routes :
#   - /climat      : séries journalières pluie CHIRPS + températures ERA5-Land d'un point (indices climatiques)
#   - /            : sert la page web (index.html)
#   - /ndvi        : carte NDVI + NDVI moyen + surface + repartition sain/moyen/faible
#   - /evolution   : serie temporelle du NDVI moyen (pas mois ou semaine)
#   - /anomalie    : detection de changement (recent - reference)
#
# Double mode d'authentification Earth Engine :
#   - En ligne / avec cle : si le fichier cle-service.json existe (ou variable
#     d'environnement GEE_KEY_FILE), on utilise le COMPTE DE SERVICE.
#   - En local : sinon, on retombe sur l'authentification personnelle (ee.Initialize).

import os
import json
import tempfile
from datetime import datetime, timezone
import ee
from flask import Flask, request, jsonify, send_from_directory, abort
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ===== Parametres =====
PROJET = os.environ.get("GEE_PROJECT", "ambient-fuze-428510-q0")
# Chemin de la cle du compte de service (peut etre surcharge par une variable d'env)
CLE_SERVICE = os.environ.get("GEE_KEY_FILE", "cle-service.json")
# Sur Render, la cle peut aussi etre donnee en contenu (variable GEE_KEY_JSON) : on l'ecrit dans un
# fichier temporaire, jamais dans le depot.
if os.environ.get("GEE_KEY_JSON") and not os.path.exists(CLE_SERVICE):
    _tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    _tmp.write(os.environ["GEE_KEY_JSON"]); _tmp.close()
    CLE_SERVICE = _tmp.name
# Jeton partage avec le serveur Terravive (VERTEA_TOKEN). S'il est defini, toute requete POST doit
# le presenter : le moteur satellite n'est alors utilisable que par Terravive.
JETON = os.environ.get("VERTEA_TOKEN", "")


@app.before_request
def verifier_jeton():
    if JETON and request.method == "POST" and request.headers.get("X-Vertea-Token", "") != JETON:
        abort(401)

# ===== Seuils configurables =====
SEUIL_FAIBLE = 0.3
SEUIL_SAIN   = 0.5
SEUIL_ANOMALIE = 0.1


def initialiser_gee():
    """
    Initialise Earth Engine.
    - Si une cle de compte de service est disponible -> on l'utilise (mode serveur).
    - Sinon -> authentification personnelle locale (mode developpement).
    """
    if os.path.exists(CLE_SERVICE):
        credentials = ee.ServiceAccountCredentials(None, CLE_SERVICE)
        ee.Initialize(credentials, project=PROJET)
        print("Google Earth Engine initialise via COMPTE DE SERVICE \u2713")
    else:
        ee.Initialize(project=PROJET)
        print("Google Earth Engine initialise via auth personnelle \u2713")


try:
    initialiser_gee()
except Exception as e:
    print("GEE non initialise. Detail:", e)


def construire_zone(data):
    """Construit la geometrie GEE (rectangle bbox OU polygone)."""
    polygone = data.get("polygon")
    if polygone:
        if len(polygone) < 3:
            return None, "Polygone invalide : il faut au moins 3 points."
        return ee.Geometry.Polygon([polygone]), None
    coords = data.get("bbox")
    if coords and len(coords) == 4:
        return ee.Geometry.Rectangle(coords), None
    return None, "Zone invalide. Envoie un 'bbox' [ouest, sud, est, nord] ou un 'polygon' [[lng,lat],...]."


def lire_cle(resultat_reduce, cle, defaut=None):
    """
    Lit une cle d'un ee.Dictionary (resultat d'un reduceRegion) SANS planter.
    Important : on fait .getInfo() sur TOUT le dictionnaire puis on lit la cle cote
    Python. Appeler .get('NDVI') directement sur l'ee.Dictionary leve l'erreur
    'Dictionary does not contain key' quand la bande est absente (petite parcelle,
    image vide, nuages). Ici on renvoie simplement le defaut dans ce cas.
    """
    try:
        d = resultat_reduce.getInfo() or {}
    except Exception:
        return defaut
    v = d.get(cle)
    return v if v is not None else defaut


def zone_avec_marge(zone, metres=20):
    """Tampon leger autour de la zone : garantit qu'au moins un pixel est couvert
    meme pour une toute petite parcelle (plus petite qu'un pixel satellite)."""
    try:
        return zone.buffer(metres)
    except Exception:
        return zone


def masque_nuages_s2(image):
    """
    Masque les nuages, ombres de nuages et cirrus PIXEL PAR PIXEL grace a la bande
    SCL (Scene Classification) de Sentinel-2. CRUCIAL : sans ce masque, un nuage ou
    un voile fait chuter le NDVI (reflectance elevee partout) et une zone bien verte
    ressort a tort en ROUGE / NDVI tres faible. On ne garde que les pixels utiles :
      4=vegetation, 5=sol nu, 6=eau, 7=non classe, 11=neige.
    On retire : 0=no data, 1=sature, 2=ombre sombre, 3=ombre de nuage,
      8=nuage (proba moyenne), 9=nuage (proba haute), 10=cirrus.
    """
    scl = image.select("SCL")
    bon = (scl.eq(4).Or(scl.eq(5)).Or(scl.eq(6)).Or(scl.eq(7)).Or(scl.eq(11)))
    return image.updateMask(bon)


def collection_ndvi(zone, date_debut, date_fin, seuil_nuages=60):
    """Collection Sentinel-2 filtree + masque nuages par pixel, avec bande NDVI ajoutee."""
    def ajouter_ndvi(image):
        image = masque_nuages_s2(image)
        ndvi = image.normalizedDifference(["B8", "B4"]).rename("NDVI")
        return image.addBands(ndvi)
    return (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(zone)
            .filterDate(date_debut, date_fin)
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", seuil_nuages))
            .map(ajouter_ndvi))


def collection_ndvi_robuste(zone, date_debut, date_fin):
    """
    Trouve des images NDVI nettes meme quand la fenetre demandee est vide
    (petite zone, periode courte, beaucoup de nuages). On elargit progressivement :
      1) fenetre demandee, nuages < 20 %
      2) on recule le debut jusqu'a 120 jours avant la fin
      3) on relache le seuil de nuages (40 % puis 60 %)
    Renvoie (collection, info) ou (None, message) si vraiment rien n'est captable.
    """
    from datetime import datetime, timedelta
    try:
        fin_dt = datetime.strptime(date_fin[:10], "%Y-%m-%d")
    except Exception:
        fin_dt = None

    # Les nuages etant retires PIXEL PAR PIXEL (masque SCL), on tolere des scenes
    # assez nuageuses (60 %) : plus d'images = meilleure mediane de pixels clairs.
    essais = [(date_debut, 60)]
    if fin_dt is not None:
        for recul in (90, 180, 365):
            d = (fin_dt - timedelta(days=recul)).strftime("%Y-%m-%d")
            essais.append((d, 60))
            essais.append((d, 100))

    for d_debut, seuil in essais:
        col = collection_ndvi(zone, d_debut, date_fin, seuil_nuages=seuil)
        try:
            n = col.size().getInfo()
        except Exception:
            n = 0
        if n and n > 0:
            return col, {"images": n, "depuis": d_debut, "nuages_max": seuil}
    return None, ("Aucune image satellite nette (Sentinel-2) sur cette parcelle, meme en "
                  "elargissant la periode et en tolerant plus de nuages. Reessaie avec une "
                  "parcelle un peu plus grande ou une autre periode.")


def calculer_stats(ndvi_image, zone):
    """Surface (ha) + repartition sain/moyen/faible (%)."""
    classe = (ndvi_image.gte(SEUIL_FAIBLE)
              .add(ndvi_image.gte(SEUIL_SAIN))
              .rename("classe"))
    histo = lire_cle(classe.reduceRegion(
        reducer=ee.Reducer.frequencyHistogram(),
        geometry=zone, scale=10, maxPixels=1e9, bestEffort=True
    ), "classe", {}) or {}

    n_faible = histo.get("0", 0); n_moyen = histo.get("1", 0); n_sain = histo.get("2", 0)
    total = n_faible + n_moyen + n_sain
    if total > 0:
        pct_faible = round(100 * n_faible / total, 1)
        pct_moyen  = round(100 * n_moyen  / total, 1)
        pct_sain   = round(100 * n_sain   / total, 1)
    else:
        pct_faible = pct_moyen = pct_sain = None

    aire_m2 = zone.area(maxError=1).getInfo()
    return {
        "surface_ha": round(aire_m2 / 10000, 2),
        "pct_sain": pct_sain, "pct_moyen": pct_moyen, "pct_faible": pct_faible
    }



# ======================================================================
#  IRRIGATION — besoin en eau des cultures (methode FAO-56)
#  ET0 (Penman-Monteith, formule validee) x Kc - pluie efficace
# ======================================================================

import math as _math

# --- Coefficients culturaux Kc (FAO-56) et durees de phases (jours) ---
# Phases : initiale, developpement, mi-saison, fin
# Source : FAO-56 (Tables 11 & 12). Valeurs arrondies, adaptees au climat tropical
# de Cote d'Ivoire. Pour les perennes (cacao, cafe, palmier...), Kc est pris ~constant.
CULTURES = {
    # --- Maraichage ---
    "tomate":    {"kc_ini": 0.60, "kc_mid": 1.15, "kc_end": 0.80, "d_ini": 30, "d_dev": 40, "d_mid": 40, "d_fin": 25},
    "concombre": {"kc_ini": 0.60, "kc_mid": 1.00, "kc_end": 0.75, "d_ini": 20, "d_dev": 30, "d_mid": 40, "d_fin": 15},
    "piment":    {"kc_ini": 0.60, "kc_mid": 1.05, "kc_end": 0.90, "d_ini": 30, "d_dev": 35, "d_mid": 40, "d_fin": 20},
    "poivron":   {"kc_ini": 0.60, "kc_mid": 1.05, "kc_end": 0.90, "d_ini": 30, "d_dev": 35, "d_mid": 40, "d_fin": 20},
    "laitue":    {"kc_ini": 0.70, "kc_mid": 1.00, "kc_end": 0.95, "d_ini": 20, "d_dev": 30, "d_mid": 15, "d_fin": 10},
    "chou":      {"kc_ini": 0.70, "kc_mid": 1.05, "kc_end": 0.95, "d_ini": 40, "d_dev": 60, "d_mid": 50, "d_fin": 15},
    "carotte":   {"kc_ini": 0.70, "kc_mid": 1.05, "kc_end": 0.95, "d_ini": 20, "d_dev": 30, "d_mid": 50, "d_fin": 20},
    "oignon":    {"kc_ini": 0.70, "kc_mid": 1.05, "kc_end": 0.75, "d_ini": 15, "d_dev": 25, "d_mid": 70, "d_fin": 40},
    "aubergine": {"kc_ini": 0.60, "kc_mid": 1.05, "kc_end": 0.90, "d_ini": 30, "d_dev": 40, "d_mid": 40, "d_fin": 20},
    "gombo":     {"kc_ini": 0.60, "kc_mid": 1.10, "kc_end": 0.90, "d_ini": 25, "d_dev": 35, "d_mid": 40, "d_fin": 20},
    "epinard":   {"kc_ini": 0.70, "kc_mid": 1.00, "kc_end": 0.95, "d_ini": 20, "d_dev": 20, "d_mid": 15, "d_fin": 5},
    "courgette": {"kc_ini": 0.50, "kc_mid": 1.00, "kc_end": 0.80, "d_ini": 25, "d_dev": 35, "d_mid": 25, "d_fin": 15},
    "pasteque":  {"kc_ini": 0.40, "kc_mid": 1.00, "kc_end": 0.75, "d_ini": 20, "d_dev": 30, "d_mid": 30, "d_fin": 30},
    "melon":     {"kc_ini": 0.50, "kc_mid": 1.05, "kc_end": 0.75, "d_ini": 25, "d_dev": 35, "d_mid": 40, "d_fin": 20},
    "haricot vert": {"kc_ini": 0.50, "kc_mid": 1.05, "kc_end": 0.90, "d_ini": 20, "d_dev": 30, "d_mid": 30, "d_fin": 10},
    # --- Legumineuses & grandes cultures ---
    "arachide":  {"kc_ini": 0.40, "kc_mid": 1.15, "kc_end": 0.60, "d_ini": 25, "d_dev": 35, "d_mid": 45, "d_fin": 25},
    "niebe":     {"kc_ini": 0.40, "kc_mid": 1.05, "kc_end": 0.60, "d_ini": 20, "d_dev": 30, "d_mid": 30, "d_fin": 20},
    "soja":      {"kc_ini": 0.40, "kc_mid": 1.15, "kc_end": 0.50, "d_ini": 20, "d_dev": 35, "d_mid": 60, "d_fin": 25},
    "sesame":    {"kc_ini": 0.35, "kc_mid": 1.10, "kc_end": 0.25, "d_ini": 20, "d_dev": 30, "d_mid": 40, "d_fin": 20},
    # --- Cereales ---
    "mais":      {"kc_ini": 0.30, "kc_mid": 1.20, "kc_end": 0.60, "d_ini": 25, "d_dev": 40, "d_mid": 45, "d_fin": 30},
    "mais doux": {"kc_ini": 0.30, "kc_mid": 1.15, "kc_end": 1.05, "d_ini": 20, "d_dev": 30, "d_mid": 30, "d_fin": 10},
    "riz":       {"kc_ini": 1.05, "kc_mid": 1.20, "kc_end": 0.75, "d_ini": 30, "d_dev": 30, "d_mid": 60, "d_fin": 30},
    "sorgho":    {"kc_ini": 0.30, "kc_mid": 1.05, "kc_end": 0.55, "d_ini": 20, "d_dev": 35, "d_mid": 40, "d_fin": 30},
    "mil":       {"kc_ini": 0.30, "kc_mid": 1.00, "kc_end": 0.30, "d_ini": 15, "d_dev": 25, "d_mid": 40, "d_fin": 25},
    # --- Racines & tubercules ---
    "manioc":    {"kc_ini": 0.30, "kc_mid": 0.80, "kc_end": 0.50, "d_ini": 30, "d_dev": 60, "d_mid": 120, "d_fin": 60},
    "igname":    {"kc_ini": 0.50, "kc_mid": 1.10, "kc_end": 0.95, "d_ini": 30, "d_dev": 60, "d_mid": 120, "d_fin": 40},
    "patate douce": {"kc_ini": 0.50, "kc_mid": 1.15, "kc_end": 0.65, "d_ini": 20, "d_dev": 30, "d_mid": 60, "d_fin": 30},
    "pomme de terre": {"kc_ini": 0.50, "kc_mid": 1.15, "kc_end": 0.75, "d_ini": 25, "d_dev": 30, "d_mid": 45, "d_fin": 30},
    "taro":      {"kc_ini": 0.50, "kc_mid": 1.10, "kc_end": 0.95, "d_ini": 30, "d_dev": 60, "d_mid": 90, "d_fin": 40},
    "gingembre": {"kc_ini": 0.50, "kc_mid": 1.10, "kc_end": 0.90, "d_ini": 30, "d_dev": 60, "d_mid": 90, "d_fin": 40},
    # --- Industrielles & perennes (Kc ~ constant) ---
    "coton":     {"kc_ini": 0.35, "kc_mid": 1.15, "kc_end": 0.70, "d_ini": 30, "d_dev": 50, "d_mid": 55, "d_fin": 45},
    "canne a sucre": {"kc_ini": 0.40, "kc_mid": 1.25, "kc_end": 0.75, "d_ini": 35, "d_dev": 60, "d_mid": 190, "d_fin": 120},
    "banane":    {"kc_ini": 0.50, "kc_mid": 1.10, "kc_end": 1.00, "d_ini": 120, "d_dev": 90, "d_mid": 120, "d_fin": 60},
    "banane plantain": {"kc_ini": 0.50, "kc_mid": 1.10, "kc_end": 1.00, "d_ini": 120, "d_dev": 90, "d_mid": 120, "d_fin": 60},
    "ananas":    {"kc_ini": 0.50, "kc_mid": 0.30, "kc_end": 0.30, "d_ini": 60, "d_dev": 120, "d_mid": 600, "d_fin": 10},
    "cacao":     {"kc_ini": 1.00, "kc_mid": 1.05, "kc_end": 1.00, "d_ini": 60, "d_dev": 60, "d_mid": 240, "d_fin": 5},
    "cafe":      {"kc_ini": 0.90, "kc_mid": 0.95, "kc_end": 0.95, "d_ini": 60, "d_dev": 60, "d_mid": 240, "d_fin": 5},
    "palmier a huile": {"kc_ini": 0.95, "kc_mid": 1.00, "kc_end": 1.00, "d_ini": 60, "d_dev": 60, "d_mid": 240, "d_fin": 5},
    "hevea":     {"kc_ini": 0.95, "kc_mid": 1.00, "kc_end": 1.00, "d_ini": 60, "d_dev": 60, "d_mid": 240, "d_fin": 5},
    "anacarde":  {"kc_ini": 0.85, "kc_mid": 0.90, "kc_end": 0.90, "d_ini": 60, "d_dev": 60, "d_mid": 240, "d_fin": 5},
    "mangue":    {"kc_ini": 0.80, "kc_mid": 0.85, "kc_end": 0.85, "d_ini": 60, "d_dev": 60, "d_mid": 240, "d_fin": 5},
    "papaye":    {"kc_ini": 0.80, "kc_mid": 1.00, "kc_end": 0.90, "d_ini": 60, "d_dev": 90, "d_mid": 180, "d_fin": 30},
    "agrumes":   {"kc_ini": 0.70, "kc_mid": 0.65, "kc_end": 0.70, "d_ini": 60, "d_dev": 90, "d_mid": 180, "d_fin": 30},
}

# Coefficients generiques (toute culture inconnue) : valeurs FAO-56 moyennes d'un
# legume/culture annuelle. Permet de ne JAMAIS bloquer sur une culture non listee.
KC_GENERIQUE = {"kc_ini": 0.50, "kc_mid": 1.05, "kc_end": 0.80,
                "d_ini": 25, "d_dev": 35, "d_mid": 40, "d_fin": 25}

# Synonymes / orthographes courantes -> cle canonique de CULTURES / EXIGENCES.
ALIAS_CULTURE = {
    "mais": "mais", "maïs": "mais", "corn": "mais", "mais grain": "mais",
    "maïs doux": "mais doux", "sweet corn": "mais doux",
    "piment": "piment", "poivron": "poivron", "pepper": "piment",
    "haricot": "niebe", "haricots": "niebe", "niebe": "niebe", "niébé": "niebe",
    "haricot vert": "haricot vert",
    "arachide": "arachide", "peanut": "arachide", "cacahuete": "arachide",
    "manioc": "manioc", "cassava": "manioc",
    "igname": "igname", "yam": "igname",
    "patate douce": "patate douce", "patate": "patate douce", "sweet potato": "patate douce",
    "pomme de terre": "pomme de terre", "potato": "pomme de terre",
    "gombo": "gombo", "okra": "gombo",
    "aubergine": "aubergine", "aubergine africaine": "aubergine", "gnagnan": "aubergine",
    "pasteque": "pasteque", "pastèque": "pasteque", "melon d'eau": "pasteque",
    "banane": "banane", "banane plantain": "banane plantain", "plantain": "banane plantain",
    "canne": "canne a sucre", "canne a sucre": "canne a sucre", "canne à sucre": "canne a sucre",
    "palmier": "palmier a huile", "palmier a huile": "palmier a huile", "palmier à huile": "palmier a huile",
    "cafe": "cafe", "café": "cafe", "cacao": "cacao", "cajou": "anacarde", "anacarde": "anacarde",
    "orange": "agrumes", "citron": "agrumes", "agrume": "agrumes", "agrumes": "agrumes",
    "riz": "riz", "sorgho": "sorgho", "mil": "mil", "soja": "soja", "sesame": "sesame", "sésame": "sesame",
}


def _norm_nom(nom):
    """Minuscule + sans accents, pour comparer les noms de culture."""
    import unicodedata
    s = (nom or "").strip().lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s


def get_culture(nom):
    """
    Renvoie (donnees_kc, nom_canonique, est_generique) pour N'IMPORTE QUELLE culture.
    - Si la culture est connue (directement ou via un synonyme) -> ses coefficients.
    - Sinon -> coefficients generiques (jamais de blocage), est_generique=True.
    """
    brut = _norm_nom(nom)
    # resolution via alias (compare aussi la version sans accents des cles d'alias)
    cle = ALIAS_CULTURE.get(nom.strip().lower()) if nom else None
    if not cle:
        for k, v in ALIAS_CULTURE.items():
            if _norm_nom(k) == brut:
                cle = v
                break
    if not cle:
        cle = brut
    if cle in CULTURES:
        return CULTURES[cle], cle, False
    return KC_GENERIQUE, (brut or "culture"), True


def kc_du_jour(culture, jours_depuis_semis):
    """
    Renvoie (Kc, nom_du_stade) selon le nombre de jours depuis le semis.
    Interpolation lineaire pendant les phases de transition (FAO-56).
    Accepte n'importe quelle culture (repli generique si inconnue).
    """
    c, _cle, _gen = get_culture(culture)
    d_ini, d_dev, d_mid, d_fin = c["d_ini"], c["d_dev"], c["d_mid"], c["d_fin"]
    kc_ini, kc_mid, kc_end = c["kc_ini"], c["kc_mid"], c["kc_end"]
    j = jours_depuis_semis

    fin_ini = d_ini
    fin_dev = d_ini + d_dev
    fin_mid = d_ini + d_dev + d_mid
    fin_tot = d_ini + d_dev + d_mid + d_fin

    if j < 0:
        return kc_ini, "avant semis"
    if j <= fin_ini:
        return kc_ini, "initiale"
    if j <= fin_dev:
        # montee lineaire de kc_ini vers kc_mid
        frac = (j - fin_ini) / d_dev
        return kc_ini + frac * (kc_mid - kc_ini), "developpement"
    if j <= fin_mid:
        return kc_mid, "mi-saison"
    if j <= fin_tot:
        # descente lineaire de kc_mid vers kc_end
        frac = (j - fin_mid) / d_fin
        return kc_mid + frac * (kc_end - kc_mid), "fin de saison"
    return kc_end, "apres recolte"


def pluie_efficace(pluie_mm):
    """
    Pluie efficace (FAO / USDA-SCS, forme simplifiee mensuelle ramenee).
    On applique un abattement : toute la pluie n'est pas utilisable.
    Regle USDA-SCS simplifiee au pas considere.
    """
    if pluie_mm <= 0:
        return 0.0
    # Approche simple et prudente : 80% de la pluie est efficace jusqu'a un plafond,
    # au-dela le surplus ruisselle. (parametrable)
    return round(min(pluie_mm * 0.8, pluie_mm), 2)


def calcul_et0_gee(zone, date_debut, date_fin):
    """
    Calcule ET0 (mm/jour, moyenne sur la periode) sur GEE avec ERA5-Land,
    en appliquant la formule Penman-Monteith FAO-56 VALIDEE.
    Renvoie une image ET0 (moyenne periode) clippee sur la zone.
    """
    col = (ee.ImageCollection("ECMWF/ERA5_LAND/DAILY_AGGR")
           .filterDate(date_debut, date_fin)
           .filterBounds(zone))

    def et0_image(img):
        # --- Temperatures (K -> C) ---
        tmax = img.select("temperature_2m_max").subtract(273.15)
        tmin = img.select("temperature_2m_min").subtract(273.15)
        tmean = tmax.add(tmin).divide(2)
        tdew = img.select("dewpoint_temperature_2m").subtract(273.15)

        # --- Vent 10m -> 2m (FAO-56 eq.47) ---
        u10 = img.select("u_component_of_wind_10m")
        v10 = img.select("v_component_of_wind_10m")
        vent10 = u10.hypot(v10)  # racine(u^2+v^2)
        u2 = vent10.multiply(4.87).divide(_math.log(67.8 * 10 - 5.42))

        # --- Pressions de vapeur (kPa) ---
        # e0(T) = 0.6108*exp(17.27*T/(T+237.3))
        def e0(t):
            return t.multiply(17.27).divide(t.add(237.3)).exp().multiply(0.6108)
        es = e0(tmax).add(e0(tmin)).divide(2)
        ea = e0(tdew)  # ea depuis le point de rosee (FAO-56)

        # --- Pente Delta (kPa/C) ---
        delta = (e0(tmean).multiply(4098)
                 .divide(tmean.add(237.3).pow(2)))

        # --- Constante psychrometrique gamma ---
        # P depuis altitude ~ on prend P standard via ERA5 surface_pressure si dispo,
        # sinon approximation. Ici on utilise surface_pressure (Pa -> kPa).
        P = img.select("surface_pressure").divide(1000)
        gamma = P.multiply(0.000665)

        # --- Rayonnement net Rn (J/m2 -> MJ/m2/jour) fourni par ERA5 ---
        rns = img.select("surface_net_solar_radiation_sum").divide(1e6)
        rnl = img.select("surface_net_thermal_radiation_sum").divide(1e6)
        Rn = rns.add(rnl)  # net total (thermal est generalement negatif)
        G = 0

        # --- Penman-Monteith FAO-56 (eq.6) ---
        num = (delta.multiply(0.408).multiply(Rn.subtract(G))
               .add(gamma.multiply(tmean.add(273).pow(-1).multiply(900))
                    .multiply(u2).multiply(es.subtract(ea))))
        den = delta.add(gamma.multiply(u2.multiply(0.34).add(1)))
        et0 = num.divide(den).rename("ET0")
        return et0.copyProperties(img, ["system:time_start"])

    # On decoupe avec une MARGE de 30 km : ERA5-Land (~11 km) peut masquer les pixels
    # cotiers (eau) d'une petite parcelle au bord de mer (ex. San-Pedro). Avec la marge,
    # on garde des pixels terrestres voisins pour lire une ET0 representative.
    return col.map(et0_image).mean().clip(zone_avec_marge(zone, 30000))



def lire_et0_moyen(et0_img, zone):
    """
    Lit la valeur ET0 moyenne de facon ROBUSTE, meme pour de petites zones.
    ERA5-Land a une resolution ~11 km : sur une petite parcelle, reduceRegion
    peut ne rien capter. On essaie plusieurs echelles, puis on retombe sur le
    centroide de la zone si necessaire.
    """
    # 1) Sur la parcelle elle-meme, a plusieurs echelles.
    for sc in (1000, 5000, 11132):
        val = lire_cle(et0_img.reduceRegion(
            reducer=ee.Reducer.mean(), geometry=zone,
            scale=sc, maxPixels=1e9, bestEffort=True
        ), "ET0")
        if val is not None:
            return val
    # 2) Parcelle trop petite ou cotiere (pixels masques) : on moyenne sur un TAMPON
    #    croissant pour capter les pixels terrestres ERA5 voisins (climat ~identique).
    for marge in (5000, 15000, 30000):
        val = lire_cle(et0_img.reduceRegion(
            reducer=ee.Reducer.mean(), geometry=zone_avec_marge(zone, marge),
            scale=11132, maxPixels=1e9, bestEffort=True
        ), "ET0")
        if val is not None:
            return val
    # 3) Dernier recours : moyenne autour du centre de la parcelle.
    centre = zone.centroid(maxError=1)
    val = lire_cle(et0_img.reduceRegion(
        reducer=ee.Reducer.mean(), geometry=zone_avec_marge(centre, 15000),
        scale=11132, maxPixels=1e9, bestEffort=True
    ), "ET0")
    return val


@app.route("/irrigation", methods=["POST"])
def calculer_irrigation():
    data = request.get_json()
    zone, erreur = construire_zone(data)
    if erreur:
        return jsonify({"erreur": erreur}), 400

    culture = (data.get("culture") or "").strip()
    if not culture:
        return jsonify({"erreur": "Indique une culture (ex. tomate, mais, riz, arachide...)."}), 400
    # Toute culture est acceptee : si elle n'est pas dans la table, on utilise des
    # coefficients FAO-56 generiques (comme l'itineraire technique, aucune restriction).
    _kcdata, culture_canon, est_generique = get_culture(culture)

    date_semis = data.get("date_semis")
    if not date_semis:
        return jsonify({"erreur": "Fournis la date de semis (date_semis, format AAAA-MM-JJ)."}), 400

    # Periode d'analyse : 7 derniers jours de la periode fournie (ou 7 j avant date_fin)
    date_fin = data.get("date_fin", "2024-12-31")

    try:
        from datetime import datetime, timedelta
        fin_dt = datetime.strptime(date_fin, "%Y-%m-%d")
        semis_dt = datetime.strptime(date_semis, "%Y-%m-%d")
        jours_semis = (fin_dt - semis_dt).days

        # Kc selon le stade
        kc, stade = kc_du_jour(culture, jours_semis)

        # ET0 : on cherche les images ERA5 DISPONIBLES dans une fenetre elargie
        # (60 jours avant date_fin). Si fin decembre manque, on prend ce qui existe.
        debut_dt = fin_dt - timedelta(days=60)
        col_test = (ee.ImageCollection("ECMWF/ERA5_LAND/DAILY_AGGR")
                    .filterDate(debut_dt.strftime("%Y-%m-%d"), date_fin)
                    .filterBounds(zone))
        n_images = col_test.size().getInfo()
        if n_images == 0:
            return jsonify({"erreur": "Aucune donnee ERA5 disponible pour cette periode. "
                                      "ERA5 a un delai de mise a jour : choisis une periode "
                                      "d'il y a au moins 1 a 2 mois (ex. fin en 2024)."}), 400

        # ET0 moyen (mm/j) sur les images disponibles
        et0_img = calcul_et0_gee(zone, debut_dt.strftime("%Y-%m-%d"), date_fin)
        try:
            et0_moy = lire_et0_moyen(et0_img, zone)
        except Exception as e_et0:
            return jsonify({"erreur": "Calcul ET0 echoue : " + str(e_et0)}), 500

        if et0_moy is None:
            return jsonify({"erreur": "ET0 introuvable (aucune image ERA5 captee sur cette zone/periode)."}), 400

        # ETc = ET0 x Kc
        etc = et0_moy * kc

        # Pluie CHIRPS (mm) moyenne journaliere sur la meme fenetre
        chirps = (ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
                  .filterDate(debut_dt.strftime("%Y-%m-%d"), date_fin)
                  .filterBounds(zone))
        n_pluie = chirps.size().getInfo()
        pluie_tot = lire_cle(chirps.sum().reduceRegion(
            reducer=ee.Reducer.mean(), geometry=zone, scale=5000, maxPixels=1e9, bestEffort=True
        ), "precipitation", 0)
        # moyenne journaliere sur le nombre de jours reels (evite division par 7 fixe)
        pluie_jour = (pluie_tot / n_pluie) if n_pluie and n_pluie > 0 else 0

        pluie_eff = pluie_efficace(pluie_jour)

        # Besoin net d'irrigation (mm/jour)
        besoin = max(etc - pluie_eff, 0)

        return jsonify({
            "culture": culture_canon,
            "culture_saisie": culture,
            "coefficients_generiques": est_generique,
            "stade": stade,
            "jours_depuis_semis": jours_semis,
            "kc": round(kc, 2),
            "et0_mm_j": round(et0_moy, 2),
            "etc_mm_j": round(etc, 2),
            "pluie_mm_j": round(pluie_jour, 2),
            "pluie_efficace_mm_j": round(pluie_eff, 2),
            "besoin_irrigation_mm_j": round(besoin, 2),
            "message": ("Besoin en eau calcule (FAO-56)" + (" - coefficients generiques (culture non repertoriee, estimation)" if est_generique else ""))
        })

    except Exception as e:
        return jsonify({"erreur": str(e)}), 500



@app.route("/irrigation_carte", methods=["POST"])
def carte_irrigation():
    """
    Carte spatialisee du besoin en eau (methode Kc derive du NDVI).
    Pour chaque pixel :
        Kc_pixel = 1.457 * NDVI - 0.1725   (Kamble et al., 2013 ; relation NDVI-Kc)
        ETc_pixel = ET0 (climat) * Kc_pixel
        Besoin_pixel = max(ETc_pixel - pluie_efficace, 0)   (mm/jour)
    Renvoie des tuiles colorees + le besoin moyen.
    """
    data = request.get_json()
    zone, erreur = construire_zone(data)
    if erreur:
        return jsonify({"erreur": erreur}), 400

    date_fin = data.get("date_fin", "2024-12-31")
    try:
        from datetime import datetime, timedelta
        fin_dt = datetime.strptime(date_fin, "%Y-%m-%d")
        debut_dt = fin_dt - timedelta(days=30)  # NDVI sur 30 j (assez d'images nettes)
        d_debut = debut_dt.strftime("%Y-%m-%d")

        # 1) NDVI median recent (Sentinel-2) sur la zone
        col_s2 = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                  .filterBounds(zone)
                  .filterDate(d_debut, date_fin)
                  .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20)))
        ndvi = col_s2.median().normalizedDifference(["B8", "B4"]).clip(zone)

        # 2) Kc pixel par pixel a partir du NDVI (relation lineaire)
        kc = ndvi.multiply(1.457).subtract(0.1725).rename("Kc")
        # borne Kc dans une plage physique raisonnable [0, 1.3]
        kc = kc.max(0).min(1.3)

        # 3) ET0 (climat) moyen sur 7 j via ERA5 + Penman-Monteith
        et0_debut = (fin_dt - timedelta(days=7)).strftime("%Y-%m-%d")
        et0_img = calcul_et0_gee(zone, et0_debut, date_fin)  # image ET0 (mm/j)

        # 4) ETc spatialise = ET0 * Kc
        etc = et0_img.multiply(kc).rename("ETc")

        # 5) Pluie efficace (scalaire) -> soustraction
        chirps = (ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
                  .filterDate(et0_debut, date_fin).filterBounds(zone))
        pluie_tot = lire_cle(chirps.sum().reduceRegion(
            reducer=ee.Reducer.mean(), geometry=zone, scale=5000, maxPixels=1e9, bestEffort=True
        ), "precipitation", 0)
        pluie_eff_j = pluie_efficace(pluie_tot / 7.0)

        # 6) Besoin pixel = ETc - pluie efficace (mm/j), borne a 0
        besoin = etc.subtract(pluie_eff_j).max(0).rename("besoin")

        # 7) Tuiles colorees (bleu clair -> bleu fonce = besoin croissant)
        palette = ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"]
        map_id = besoin.getMapId({"min": 0, "max": 8, "palette": palette})
        tile_url = map_id["tile_fetcher"].url_format

        # 8) Besoin moyen de la zone
        besoin_moy = besoin.reduceRegion(
            reducer=ee.Reducer.mean(), geometry=zone, scale=10, maxPixels=1e9, bestEffort=True
        ).get("besoin").getInfo()

        return jsonify({
            "tile_url": tile_url,
            "besoin_moyen_mm_j": round(besoin_moy, 2) if besoin_moy is not None else None,
            "pluie_efficace_mm_j": round(pluie_eff_j, 2),
            "message": "Carte de besoin en eau calculee (Kc derive du NDVI)"
        })
    except Exception as e:
        return jsonify({"erreur": str(e)}), 500



@app.route("/irrigation_evolution", methods=["POST"])
def irrigation_evolution():
    """
    Evolution hebdomadaire du besoin en eau vs pluie recue.
    Pour chaque semaine de la periode :
      - ETc = ET0 (Penman-Monteith) x Kc (selon stade au milieu de la semaine)
      - pluie = somme CHIRPS de la semaine
      - besoin = max(ETc_semaine - pluie_efficace_semaine, 0)
    Renvoie une liste [{semaine, etc, pluie, besoin}] en mm (cumul hebdo).
    """
    data = request.get_json()
    zone, erreur = construire_zone(data)
    if erreur:
        return jsonify({"erreur": erreur}), 400

    culture = (data.get("culture") or "").strip()
    if not culture:
        return jsonify({"erreur": "Indique une culture."}), 400
    # Toute culture acceptee (repli generique si inconnue).
    date_semis = data.get("date_semis")
    if not date_semis:
        return jsonify({"erreur": "Fournis la date de semis."}), 400

    date_debut = data.get("date_debut", "2024-01-01")
    date_fin = data.get("date_fin", "2024-12-31")

    try:
        from datetime import datetime, timedelta
        debut = datetime.strptime(date_debut, "%Y-%m-%d")
        fin = datetime.strptime(date_fin, "%Y-%m-%d")
        semis = datetime.strptime(date_semis, "%Y-%m-%d")

        points = []
        semaine_debut = debut
        # Limite de securite : max ~26 semaines pour eviter les calculs trop longs
        max_semaines = 26
        compteur = 0

        while semaine_debut < fin and compteur < max_semaines:
            semaine_fin = min(semaine_debut + timedelta(days=7), fin)
            d1 = semaine_debut.strftime("%Y-%m-%d")
            d2 = semaine_fin.strftime("%Y-%m-%d")
            milieu = semaine_debut + timedelta(days=3)
            jours_semis = (milieu - semis).days
            kc, _ = kc_du_jour(culture, jours_semis)

            # ET0 moyen (mm/j) sur la semaine -> cumul hebdo
            try:
                et0_img = calcul_et0_gee(zone, d1, d2)
                et0_moy = lire_et0_moyen(et0_img, zone)
            except Exception:
                et0_moy = None

            if et0_moy is None:
                etc_hebdo = None
            else:
                nb_jours = (semaine_fin - semaine_debut).days
                etc_hebdo = et0_moy * kc * nb_jours

            # Pluie CHIRPS cumulee sur la semaine
            chirps = (ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
                      .filterDate(d1, d2).filterBounds(zone))
            pluie = lire_cle(chirps.sum().reduceRegion(
                reducer=ee.Reducer.mean(), geometry=zone,
                scale=5000, maxPixels=1e9, bestEffort=True
            ), "precipitation", 0)
            pluie_eff = pluie_efficace(pluie)

            if etc_hebdo is None:
                besoin = None
            else:
                besoin = max(etc_hebdo - pluie_eff, 0)

            points.append({
                "semaine": semaine_debut.strftime("%Y-%m-%d"),
                "etc": round(etc_hebdo, 1) if etc_hebdo is not None else None,
                "pluie": round(pluie_eff, 1),
                "besoin": round(besoin, 1) if besoin is not None else None
            })

            semaine_debut = semaine_fin
            compteur += 1

        return jsonify({"points": points, "message": "Evolution irrigation calculee"})
    except Exception as e:
        return jsonify({"erreur": str(e)}), 500



# ======================================================================
#  CONSEIL DE PLANTATION — croise conditions reelles (ERA5/CHIRPS)
#  avec les exigences agronomiques (fiche technique Cote d'Ivoire)
# ======================================================================

# Exigences par culture (source : fiche technique agronomique CI)
#   t_min, t_max      : plage de temperature ideale (degC)
#   t_critique        : au-dela, avortement/stress fort
#   eau_min, eau_max  : besoin en eau par cycle (mm)
#   mois_semis        : liste des mois favorables au semis (1=janvier ... 12=decembre)
#   note              : specificite locale a rappeler
EXIGENCES = {
    "concombre": {
        "t_min": 24, "t_max": 30, "t_critique": 35,
        "eau_min": 400, "eau_max": 600,
        "mois_semis": [10, 11, 12, 1, 2, 5, 6],
        "note": "Arrosage tres regulier. Surveiller le mildiou en saison des pluies."
    },
    "piment": {
        "t_min": 20, "t_max": 30, "t_critique": 32,
        "eau_min": 500, "eau_max": 800,
        "mois_semis": [9, 10, 2, 3],
        "note": "Sensible a l'exces d'eau (billons draines). Floraison exige des temperatures douces."
    },
    "tomate": {
        "t_min": 18, "t_max": 27, "t_critique": 32,
        "eau_min": 500, "eau_max": 700,
        "mois_semis": [10, 11, 12, 1],
        "note": "Nuits < 22 degC requises. Eviter la saison humide (mildiou, fletrissement, viroses)."
    },
    "laitue": {
        "t_min": 15, "t_max": 24, "t_critique": 28,
        "eau_min": 300, "eau_max": 400,
        "mois_semis": [11, 12, 1, 2],
        "note": "Enracinement superficiel, arrosages frequents. Montaison si trop chaud : variete thermotolerante + ombriere."
    },
    "aubergine": {
        "t_min": 22, "t_max": 30, "t_critique": 35, "eau_min": 450, "eau_max": 700,
        "mois_semis": [9, 10, 11, 2, 3],
        "note": "Aime la chaleur. Billons draines. Sensible aux nematodes : rotation conseillee."
    },
    "gombo": {
        "t_min": 22, "t_max": 32, "t_critique": 38, "eau_min": 400, "eau_max": 600,
        "mois_semis": [3, 4, 5, 6, 9, 10],
        "note": "Culture rustique de saison chaude. Recolte frequente des capsules jeunes."
    },
    "oignon": {
        "t_min": 15, "t_max": 28, "t_critique": 35, "eau_min": 350, "eau_max": 550,
        "mois_semis": [10, 11, 12, 1],
        "note": "Bulbaison favorisee par temps sec. Arreter l'irrigation avant recolte."
    },
    "chou": {
        "t_min": 15, "t_max": 25, "t_critique": 30, "eau_min": 350, "eau_max": 500,
        "mois_semis": [10, 11, 12, 1],
        "note": "Prefere la fraicheur. Surveiller chenilles et pucerons. Sol riche en matiere organique."
    },
    "carotte": {
        "t_min": 16, "t_max": 24, "t_critique": 30, "eau_min": 350, "eau_max": 500,
        "mois_semis": [10, 11, 12, 1],
        "note": "Sol meuble et profond sans cailloux (racines droites). Semis direct."
    },
    "pasteque": {
        "t_min": 22, "t_max": 32, "t_critique": 38, "eau_min": 400, "eau_max": 600,
        "mois_semis": [11, 12, 1, 2, 3],
        "note": "Saison chaude et ensoleillee. Reduire l'eau a l'approche de la maturite (sucre)."
    },
    "melon": {
        "t_min": 22, "t_max": 30, "t_critique": 36, "eau_min": 400, "eau_max": 600,
        "mois_semis": [11, 12, 1, 2],
        "note": "Chaleur et soleil. Eviter l'exces d'humidite sur feuillage (oidium)."
    },
    "mais": {
        "t_min": 20, "t_max": 32, "t_critique": 38, "eau_min": 450, "eau_max": 700,
        "mois_semis": [3, 4, 5, 8, 9],
        "note": "Caler le semis sur l'installation des pluies. Besoin fort en eau a la floraison."
    },
    "riz": {
        "t_min": 22, "t_max": 32, "t_critique": 38, "eau_min": 900, "eau_max": 1500,
        "mois_semis": [4, 5, 6, 7],
        "note": "Riz irrigue/bas-fond : lame d'eau. Riz pluvial : besoin de pluies regulieres."
    },
    "arachide": {
        "t_min": 22, "t_max": 32, "t_critique": 38, "eau_min": 400, "eau_max": 600,
        "mois_semis": [4, 5, 6, 7],
        "note": "Sol leger et draine. Peu d'azote (legumineuse). Recolte en sol ressuye."
    },
    "niebe": {
        "t_min": 22, "t_max": 33, "t_critique": 38, "eau_min": 300, "eau_max": 450,
        "mois_semis": [5, 6, 7, 8, 9],
        "note": "Legumineuse rustique, tolere la secheresse. Surveiller pucerons et thrips a la floraison."
    },
    "soja": {
        "t_min": 20, "t_max": 30, "t_critique": 35, "eau_min": 450, "eau_max": 700,
        "mois_semis": [5, 6, 7],
        "note": "Legumineuse. Inoculation conseillee. Sensible au manque d'eau au remplissage des gousses."
    },
    "sorgho": {
        "t_min": 22, "t_max": 34, "t_critique": 40, "eau_min": 400, "eau_max": 600,
        "mois_semis": [5, 6, 7],
        "note": "Tres tolerant a la secheresse. Bien adapte au nord du pays."
    },
    "manioc": {
        "t_min": 22, "t_max": 32, "t_critique": 38, "eau_min": 500, "eau_max": 1000,
        "mois_semis": [3, 4, 5, 9, 10],
        "note": "Culture rustique de longue duree (8-12 mois). Boutures saines. Tolere les sols pauvres."
    },
    "igname": {
        "t_min": 22, "t_max": 32, "t_critique": 38, "eau_min": 600, "eau_max": 1200,
        "mois_semis": [2, 3, 4, 11, 12],
        "note": "Longue duree. Buttes profondes. Tuteurage. Demande des sols profonds et meubles."
    },
    "patate douce": {
        "t_min": 20, "t_max": 32, "t_critique": 38, "eau_min": 400, "eau_max": 650,
        "mois_semis": [3, 4, 5, 9, 10],
        "note": "Boutures sur billons. Rustique. Reduire l'eau en fin de cycle (tubercules)."
    },
    "banane plantain": {
        "t_min": 22, "t_max": 32, "t_critique": 38, "eau_min": 1200, "eau_max": 1800,
        "mois_semis": [3, 4, 5, 9, 10],
        "note": "Perenne exigeante en eau et en matiere organique. Paillage fortement conseille."
    },
    "cacao": {
        "t_min": 21, "t_max": 30, "t_critique": 34, "eau_min": 1200, "eau_max": 2000,
        "mois_semis": [4, 5, 6, 9, 10],
        "note": "Perenne d'ombrage. Exige des pluies abondantes et reparties. Zone forestiere."
    },
    "cafe": {
        "t_min": 20, "t_max": 28, "t_critique": 32, "eau_min": 1000, "eau_max": 1800,
        "mois_semis": [4, 5, 6, 9, 10],
        "note": "Perenne. Robusta adapte aux zones chaudes. Pluies reparties, ombrage leger."
    },
    "anacarde": {
        "t_min": 22, "t_max": 36, "t_critique": 42, "eau_min": 600, "eau_max": 1200,
        "mois_semis": [5, 6, 7],
        "note": "Tres rustique, adapte au nord. Tolere la secheresse une fois installe."
    },
}

MOIS_FR = {1:"janvier",2:"fevrier",3:"mars",4:"avril",5:"mai",6:"juin",
           7:"juillet",8:"aout",9:"septembre",10:"octobre",11:"novembre",12:"decembre"}


def lire_valeur_moyenne(image, zone, bande):
    """Lecture robuste (multi-echelle + centroide) d'une bande d'une image ERA5/CHIRPS."""
    for sc in (1000, 5000, 11132):
        val = lire_cle(image.reduceRegion(
            reducer=ee.Reducer.mean(), geometry=zone,
            scale=sc, maxPixels=1e9, bestEffort=True
        ), bande)
        if val is not None:
            return val
    # Petite parcelle / cotiere : on moyenne sur un tampon croissant (pixels voisins).
    for marge in (5000, 15000, 30000):
        val = lire_cle(image.reduceRegion(
            reducer=ee.Reducer.mean(), geometry=zone_avec_marge(zone, marge),
            scale=11132, maxPixels=1e9, bestEffort=True
        ), bande)
        if val is not None:
            return val
    centre = zone.centroid(maxError=1)
    return lire_cle(image.reduceRegion(
        reducer=ee.Reducer.mean(), geometry=zone_avec_marge(centre, 15000),
        scale=11132, maxPixels=1e9, bestEffort=True
    ), bande)


def evaluer_culture(nom, temp_moy, pluie_cycle, mois):
    """Renvoie un verdict pour une culture selon les conditions reelles."""
    e = EXIGENCES[nom]
    raisons = []
    score = 0  # 2 = favorable, 1 = precautions, 0 = deconseille

    # --- Critere temperature ---
    if temp_moy is None:
        raisons.append("temperature indisponible")
        score_temp = 1
    elif temp_moy > e["t_critique"]:
        raisons.append(f"temperature trop elevee ({temp_moy:.1f}degC > seuil critique {e['t_critique']}degC)")
        score_temp = 0
    elif e["t_min"] <= temp_moy <= e["t_max"]:
        raisons.append(f"temperature ideale ({temp_moy:.1f}degC)")
        score_temp = 2
    else:
        raisons.append(f"temperature acceptable mais hors plage ideale ({temp_moy:.1f}degC)")
        score_temp = 1

    # --- Critere saison de semis ---
    if mois in e["mois_semis"]:
        raisons.append(f"periode de semis favorable ({MOIS_FR[mois]})")
        score_saison = 2
    else:
        favs = ", ".join(MOIS_FR[m] for m in e["mois_semis"])
        raisons.append(f"hors periode optimale (conseille : {favs})")
        score_saison = 0

    # --- Critere eau (pluie sur le cycle vs besoin) ---
    if pluie_cycle is None:
        score_eau = 1
    elif pluie_cycle >= e["eau_min"]:
        raisons.append(f"pluie suffisante sur le cycle (~{pluie_cycle:.0f} mm)")
        score_eau = 2
    elif pluie_cycle >= e["eau_min"] * 0.5:
        raisons.append(f"pluie partielle (~{pluie_cycle:.0f} mm), irrigation d'appoint necessaire")
        score_eau = 1
    else:
        raisons.append(f"pluie faible (~{pluie_cycle:.0f} mm), forte irrigation requise")
        score_eau = 1  # pas eliminatoire si on peut irriguer

    # --- Verdict global : la temperature et la saison priment ---
    if temp_moy is not None and temp_moy > e["t_critique"]:
        verdict = "Deconseille"
    elif score_saison == 0:
        verdict = "Possible avec precautions"
    elif score_temp == 2 and score_saison == 2:
        verdict = "Favorable"
    else:
        verdict = "Possible avec precautions"

    return {
        "culture": nom,
        "verdict": verdict,
        "temperature_moy": round(temp_moy, 1) if temp_moy is not None else None,
        "pluie_cycle_mm": round(pluie_cycle, 0) if pluie_cycle is not None else None,
        "raisons": raisons,
        "note": e["note"]
    }


@app.route("/plantation", methods=["POST"])
def conseil_plantation():
    """
    Conseille les cultures a planter selon les conditions reelles de la zone
    a la date choisie (temperature ERA5, pluie CHIRPS) croisees avec la fiche.
    """
    data = request.get_json()
    zone, erreur = construire_zone(data)
    if erreur:
        return jsonify({"erreur": erreur}), 400

    # Date de reference (par defaut : date_fin)
    date_ref = data.get("date_ref") or data.get("date_fin", "2024-12-31")

    try:
        from datetime import datetime, timedelta
        ref = datetime.strptime(date_ref, "%Y-%m-%d")
        mois = ref.month

        # Temperature moyenne (ERA5) sur les 30 derniers jours
        d1 = (ref - timedelta(days=30)).strftime("%Y-%m-%d")
        d2 = ref.strftime("%Y-%m-%d")
        col = (ee.ImageCollection("ECMWF/ERA5_LAND/DAILY_AGGR")
               .filterDate(d1, d2).filterBounds(zone))
        # temperature_2m en Kelvin -> Celsius (moyenne de la periode)
        temp_img = col.select("temperature_2m").mean().subtract(273.15)
        temp_moy = lire_valeur_moyenne(temp_img, zone, "temperature_2m")

        # Pluie CHIRPS estimee sur un cycle (~90 jours) autour de la date
        dc1 = (ref - timedelta(days=45)).strftime("%Y-%m-%d")
        dc2 = (ref + timedelta(days=45)).strftime("%Y-%m-%d")
        chirps = (ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
                  .filterDate(dc1, dc2).filterBounds(zone))
        pluie_cycle = lire_cle(chirps.sum().reduceRegion(
            reducer=ee.Reducer.mean(), geometry=zone,
            scale=5000, maxPixels=1e9, bestEffort=True
        ), "precipitation")

        # Evaluer chaque culture
        resultats = [evaluer_culture(nom, temp_moy, pluie_cycle, mois)
                     for nom in EXIGENCES]
        # Trier : Favorable d'abord, puis precautions, puis deconseille
        ordre = {"Favorable": 0, "Possible avec precautions": 1, "Deconseille": 2}
        resultats.sort(key=lambda r: ordre.get(r["verdict"], 3))

        return jsonify({
            "mois": MOIS_FR[mois],
            "temperature_moy": round(temp_moy, 1) if temp_moy is not None else None,
            "pluie_cycle_mm": round(pluie_cycle, 0) if pluie_cycle is not None else None,
            "cultures": resultats,
            "message": "Conseil de plantation calcule"
        })
    except Exception as e:
        return jsonify({"erreur": str(e)}), 500


# ===== Etat du service =====
# L'interface est Terravive : Vertea ne sert plus de page web, seulement un etat (utile au suivi Render).
@app.route("/", methods=["GET"])
def accueil():
    return jsonify({"service": "vertea", "role": "moteur satellite de Terravive", "ok": True})


@app.route("/ndvi", methods=["POST"])
def calculer_ndvi():
    data = request.get_json()
    zone, erreur = construire_zone(data)
    if erreur:
        return jsonify({"erreur": erreur}), 400
    date_debut = data.get("date_debut", "2024-01-01")
    date_fin = data.get("date_fin", "2024-12-31")
    try:
        # Collection robuste : si la fenetre demandee est vide (petite parcelle,
        # periode courte, nuages), on elargit automatiquement avant d'abandonner.
        col, info = collection_ndvi_robuste(zone, date_debut, date_fin)
        if col is None:
            return jsonify({"erreur": info}), 400

        ndvi = col.select("NDVI").median().clip(zone)
        palette = ["#a52a2a", "#d9a441", "#ffff99", "#97c459", "#3b6d11", "#173404"]
        map_id = ndvi.getMapId({"min": 0.0, "max": 0.8, "palette": palette})
        tile_url = map_id["tile_fetcher"].url_format

        # Moyenne NDVI : lecture robuste. Sur une parcelle plus petite qu'un pixel,
        # on reessaie a une echelle plus large puis sur une zone avec marge.
        moyenne = None
        for sc in (10, 20, 30):
            moyenne = lire_cle(ndvi.reduceRegion(
                reducer=ee.Reducer.mean(), geometry=zone,
                scale=sc, maxPixels=1e9, bestEffort=True
            ), "NDVI")
            if moyenne is not None:
                break
        if moyenne is None:
            moyenne = lire_cle(ndvi.reduceRegion(
                reducer=ee.Reducer.mean(), geometry=zone_avec_marge(zone, 20),
                scale=10, maxPixels=1e9, bestEffort=True
            ), "NDVI")

        reponse = {
            "tile_url": tile_url,
            "ndvi_moyen": round(moyenne, 3) if moyenne is not None else None,
            "message": "NDVI calcule avec succes",
            "images_utilisees": info.get("images"),
            "periode_depuis": info.get("depuis"),
            "periode_fin": date_fin
        }
        # Metadonnees de qualite : couverture nuageuse moyenne des scenes et dates extremes.
        try:
            meta = ee.Dictionary({
                "nuages": col.aggregate_mean("CLOUDY_PIXEL_PERCENTAGE"),
                "t0": col.aggregate_min("system:time_start"),
                "t1": col.aggregate_max("system:time_start")
            }).getInfo()
            if meta.get("nuages") is not None:
                reponse["couverture_nuageuse_moy"] = round(meta["nuages"], 1)
            if meta.get("t0"):
                reponse["date_premiere_image"] = ee.Date(meta["t0"]).format("YYYY-MM-dd").getInfo()
            if meta.get("t1"):
                reponse["date_derniere_image"] = ee.Date(meta["t1"]).format("YYYY-MM-dd").getInfo()
        except Exception:
            pass
        reponse.update(calculer_stats(ndvi, zone_avec_marge(zone, 20) if reponse["ndvi_moyen"] is None else zone))
        return jsonify(reponse)
    except Exception as e:
        return jsonify({"erreur": str(e)}), 500


@app.route("/evolution", methods=["POST"])
def evolution_ndvi():
    data = request.get_json()
    zone, erreur = construire_zone(data)
    if erreur:
        return jsonify({"erreur": erreur}), 400
    date_debut = data.get("date_debut", "2024-01-01")
    date_fin = data.get("date_fin", "2024-12-31")
    pas = data.get("pas", "mois")
    try:
        col = collection_ndvi(zone, date_debut, date_fin)
        debut = ee.Date(date_debut); fin = ee.Date(date_fin)

        if pas == "semaine":
            unite = "week"; fmt = "YYYY-MM-dd"
            n_pas = fin.difference(debut, "week").ceil()
        else:
            unite = "month"; fmt = "YYYY-MM"
            n_pas = fin.difference(debut, "month").ceil()

        indices = ee.List.sequence(0, n_pas.subtract(1))

        def ndvi_du_pas(i):
            i = ee.Number(i)
            p_debut = debut.advance(i, unite)
            p_fin = p_debut.advance(1, unite)
            sous_col = col.filterDate(p_debut, p_fin).select("NDVI")
            moyenne = ee.Algorithms.If(
                sous_col.size().gt(0),
                sous_col.median().reduceRegion(
                    reducer=ee.Reducer.mean(), geometry=zone,
                    scale=10, maxPixels=1e9, bestEffort=True
                ).get("NDVI"),
                None
            )
            return ee.Feature(None, {"date": p_debut.format(fmt), "ndvi": moyenne})

        serie = ee.FeatureCollection(indices.map(ndvi_du_pas))
        brut = serie.getInfo()["features"]
        points = []
        for f in brut:
            p = f["properties"]; valeur = p.get("ndvi")
            points.append({"date": p.get("date"),
                           "ndvi": round(valeur, 3) if valeur is not None else None})
        return jsonify({"points": points, "message": "Evolution calculee avec succes"})
    except Exception as e:
        return jsonify({"erreur": str(e)}), 500


@app.route("/anomalie", methods=["POST"])
def anomalie_ndvi():
    data = request.get_json()
    zone, erreur = construire_zone(data)
    if erreur:
        return jsonify({"erreur": erreur}), 400
    date_debut = data.get("date_debut", "2024-01-01")
    date_fin = data.get("date_fin", "2024-12-31")
    try:
        debut = ee.Date(date_debut); fin = ee.Date(date_fin)
        total_jours = fin.difference(debut, "day")
        tiers = total_jours.divide(3)
        ref_debut = debut; ref_fin = debut.advance(tiers, "day")
        rec_debut = fin.advance(tiers.multiply(-1), "day"); rec_fin = fin

        col = collection_ndvi(zone, date_debut, date_fin)
        col_ref = col.filterDate(ref_debut, ref_fin).select("NDVI")
        col_rec = col.filterDate(rec_debut, rec_fin).select("NDVI")

        if col_ref.size().getInfo() == 0 or col_rec.size().getInfo() == 0:
            return jsonify({"erreur": "Pas assez d'images nettes dans l'une des sous-periodes "
                                      "(nuages ?). Elargis la periode ou change les dates."}), 400

        ndvi_ref = col_ref.median().clip(zone)
        ndvi_rec = col_rec.median().clip(zone)
        diff = ndvi_rec.subtract(ndvi_ref).rename("diff")

        palette_div = ["#b2182b", "#ef8a62", "#fddbc7", "#f7f7f7", "#d9f0d3", "#7fbf7b", "#1b7837"]
        map_id = diff.getMapId({"min": -0.3, "max": 0.3, "palette": palette_div})
        tile_url = map_id["tile_fetcher"].url_format

        classe = (diff.gte(-SEUIL_ANOMALIE).add(diff.gt(SEUIL_ANOMALIE)).rename("classe"))
        histo = lire_cle(classe.reduceRegion(
            reducer=ee.Reducer.frequencyHistogram(),
            geometry=zone, scale=10, maxPixels=1e9, bestEffort=True
        ), "classe", {}) or {}

        n_deg = histo.get("0", 0); n_sta = histo.get("1", 0); n_ame = histo.get("2", 0)
        total = n_deg + n_sta + n_ame
        if total > 0:
            pct_degrade = round(100 * n_deg / total, 1)
            pct_stable = round(100 * n_sta / total, 1)
            pct_ameliore = round(100 * n_ame / total, 1)
        else:
            pct_degrade = pct_stable = pct_ameliore = None

        return jsonify({
            "tile_url": tile_url,
            "pct_degrade": pct_degrade, "pct_stable": pct_stable, "pct_ameliore": pct_ameliore,
            "periode_reference": {"debut": ref_debut.format("YYYY-MM-dd").getInfo(),
                                  "fin": ref_fin.format("YYYY-MM-dd").getInfo()},
            "periode_recente": {"debut": rec_debut.format("YYYY-MM-dd").getInfo(),
                                "fin": rec_fin.format("YYYY-MM-dd").getInfo()},
            "message": "Anomalie calculee avec succes"
        })
    except Exception as e:
        return jsonify({"erreur": str(e)}), 500


# ===== Climat d'un point : series journalieres longues (indices climatiques) =====
def _serie_point(collection, bandes, point, annee_debut, annee_fin, echelle):
    """Valeurs journalieres d'une collection en un point, par tranches de 5 ans (limite des calculs GEE)."""
    sortie = {}
    a = annee_debut
    while a <= annee_fin:
        b = min(a + 4, annee_fin)
        col = (ee.ImageCollection(collection).filterDate(f"{a}-01-01", f"{b + 1}-01-01").select(bandes))
        lignes = col.getRegion(point, echelle).getInfo()
        entete = lignes[0]
        it = entete.index("time")
        for ligne in lignes[1:]:
            jour = datetime.fromtimestamp(ligne[it] / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
            vals = sortie.setdefault(jour, {})
            for bande in bandes:
                v = ligne[entete.index(bande)]
                if v is not None:
                    vals[bande] = v
        a = b + 1
    return sortie


@app.route("/climat", methods=["POST"])
def climat_point():
    """
    Pluie CHIRPS (0,05 deg) et temperatures max/min ERA5-Land (0,1 deg) journalieres pour un point.
    Entree : {lat, lon, annee_debut, annee_fin} (au plus 40 ans). Sortie : dates + series, sans calcul d'indice
    (les indices sont calcules par Terravive, identiques pour toutes les sources).
    """
    data = request.get_json() or {}
    try:
        lat = float(data.get("lat")); lon = float(data.get("lon"))
        a0 = int(data.get("annee_debut", 1991)); a1 = int(data.get("annee_fin", 2024))
    except Exception:
        return jsonify({"erreur": "Parametres invalides (lat, lon, annee_debut, annee_fin)."}), 400
    if not (-50 <= lat <= 50 and -180 <= lon <= 180) or a0 < 1981 or a1 < a0 or a1 - a0 > 40:
        return jsonify({"erreur": "Point ou periode hors limites (CHIRPS : 50 S - 50 N, depuis 1981, 40 ans au plus)."}), 400
    try:
        point = ee.Geometry.Point([lon, lat])
        pluie = _serie_point("UCSB-CHG/CHIRPS/DAILY", ["precipitation"], point, a0, a1, 5566)
        temp = _serie_point("ECMWF/ERA5_LAND/DAILY_AGGR", ["temperature_2m_max", "temperature_2m_min"], point, a0, a1, 11132)
        jours = sorted(set(pluie.keys()) | set(temp.keys()))
        def k2c(v):
            return round(v - 273.15, 2) if v is not None else None
        return jsonify({
            "lat": lat, "lon": lon, "annee_debut": a0, "annee_fin": a1,
            "dates": jours,
            "pluie": [round(pluie.get(j, {}).get("precipitation"), 2) if pluie.get(j, {}).get("precipitation") is not None else None for j in jours],
            "tmax": [k2c(temp.get(j, {}).get("temperature_2m_max")) for j in jours],
            "tmin": [k2c(temp.get(j, {}).get("temperature_2m_min")) for j in jours],
            "sources": {"pluie": "CHIRPS v2.0 (UCSB-CHG), 0,05 deg, journalier",
                        "temperature": "ERA5-Land (ECMWF), 0,1 deg, agregats journaliers"}
        })
    except Exception as e:
        return jsonify({"erreur": str(e)}), 500


if __name__ == "__main__":
    # En local : port 5000. En ligne (Cloud Run) : port fourni par la variable PORT.
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
