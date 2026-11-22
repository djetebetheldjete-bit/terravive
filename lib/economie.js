"use strict";
// Terravive — résultat économique d'une parcelle, calculé uniquement à partir du carnet :
// ventes notées (kind « vente », montant reçu) et coûts notés (montant facultatif sur chaque intervention).
// Aucune valeur par défaut : sans coût ni vente notés, le résultat reste « non calculable ».

const COST_LABEL = { semis: "Semences / plants", compost: "Compost / fumier", engrais: "Engrais", traitement: "Traitements", arrosage: "Eau / irrigation", observation: "Main-d'œuvre et divers", incident: "Divers" };

function n(x) { const v = Number(x); return Number.isFinite(v) ? v : null; }
/** @param entries [{kind, qty, amount_fcfa}] @param areaM2 surface de la parcelle */
function economics(entries, areaM2) {
  const sales = (entries || []).filter((e) => e.kind === "vente" && n(e.amount_fcfa) != null);
  const costs = (entries || []).filter((e) => e.kind !== "vente" && n(e.amount_fcfa) != null && n(e.amount_fcfa) > 0);
  const revenue = sales.reduce((s, e) => s + n(e.amount_fcfa), 0), kgSold = sales.reduce((s, e) => s + (n(e.qty) || 0), 0);
  const cost = costs.reduce((s, e) => s + n(e.amount_fcfa), 0);
  const byCost = {}; costs.forEach((e) => { const k = COST_LABEL[e.kind] || "Autres"; byCost[k] = (byCost[k] || 0) + n(e.amount_fcfa); });
  const harvestKg = (entries || []).filter((e) => e.kind === "recolte").reduce((s, e) => s + (n(e.qty) || 0), 0);
  const out = {
    revenue_fcfa: Math.round(revenue), cost_fcfa: Math.round(cost), kg_sold: Math.round(kgSold * 10) / 10, harvest_kg: Math.round(harvestKg * 10) / 10,
    avg_price_fcfa_kg: kgSold > 0 ? Math.round(revenue / kgSold) : null,
    costs_by_type: Object.entries(byCost).map(([k, v]) => ({ label: k, fcfa: Math.round(v) })).sort((a, b) => b.fcfa - a.fcfa),
    sales_n: sales.length, costs_n: costs.length, computable: sales.length > 0 && costs.length > 0
  };
  if (out.computable) {
    out.margin_fcfa = Math.round(revenue - cost);
    out.margin_per_m2 = areaM2 > 0 ? Math.round((revenue - cost) / areaM2) : null;
    out.cost_per_kg = harvestKg > 0 ? Math.round(cost / harvestKg) : null;
  }
  const notes = [];
  if (!sales.length) notes.push("Aucune vente notée : ajoutez vos ventes (« Vente » dans le carnet, avec le montant reçu).");
  if (!costs.length) notes.push("Aucun coût noté : indiquez le montant dépensé lorsque vous notez semences, compost, engrais, traitements ou main-d'œuvre.");
  if (harvestKg > 0 && kgSold > harvestKg * 1.05) notes.push("Vous avez noté plus de kilos vendus que récoltés : vérifiez les saisies.");
  if (harvestKg > 0 && kgSold > 0 && kgSold < harvestKg) out.unsold_kg = Math.round((harvestKg - kgSold) * 10) / 10;
  out.notes = notes;
  return out;
}
module.exports = { economics };
