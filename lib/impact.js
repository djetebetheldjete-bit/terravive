"use strict";
// Terravive — bilan d'impact d'une parcelle à partir du carnet de champ.
// Chaque chiffre est accompagné de sa NATURE (d'où il vient) pour ne jamais confondre
// une mesure avec une estimation :
//   mesure      : noté dans le carnet de champ (quantités réellement apportées ou récoltées)
//   declare     : saisi à la main comme référence « avant » (souvenir, cahier papier)
//   satellite   : estimé à partir d'images ou de cartes satellitaires
//   modele      : calculé par un modèle à partir d'autres chiffres + hypothèses écrites
//   hypothese   : valeur supposée, à confirmer
//   repere      : repère général publié (source citée), pas une mesure de la parcelle
// Rien n'est inventé : sans saisie, l'indicateur est absent.

const NATURES = {
  mesure: { label: "Mesuré", hint: "noté dans le carnet de champ" },
  declare: { label: "Déclaré", hint: "référence saisie à la main" },
  satellite: { label: "Estimé satellite", hint: "images ou cartes satellitaires" },
  modele: { label: "Estimé (calcul)", hint: "calcul à partir d'autres chiffres et d'hypothèses écrites" },
  hypothese: { label: "Hypothèse", hint: "valeur supposée, à confirmer" },
  repere: { label: "Repère général", hint: "valeur publiée, source citée" }
};
const RESIDUS = require("./residus");

// Hypothèses écrites et visibles pour le carbone apporté par le compost.
const CARBON_HYP = { dry_matter: 0.5, carbon_of_dm: 0.3, co2_per_c: 44 / 12, retained: [0.1, 0.2] };

const r = (x, d) => { const k = Math.pow(10, d == null ? 1 : d); return Math.round(x * k) / k; };
const num = (v) => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
function val(v, unit, nature, source, extra) { return v == null ? null : Object.assign({ v, unit, nature, source }, extra || {}); }

/** Saison par défaut, d'après la date (calendrier ivoirien simplifié). */
function defaultSeason(date) {
  const d = new Date(String(date || "") + "T12:00:00Z");
  if (isNaN(d)) return "Sans saison";
  const m = d.getUTCMonth() + 1, y = d.getUTCFullYear();
  if (m >= 3 && m <= 7) return y + " · grande saison";
  if (m >= 8 && m <= 11) return y + " · petite saison";
  return (m === 12 ? y : y - 1) + "-" + (m === 12 ? y + 1 : y) + " · saison sèche";
}
function seasonOf(e) { return (e.season && String(e.season).trim()) || defaultSeason(e.date); }

/** Totaux d'une liste d'entrées (une saison). */
function seasonTotals(entries, areaM2) {
  const t = { from: null, to: null, n: entries.length, water_l: 0, water_n: 0, rain_mm: 0, rain_n: 0, compost_kg: 0, chem_kg: 0, chem_n: 0, treat_n: 0, treat_l: 0, harvest_kg: 0, harvest_n: 0, loss_kg: 0, loss_n: 0, residue_kg: 0, residue_n: 0, residue_routes: {}, germ_tests: [], incidents: [], products: {} };
  entries.forEach((e) => {
    if (!t.from || e.date < t.from) t.from = e.date;
    if (!t.to || e.date > t.to) t.to = e.date;
    const q = num(e.qty);
    switch (e.kind) {
      case "arrosage": t.water_n++; if (q != null) t.water_l += q; break;
      case "compost": if (q != null) t.compost_kg += q; break;
      case "engrais": t.chem_n++; if (q != null) t.chem_kg += q; break;
      case "traitement": t.treat_n++; if (q != null) t.treat_l += q; break;
      case "recolte": t.harvest_n++; if (q != null) t.harvest_kg += q; break;
      case "pluie": t.rain_n++; if (q != null) t.rain_mm += q; break;
      case "perte": t.loss_n++; if (q != null) t.loss_kg += q; break;
      // Résidus valorisés : total en kg et détail par voie (compost, paillis…), d'après le carnet.
      case "residu": t.residue_n++; if (q != null) { t.residue_kg += q; const k = String(e.product || "").trim() || "Voie non précisée"; t.residue_routes[k] = r((t.residue_routes[k] || 0) + q, 2); } break;
      // Tests de germination du compost : gardés un par un (un pourcentage ne s'additionne pas).
      case "germination": t.germ_tests.push({ date: e.date, pct: q, note: e.note || "" }); break;
      case "incident": t.incidents.push({ date: e.date, note: e.note || "" }); break;
      default: break;
    }
    if (e.product && (e.kind === "engrais" || e.kind === "traitement" || e.kind === "compost")) {
      const k = String(e.product).trim().slice(0, 60); if (k) t.products[k] = r((t.products[k] || 0) + (q || 0), 2);
    }
  });
  ["water_l", "rain_mm", "compost_kg", "chem_kg", "treat_l", "harvest_kg", "loss_kg", "residue_kg"].forEach((k) => { t[k] = r(t[k], 2); });
  return withRatios(t, areaM2);
}
function withRatios(t, areaM2) {
  const a = areaM2 && areaM2 > 0 ? areaM2 : null;
  t.water_l_m2 = a && t.water_l ? r(t.water_l / a, 1) : null;
  t.compost_kg_m2 = a && t.compost_kg ? r(t.compost_kg / a, 2) : null;
  t.chem_kg_ha = a && t.chem_kg != null ? r(t.chem_kg / a * 10000, 0) : null;
  t.yield_t_ha = a && t.harvest_kg ? r(t.harvest_kg / a * 10, 2) : null;
  // Récolte vendable = récolte − invendable (pertes notées) ; 1 mm de pluie = 1 L par m².
  t.sellable_kg = t.harvest_kg ? r(Math.max(0, t.harvest_kg - (t.loss_kg || 0)), 2) : null;
  t.sellable_t_ha = a && t.sellable_kg ? r(t.sellable_kg / a * 10, 2) : null;
  t.total_water_l_m2 = t.water_l_m2 != null || t.rain_n ? r((t.water_l_m2 || 0) + (t.rain_mm || 0), 1) : null;
  t.water_per_kg = t.water_l && t.sellable_kg ? r(t.water_l / t.sellable_kg, 1) : null;
  // Productivité de l'eau d'arrosage : kg récoltés par m³ apporté (la pluie n'est pas comptée).
  t.water_prod_kg_m3 = t.harvest_kg && t.water_l ? r(t.harvest_kg / (t.water_l / 1000), 1) : null;
  return t;
}

/** Référence « avant » saisie à la main (totaux d'une saison complète). */
function refTotals(ref, areaM2) {
  if (!ref) return null;
  const t = { label: ref.label || "Référence saisie", water_l: num(ref.water_l), compost_kg: num(ref.compost_kg), chem_kg: num(ref.chem_kg), harvest_kg: num(ref.yield_kg) };
  if ([t.water_l, t.compost_kg, t.chem_kg, t.harvest_kg].every((x) => x == null)) return null;
  return withRatios(t, areaM2);
}

function compare(cur, base, key, unit, betterWhen, curNature, baseNature) {
  const c = cur && cur[key], b = base && base[key];
  if (c == null || b == null) return null;
  const delta = r(c - b, 2), pct = b !== 0 ? r((c - b) / b * 100, 0) : null;
  const better = delta === 0 ? null : betterWhen === "lower" ? delta < 0 : delta > 0;
  return { key, unit, current: val(c, unit, curNature, "carnet de champ"), baseline: val(b, unit, baseNature, baseNature === "declare" ? "référence saisie" : "saison précédente (carnet)"), delta, pct, better };
}

/** Carbone apporté au sol par le compost noté (calcul transparent, hypothèses écrites). */
function compostCarbon(compostKg) {
  if (!compostKg) return null;
  const c = compostKg * CARBON_HYP.dry_matter * CARBON_HYP.carbon_of_dm;
  return {
    carbon_kg: val(r(c, 0), "kg C", "modele", "compost noté × hypothèses"),
    co2e_kg: val(r(c * CARBON_HYP.co2_per_c, 0), "kg CO₂e", "modele", "carbone × 44/12"),
    retained_co2e_kg: val([r(c * CARBON_HYP.co2_per_c * CARBON_HYP.retained[0], 0), r(c * CARBON_HYP.co2_per_c * CARBON_HYP.retained[1], 0)], "kg CO₂e", "hypothese", "part restant durablement dans le sol"),
    hypotheses: ["Compost à 50 % de matière sèche", "Carbone = 30 % de la matière sèche", "10 à 20 % de ce carbone reste dans le sol après quelques années (le reste est respiré par la vie du sol)"]
  };
}

/**
 * Résidus valorisés de la saison (mesurés dans le carnet), détail par voie, et part mise au compost
 * face aux matières à réunir d'après la fiche sol (estimation), quand elle existe.
 */
function residueSummary(t, rawNeedKg) {
  if (!t || !t.residue_n) return null;
  const routes = Object.keys(t.residue_routes).map((k) => ({ label: k, kg: t.residue_routes[k] })).sort((a, b) => b.kg - a.kg);
  const composted = t.residue_routes[RESIDUS.ROUTES.compost.label] || 0;
  const out = { total: val(t.residue_kg, "kg", "mesure", "carnet de champ"), entries: t.residue_n, routes };
  if (composted) out.composted = val(composted, "kg", "mesure", "carnet de champ");
  if (Array.isArray(rawNeedKg) && rawNeedKg[0] > 0) {
    out.need = val(rawNeedKg, "kg", "modele", "fiche sol : compost conseillé × 3 kg de matières par kg de compost");
    out.need_pct = [r(composted / rawNeedKg[1] * 100, 0), r(composted / rawNeedKg[0] * 100, 0)];
  }
  return out;
}
/** Dernier test de germination de la saison, avec le repère de lecture (source citée). */
function germinationSummary(t) {
  if (!t || !t.germ_tests.length) return null;
  const last = t.germ_tests[t.germ_tests.length - 1], G = RESIDUS.GERMINATION;
  const level = last.pct == null ? "indetermine" : /sans témoin/.test(last.note) ? "indetermine" : last.pct >= G.ok_pct ? "ok" : last.pct >= G.low_pct ? "moyen" : "faible";
  return {
    date: last.date, tests: t.germ_tests.length, level, detail: last.note,
    pct: last.pct == null ? null : val(last.pct, level === "indetermine" ? "% de levée" : "% de la levée du témoin", "mesure", "graines comptées, carnet de champ"),
    threshold: val([G.low_pct, G.ok_pct], "%", "repere", G.sources.map((s) => s.name).join(" ; ")),
    reading: "À partir de " + G.ok_pct + " % de la levée du témoin, le compost est jugé satisfaisant ; en dessous de " + G.low_pct + " %, il faut poursuivre le compostage."
  };
}

/**
 * Bilan d'impact d'une parcelle.
 * @param {object} o { entries, areaM2, ref, parcelName, rawNeedKg }
 */
function impactReport(o) {
  const entries = (o.entries || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const areaM2 = o.areaM2 || null;
  const groups = {};
  entries.forEach((e) => { const s = seasonOf(e); (groups[s] = groups[s] || []).push(e); });
  const seasons = Object.keys(groups).map((s) => Object.assign({ season: s }, seasonTotals(groups[s], areaM2))).sort((a, b) => String(a.from).localeCompare(String(b.from)));
  const current = seasons.length ? seasons[seasons.length - 1] : null;
  const ref = refTotals(o.ref, areaM2);
  let baseline = null, baseNature = null;
  if (ref) { baseline = ref; baseNature = "declare"; }
  else if (seasons.length > 1) { baseline = seasons[seasons.length - 2]; baseNature = "mesure"; }
  const comparisons = current && baseline ? [
    compare(current, baseline, "water_l_m2", "L/m²", "lower", "mesure", baseNature),
    compare(current, baseline, "chem_kg_ha", "kg/ha", "lower", "mesure", baseNature),
    compare(current, baseline, "compost_kg_m2", "kg/m²", "higher", "mesure", baseNature),
    compare(current, baseline, "yield_t_ha", "t/ha", "higher", "mesure", baseNature),
    compare(current, baseline, "water_prod_kg_m3", "kg/m³", "higher", "mesure", baseNature)
  ].filter(Boolean) : [];
  const savings = {};
  if (current && baseline && areaM2) {
    if (current.water_l_m2 != null && baseline.water_l_m2 != null) savings.water_l = val(r((baseline.water_l_m2 - current.water_l_m2) * areaM2, 0), "L", "modele", "écart par m² × surface");
    if (current.chem_kg_ha != null && baseline.chem_kg_ha != null) savings.chem_kg = val(r((baseline.chem_kg_ha - current.chem_kg_ha) * areaM2 / 10000, 1), "kg", "modele", "écart par ha × surface");
  }
  const missing = [];
  if (!areaM2) missing.push("Surface de la parcelle (dessinez-la sur la carte) : sans elle, pas de calcul par m² ou par hectare.");
  if (!current) missing.push("Aucune entrée dans le carnet de champ.");
  else {
    if (!current.harvest_n) missing.push("Aucune récolte notée cette saison : le rendement ne peut pas être calculé.");
    if (!current.water_n) missing.push("Aucun arrosage noté cette saison.");
  }
  // Facultatif : sans point de comparaison, le bilan reste complet ; on indique seulement comment mesurer les économies.
  const tips = [];
  if (!baseline) tips.push("Pour mesurer ce que Terravive vous fait économiser, il faut un point de comparaison. Au choix : une parcelle témoin cultivée en même temps (le plus fiable), une saison de référence saisie de mémoire, ou simplement votre prochaine saison sur cette parcelle.");
  return {
    parcel: { name: o.parcelName || null, area_m2: areaM2 != null ? val(areaM2, "m²", "satellite", "parcelle dessinée sur la carte") : null },
    seasons, current, baseline: baseline ? Object.assign({ nature: baseNature }, baseline) : null,
    comparisons, savings, carbon: current ? compostCarbon(current.compost_kg) : null,
    residues: residueSummary(current, o.rawNeedKg), germination: germinationSummary(current),
    missing, tips, natures: NATURES
  };
}

/**
 * Réponses du questionnaire de durabilité qu'on peut déduire du carnet (mesuré).
 * @param items [{ t: totaux de la saison en cours, area_m2, rec_kg_m2 (dose de compost conseillée, bas de fourchette) }]
 */
function durabilityFromLog(items) {
  const out = {};
  const s = (items || []).filter((x) => x && x.t && x.t.n >= 3);
  if (!s.length) return out;
  const compostKg = s.reduce((a, x) => a + (x.t.compost_kg || 0), 0);
  const chemKg = s.reduce((a, x) => a + (x.t.chem_kg || 0), 0);
  const chemN = s.reduce((a, x) => a + (x.t.chem_n || 0), 0);
  const withRec = s.filter((x) => x.area_m2 && x.rec_kg_m2);
  const allMeet = withRec.length === s.length && withRec.every((x) => (x.t.compost_kg || 0) / x.area_m2 >= x.rec_kg_m2);
  if (compostKg === 0) out.mo = { value: 0, why: "Aucun apport de compost noté dans le carnet pour la saison en cours." };
  else if (allMeet) out.mo = { value: 100, why: "Compost noté sur chaque parcelle suivie, au moins à la dose conseillée par la fiche sol." };
  else out.mo = { value: 50, why: "Compost noté : " + r(compostKg, 0) + " kg pour la saison en cours" + (withRec.length ? ", sous la dose conseillée sur au moins une parcelle" : "") + "." };
  if (chemN === 0) out.intrant = { value: 100, why: "Aucun engrais chimique noté dans le carnet pour la saison en cours." };
  else out.intrant_note = "Engrais chimique noté : " + r(chemKg, 1) + " kg pour la saison en cours. Choisissez « Modéré » ou « Beaucoup » selon votre situation.";
  out.parcels = s.length;
  return out;
}

/**
 * Comparaison côte à côte de deux parcelles (moitié Terravive et moitié témoin), saison en cours de chacune.
 * Écart = (Terravive − témoin) ÷ témoin. Chaque ligne dit si une valeur plus basse ou plus haute est meilleure.
 */
const PAIR_ROWS = [
  { key: "water_l_m2", label: "Eau d'arrosage", unit: "L/m²", better: "lower" },
  { key: "total_water_l_m2", label: "Eau totale reçue (arrosage + pluie)", unit: "L/m²", better: "lower" },
  { key: "chem_kg_ha", label: "Engrais chimique", unit: "kg/ha", better: "lower" },
  { key: "compost_kg_m2", label: "Compost apporté", unit: "kg/m²", better: null },
  { key: "sellable_kg", label: "Récolte vendable", unit: "kg", better: "higher" },
  { key: "sellable_t_ha", label: "Rendement vendable", unit: "t/ha", better: "higher" },
  { key: "water_per_kg", label: "Eau d'arrosage par kg vendable", unit: "L/kg", better: "lower" },
  { key: "incidents_n", label: "Incidents notés", unit: "", better: null }
];
function compareParcels(a, b) {
  if (!a || !b || !a.current || !b.current) return null;
  const A = Object.assign({ incidents_n: a.current.incidents.length }, a.current), B = Object.assign({ incidents_n: b.current.incidents.length }, b.current);
  const rows = PAIR_ROWS.map((d) => {
    const x = A[d.key], y = B[d.key];
    if (x == null && y == null) return null;
    const pct = x != null && y != null && y !== 0 ? r((x - y) / y * 100, 1) : null;
    let verdict = null;
    if (d.better && x != null && y != null) verdict = x === y ? "egal" : (d.better === "lower" ? x < y : x > y) ? "terravive" : "temoin";
    return { key: d.key, label: d.label, unit: d.unit, better: d.better, terravive: val(x, d.unit, "mesure", "carnet de champ"), temoin: val(y, d.unit, "mesure", "carnet de champ"), pct, verdict };
  }).filter(Boolean);
  const warnings = [];
  if (a.current.season !== b.current.season) warnings.push("Les deux parcelles n'ont pas le même nom de saison (« " + a.current.season + " » et « " + b.current.season + " ») : vérifiez qu'on compare bien la même campagne.");
  const ra = a.current.rain_mm || 0, rb = b.current.rain_mm || 0;
  if ((a.current.rain_n || b.current.rain_n) && Math.abs(ra - rb) > Math.max(5, 0.2 * Math.max(ra, rb))) warnings.push("La pluie notée diffère entre les deux parcelles (" + ra + " mm et " + rb + " mm) : notez le même relevé du pluviomètre sur les deux.");
  const pa = a.parcel.area_m2 && a.parcel.area_m2.v, pb = b.parcel.area_m2 && b.parcel.area_m2.v;
  if (pa && pb && Math.abs(pa - pb) / Math.max(pa, pb) > 0.15) warnings.push("Les surfaces dessinées diffèrent de plus de 15 % (" + pa + " m² et " + pb + " m²) : les totaux en kg ne sont pas directement comparables ; regardez plutôt les valeurs par m² ou par hectare.");
  if (!a.current.harvest_n || !b.current.harvest_n) warnings.push("Récolte pas encore notée sur les deux parcelles : la comparaison de rendement viendra avec les pesées.");
  const decided = rows.filter((x) => x.verdict === "terravive" || x.verdict === "temoin");
  return {
    terravive: { name: a.parcel.name, season: a.current.season, area_m2: pa || null },
    temoin: { name: b.parcel.name, season: b.current.season, area_m2: pb || null },
    rows, warnings,
    score: { terravive: decided.filter((x) => x.verdict === "terravive").length, temoin: decided.filter((x) => x.verdict === "temoin").length }
  };
}

/** Lignes CSV (séparateur ;) d'un bilan. */
function reportCsv(rep) {
  const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const n = (v) => (v == null ? "" : String(v).replace(".", ","));
  const rows = [["saison", "du", "au", "eau_L", "eau_L_m2", "pluie_mm", "eau_totale_L_m2", "compost_kg", "compost_kg_m2", "engrais_chimique_kg", "engrais_kg_ha", "traitements", "recolte_kg", "invendable_kg", "vendable_kg", "rendement_vendable_t_ha", "L_eau_par_kg_vendable", "incidents", "residus_valorises_kg", "dont_compost_kg", "dernier_test_germination_pct"]];
  rep.seasons.forEach((s) => rows.push([s.season, s.from, s.to, n(s.water_l), n(s.water_l_m2), n(s.rain_mm), n(s.total_water_l_m2), n(s.compost_kg), n(s.compost_kg_m2), n(s.chem_kg), n(s.chem_kg_ha), s.treat_n, n(s.harvest_kg), n(s.loss_kg), n(s.sellable_kg), n(s.sellable_t_ha), n(s.water_per_kg), s.incidents.length, n(s.residue_n ? s.residue_kg : null), n(s.residue_routes[RESIDUS.ROUTES.compost.label] || null), n(s.germ_tests.length ? s.germ_tests[s.germ_tests.length - 1].pct : null)]));
  if (rep.pair) {
    rows.push([]); rows.push(["comparaison", rep.pair.terravive.name + " (Terravive)", rep.pair.temoin.name + " (témoin)", "ecart_pct", "le_mieux", "verdict"]);
    rep.pair.rows.forEach((x) => rows.push([x.label + (x.unit ? " (" + x.unit + ")" : ""), n(x.terravive && x.terravive.v), n(x.temoin && x.temoin.v), n(x.pct), x.better === "lower" ? "plus bas" : x.better === "higher" ? "plus haut" : "", x.verdict === "terravive" ? "Terravive mieux" : x.verdict === "temoin" ? "Témoin mieux" : x.verdict === "egal" ? "Égalité" : ""]));
  }
  return "﻿" + rows.map((x) => x.map(q).join(";")).join("\r\n");
}

module.exports = { residueSummary, germinationSummary, compareParcels, PAIR_ROWS, impactReport, seasonTotals, defaultSeason, seasonOf, durabilityFromLog, reportCsv, compostCarbon, NATURES, CARBON_HYP };
