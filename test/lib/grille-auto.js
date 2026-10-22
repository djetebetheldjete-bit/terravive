"use strict";
/**
 * grille-auto.js — GRILLE D'ÉVALUATION AUTOMATIQUE (structurelle) d'un itinéraire (ITK)
 * produit par l'IA.
 *
 * IMPORTANT — ce que cette grille PEUT et NE PEUT PAS faire :
 *  - Elle vérifie des propriétés DÉTERMINISTES du texte : présence et ORDRE des 18
 *    sections, présence des tableaux attendus (budget, calendrier), absence d'emojis,
 *    absence de formulations interdites (ex. prix inventé affirmé comme certain), cohérence
 *    simple des unités, non-troncature (le texte finit bien par la section 18).
 *  - Elle NE PEUT PAS juger l'EXACTITUDE AGRONOMIQUE (une dose peut être bien formée mais
 *    agronomiquement fausse). Ce jugement relève de la grille humaine (GRILLE-AGRONOMIQUE.md).
 *
 * Entrée : le texte Markdown de l'ITK + un objet `attendus` propre au scénario.
 * Sortie : { score, max, items:[{id, pass, detail}] }  (aucune exception).
 */

const SECTIONS = [
  "## 1.", "## 2.", "## 3.", "## 4.", "## 5.", "## 6.", "## 7.", "## 8.", "## 9.",
  "## 10.", "## 11.", "## 12.", "## 13.", "## 14.", "## 15.", "## 16.", "## 17.", "## 18.",
];

// Emojis / pictogrammes interdits par le prompt (STYLE : « pas de 🌱 😊 💧 »).
// On vise les blocs réellement pictographiques (emoji, symboles divers, dingbats,
// sélecteur de variation emoji). On EXCLUT volontairement les flèches (U+2190–21FF,
// ex. « → ») et le signe « × », qui sont des caractères typographiques normaux
// utilisés par l'itinéraire (et par l'invite de production elle-même).
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}]/u;

function allSectionsPresentInOrder(text) {
  let lastIdx = -1;
  const missing = [];
  for (const s of SECTIONS) {
    const idx = text.indexOf(s);
    if (idx === -1) { missing.push(s); continue; }
    if (idx < lastIdx) return { ok: false, detail: `section ${s} hors d'ordre` };
    lastIdx = idx;
  }
  if (missing.length) return { ok: false, detail: `sections manquantes : ${missing.join(" ")}` };
  return { ok: true, detail: "18 sections présentes et dans l'ordre" };
}

function endsAtSection18(text) {
  const i18 = text.indexOf("## 18.");
  if (i18 === -1) return { ok: false, detail: "pas de section 18 (texte tronqué ?)" };
  // Après ## 18, aucune nouvelle section ## 19+ et au moins ~200 caractères de contenu.
  const tail = text.slice(i18);
  if (/##\s*19\./.test(tail)) return { ok: false, detail: "une section ## 19 inattendue existe" };
  return { ok: tail.length > 150, detail: tail.length > 150 ? "la section 18 a du contenu (non tronquée)" : "section 18 trop courte (possible troncature)" };
}

function evaluateItk(text, attendus) {
  attendus = attendus || {};
  const items = [];
  const add = (id, pass, detail) => items.push({ id, pass: !!pass, detail: detail || "" });

  // 1) Structure : 18 sections dans l'ordre.
  const sec = allSectionsPresentInOrder(text);
  add("18_sections_ordre", sec.ok, sec.detail);

  // 2) Non-troncature : finit sur la section 18.
  const end = endsAtSection18(text);
  add("non_tronque", end.ok, end.detail);

  // 3) Pas d'introduction avant ## 1.
  const before = text.slice(0, text.indexOf("## 1."));
  add("pas_intro_avant_1", before.trim().length === 0, before.trim().length === 0 ? "rien avant ## 1" : "du texte précède ## 1");

  // 4) Pas d'emoji.
  add("pas_emoji", !EMOJI_RE.test(text), EMOJI_RE.test(text) ? "emoji/pictogramme détecté" : "aucun emoji");

  // 5) Tableau budget (section 16) avec les bonnes colonnes.
  const hasBudgetCols = text.includes("| Poste |") || /Poste\s*\|\s*Quantité/.test(text);
  add("tableau_budget", hasBudgetCols, hasBudgetCols ? "tableau budget présent" : "tableau budget (colonnes Poste|Quantité…) absent");

  // 6) Tableau calendrier (section 17) avec les bonnes colonnes.
  const hasCal = /\|\s*Période\s*\|\s*Opération\s*\|/.test(text) || text.includes("| Période | Opération |");
  add("tableau_calendrier", hasCal, hasCal ? "tableau calendrier présent" : "tableau calendrier (Période|Opération|…) absent");

  // 7) Garde-fou « marge ≠ bénéfice réel ».
  const margeOk = /marge\s+prévisionnelle\s+n[’']est\s+pas\s+le\s+bénéfice\s+réel/i.test(text) || /n[’']est\s+pas\s+le\s+BÉNÉFICE\s+RÉEL/i.test(text);
  add("marge_diff_benefice", margeOk, margeOk ? "précise que marge ≠ bénéfice réel" : "manque la mention « marge ≠ bénéfice réel »");

  // 8) Aucune AFFIRMATION de prix chiffré en FCFA présenté comme certain.
  //    Heuristique : un montant explicite en FCFA/CFA est suspect (le prompt interdit
  //    d'inventer des prix). On le SIGNALE (à confirmer humainement).
  const prixRe = /\b\d[\d\s. ]*\s*(FCFA|F\s*CFA|CFA|XOF)\b/i;
  const prixSuspect = prixRe.test(text);
  add("pas_de_prix_invente", !prixSuspect, prixSuspect ? "montant en FCFA détecté — vérifier qu'il vient du producteur et non d'une invention" : "aucun prix chiffré inventé détecté");

  // 9) Cohérence d'unités de surface : si une surface en ha est attendue, elle doit
  //    apparaître ; et on ne doit pas confondre m² et ha dans un même calcul évident.
  if (attendus.haStr) {
    const haShown = text.includes(attendus.haStr + " ha") || text.includes(attendus.haStr + " hectare");
    add("surface_ha_affichee", haShown, haShown ? `surface ${attendus.haStr} ha mentionnée` : `surface convertie ${attendus.haStr} ha non retrouvée`);
  }

  // 10) Calcul de quantité montré (dose × surface) si attendu.
  if (attendus.exigeCalculQuantite) {
    const calcShown = /×|\bx\b|\*/.test(text) && /(kg|g|t|plants?|graines?)/i.test(text);
    add("calcul_quantite_montre", calcShown, calcShown ? "au moins un calcul dose × surface est montré" : "aucun calcul de quantité visible");
  }

  // 11) Interdits spécifiques au scénario (ex. pas de dose de chaux sans pH).
  if (Array.isArray(attendus.interdits)) {
    for (const bad of attendus.interdits) {
      const present = typeof bad.regex === "object" ? bad.regex.test(text) : text.includes(bad.text);
      add("interdit_" + bad.id, !present, present ? `formulation interdite détectée : ${bad.label}` : `absent (ok) : ${bad.label}`);
    }
  }

  // 12) Exigés spécifiques au scénario (ex. phrase « disponibilité locale à confirmer »).
  if (Array.isArray(attendus.exiges)) {
    for (const need of attendus.exiges) {
      const present = typeof need.regex === "object" ? need.regex.test(text) : text.includes(need.text);
      add("exige_" + need.id, present, present ? `présent : ${need.label}` : `MANQUE : ${need.label}`);
    }
  }

  const max = items.length;
  const score = items.filter((i) => i.pass).length;
  return { score, max, items };
}

module.exports = { evaluateItk, SECTIONS };
