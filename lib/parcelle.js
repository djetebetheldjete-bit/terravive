"use strict";
// Terravive — fiche parcelle unifiée : ce que l'on sait de la parcelle (et ce qui manque), et contrôles
// de cohérence du carnet (Quality Guard des données). Les autres modules (conseiller, itinéraire, alertes)
// relisent cette fiche : une seule source de vérité par parcelle.

const SOL_TEXTURES = require("./sol").TEXTURES; // noms des textures de sol en français

const MODES = {
  agroecologie: "Agroécologie / agriculture régénératrice",
  bio: "Agriculture biologique (sans chimie de synthèse)",
  conservation: "Agriculture de conservation",
  raisonnee: "Agriculture conventionnelle raisonnée"
};
const STAGES = {
  preparation: "Préparation du sol", semis: "Semis / plantation", levee: "Levée / reprise", croissance: "Croissance",
  floraison: "Floraison", fructification: "Fructification / remplissage", recolte: "Récolte en cours", apres: "Après récolte"
};
const IRRIGATION = { pluvial: "Pluie seulement", arrosoir: "Arrosoir / seau (manuel)", tuyau: "Tuyau / pompe", goutte: "Goutte-à-goutte", aspersion: "Aspersion" };
const MECA = { manuel: "Travail manuel (sans tracteur)", traction: "Traction animale", motorise: "Motoculteur / tracteur" };
const BUDGET = { limite: "Limité", moyen: "Moyen", confortable: "Confortable" };

function clean(s, n) { return String(s == null ? "" : s).trim().slice(0, n || 80); }
function isDay(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); if (!m) return false; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCDate() === +m[3]; }

/** Valide une mise à jour de fiche. Renvoie {error} ou {fiche} (seuls les champs fournis). */
function checkFicheInput(p) {
  const f = {};
  if ("variety" in p) f.variety = clean(p.variety, 80) || null;
  if ("campaign" in p) f.campaign = clean(p.campaign, 60) || null;
  for (const [k, dict] of [["mode", MODES], ["stage", STAGES], ["irrigation", IRRIGATION], ["mechanization", MECA], ["budget", BUDGET]]) {
    if (k in p) { if (p[k] === "" || p[k] == null) f[k] = null; else if (!dict[p[k]]) return { error: "Valeur inconnue pour « " + k + " »." }; else f[k] = p[k]; }
  }
  if ("stage" in f) f.stage_at = f.stage ? new Date().toISOString().slice(0, 10) : null;
  if ("expected_yield_kg" in p) {
    if (p.expected_yield_kg === "" || p.expected_yield_kg == null) f.expected_yield_kg = null;
    else { const v = Number(p.expected_yield_kg); if (!Number.isFinite(v) || v <= 0 || v > 1e7) return { error: "Rendement attendu invalide (kg)." }; f.expected_yield_kg = Math.round(v); }
  }
  return { fiche: f };
}

/**
 * Ce qui manque sur la parcelle, et ce qui est incohérent dans son carnet.
 * @param {object} c { fiche, soil:{crop,sown_at,estimate,manual}, entries:[{kind,date,qty}], areaM2, ndvi, today }
 */
function checkParcel(c) {
  const fiche = c.fiche || {}, soil = c.soil || {}, entries = c.entries || [], today = c.today || new Date().toISOString().slice(0, 10);
  const missing = [];
  const need = (ok, field, label, why) => { if (!ok) missing.push({ field, label, why }); };
  need(soil.crop, "crop", "Culture", "Sans culture, pas de tâches ni de conseils adaptés.");
  need(soil.sown_at, "sown_at", "Date de semis / plantation", "Elle sert à dater les tâches et à suivre le stade.");
  need(fiche.variety, "variety", "Variété", "Le cycle et la tolérance (chaleur, maladies) changent selon la variété.");
  need(fiche.mode, "mode", "Mode de conduite", "Il détermine les solutions proposées (biologique, raisonné…).");
  need(fiche.stage, "stage", "Stade actuel", "Utile pour les conseils du moment et la lecture du satellite.");
  need(fiche.irrigation, "irrigation", "Moyen d'irrigation", "Pour des doses d'arrosage réalistes.");
  need(soil.manual || soil.estimate, "soil", "Type de sol", "Estimé par satellite ou observé (test du bocal) dans « Sol & racines ».");
  need(c.ndvi != null, "ndvi", "Analyse satellite récente", "Elle aide à repérer les zones à inspecter.");

  const warnings = [];
  const warn = (code, text) => warnings.push({ code, text });
  const sown = soil.sown_at ? String(soil.sown_at).slice(0, 10) : null;
  if (sown && sown > addDays(today, 120)) warn("SOWN_FUTURE", "La date de semis (" + sown + ") est très loin dans le futur : à vérifier.");
  entries.forEach((e) => {
    const d = String(e.date || "").slice(0, 10);
    if (d && d > addDays(today, 1)) warn("ENTRY_FUTURE", "Une saisie « " + e.kind + " » est datée dans le futur (" + d + ").");
    if (sown && e.kind === "recolte" && d && d < sown) warn("HARVEST_BEFORE_SOWING", "Une récolte (" + d + ") est notée avant la date de semis (" + sown + ").");
    if (e.kind === "arrosage" && c.areaM2 > 0 && Number(e.qty) / c.areaM2 > 60) warn("WATER_EXCESS", "Un arrosage de " + e.qty + " L sur " + Math.round(c.areaM2) + " m² (" + Math.round(Number(e.qty) / c.areaM2) + " L/m²) paraît très élevé : unité ou surface à vérifier.");
    if (e.kind === "pluie" && Number(e.qty) > 300) warn("RAIN_EXCESS", "Une pluie de " + e.qty + " mm en un jour est exceptionnelle : à vérifier.");
  });
  const harvestKg = entries.filter((e) => e.kind === "recolte").reduce((s, e) => s + (Number(e.qty) || 0), 0);
  if (c.areaM2 > 0 && harvestKg > 0) {
    const tHa = harvestKg / 1000 / (c.areaM2 / 10000);
    if (tHa > 200) warn("YIELD_IMPLAUSIBLE", "Le rendement calculé (" + Math.round(tHa) + " t/ha) est improbable : vérifiez les quantités récoltées ou la surface de la parcelle.");
  }
  if (fiche.stage === "recolte" && !entries.some((e) => e.kind === "recolte")) warn("STAGE_NO_HARVEST", "Le stade indique « récolte en cours » mais aucune récolte n'est notée dans le carnet.");
  // doublons exacts (même jour, même type, même quantité) : souvent une saisie envoyée deux fois
  const seen = {};
  entries.forEach((e) => { const k = [e.kind, String(e.date).slice(0, 10), e.qty, e.note || ""].join("|"); seen[k] = (seen[k] || 0) + 1; });
  Object.entries(seen).forEach(([k, n]) => { if (n > 1 && k.split("|")[2] !== "") warn("DUPLICATE", "La saisie « " + k.split("|")[0] + " » du " + k.split("|")[1] + " apparaît " + n + " fois : doublon possible."); });

  const filled = 8 - missing.length;
  return { missing, warnings: dedupe(warnings), completeness: Math.round(100 * filled / 8) };
}
function addDays(day, n) { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dedupe(ws) { const s = new Set(); return ws.filter((w) => (s.has(w.text) ? false : (s.add(w.text), true))); }

/** Texte court décrivant la parcelle, pour le conseiller (faits seulement, rien d'inventé). */
function contextText(c) {
  const f = c.fiche || {}, s = c.soil || {}, lines = [];
  lines.push("Parcelle « " + (c.name || "sans nom") + " »" + (c.areaM2 ? ", " + Math.round(c.areaM2) + " m²" : "") + (c.center ? ", position " + c.center.lat.toFixed(3) + " N, " + Math.abs(c.center.lon).toFixed(3) + (c.center.lon < 0 ? " O" : " E") : "") + ".");
  lines.push("Culture : " + (s.crop || "non renseignée") + (f.variety ? " (variété " + f.variety + ")" : "") + (s.sown_at ? ", semée le " + String(s.sown_at).slice(0, 10) : "") + ".");
  if (f.stage) lines.push("Stade déclaré : " + STAGES[f.stage] + " (mis à jour le " + f.stage_at + ").");
  if (f.mode) lines.push("Mode de conduite choisi : " + MODES[f.mode] + ".");
  const means = [f.irrigation && "irrigation : " + IRRIGATION[f.irrigation], f.mechanization && MECA[f.mechanization], f.budget && "budget " + BUDGET[f.budget].toLowerCase()].filter(Boolean);
  if (means.length) lines.push("Moyens : " + means.join(", ") + ".");
  const texName = (code) => (SOL_TEXTURES[code] && SOL_TEXTURES[code].fr) || code;
  const tex = s.manual && s.manual.texture ? texName(s.manual.texture) + " (observé au champ)" : s.estimate && s.estimate.texture ? texName(s.estimate.texture) + " (estimé par satellite, " + (s.estimate.source || "carte de sol") + ")" : null;
  if (tex) lines.push("Sol : " + tex + ".");
  if (c.ndvi) lines.push("Dernière analyse satellite (NDVI) : " + c.ndvi.ndvi + (c.ndvi.measured_at ? " le " + String(c.ndvi.measured_at).slice(0, 10) : "") + (c.ndvi.pct_faible != null ? ", " + c.ndvi.pct_faible + " % de la surface en végétation faible" : "") + ". Le NDVI signale des zones à inspecter, il ne diagnostique pas.");
  if (c.entries && c.entries.length) lines.push("Dernières notes du carnet : " + c.entries.slice(0, 8).map((e) => String(e.date).slice(0, 10) + " " + e.kind + (e.qty != null && e.qty !== "" ? " " + e.qty + (e.unit ? " " + e.unit : "") : "") + (e.note ? " (" + String(e.note).slice(0, 80) + ")" : "")).join(" ; ") + ".");
  else lines.push("Carnet : aucune note.");
  if (c.climate && c.climate.length) lines.push("Climat sur ~35 ans (" + c.climateSource + ") : " + c.climate.join(" ; ") + ".");
  const miss = (c.missing || []).map((m) => m.label.toLowerCase());
  if (miss.length) lines.push("Données NON disponibles : " + miss.join(", ") + ".");
  return lines.join("\n");
}

module.exports = { MODES, STAGES, IRRIGATION, MECA, BUDGET, checkFicheInput, checkParcel, contextText };
