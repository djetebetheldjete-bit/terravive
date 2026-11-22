# test_penman.py — Validation Penman-Monteith FAO-56 (Allen et al., 1998)
# =======================================================================
# Reference de validation : EXEMPLE 17, Chapitre 4, FAO Irrigation &
# Drainage Paper 56 (Bangkok, Thailande). Donnees mensuelles moyennes d'avril.
#
# Entrees (toutes issues du meme exemple, donc coherentes) :
#   latitude = 13.73 deg N   |  jour de l'annee j = 105 (mi-avril)
#   Tmax = 34.8 C  |  Tmin = 25.6 C
#   ea = 2.85 kPa  (pression de vapeur reelle, donnee directement)
#   u2 = 2.0 m/s   |  altitude z = 2 m
#   n = 8.5 h  (duree d'ensoleillement effective)
#
# Resultats intermediaires attendus (FAO-56, Ex.17) :
#   Delta ~ 0.246 kPa/C  |  P ~ 101.3 kPa  |  gamma ~ 0.0674 kPa/C
#   es ~ 4.42 kPa        |  es - ea ~ 1.57 kPa
#   Ra ~ 38.06 MJ/m2/j   |  Rs ~ 22.65     |  Rn ~ 14.33 MJ/m2/j
#   ET0 ~ 5.72 mm/jour   <-- valeur finale de reference
#
# Script AUTONOME (ne depend pas de GEE).

import math

# ---------- Fonctions de base (pression de vapeur, pente, etc.) ----------

def pression_saturante(T):
    # FAO-56 eq.11 : e0(T) en kPa
    return 0.6108 * math.exp((17.27 * T) / (T + 237.3))

def pente_courbe_vapeur(Tmean):
    # FAO-56 eq.13 : Delta (kPa/C)
    e0 = pression_saturante(Tmean)
    return (4098 * e0) / ((Tmean + 237.3) ** 2)

def pression_atmospherique(z):
    # FAO-56 eq.7 : P (kPa)
    return 101.3 * (((293 - 0.0065 * z) / 293) ** 5.26)

def constante_psychrometrique(P):
    # FAO-56 eq.8 : gamma (kPa/C)
    return 0.000665 * P

def es_moyenne(Tmax, Tmin):
    # FAO-56 eq.12
    return (pression_saturante(Tmax) + pression_saturante(Tmin)) / 2

# ---------- Rayonnement (chaine FAO-56 eq. 21 a 40) ----------

def rayonnement_extraterrestre(latitude_deg, j):
    """Ra (MJ/m2/jour) — FAO-56 eq.21."""
    phi = math.radians(latitude_deg)                     # latitude en radians
    dr = 1 + 0.033 * math.cos(2 * math.pi / 365 * j)     # distance Terre-Soleil (eq.23)
    delta = 0.409 * math.sin(2 * math.pi / 365 * j - 1.39)  # declinaison solaire (eq.24)
    ws = math.acos(-math.tan(phi) * math.tan(delta))     # angle horaire coucher (eq.25)
    Gsc = 0.0820                                          # constante solaire MJ/m2/min
    Ra = (24 * 60 / math.pi) * Gsc * dr * (
        ws * math.sin(phi) * math.sin(delta)
        + math.cos(phi) * math.cos(delta) * math.sin(ws)
    )
    return Ra, ws

def duree_jour(ws):
    """N (heures) — FAO-56 eq.34."""
    return 24 / math.pi * ws

def rayonnement_solaire(n, N, Ra, a_s=0.25, b_s=0.50):
    """Rs (MJ/m2/jour) — FAO-56 eq.35 (Angstrom)."""
    return (a_s + b_s * n / N) * Ra

def rayonnement_net(Rs, Ra, Tmax, Tmin, ea, z, albedo=0.23):
    """Rn (MJ/m2/jour) — FAO-56 eq.38,39,40."""
    # Rayonnement net ondes courtes (eq.38)
    Rns = (1 - albedo) * Rs
    # Rayonnement solaire par ciel clair Rso (eq.37)
    Rso = (0.75 + 2e-5 * z) * Ra
    # Rayonnement net ondes longues (eq.39)
    sigma = 4.903e-9   # constante de Stefan-Boltzmann MJ/K4/m2/jour
    TmaxK = Tmax + 273.16
    TminK = Tmin + 273.16
    Rnl = (sigma * ((TmaxK ** 4 + TminK ** 4) / 2)
           * (0.34 - 0.14 * math.sqrt(ea))
           * (1.35 * (Rs / Rso) - 0.35))
    # Rayonnement net (eq.40)
    return Rns - Rnl, Rns, Rnl, Rso

# ---------- Equation finale ET0 (FAO-56 eq.6) ----------

def et0_penman_monteith(Tmean, u2, Rn, G, es, ea, Delta, gamma):
    num = (0.408 * Delta * (Rn - G)
           + gamma * (900 / (Tmean + 273)) * u2 * (es - ea))
    den = Delta + gamma * (1 + 0.34 * u2)
    return num / den

# ---------- Validation ----------

def run_validation():
    print("=" * 62)
    print(" VALIDATION Penman-Monteith FAO-56 — Exemple 17 (Bangkok)")
    print("=" * 62)

    # Entrees
    latitude = 13.73
    j = 105
    Tmax, Tmin = 34.8, 25.6
    ea = 2.85
    u2 = 2.0
    z = 2.0
    n = 8.5
    G = 0.0

    Tmean = (Tmax + Tmin) / 2

    # Chaine
    Delta = pente_courbe_vapeur(Tmean)
    P = pression_atmospherique(z)
    gamma = constante_psychrometrique(P)
    es = es_moyenne(Tmax, Tmin)

    Ra, ws = rayonnement_extraterrestre(latitude, j)
    N = duree_jour(ws)
    Rs = rayonnement_solaire(n, N, Ra)
    Rn, Rns, Rnl, Rso = rayonnement_net(Rs, Ra, Tmax, Tmin, ea, z)

    et0 = et0_penman_monteith(Tmean, u2, Rn, G, es, ea, Delta, gamma)

    def ligne(nom, val, ref):
        print(f"{nom:<22}= {val:>8.3f}      (ref ~ {ref})")

    ligne("Tmean (C)", Tmean, "30.20")
    ligne("Delta (kPa/C)", Delta, "0.246")
    ligne("P (kPa)", P, "101.3")
    ligne("gamma (kPa/C)", gamma, "0.0674")
    ligne("es (kPa)", es, "4.42")
    ligne("es - ea (kPa)", es - ea, "1.57")
    ligne("Ra (MJ/m2/j)", Ra, "38.06")
    ligne("N (heures)", N, "12.31")
    ligne("Rs (MJ/m2/j)", Rs, "22.65")
    ligne("Rn (MJ/m2/j)", Rn, "14.33")
    print("-" * 62)
    print(f"{'ET0 calcule (mm/j)':<22}= {et0:>8.3f}")
    print(f"{'ET0 reference (mm/j)':<22}= {5.72:>8.3f}")
    print("-" * 62)
    ecart = abs(et0 - 5.72)
    if ecart <= 0.10:
        print(f"RESULTAT : CONFORME (ecart {ecart:.3f} mm <= 0.10). Formule VALIDEE.")
    else:
        print(f"RESULTAT : ECART ({ecart:.3f} mm). A analyser via les intermediaires.")
    print("=" * 62)

if __name__ == "__main__":
    run_validation()
