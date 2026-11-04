/**
 * Terravive — Sol, racines et arrosage (calculs purs, sans dépendance, sans réseau).
 *
 * Chaîne de calcul (méthode FAO-56, bulletin d'irrigation et de drainage n° 56) :
 *   1. TEXTURE du sol (estimée par satellite iSDAsoil/SoilGrids, ou corrigée sur le terrain)
 *      -> RÉSERVE UTILE par mètre de sol (eau que le sol garde et que la plante peut prendre).
 *   2. PROFONDEUR RACINAIRE de la culture selon son STADE (jours depuis semis/plantation),
 *      limitée par la PROFONDEUR DU SOL (roche, cuirasse) -> profondeur UTILE.
 *   3. Réserve totale (RU) = réserve par mètre × profondeur utile × (1 − cailloux).
 *      Réserve facilement utilisable (RFU) = p × RU  (p = fraction qu'on laisse s'épuiser).
 *   4. DOSE d'arrosage ≈ RFU ; FRÉQUENCE ≈ RFU / ETc, avec ETc = Kc × ET0 (météo).
 *   5. Position du CAPTEUR d'humidité et SEUIL de déclenchement.
 *
 * Toutes ces valeurs sont des ESTIMATIONS indicatives : on le dit toujours à l'utilisateur.
 */
"use strict";

// ---------------------------------------------------------------------------
// 1) Textures (classes USDA) -> libellés français + réserve utile (FAO-56, tableau 19)
// ---------------------------------------------------------------------------
// awc = [min, max] en mm d'eau disponible par mètre de sol (θCC − θPF × 1000).
// Les 3 classes marquées "approx" ne figurent pas dans le tableau 19 de FAO-56 :
// valeurs intermédiaires entre les classes voisines.
const TEXTURES = {
  sand:            { fr: "Sableux",                 awc: [50, 110],  approx: false, drain: "très rapide" },
  loamy_sand:      { fr: "Sablo-limoneux léger",    awc: [60, 120],  approx: false, drain: "rapide" },
  sandy_loam:      { fr: "Sablo-limoneux",          awc: [110, 150], approx: false, drain: "assez rapide" },
  loam:            { fr: "Limoneux équilibré (terre franche)", awc: [120, 200], approx: false, drain: "moyen" },
  silt_loam:       { fr: "Limoneux",                awc: [150, 220], approx: false, drain: "moyen" },
  silt:            { fr: "Limoneux fin (silt)",     awc: [170, 230], approx: false, drain: "moyen à lent" },
  sandy_clay_loam: { fr: "Sablo-argileux",          awc: [120, 170], approx: true,  drain: "moyen" },
  clay_loam:       { fr: "Argilo-limoneux équilibré", awc: [130, 180], approx: true, drain: "lent" },
  silty_clay_loam: { fr: "Limono-argileux",         awc: [130, 180], approx: false, drain: "lent" },
  sandy_clay:      { fr: "Argilo-sableux",          awc: [110, 170], approx: true,  drain: "lent" },
  silty_clay:      { fr: "Argilo-limoneux",         awc: [130, 190], approx: false, drain: "très lent" },
  clay:            { fr: "Argileux",                awc: [120, 200], approx: false, drain: "très lent" }
};
// Codes iSDAsoil « USDA texture class » (1 à 12).
const ISDA_TEXTURE_CODES = { 1: "clay", 2: "silty_clay", 3: "sandy_clay", 4: "clay_loam", 5: "silty_clay_loam", 6: "sandy_clay_loam", 7: "loam", 8: "silt_loam", 9: "sandy_loam", 10: "silt", 11: "loamy_sand", 12: "sand" };
// Libellés français de l'application (formulaire « Type de sol ») -> classe USDA la plus proche.
const FR_TO_TEXTURE = {
  "sableux": "sand",
  "limoneux": "silt_loam",
  "argileux": "clay",
  "sablo-limoneux": "sandy_loam",
  "limono-sableux": "loam",
  "sablo-argileux": "sandy_clay_loam",
  "argilo-sableux": "sandy_clay",
  "limono-argileux": "silty_clay_loam",
  "argilo-limoneux": "silty_clay",
  "argilo-limono-sableux (terre franche)": "loam",
  "terre franche": "loam"
};

/** Classe USDA à partir des pourcentages sable / limon / argile (triangle des textures). */
function textureFromFractions(sand, silt, clay) {
  let s = Number(sand), si = Number(silt), c = Number(clay);
  if (![s, si, c].every((x) => isFinite(x) && x >= 0)) return null;
  const tot = s + si + c;
  if (tot <= 0) return null;
  s = (s * 100) / tot; si = (si * 100) / tot; c = (c * 100) / tot; // normalise à 100 %
  if (si + 1.5 * c < 15) return "sand";
  if (si + 1.5 * c >= 15 && si + 2 * c < 30) return "loamy_sand";
  if ((c >= 7 && c < 20 && s > 52 && si + 2 * c >= 30) || (c < 7 && si < 50 && si + 2 * c >= 30)) return "sandy_loam";
  if (c >= 7 && c < 27 && si >= 28 && si < 50 && s <= 52) return "loam";
  if ((si >= 50 && c >= 12 && c < 27) || (si >= 50 && si < 80 && c < 12)) return "silt_loam";
  if (si >= 80 && c < 12) return "silt";
  if (c >= 20 && c < 35 && si < 28 && s > 45) return "sandy_clay_loam";
  if (c >= 27 && c < 40 && s > 20 && s <= 45) return "clay_loam";
  if (c >= 27 && c < 40 && s <= 20) return "silty_clay_loam";
  if (c >= 35 && s > 45) return "sandy_clay";
  if (c >= 40 && si >= 40) return "silty_clay";
  if (c >= 40 && s <= 45 && si < 40) return "clay";
  return "loam"; // cas limites dus aux arrondis
}

/** Normalise une texture venant de n'importe quelle source (code iSDA, clé USDA, libellé FR ou EN). */
function normalizeTexture(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" || /^\d+$/.test(String(v).trim())) return ISDA_TEXTURE_CODES[Number(v)] || null;
  const k = String(v).trim().toLowerCase();
  if (TEXTURES[k]) return k;
  const en = k.replace(/[\s-]+/g, "_");
  if (TEXTURES[en]) return en;
  if (FR_TO_TEXTURE[k]) return FR_TO_TEXTURE[k];
  for (const key of Object.keys(TEXTURES)) if (TEXTURES[key].fr.toLowerCase() === k) return key;
  return null;
}

// ---------------------------------------------------------------------------
// 2) Cultures : racines, p, Kc et durée des stades
// ---------------------------------------------------------------------------
// zr = profondeur racinaire maximale [min, max] en m ; p = fraction de la réserve qu'on peut
// laisser s'épuiser sans stress (pour ETc ≈ 5 mm/j) ; kc = [initial, mi-saison, fin] ;
// st = durée des stades en jours [initial, développement, mi-saison, arrière-saison]
// (valeurs typiques FAO-56 pour climat chaud ; elles varient selon variété et saison).
// src "fao" = valeurs des tableaux FAO-56 ; "ind" = culture absente de FAO-56 ou valeurs
// mal établies : ordre de grandeur indicatif, signalé à l'utilisateur.
// per = culture pérenne (racines déjà installées : profondeur maximale d'emblée).
const CROPS = {
  "tomate":          { zr: [0.7, 1.5], p: 0.40, kc: [0.60, 1.15, 0.80], st: [30, 40, 40, 25], src: "fao" },
  "poivron":         { zr: [0.5, 1.0], p: 0.30, kc: [0.60, 1.05, 0.90], st: [25, 35, 40, 20], src: "fao" },
  "piment":          { zr: [0.5, 1.0], p: 0.30, kc: [0.60, 1.05, 0.90], st: [25, 35, 40, 20], src: "fao" },
  "aubergine":       { zr: [0.7, 1.2], p: 0.45, kc: [0.60, 1.05, 0.90], st: [30, 40, 40, 20], src: "fao" },
  "concombre":       { zr: [0.7, 1.2], p: 0.50, kc: [0.60, 1.00, 0.75], st: [20, 30, 40, 15], src: "fao" },
  "courgette":       { zr: [0.6, 1.0], p: 0.50, kc: [0.50, 0.95, 0.75], st: [25, 35, 25, 15], src: "fao" },
  "pastèque":        { zr: [0.8, 1.5], p: 0.40, kc: [0.40, 1.00, 0.75], st: [20, 30, 30, 30], src: "fao" },
  "melon":           { zr: [0.8, 1.5], p: 0.40, kc: [0.50, 0.85, 0.60], st: [25, 35, 40, 20], src: "fao" },
  "laitue":          { zr: [0.3, 0.5], p: 0.30, kc: [0.70, 1.00, 0.95], st: [20, 30, 15, 10], src: "fao" },
  "chou":            { zr: [0.5, 0.8], p: 0.45, kc: [0.70, 1.05, 0.95], st: [40, 60, 50, 15], src: "fao" },
  "carotte":         { zr: [0.5, 1.0], p: 0.35, kc: [0.70, 1.05, 0.95], st: [20, 30, 50, 20], src: "fao" },
  "oignon":          { zr: [0.3, 0.6], p: 0.30, kc: [0.70, 1.05, 0.75], st: [15, 25, 70, 40], src: "fao" },
  "épinard":         { zr: [0.3, 0.5], p: 0.20, kc: [0.70, 1.00, 0.95], st: [20, 20, 15, 5],  src: "fao" },
  "haricot vert":    { zr: [0.5, 0.7], p: 0.45, kc: [0.50, 1.05, 0.90], st: [20, 30, 30, 10], src: "fao" },
  "gombo":           { zr: [0.5, 1.0], p: 0.40, kc: [0.50, 1.00, 0.85], st: [25, 35, 40, 20], src: "ind" },
  "arachide":        { zr: [0.5, 1.0], p: 0.50, kc: [0.40, 1.15, 0.60], st: [25, 35, 45, 25], src: "fao" },
  "niébé":           { zr: [0.6, 1.0], p: 0.45, kc: [0.40, 1.05, 0.55], st: [20, 30, 30, 20], src: "ind" },
  "soja":            { zr: [0.6, 1.3], p: 0.50, kc: [0.40, 1.15, 0.50], st: [20, 35, 60, 25], src: "fao" },
  "sésame":          { zr: [1.0, 1.5], p: 0.60, kc: [0.35, 1.10, 0.25], st: [20, 30, 40, 20], src: "fao" },
  "maïs":            { zr: [1.0, 1.7], p: 0.55, kc: [0.30, 1.20, 0.50], st: [30, 40, 50, 30], src: "fao" },
  "maïs doux":       { zr: [0.8, 1.2], p: 0.50, kc: [0.30, 1.15, 1.05], st: [20, 30, 30, 10], src: "fao" },
  "riz":             { zr: [0.5, 1.0], p: 0.20, kc: [1.05, 1.20, 0.75], st: [30, 30, 60, 30], src: "fao", paddy: true },
  "sorgho":          { zr: [1.0, 2.0], p: 0.55, kc: [0.30, 1.05, 0.55], st: [20, 35, 40, 30], src: "fao" },
  "mil":             { zr: [1.0, 2.0], p: 0.55, kc: [0.30, 1.00, 0.30], st: [20, 30, 55, 35], src: "fao" },
  "manioc":          { zr: [0.5, 0.8], p: 0.35, kc: [0.30, 0.80, 0.30], st: [20, 40, 90, 60], src: "fao" },
  "igname":          { zr: [0.4, 0.8], p: 0.40, kc: [0.50, 1.05, 0.80], st: [40, 60, 90, 50], src: "ind" },
  "patate douce":    { zr: [1.0, 1.5], p: 0.65, kc: [0.50, 1.15, 0.65], st: [20, 30, 60, 40], src: "fao" },
  "pomme de terre":  { zr: [0.4, 0.6], p: 0.35, kc: [0.50, 1.15, 0.75], st: [25, 30, 45, 30], src: "fao" },
  "taro":            { zr: [0.3, 0.6], p: 0.30, kc: [0.50, 1.05, 0.80], st: [30, 60, 90, 40], src: "ind" },
  "gingembre":       { zr: [0.3, 0.5], p: 0.30, kc: [0.50, 1.00, 0.80], st: [30, 60, 90, 40], src: "ind" },
  "coton":           { zr: [1.0, 1.7], p: 0.65, kc: [0.35, 1.15, 0.60], st: [30, 50, 60, 55], src: "fao" },
  "canne à sucre":   { zr: [1.2, 2.0], p: 0.65, kc: [0.40, 1.25, 0.75], st: [35, 60, 190, 120], src: "fao" },
  "banane plantain": { zr: [0.5, 0.9], p: 0.35, kc: [0.50, 1.10, 1.00], st: [120, 90, 120, 60], src: "fao" },
  "ananas":          { zr: [0.3, 0.6], p: 0.50, kc: [0.50, 0.30, 0.30], st: [60, 120, 600, 10], src: "fao" },
  "cacao":           { zr: [0.7, 1.0], p: 0.30, kc: [1.00, 1.05, 1.05], per: true, src: "fao" },
  "café":            { zr: [0.9, 1.5], p: 0.40, kc: [0.90, 0.95, 0.95], per: true, src: "fao" },
  "palmier à huile": { zr: [0.7, 1.1], p: 0.65, kc: [0.95, 1.00, 1.00], per: true, src: "fao" },
  "hévéa":           { zr: [1.0, 1.5], p: 0.40, kc: [0.95, 1.00, 1.00], per: true, src: "fao" },
  "agrumes":         { zr: [1.2, 1.5], p: 0.50, kc: [0.70, 0.65, 0.70], per: true, src: "fao" },
  "anacarde":        { zr: [1.0, 2.0], p: 0.50, kc: [0.70, 0.90, 0.90], per: true, src: "ind" },
  "mangue":          { zr: [1.0, 2.0], p: 0.50, kc: [0.70, 0.90, 0.90], per: true, src: "ind" },
  "papaye":          { zr: [0.5, 1.0], p: 0.40, kc: [0.80, 1.00, 1.00], per: true, src: "ind" }
};
const CROP_ALIASES = {
  "tomates": "tomate", "poivrons": "poivron", "piments": "piment", "aubergines": "aubergine", "concombres": "concombre",
  "courgettes": "courgette", "pasteque": "pastèque", "pastèques": "pastèque", "laitues": "laitue", "salade": "laitue", "choux": "chou",
  "carottes": "carotte", "oignons": "oignon", "epinard": "épinard", "épinards": "épinard", "haricot": "haricot vert", "haricots verts": "haricot vert",
  "gombos": "gombo", "okra": "gombo", "arachides": "arachide", "niebe": "niébé", "sesame": "sésame", "mais": "maïs", "maïs grain": "maïs",
  "mais doux": "maïs doux", "riz irrigué": "riz", "riz pluvial": "riz", "mil / sorgho": "mil", "patate": "patate douce", "patates douces": "patate douce",
  "pommes de terre": "pomme de terre", "cafe": "café", "caféier": "café", "cacaoyer": "cacao", "palmier": "palmier à huile", "hevea": "hévéa",
  "orange": "agrumes", "oranger": "agrumes", "citron": "agrumes", "cajou": "anacarde", "anacardier": "anacarde", "mangue": "mangue", "manguier": "mangue",
  "papayer": "papaye", "banane": "banane plantain", "bananier": "banane plantain", "plantain": "banane plantain", "canne a sucre": "canne à sucre",
  "cotonnier": "coton", "ignames": "igname"
};
// Valeurs génériques (culture non répertoriée) : légume-fruit moyen.
const GENERIC_CROP = { zr: [0.5, 1.0], p: 0.45, kc: [0.50, 1.00, 0.80], st: [25, 35, 40, 20], src: "gen" };

function findCrop(name) {
  const k = String(name || "").trim().toLowerCase();
  if (!k) return null;
  if (CROPS[k]) return { key: k, data: CROPS[k] };
  if (CROP_ALIASES[k]) return { key: CROP_ALIASES[k], data: CROPS[CROP_ALIASES[k]] };
  const noAcc = k.normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const key of Object.keys(CROPS)) if (key.normalize("NFD").replace(/[̀-ͯ]/g, "") === noAcc) return { key, data: CROPS[key] };
  for (const key of Object.keys(CROPS)) if (noAcc.startsWith(key.normalize("NFD").replace(/[̀-ͯ]/g, ""))) return { key, data: CROPS[key] };
  return null;
}

/** Stade et Kc d'une culture annuelle à J jours après semis/plantation (FAO-56, courbe de Kc). */
function cropStage(crop, days) {
  if (crop.per) return { stage: "pérenne", kc: crop.kc[1], progress: 1 };
  const [li, ld, lm, ll] = crop.st;
  const [ki, km, ke] = crop.kc;
  const d = Math.max(0, days);
  if (d <= li) return { stage: "initial", kc: ki, progress: 0 };
  if (d <= li + ld) { const f = (d - li) / ld; return { stage: "développement", kc: ki + f * (km - ki), progress: f }; }
  if (d <= li + ld + lm) return { stage: "mi-saison", kc: km, progress: 1 };
  if (d <= li + ld + lm + ll) { const f = (d - li - ld - lm) / ll; return { stage: "arrière-saison", kc: km + f * (ke - km), progress: 1 }; }
  return { stage: "après récolte", kc: ke, progress: 1, over: true };
}

const ZR_START = 0.15; // m : profondeur des racines au semis/repiquage (FAO-56 : 0,15–0,20 m)
/** Profondeur racinaire (m) : croît du semis jusqu'à la fin du stade de développement. */
function rootDepthAt(crop, days) {
  const zmax = (crop.zr[0] + crop.zr[1]) / 2; // milieu de la fourchette FAO
  if (crop.per || days == null) return zmax;
  const grow = crop.st[0] + crop.st[1];
  const f = Math.max(0, Math.min(1, days / grow));
  return ZR_START + f * (zmax - ZR_START);
}

function round(x, n) { const m = Math.pow(10, n || 0); return Math.round(x * m) / m; }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function daysBetween(fromIso, toDate) {
  const t0 = Date.parse(fromIso);
  if (!isFinite(t0)) return null;
  return Math.floor(((toDate ? toDate.getTime() : Date.now()) - t0) / 86400000);
}

/**
 * Sol « effectif » : la correction de TERRAIN (test du bocal, profondeur observée) l'emporte
 * toujours sur l'estimation satellite.
 * estimate = { texture, sand, silt, clay, stones, bedrock_cm, ph, ... , source }
 * manual   = { texture, depth_cm, stones }
 */
function effectiveSoil(estimate, manual) {
  const e = estimate || {}, m = manual || {};
  let texture = normalizeTexture(m.texture), textureFrom = "terrain";
  if (!texture) { texture = normalizeTexture(e.texture); textureFrom = e.source || "estimation"; }
  if (!texture && e.sand != null && e.silt != null && e.clay != null) { texture = textureFromFractions(e.sand, e.silt, e.clay); textureFrom = e.source || "estimation"; }
  if (!texture) textureFrom = null;
  let depthCm = null, depthFrom = null;
  if (isFinite(Number(m.depth_cm)) && Number(m.depth_cm) > 0) { depthCm = Number(m.depth_cm); depthFrom = "terrain"; }
  else if (isFinite(Number(e.bedrock_cm)) && Number(e.bedrock_cm) > 0) { depthCm = Number(e.bedrock_cm); depthFrom = e.source || "estimation"; }
  let stones = 0, stonesFrom = null;
  if (isFinite(Number(m.stones)) && m.stones !== "" && m.stones != null) { stones = clamp(Number(m.stones), 0, 90); stonesFrom = "terrain"; }
  else if (isFinite(Number(e.stones)) && e.stones != null) { stones = clamp(Number(e.stones), 0, 90); stonesFrom = e.source || "estimation"; }
  return { texture, textureFrom, depthCm, depthFrom, depthCapped: depthFrom !== "terrain" && depthCm != null && depthCm >= 200, stones, stonesFrom };
}

/**
 * Fiche complète « sol, racines, arrosage, capteur » pour une parcelle.
 * input = { estimate, manual, crop, sownAt (ISO), et0 (mm/j, prévision), now (Date, tests) }
 */
function soilAdvice(input) {
  const inp = input || {};
  const soil = effectiveSoil(inp.estimate, inp.manual);
  const out = { soil, warnings: [], ok: true };
  const tex = soil.texture ? TEXTURES[soil.texture] : null;
  out.texture = tex ? { key: soil.texture, label: tex.fr, drainage: tex.drain, awc_mm_m: round((tex.awc[0] + tex.awc[1]) / 2), awc_range: tex.awc, approx: tex.approx } : null;
  if (!tex) out.warnings.push("Texture du sol inconnue : faites le test du bocal (voir ci-dessous) pour obtenir des conseils d'arrosage.");

  // Culture et stade
  const found = findCrop(inp.crop);
  const crop = found ? found.data : (inp.crop ? GENERIC_CROP : null);
  out.crop = inp.crop ? { name: found ? found.key : String(inp.crop).trim().toLowerCase(), known: !!found, source: found ? found.data.src : "gen" } : null;
  if (out.crop && !found) out.warnings.push("Culture non répertoriée : coefficients génériques (valeurs indicatives).");
  else if (out.crop && found.data.src === "ind") out.warnings.push("Pour cette culture, les références FAO-56 manquent : profondeur racinaire et coefficients indicatifs.");
  const days = inp.sownAt ? daysBetween(inp.sownAt, inp.now) : null;
  if (crop) {
    const st = cropStage(crop, days == null ? (crop.per ? 0 : (crop.st[0] + crop.st[1])) : days);
    const zMax = (crop.zr[0] + crop.zr[1]) / 2;
    const zNow = rootDepthAt(crop, days == null ? null : days);
    out.stage = { days, name: days == null && !crop.per ? "non précisé (on suppose la pleine croissance)" : st.stage, kc: round(st.kc, 2), over: !!st.over };
    out.roots = { now_m: round(zNow, 2), max_m: round(zMax, 2), range_m: crop.zr };
    if (days != null && days < 0) out.warnings.push("La date de semis est dans le futur : vérifiez-la.");
    if (st.over) out.warnings.push("Le cycle habituel de cette culture semble terminé : mettez à jour la culture et la date de semis.");
    // Profondeur UTILE = racines limitées par la profondeur du sol
    let zEff = zNow, limitedBySoil = false;
    if (soil.depthCm != null && !soil.depthCapped && soil.depthCm / 100 < zEff) { zEff = soil.depthCm / 100; limitedBySoil = true; }
    out.roots.effective_m = round(zEff, 2);
    out.roots.limited_by_soil = limitedBySoil;
    if (soil.depthCm != null && !soil.depthCapped && soil.depthCm / 100 < zMax) {
      out.warnings.push("Sol peu profond (≈ " + round(soil.depthCm) + " cm) : les racines ne pourront pas descendre jusqu'à " + round(zMax * 100) + " cm. Préférez des arrosages courts et plus fréquents, et un bon paillage.");
    }

    if (crop.paddy) {
      out.irrigation = { paddy: true, note: "Riz irrigué : l'eau se gère par une lame d'eau dans la rizière (et non par la réserve du sol). Les calculs de dose ci-dessous ne s'appliquent pas." };
    } else if (tex) {
      const awc = out.texture.awc_mm_m;
      const ru = awc * zEff * (1 - soil.stones / 100);           // mm
      const etc = isFinite(Number(inp.et0)) && Number(inp.et0) > 0 ? Number(inp.et0) * st.kc : null;
      // Ajustement FAO-56 de p selon la demande climatique : p = p_tab + 0,04 (5 − ETc)
      const p = clamp(crop.p + (etc != null ? 0.04 * (5 - etc) : 0), 0.1, 0.8);
      const rfu = p * ru;                                       // mm = litres par m²
      out.irrigation = {
        ru_mm: round(ru, 0), rfu_mm: round(rfu, 0), p: round(p, 2),
        dose_l_m2: round(rfu, 0), dose_l_100m2: round(rfu * 100, -1),
        et0_mm_j: etc != null ? round(Number(inp.et0), 1) : null,
        etc_mm_j: etc != null ? round(etc, 1) : null,
        interval_days: etc != null && etc > 0 ? Math.max(1, Math.round(rfu / etc)) : null
      };
      if (soil.stones >= 15) out.warnings.push("Sol caillouteux (≈ " + round(soil.stones) + " % de cailloux) : il retient moins d'eau, la réserve a été réduite d'autant.");
    }

    // Capteur : au cœur de la zone des racines actives (≈ 40 % de la profondeur utile)
    const sensorCm = clamp(Math.round((zEff * 0.4 * 100) / 5) * 5, 10, 45);
    const second = zEff >= 0.6 ? clamp(Math.round((zEff * 0.8 * 100) / 5) * 5, sensorCm + 15, 90) : null;
    // Seuil : on arrose quand la réserve facilement utilisable est consommée, soit quand
    // l'humidité « utile » descend à (1 − p) de la réserve. Le capteur, calibré entre
    // « sol sec de la parcelle » (0 %) et « sol ressuyé 1 à 2 jours après un fort arrosage » (100 %),
    // donne une mesure proche de cette humidité utile.
    const pUsed = out.irrigation && out.irrigation.p ? out.irrigation.p : crop.p;
    const threshold = clamp(Math.round((1 - pUsed) * 100 / 5) * 5, 20, 80);
    out.sensor = { depth_cm: sensorCm, second_depth_cm: second, threshold_pct: crop.paddy ? null : threshold };
  }
  out.summary = summarize(out);
  return out;
}

function summarize(a) {
  const parts = [];
  if (a.texture) parts.push("Sol " + a.texture.label.toLowerCase() + " (drainage " + a.texture.drainage + ")");
  if (a.roots) parts.push("racines utiles ≈ " + Math.round(a.roots.effective_m * 100) + " cm" + (a.roots.limited_by_soil ? " (limitées par la profondeur du sol)" : ""));
  if (a.irrigation && !a.irrigation.paddy) {
    parts.push("dose ≈ " + a.irrigation.dose_l_m2 + " L/m² par arrosage" + (a.irrigation.interval_days ? (", environ tous les " + a.irrigation.interval_days + " jour" + (a.irrigation.interval_days > 1 ? "s" : "") + " sans pluie") : ""));
  }
  if (a.sensor && a.sensor.threshold_pct != null) parts.push("capteur à " + a.sensor.depth_cm + " cm, arroser sous " + a.sensor.threshold_pct + " %");
  return parts.join(" ; ") + (parts.length ? "." : "");
}

/** Interprétation qualitative prudente des propriétés chimiques estimées (pour l'affichage). */
function interpretChem(e) {
  const out = [];
  if (!e) return out;
  const ph = Number(e.ph);
  if (isFinite(ph) && e.ph != null) {
    let t = "neutre";
    if (ph < 5.0) t = "très acide"; else if (ph < 5.5) t = "acide"; else if (ph < 6.5) t = "légèrement acide"; else if (ph <= 7.5) t = "neutre"; else t = "alcalin";
    out.push({ k: "pH", v: round(ph, 1), t, note: ph < 5.5 ? "Un pH acide limite l'assimilation du phosphore : la matière organique et, si besoin, un amendement calcique (après analyse) aident." : null });
  }
  const oc = Number(e.oc_gkg);
  if (isFinite(oc) && e.oc_gkg != null) out.push({ k: "Carbone organique", v: round(oc, 1) + " g/kg", t: oc < 6 ? "faible" : oc < 12 ? "moyen" : "bon", note: oc < 6 ? "Sol pauvre en matière organique : compost, paillage et couverts végétaux sont prioritaires." : null });
  const n = Number(e.n_gkg);
  if (isFinite(n) && e.n_gkg != null) out.push({ k: "Azote total", v: round(n, 2) + " g/kg", t: n < 0.5 ? "faible" : n < 1.5 ? "moyen" : "bon" });
  if (e.p_ppm != null && isFinite(Number(e.p_ppm))) out.push({ k: "Phosphore extractible", v: round(Number(e.p_ppm), 1) + " ppm", t: Number(e.p_ppm) < 10 ? "faible" : Number(e.p_ppm) < 25 ? "moyen" : "bon" });
  if (e.k_ppm != null && isFinite(Number(e.k_ppm))) out.push({ k: "Potassium extractible", v: round(Number(e.k_ppm)) + " ppm", t: Number(e.k_ppm) < 80 ? "faible" : Number(e.k_ppm) < 160 ? "moyen" : "bon" });
  return out;
}

/** Texte compact, pour enrichir le message envoyé à l'IA (itinéraire technique). */
function adviceForPrompt(a, chem) {
  const lines = [];
  if (a.texture) lines.push("- Texture : " + a.texture.label + " (" + (a.soil.textureFrom === "terrain" ? "confirmée sur le terrain" : "estimation satellite à confirmer") + "), drainage " + a.texture.drainage + ", réserve utile ≈ " + a.texture.awc_mm_m + " mm par mètre de sol.");
  if (a.soil.depthCm != null) lines.push("- Profondeur de sol : " + (a.soil.depthCapped ? "200 cm ou plus" : "≈ " + Math.round(a.soil.depthCm) + " cm") + " (" + (a.soil.depthFrom === "terrain" ? "observée" : "estimée") + ").");
  if (a.soil.stones) lines.push("- Cailloux : ≈ " + Math.round(a.soil.stones) + " %.");
  (chem || []).forEach((c) => lines.push("- " + c.k + " : " + c.v + " (" + c.t + ", estimation)."));
  if (a.roots) lines.push("- Profondeur racinaire utile actuelle ≈ " + Math.round(a.roots.effective_m * 100) + " cm (maximum de la culture ≈ " + Math.round(a.roots.max_m * 100) + " cm).");
  if (a.irrigation && !a.irrigation.paddy) lines.push("- Arrosage calculé (FAO-56) : dose ≈ " + a.irrigation.dose_l_m2 + " L/m²" + (a.irrigation.interval_days ? ", environ tous les " + a.irrigation.interval_days + " j sans pluie" : "") + ".");
  return lines.join("\n");
}

module.exports = {
  TEXTURES, CROPS, ISDA_TEXTURE_CODES,
  textureFromFractions, normalizeTexture, findCrop, cropStage, rootDepthAt, effectiveSoil, soilAdvice, interpretChem, adviceForPrompt
};
