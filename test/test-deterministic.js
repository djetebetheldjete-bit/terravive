"use strict";
/**
 * test-deterministic.js — TESTS DÉTERMINISTES sur le CODE DE PRODUCTION réel.
 *
 * Vérifie ce qu'un ordinateur PEUT prouver, sans appeler l'IA :
 *  - conversion et validation des surfaces (parseArea) ;
 *  - contenu transmis au modèle (planUserMessage) pour chaque scénario ;
 *  - garde-fous présents dans l'invite système (planSystem) ;
 *  - gestion des entrées invalides ;
 *  - contrat de la route /api/plan (inspection du source).
 *
 * N'appelle JAMAIS api.anthropic.com et n'ouvre aucun port.
 */
const fs = require("fs");
const T = require("./lib/harness");
const { loadServer, resolveServerPath } = require("./lib/load-server");
const { scenarios } = require("./scenarios");

function run() {
  T.reset();
  const api = loadServer();

  // ---------- 1) parseArea : conversions et refus ----------
  T.test("parseArea — conversions correctes (m², are, ha)", () => {
    T.equal(api.parseArea("1000 m²").ha, 0.1, "1000 m² = 0,1 ha");
    T.equal(api.parseArea("1000 m²").m2, 1000, "1000 m² = 1000 m²");
    T.equal(api.parseArea("2 ha").ha, 2, "2 ha = 2 ha");
    T.equal(api.parseArea("2 ha").m2, 20000, "2 ha = 20 000 m²");
    T.equal(api.parseArea("50 ares").ha, 0.5, "50 ares = 0,5 ha");
    T.equal(api.parseArea("0,25 ha").ha, 0.25, "virgule décimale acceptée");
    T.equal(api.parseArea("500 m2").m2, 500, "« m2 » accepté comme m²");
  });

  T.test("parseArea — refus des surfaces invalides", () => {
    T.equal(api.parseArea("0").ok, false, "0 refusé");
    T.equal(api.parseArea("-5 ha").ok, false, "négatif refusé");
    T.equal(api.parseArea("beaucoup").ok, false, "non numérique refusé");
    T.equal(api.parseArea("500").ok, false, "sans unité refusé");
    T.equal(api.parseArea("").ok, false, "vide refusé");
    T.equal(api.parseArea(null).ok, false, "null refusé");
  });

  // ---------- 2) planSystem : garde-fous globaux présents ----------
  T.test("planSystem — garde-fous Prompts 1→5 présents", () => {
    const s = api.planSystem();
    T.contains(s, "SIGNALER LES INCERTITUDES", "garde-fou incertitudes (Prompt 1)");
    T.contains(s, "FICHE D'ACTION", "fiches d'action (Prompt 2)");
    T.contains(s, "CALCUL DES QUANTITÉS", "calcul des quantités (Prompt 2)");
    T.contains(s, "SÉCURISER LES DOSES", "classes de dose A/B/C/D (fiabilité)");
    T.contains(s, "Dose à confirmer auprès d'un technicien", "formulation de repli dose");
    T.contains(s, "ADAPTATION LOCALE (Côte d'Ivoire)", "adaptation locale (Prompt 5)");
    T.contains(s, "Disponibilité locale à confirmer", "disponibilité à confirmer (Prompt 5)");
    T.contains(s, "n'est pas le BÉNÉFICE RÉEL", "marge ≠ bénéfice (Prompt 2)");
    T.contains(s, "COMPLÉTUDE OBLIGATOIRE", "complétude 18 sections (fix plafond)");
    T.contains(s, "JAMAIS d'emojis", "interdiction emojis (style)");
    // 18 sections dans l'ordre
    let last = -1, ok = true;
    for (let i = 1; i <= 18; i++) { const idx = s.indexOf("## " + i + "."); if (idx === -1 || idx < last) ok = false; last = idx; }
    T.ok(ok, "les 18 titres de section sont présents et ordonnés dans l'invite");
    // 4 modes
    T.contains(s, "AGROÉCOLOGIE / RÉGÉNÉRATIF", "mode agroécologie");
    T.contains(s, "AGRICULTURE BIOLOGIQUE", "mode biologique");
    T.contains(s, "AGRICULTURE DE CONSERVATION", "mode conservation");
    T.contains(s, "CONVENTIONNEL RAISONNÉ", "mode conventionnel");
  });

  // ---------- 2bis) planSystem : corrections agronomiques Prompt 8 ----------
  T.test("planSystem — corrections agronomiques (Prompt 8) présentes", () => {
    const s = api.planSystem();
    T.contains(s, "PRESSION DES MALADIES", "fenêtre de plantation vs pression maladies (§5)");
    T.contains(s, "COHÉRENTE avec l'écartement", "cohérence densité ↔ écartement (§5)");
    T.contains(s, "MATURITÉ et de la QUALITÉ", "dose organique liée à la qualité du compost (§4)");
    T.contains(s, "l'ortie et la consoude sont des plantes tempérées", "purins : ressources réellement locales (§7)");
    T.contains(s, "vers le BAS de la fourchette", "rendement réaliste selon contraintes (§16)");
    T.contains(s, "ne regroupe pas sous l'étiquette", "variété reliée aux conditions précises (§2)");
  });

  // ---------- 2ter) planSystem : affinages Prompt 9 ----------
  T.test("planSystem — affinages (Prompt 9) présents", () => {
    const s = api.planSystem();
    // Rendement : 3 scénarios + signaler le manque de références locales (§16)
    T.contains(s, "TROIS SCÉNARIOS — PRUDENT, INTERMÉDIAIRE, FAVORABLE", "rendement en 3 scénarios (§16)");
    T.contains(s, "RÉFÉRENCES LOCALES fiables pour chiffrer", "signaler l'absence de références locales (§16)");
    T.contains(s, "ne remplace pas une fourchette par une autre sans base", "pas de fourchette imposée sans base (§16)");
    // Densité : justifier, ne pas imposer une distance unique (§5)
    T.contains(s, "JUSTIFIE l'écartement et la densité retenus selon la VARIÉTÉ", "densité justifiée par variété/tuteurage/conduite/risque (§5)");
    T.contains(s, "n'IMPOSE PAS une distance unique", "pas de distance unique imposée (§5)");
    // Compost : adapter à la quantité réellement disponible (§4)
    T.contains(s, "quantité de compost RÉELLEMENT DISPONIBLE", "compost adapté aux ressources réelles (§4)");
    T.contains(s, "PRIORISE les apports", "prioriser les apports si ressource limitée (§4)");
  });

  // ---------- 2quater) planSystem : carences prudentes Prompt 10 (§10) ----------
  T.test("planSystem — interprétation prudente des carences (Prompt 10) présente", () => {
    const s = api.planSystem();
    T.contains(s, "INDICES À CONFIRMER", "symptômes présentés comme indices, pas diagnostic (§10)");
    T.contains(s, "PLUSIEURS CAUSES", "plusieurs causes possibles pour un même symptôme (§10)");
    T.contains(s, "ce qu'il faut OBSERVER pour les distinguer", "observations pour distinguer les causes (§10)");
    T.contains(s, "pH ÉLEVÉ qui BLOQUE l'assimilation", "fer : blocage par pH, vérifier avant apport (§10)");
    T.contains(s, "du STADE de la culture, du TYPE DE SOL et de l'HISTORIQUE", "tenir compte stade/sol/historique (§10)");
    T.contains(s, "N'IMPOSE PAS une dose corrective précise", "pas de dose corrective sans données (§10)");
  });

  // ---------- 3) Par scénario : contenu transmis + garde-fous ciblés ----------
  const system = api.planSystem();
  for (const sc of scenarios) {
    if (sc.input) {
      T.test(`Scénario ${sc.id} — message transmis au modèle (planUserMessage)`, () => {
        const msg = api.planUserMessage(sc.input);
        for (const a of sc.promptAttendu || []) {
          if (a.regex) T.match(msg, a.regex, a.label);
          else T.contains(msg, a.text, a.label);
        }
      });
    }
    if (sc.systemeAttendu && sc.systemeAttendu.length) {
      T.test(`Scénario ${sc.id} — garde-fous présents dans l'invite système`, () => {
        for (const a of sc.systemeAttendu) {
          if (a.regex) T.match(system, a.regex, a.label);
          else T.contains(system, a.text, a.label);
        }
      });
    }
  }

  // ---------- 4) Scénario 10 : entrées invalides / incomplètes ----------
  const sc10 = scenarios.find((s) => s.id === "10_entrees_invalides");
  T.test("Scénario 10 — une surface invalide interdit tout calcul de quantité", () => {
    for (const cas of sc10.sousCas) {
      const msg = api.planUserMessage({ crop: "tomate", area: cas.area });
      T.match(msg, cas.attendu, cas.label);
    }
  });

  T.test("Scénario 10 — contrat de la route /api/plan (inspection du source de production)", () => {
    const src = fs.readFileSync(resolveServerPath(), "utf8");
    for (const c of sc10.contratSource) {
      T.contains(src, c.text, c.label);
    }
    // Vérifie aussi que la génération part bien de planSystem()+planUserMessage().
    T.match(src, /callClaude\(\s*planSystem\(\)\s*,\s*\[\s*{\s*role:\s*"user",\s*content:\s*planUserMessage\(/, "la route appelle callClaude(planSystem(), [planUserMessage(clean)])");
  });

  // ---------- 5) Données structurées : aucun champ inventé ----------
  T.test("Enregistrement du plan — les champs structurés ne contiennent QUE des entrées utilisateur", () => {
    const src = fs.readFileSync(resolveServerPath(), "utf8");
    // Le record est construit à partir de `clean` (entrées utilisateur) + content (texte IA).
    // On vérifie qu'aucune donnée chiffrée n'est fabriquée côté serveur dans le record.
    T.match(src, /const rec = \{[^}]*crop,[^}]*region: clean\.region[^}]*area: clean\.area/, "rec = { crop, region: clean.region, area: clean.area, ... } (échos des entrées)");
    T.notContains(src.split("const rec =")[1].split("};")[0], "Math.random", "aucune valeur aléatoire dans le record");
  });

  return T.report({ title: "TESTS DÉTERMINISTES (code de production réel)" });
}

module.exports = { run };

if (require.main === module) {
  const r = run();
  process.exit(r.failed ? 1 : 0);
}
