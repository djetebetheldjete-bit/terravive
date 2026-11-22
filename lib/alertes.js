"use strict";
// Terravive — alertes « à surveiller » d'une parcelle. Chaque alerte dit d'où elle vient (satellite,
// prévision météo, carnet), ce qu'il faut faire, et reste prudente : le satellite signale une zone à
// inspecter, la prévision est une probabilité, pas une certitude.

const SENSITIVE = ["semis", "levee", "floraison", "fructification"];

/**
 * @param {object} c { parcel:{id,name}, fiche, soil, lastNdvi:{at, summary:{level, ndvi}}, forecast:[{date,tmax,rainMm,rainP}], warnings, missing, today }
 * @returns {Array<{level:'inspect'|'watch'|'info', title, text, source}>}
 */
function parcelAlerts(c) {
  const out = [], f = c.fiche || {}, today = c.today || new Date().toISOString().slice(0, 10);
  const add = (level, title, text, source) => out.push({ parcel_id: c.parcel.id, parcel: c.parcel.name, level, title, text, source });
  // Satellite : dernière analyse de la parcelle
  const o = c.lastNdvi;
  if (o && o.summary) {
    const age = Math.round((Date.parse(today) - Date.parse(String(o.at).slice(0, 10))) / 864e5);
    if (o.summary.level === "inspect" && age <= 30) add("inspect", "Zone à inspecter", "La dernière analyse satellite (" + String(o.at).slice(0, 10) + ") montre une baisse ou une faible vigueur. Passez voir les zones concernées : feuilles, humidité du sol, insectes. Le satellite ne dit pas de quoi il s'agit.", "Satellite (Sentinel-2)");
    else if (o.summary.level === "watch" && age <= 30) add("watch", "Vigueur à surveiller", "Vigueur moyenne lors de la dernière analyse (" + String(o.at).slice(0, 10) + ") : à regarder lors du prochain passage.", "Satellite (Sentinel-2)");
    else if (age > 45) add("info", "Analyse satellite ancienne", "La dernière analyse date de " + age + " jours : relancez-en une pour suivre l'évolution.", "Satellite");
  }
  // Prévisions des prochains jours
  const fc = (c.forecast || []).filter((d) => d.date >= today);
  const heavy = fc.find((d) => typeof d.rainMm === "number" && d.rainMm >= 40);
  if (heavy) add("watch", "Forte pluie annoncée", "Environ " + Math.round(heavy.rainMm) + " mm prévus le " + heavy.date + " : dégagez les rigoles de drainage, évitez d'épandre engrais ou traitements avant la pluie.", "Prévision Open-Meteo");
  const rainNext = fc.slice(0, 4).reduce((s, d) => s + (typeof d.rainMm === "number" ? d.rainMm : 0), 0);
  const known = fc.slice(0, 4).filter((d) => typeof d.rainMm === "number").length;
  if (known >= 3 && rainNext < 2 && SENSITIVE.includes(f.stage) && f.irrigation !== "goutte")
    add("watch", "Jours secs à venir", "Presque pas de pluie prévue sur " + known + " jours alors que la culture est à un stade sensible (" + f.stage + ") : prévoyez l'arrosage, de préférence tôt le matin ou en fin de journée, et un paillage.", "Prévision Open-Meteo");
  const hot = fc.find((d) => typeof d.tmax === "number" && d.tmax >= 35);
  if (hot && (f.stage === "floraison" || f.stage === "fructification")) add("watch", "Forte chaleur pendant la floraison", "Jusqu'à " + hot.tmax + " °C prévus le " + hot.date + " : arrosez aux heures fraîches ; un ombrage léger limite la chute des fleurs.", "Prévision Open-Meteo");
  // Carnet : saisies incohérentes
  (c.warnings || []).slice(0, 2).forEach((w) => add("info", "Saisie à vérifier", w.text, "Carnet de champ"));
  // Données de base manquantes
  const miss = (c.missing || []).filter((m) => m.field === "crop" || m.field === "sown_at");
  if (miss.length) add("info", "Fiche incomplète", "Renseignez " + miss.map((m) => m.label.toLowerCase()).join(" et ") + " pour recevoir vos tâches et des alertes adaptées.", "Fiche parcelle");
  const rank = { inspect: 0, watch: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

module.exports = { parcelAlerts };
