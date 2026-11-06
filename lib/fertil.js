"use strict";
// Terravive — conseil de fertilisation organique (compost, fumier) et de correction du sol,
// à partir de l'estimation de sol (iSDAsoil ou SoilGrids), de la culture et de la surface.
// Repères de vulgarisation (ordres de grandeur), à confirmer par une analyse de laboratoire
// et l'observation de la culture. Aucune dose d'engrais minéral n'est calculée ici : elle
// relève de l'itinéraire technique.

const SOL = require("./sol");

const KG_PER_WHEELBARROW = 50; // brouette ≈ 80 L de compost mûr ≈ 50 kg
const RAW_PER_COMPOST = 3;     // il faut ≈ 3 kg de matières brutes pour ≈ 1 kg de compost mûr

// Doses de compost mûr en t/ha (équivalent kg/10 m²), par groupe de cultures.
const GROUPS = {
  maraichage: { label: "maraîchage", t_ha: [15, 30], crops: ["tomate", "poivron", "piment", "aubergine", "concombre", "courgette", "pastèque", "melon", "laitue", "chou", "carotte", "oignon", "épinard", "haricot vert", "gombo"] },
  legumineuse: { label: "légumineuse", t_ha: [5, 10], crops: ["arachide", "niébé", "soja"] },
  cereale: { label: "céréale ou culture de plein champ", t_ha: [5, 10], crops: ["maïs", "maïs doux", "riz", "sorgho", "mil", "sésame", "coton"] },
  tubercule: { label: "racine ou tubercule", t_ha: [10, 20], crops: ["manioc", "igname", "patate douce", "pomme de terre", "taro", "gingembre"] },
  perenne: { label: "culture pérenne", kg_plant: [5, 10], crops: ["cacao", "café", "palmier à huile", "hévéa", "agrumes", "anacarde", "mangue", "papaye", "banane plantain", "canne à sucre", "ananas"] }
};
const ACID_TOLERANT = ["ananas"];

function groupOf(cropKey) {
  for (const k of Object.keys(GROUPS)) if (GROUPS[k].crops.includes(cropKey)) return k;
  return null;
}
const r1 = (x) => Math.round(x * 10) / 10;
const rnd = (x) => (x >= 100 ? Math.round(x / 10) * 10 : Math.round(x));

/** Surface approximative (m²) d'une zone { bbox } ou { polygon } en longitude/latitude. */
function zoneAreaM2(zone) {
  if (!zone) return null;
  let pts = null;
  if (Array.isArray(zone.bbox)) { const [w, s, e, n] = zone.bbox; pts = [[w, s], [e, s], [e, n], [w, n]]; }
  else if (Array.isArray(zone.polygon) && zone.polygon.length >= 3) pts = zone.polygon;
  if (!pts) return null;
  const lat0 = pts.reduce((a, p) => a + p[1], 0) / pts.length * Math.PI / 180;
  const R = 6371008.8, kx = R * Math.cos(lat0) * Math.PI / 180, ky = R * Math.PI / 180;
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += (p[0] * kx) * (q[1] * ky) - (q[0] * kx) * (p[1] * ky); }
  const m2 = Math.abs(a) / 2;
  return m2 > 0 && isFinite(m2) ? Math.round(m2) : null;
}

function statusOf(chem, key) { const c = (chem || []).find((x) => x.k === key); return c ? c.t : null; }

/**
 * @param {object} o { estimate, crop, areaM2 }
 * @returns conseil structuré, ou null si aucune donnée de sol.
 */
function fertilityAdvice(o) {
  const est = o && o.estimate;
  if (!est) return null;
  const chem = SOL.interpretChem(est);
  const found = SOL.findCrop(o.crop);
  const cropKey = found ? found.key : null;
  const gk = cropKey ? groupOf(cropKey) : null;
  const group = gk ? GROUPS[gk] : null;
  const areaM2 = o.areaM2 && o.areaM2 > 0 ? o.areaM2 : null;
  const texture = est.texture ? String(est.texture) : "";
  const sandy = /sable|sand/i.test(texture) || (est.sand != null && est.sand >= 70);
  const out = { crop: cropKey, group: group ? group.label : null, area_m2: areaM2, area_ha: areaM2 ? Math.round(areaM2 / 100) / 100 : null, priorities: [], nutrients: [] };

  // 1) Matière organique : dose de compost
  const ocStatus = statusOf(chem, "Carbone organique");
  const oc = est.oc_gkg != null ? Number(est.oc_gkg) : null;
  const org = { status: ocStatus, oc_gkg: oc != null ? r1(oc) : null, mo_pct: oc != null ? r1(oc * 1.724 / 10) : null };
  if (group && group.t_ha) {
    let [lo, hi] = group.t_ha; const mid = (lo + hi) / 2;
    if (ocStatus === "faible") lo = mid; else if (ocStatus === "moyen") hi = mid; else if (ocStatus === "bon") { hi = lo; lo = lo / 2; }
    org.dose_t_ha = [r1(lo), r1(hi)];
    org.dose_kg_m2 = [r1(lo / 10), r1(hi / 10)];
    if (areaM2) {
      const tlo = lo / 10 * areaM2, thi = hi / 10 * areaM2;
      org.total_kg = [rnd(tlo), rnd(thi)];
      org.wheelbarrows = [Math.max(1, Math.round(tlo / KG_PER_WHEELBARROW)), Math.max(1, Math.round(thi / KG_PER_WHEELBARROW))];
      org.raw_kg = [rnd(tlo * RAW_PER_COMPOST), rnd(thi * RAW_PER_COMPOST)];
    }
    org.when = "Épandre le compost mûr 2 à 3 semaines avant le semis ou le repiquage et l'enfouir légèrement (10 à 15 cm)." + (sandy ? " Sol sableux : fractionner en deux apports (avant semis, puis au début de la croissance), car la matière organique s'y dégrade vite." : "");
  } else if (group && group.kg_plant) {
    let [lo, hi] = group.kg_plant;
    if (ocStatus === "faible") lo = (lo + hi) / 2; else if (ocStatus === "bon") hi = lo;
    org.dose_kg_plant = [r1(lo), r1(hi)];
    org.when = "Apporter le compost chaque année en couronne autour du pied (pas contre le tronc), au début de la saison des pluies, puis couvrir d'un paillage.";
  }
  org.start = "Le compost demande 2 à 3 mois : lancer le tas au moins 10 à 12 semaines avant la date d'apport.";
  out.organic = org;
  if (ocStatus === "faible") out.priorities.push("Remonter la matière organique : c'est la priorité de cette parcelle (compost, paillage, résidus de culture laissés au sol, jamais brûlés).");

  // 2) pH : correction éventuelle
  const ph = est.ph != null ? Number(est.ph) : null;
  if (ph != null && isFinite(ph)) {
    const p = { value: r1(ph), status: statusOf(chem, "pH") };
    const tolerant = cropKey && ACID_TOLERANT.includes(cropKey);
    if (ph < 5.5 && !tolerant) {
      const strong = ph < 5.0;
      p.action = (strong ? "Sol très acide." : "Sol acide.") + " Un amendement calcique améliore l'assimilation du phosphore : chaux agricole ou dolomie, environ " + (strong ? "1 à 2" : "0,5 à 1") + " t/ha, à confirmer par une analyse de laboratoire. Alternative locale : cendre de bois, 100 à 200 g/m², épandue et enfouie un mois avant le semis.";
      p.lime_t_ha = strong ? [1, 2] : [0.5, 1];
      if (areaM2) p.lime_total_kg = [rnd(p.lime_t_ha[0] * areaM2 / 10), rnd(p.lime_t_ha[1] * areaM2 / 10)];
      out.priorities.push("Corriger l'acidité du sol (pH " + String(r1(ph)).replace(".", ",") + ").");
    } else if (ph < 5.5 && tolerant) {
      p.action = "Sol acide, mais l'ananas le supporte bien : pas de chaulage nécessaire.";
    } else if (ph > 7.5) {
      p.action = "Sol alcalin : n'apportez ni chaux ni cendre. Le compost aide à rendre les éléments nutritifs plus disponibles.";
    } else {
      p.action = "pH favorable à la plupart des cultures : aucune correction nécessaire.";
    }
    out.ph = p;
  }

  // 3) Éléments nutritifs : priorités et sources organiques locales
  const legume = gk === "legumineuse";
  const n = statusOf(chem, "Azote total"), P = statusOf(chem, "Phosphore extractible"), K = statusOf(chem, "Potassium extractible");
  if (n) out.nutrients.push({ k: "Azote (N)", status: n, action: legume ? "La culture fixe l'azote de l'air : pas d'engrais azoté, sauf une petite dose au démarrage sur sol très pauvre." : n === "faible" ? "Compost, fientes de volaille bien décomposées, et une légumineuse (niébé, arachide) en rotation." : "L'apport de compost suffit pour l'entretien." });
  if (P) out.nutrients.push({ k: "Phosphore (P)", status: P, action: P === "faible" ? "Fientes de volaille, phosphate naturel au fond du trou de plantation, et correction du pH si le sol est acide." : "Pas d'apport spécifique : le compost entretient le stock." });
  if (K) out.nutrients.push({ k: "Potassium (K)", status: K, action: K === "faible" ? "Cendre de bois, cabosses de cacao compostées, tiges de bananier : ce sont des sources locales riches en potassium." : "Pas d'apport spécifique : laissez les résidus de culture sur la parcelle." });
  const lows = out.nutrients.filter((x) => x.status === "faible").map((x) => x.k.split(" ")[0].toLowerCase());
  if (lows.length) out.priorities.push("Renforcer " + lows.join(", ").replace(/, ([^,]*)$/, " et $1") + " avec les sources organiques indiquées.");
  if (!out.nutrients.length) out.nutrients_note = "Azote, phosphore et potassium ne sont pas disponibles pour cet endroit dans les cartes de sol : une analyse de laboratoire est recommandée.";

  out.mineral = "Le compost ne remplace pas toujours tout l'engrais. Si la culture en a besoin, un engrais minéral reste possible en complément : dose modérée, fractionnée, placée près du pied sur sol humide, jamais en excès. La dose précise se trouve dans votre itinéraire technique. Un sol riche en matière organique permet souvent d'en utiliser moins.";
  out.caveat = "Estimation issue des cartes de sol satellitaires (" + (est.source || "carte de sol") + "), pas une analyse de laboratoire. Les doses sont des ordres de grandeur : commencez par le bas de la fourchette si la qualité du compost est incertaine, et observez la culture.";
  if (!group) out.priorities.push("Indiquez la culture pour obtenir une dose de compost adaptée.");
  return out;
}

const frNum = (v) => { const [i, d] = String(v).split("."); return i.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f") + (d ? "," + d : ""); };
const fmtR = (a, u) => (a[0] === a[1] ? frNum(a[0]) : frNum(a[0]) + " à " + frNum(a[1])) + (u ? " " + u : "");

/** Message court et clair à envoyer au producteur (WhatsApp, SMS). */
function shareMessage(o) {
  const L = [];
  L.push("Terravive — " + (o.parcelName || "Ma parcelle") + (o.crop ? " (" + o.crop + ")" : ""));
  const irr = o.advice && o.advice.irrigation;
  if (irr && !irr.paddy && irr.dose_l_m2) {
    L.push("");
    L.push("Arrosage : " + String(irr.dose_l_m2).replace(".", ",") + " L par m²" + (irr.interval_days ? ", environ tous les " + irr.interval_days + " jours sans pluie" : "") + ". Arrosez tôt le matin ou en fin de journée.");
  }
  const s = o.advice && o.advice.sensor;
  if (s && s.threshold_pct) L.push("Capteur : arroser quand l'humidité passe sous " + s.threshold_pct + " %.");
  const f = o.fert;
  if (f && f.organic) {
    const g = f.organic;
    L.push("");
    if (g.total_kg) L.push("Compost : " + fmtR(g.total_kg, "kg") + " pour la parcelle (≈ " + fmtR(g.wheelbarrows, "brouettes") + "), soit " + fmtR(g.dose_kg_m2, "kg par m²") + ".");
    else if (g.dose_kg_m2) L.push("Compost : " + fmtR(g.dose_kg_m2, "kg par m²") + ".");
    else if (g.dose_kg_plant) L.push("Compost : " + fmtR(g.dose_kg_plant, "kg par pied") + " chaque année.");
    if (g.status === "faible") L.push("Le sol manque de matière organique : c'est la priorité.");
  }
  if (f && f.ph && f.ph.lime_t_ha) L.push("Sol acide (pH " + String(f.ph.value).replace(".", ",") + ") : cendre de bois 100 à 200 g par m², un mois avant le semis.");
  if (f) f.nutrients.filter((x) => x.status === "faible").forEach((x) => L.push("• " + x.k + " faible : " + x.action.charAt(0).toLowerCase() + x.action.slice(1)));
  L.push("");
  L.push("Conseil indicatif, à vérifier sur le terrain.");
  return L.join("\n");
}

module.exports = { fertilityAdvice, shareMessage, zoneAreaM2, GROUPS, KG_PER_WHEELBARROW };
