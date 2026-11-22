"use strict";
// Terravive — lecture des résultats satellite (Vertea) : fiabilité de l'observation et phrase utile au
// producteur. Règle : une anomalie satellite n'est JAMAIS présentée comme une maladie ; elle signale une
// zone à inspecter sur le terrain.

/** Fiabilité d'une observation NDVI d'après le nombre d'images et la couverture nuageuse. */
function reliability(m) {
  const n = Number(m && m.images), c = m && m.clouds != null ? Number(m.clouds) : null;
  if (!Number.isFinite(n) || n <= 0) return { level: "inconnue", label: "Fiabilité inconnue", why: "Nombre d'images non communiqué." };
  if (n >= 4 && (c == null || c < 40)) return { level: "bonne", label: "Fiabilité bonne", why: n + " images" + (c != null ? ", nuages " + c + " % en moyenne" : "") + "." };
  if (n >= 2) return { level: "moyenne", label: "Fiabilité moyenne", why: "Seulement " + n + " images" + (c != null ? ", nuages " + c + " % en moyenne" : "") + " : à confirmer." };
  return { level: "faible", label: "Fiabilité faible", why: "Une seule image exploitable : résultat indicatif." };
}

/** Résumé compact d'une réponse NDVI de Vertea (ce qui est gardé dans l'historique de la parcelle). */
function ndviSummary(d) {
  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return {
    ndvi: num(d.ndvi_moyen), pct_faible: num(d.pct_faible), pct_moyen: num(d.pct_moyen), pct_sain: num(d.pct_sain),
    surface_ha: num(d.surface_ha), images: num(d.images_utilisees), clouds: num(d.couverture_nuageuse_moy),
    period_from: typeof d.periode_depuis === "string" ? d.periode_depuis.slice(0, 10) : null,
    period_to: typeof d.periode_fin === "string" ? d.periode_fin.slice(0, 10) : null,
    first_image: typeof d.date_premiere_image === "string" ? d.date_premiere_image : null,
    last_image: typeof d.date_derniere_image === "string" ? d.date_derniere_image : null
  };
}

/**
 * Interprétation d'une observation NDVI, comparée à la précédente si elle existe.
 * Renvoie { level: ok|watch|inspect, inspect:boolean, text, limits }.
 */
function interpretNdvi(cur, prev) {
  const limits = "Le NDVI mesure la vigueur de la végétation vue du ciel. Il ne permet pas de nommer une maladie ou un ravageur : seule une observation au champ le peut.";
  if (!cur || cur.ndvi == null) return { level: "unknown", inspect: false, text: "Aucune valeur exploitable pour cette période.", limits };
  const f = cur.pct_faible || 0, m = cur.pct_moyen || 0;
  let level = "ok", text;
  if (f >= 25) { level = "inspect"; text = "Une part importante de la parcelle (" + f + " %) montre une végétation faible."; }
  else if (f + m >= 50) { level = "watch"; text = "La vigueur est moyenne sur une bonne partie de la parcelle (" + Math.round(f + m) + " %)."; }
  else text = "La végétation paraît vigoureuse sur l'essentiel de la parcelle.";
  if (prev && prev.ndvi != null) {
    const d = Math.round((cur.ndvi - prev.ndvi) * 100) / 100;
    if (d <= -0.1) { level = "inspect"; text += " La vigueur a nettement baissé depuis l'observation précédente (" + (prev.at || "").slice(0, 10) + " : " + prev.ndvi + " → " + cur.ndvi + ")."; }
    else if (d <= -0.05) { if (level === "ok") level = "watch"; text += " Légère baisse depuis l'observation précédente (" + prev.ndvi + " → " + cur.ndvi + ")."; }
    else if (d >= 0.05) text += " En hausse depuis l'observation précédente (" + prev.ndvi + " → " + cur.ndvi + ").";
    else text += " Stable depuis l'observation précédente.";
  }
  if (level === "inspect") text += " Une observation de terrain est recommandée : regardez les feuilles, l'humidité du sol et la présence d'insectes dans les zones signalées.";
  else if (level === "watch") text += " À surveiller lors de votre prochain passage.";
  // Une seule image : on reste prudent.
  if (cur.images != null && cur.images < 2 && level === "inspect") level = "watch";
  return { level, inspect: level === "inspect", text, limits };
}

module.exports = { reliability, ndviSummary, interpretNdvi };
