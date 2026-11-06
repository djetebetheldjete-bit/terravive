"use strict";
// Terravive — « fiche pratique terrain » : une version courte, concrète et imprimable de
// l'itinéraire technique (ITK), à emporter au champ. Le modèle reformule l'ITK dans un format
// JSON fixe ; ce module construit l'invite, puis vérifie et nettoie strictement la réponse.

const LIMITS = {
  titre: 90,
  en_bref: [5, 160],
  calendrier: [14, { quand: 40, faire: 120, detail: 220 }],
  quantites: [10, { quoi: 70, combien: 90, quand: 90 }],
  arrosage: [5, 180],
  surveiller: [8, { signe: 110, action: 180 }],
  securite: [5, 180],
  recolte: [5, 180],
  materiel: [12, 70],
  carnet: [6, 120]
};

function ficheSystem() {
  return `Tu es un technicien agricole de terrain en Côte d'Ivoire. On te donne un ITINÉRAIRE TECHNIQUE (ITK) complet.
Ta tâche : en tirer une FICHE PRATIQUE TERRAIN que le producteur emporte au champ (imprimée ou sur téléphone).

RÈGLES :
- Reprends UNIQUEMENT ce que dit l'ITK. N'invente aucune dose, aucun produit, aucune date, aucun chiffre qui n'y figure pas. Si l'ITK donne une fourchette, garde la fourchette.
- Phrases très courtes, verbes d'action à l'impératif (« Préparer », « Arroser », « Vérifier »), mots simples, pas de jargon. Une idée par ligne.
- Garde les unités exactes (kg, g, L, m, cm, t/ha, par pied, par m²).
- Calendrier dans l'ordre chronologique, repéré par rapport au semis ou au repiquage (ex. « 3 semaines avant semis », « Jour 0 », « Semaines 3-4 », « À la floraison »), avec les dates seulement si l'ITK en donne.
- Pour « surveiller » : le signe visible au champ, puis l'action immédiate, en privilégiant les solutions de l'ITK.
- Pour « securite » : les précautions de l'ITK (gants, délai avant récolte, stockage des produits, enfants). Si l'ITK ne parle d'aucun produit, donne seulement les précautions générales qu'il mentionne, sinon laisse la liste vide.
- Aucun emoji.

RÉPONDS PAR UN SEUL OBJET JSON valide, sans texte avant ni après, sans bloc de code, avec exactement ces clés :
{
  "titre": "Fiche terrain — <culture>",
  "en_bref": ["3 à 5 points essentiels à retenir"],
  "calendrier": [{"quand": "...", "faire": "action courte", "detail": "comment, combien (facultatif)"}],
  "quantites": [{"quoi": "intrant ou matériel", "combien": "quantité avec unité", "quand": "moment"}],
  "arrosage": ["consignes d'arrosage"],
  "surveiller": [{"signe": "ce qu'on voit", "action": "ce qu'on fait"}],
  "securite": ["précautions"],
  "recolte": ["quand et comment récolter, conserver"],
  "materiel": ["liste du matériel à préparer"],
  "carnet": ["ce qu'il faut noter dans le carnet de champ"]
}
Limites : calendrier 14 lignes au plus, quantités 10, surveiller 8, matériel 12, les autres listes 5 ou 6.`;
}

function ficheUserMessage(plan) {
  const head = [
    "Culture : " + (plan.crop || ""),
    plan.region ? "Région : " + plan.region : "",
    plan.area ? "Surface : " + plan.area : "",
    plan.season ? "Saison : " + plan.season : ""
  ].filter(Boolean).join("\n");
  const itk = String(plan.content || "").slice(0, 60000);
  return head + "\n\nITINÉRAIRE TECHNIQUE :\n<<<\n" + itk + "\n>>>\n\nProduis la fiche pratique terrain (JSON uniquement).";
}

// --- Nettoyage strict de la réponse ---
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;
function str(v, max) {
  if (v == null) return "";
  let s = String(v).replace(EMOJI, "").replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
  if (s.length > max) s = s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
  return s;
}
function list(v, n, max) {
  return (Array.isArray(v) ? v : []).map((x) => str(typeof x === "object" && x ? Object.values(x).join(" — ") : x, max)).filter(Boolean).slice(0, n);
}
function rows(v, n, shape) {
  const keys = Object.keys(shape);
  return (Array.isArray(v) ? v : []).filter((x) => x && typeof x === "object").map((x) => {
    const o = {}; keys.forEach((k) => { o[k] = str(x[k], shape[k]); }); return o;
  }).filter((o) => o[keys[0]] || o[keys[1]]).slice(0, n);
}
function extractJson(text) {
  const t = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(t); } catch (e) { /* on cherche l'objet le plus large */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; } }
  return null;
}

/** Transforme la réponse brute du modèle en fiche propre, ou lève une erreur claire. */
function parseFiche(text, crop) {
  const j = extractJson(text);
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("La fiche n'a pas pu être lue. Réessayez.");
  const L = LIMITS;
  const f = {
    titre: str(j.titre, L.titre) || ("Fiche terrain — " + (crop || "culture")),
    en_bref: list(j.en_bref, ...L.en_bref),
    calendrier: rows(j.calendrier, ...L.calendrier),
    quantites: rows(j.quantites, ...L.quantites),
    arrosage: list(j.arrosage, ...L.arrosage),
    surveiller: rows(j.surveiller, ...L.surveiller),
    securite: list(j.securite, ...L.securite),
    recolte: list(j.recolte, ...L.recolte),
    materiel: list(j.materiel, ...L.materiel),
    carnet: list(j.carnet, ...L.carnet)
  };
  if (!f.calendrier.length && !f.en_bref.length) throw new Error("La fiche générée est vide. Réessayez.");
  return f;
}

/** Version texte courte (WhatsApp, SMS), sans dépasser ~3 000 caractères. */
function ficheText(f, parcel) {
  const L = [];
  L.push("🌱 " + f.titre);
  if (parcel && parcel.name) L.push("Parcelle : " + parcel.name + (parcel.area_m2 ? " (" + parcel.area_m2.toLocaleString("fr-FR") + " m²)" : ""));
  if (f.en_bref.length) { L.push(""); L.push("L'ESSENTIEL"); f.en_bref.forEach((x) => L.push("• " + x)); }
  if (f.calendrier.length) { L.push(""); L.push("CALENDRIER"); f.calendrier.forEach((c) => L.push("☐ " + c.quand + " : " + c.faire)); }
  if (f.quantites.length) { L.push(""); L.push("QUANTITÉS"); f.quantites.forEach((q) => L.push("• " + q.quoi + " : " + q.combien + (q.quand ? " (" + q.quand + ")" : ""))); }
  if (f.arrosage.length) { L.push(""); L.push("ARROSAGE"); f.arrosage.forEach((x) => L.push("• " + x)); }
  if (f.surveiller.length) { L.push(""); L.push("À SURVEILLER"); f.surveiller.forEach((s) => L.push("• " + s.signe + " → " + s.action)); }
  let out = L.join("\n");
  if (out.length > 3000) out = out.slice(0, 2990).replace(/\n[^\n]*$/, "") + "\n…";
  return out + "\n\nFiche indicative tirée de l'itinéraire Terravive.";
}

module.exports = { ficheSystem, ficheUserMessage, parseFiche, ficheText, extractJson };
