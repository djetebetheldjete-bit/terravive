"use strict";
// Terravive — module Distribution (projet ASTRIDE) : de la parcelle au client.
// Fonctions pures (sans accès aux données) : position et surface d'une parcelle, état d'un lot,
// contrôle des saisies, indicateurs. Le serveur s'occupe du stockage et des droits.
//
// Un lot suit quatre étapes, dans cet ordre :
//   prévu (récolte annoncée au centre) → au centre (récolté, pesé) → en route (tournée) → livré (client).
// Toutes les valeurs affichées viennent des saisies : rien n'est estimé ni inventé.

const LOT_STEPS = ["prevu", "centre", "route", "livre"];
const LOT_LABEL = { prevu: "Prévu", centre: "Au centre", route: "En route", livre: "Livré" };
const CANALS = { grossistes: "Grossistes et marchés", restauration: "Restauration collective", commerces: "Commerçants et supérettes", directe: "Vente directe" };
const QUALITIES = ["A", "B", "C"];
// Cibles du pilote (document ASTRIDE, phase 1).
const TARGETS = { lossPct: 15, fastPct: 80, fastHours: 48, forecastGapPct: 15 };

function num(x) { const v = typeof x === "number" ? x : parseFloat(String(x == null ? "" : x).replace(",", ".")); return Number.isFinite(v) ? v : null; }

/** Centre d'une zone Terravive ({bbox:[o,s,e,n]} ou {polygon:[[lng,lat],...]}) → {lat, lon} ou null. */
function zoneCenter(zone) {
  if (!zone) return null;
  if (Array.isArray(zone.bbox) && zone.bbox.length === 4) {
    const [o, s, e, n] = zone.bbox.map(num); if ([o, s, e, n].some((v) => v == null)) return null;
    return { lat: (s + n) / 2, lon: (o + e) / 2 };
  }
  const pts = ringOf(zone); if (!pts) return null;
  // Centre de gravité du polygone (repli sur la moyenne des sommets si la surface est nulle).
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1; a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-12) { const m = pts.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]); return { lat: m[1] / pts.length, lon: m[0] / pts.length }; }
  return { lat: cy / (3 * a), lon: cx / (3 * a) };
}
function ringOf(zone) {
  if (!zone || !Array.isArray(zone.polygon)) return null;
  const pts = zone.polygon.map((p) => [num(p && p[0]), num(p && p[1])]).filter((p) => p[0] != null && p[1] != null);
  return pts.length >= 3 ? pts : null;
}
/** Surface approximative d'une zone, en hectares (projection locale, suffisante pour quelques hectares). */
function zoneAreaHa(zone) {
  const c = zoneCenter(zone); if (!c) return null;
  const k = Math.cos(c.lat * Math.PI / 180), M = 111320; // mètres par degré de latitude
  let pts = ringOf(zone);
  if (!pts && zone.bbox) { const [o, s, e, n] = zone.bbox.map(num); pts = [[o, s], [e, s], [e, n], [o, n]]; }
  if (!pts) return null;
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += (x1 * k * M) * (y2 * M) - (x2 * k * M) * (y1 * M); }
  return Math.round(Math.abs(a) / 2 / 10000 * 100) / 100;
}

/** État de santé d'une parcelle à partir de la dernière analyse NDVI (mêmes seuils que le tableau de bord). */
function healthOf(nd) {
  if (!nd || typeof nd.ndvi !== "number") return null;
  const f = num(nd.pct_faible) || 0, m = num(nd.pct_moyen) || 0;
  if (f >= 25) return "Alerte";
  if (f + m >= 50) return "Surveillance";
  return "OK";
}

/** Étape d'un lot, déduite de ses dates (la seule source de vérité). */
function lotStep(l) {
  if (l.delivered_at) return "livre";
  if (l.departed_at) return "route";
  if (l.harvested_at) return "centre";
  return "prevu";
}
function hoursBetween(a, b) { const t = (Date.parse(b) - Date.parse(a)) / 3600000; return Number.isFinite(t) ? Math.round(t * 10) / 10 : null; }
/** Lot enrichi pour l'affichage : étape, perte, délai récolte → livraison. */
function lotView(l) {
  const step = lotStep(l);
  const kgH = num(l.kg_harvested), kgD = num(l.kg_delivered);
  const loss = step === "livre" && kgH != null && kgD != null ? Math.max(0, Math.round((kgH - kgD) * 10) / 10) : null;
  const hours = step === "livre" && l.harvested_at ? hoursBetween(l.harvested_at, l.delivered_at) : null;
  return Object.assign({}, l, { step, step_label: LOT_LABEL[step], loss_kg: loss, hours });
}

// ---------------------------------------------------------------- Contrôle des saisies
function cleanStr(s, max) { return String(s == null ? "" : s).trim().slice(0, max || 100); }
function validLatLon(lat, lon) { return lat != null && lon != null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180; }

/** Centre de groupage ou point de vente. Renvoie {error} ou {site}. */
function checkSite(p) {
  const kind = p.kind === "vente" ? "vente" : p.kind === "centre" ? "centre" : null;
  if (!kind) return { error: "Choisissez : centre de groupage ou point de vente." };
  const name = cleanStr(p.name, 80); if (name.length < 2) return { error: "Donnez un nom au site." };
  const lat = num(p.lat), lon = num(p.lon);
  if (!validLatLon(lat, lon)) return { error: "Position invalide : placez le site sur la carte ou utilisez votre position." };
  const site = { kind, name, lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
  if (kind === "vente") {
    if (!CANALS[p.canal]) return { error: "Choisissez le canal de vente." };
    site.canal = p.canal; site.capacity_kg = null; site.cold = false;
  } else {
    const cap = num(p.capacity_kg);
    if (cap == null || cap <= 0 || cap > 10000000) return { error: "Indiquez la capacité du centre en kg." };
    site.capacity_kg = Math.round(cap); site.canal = null; site.cold = !!p.cold;
  }
  return { site };
}

function isoDay(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); if (!m) return null; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCDate() === +m[3] ? m[0] : null; }
function isoTime(s, now) {
  if (s == null || s === "") return now.toISOString();
  const t = Date.parse(s); if (!Number.isFinite(t)) return null;
  if (t > now.getTime() + 10 * 60000) return null; // pas de date dans le futur pour un fait accompli
  return new Date(t).toISOString();
}
function kgOf(x, max) { const v = num(x); return v != null && v > 0 && v <= (max || 1000000) ? Math.round(v * 10) / 10 : null; }

/**
 * Fait avancer un lot d'une étape. `action` : forecast (création), harvest, ship, deliver.
 * Renvoie {error} ou {patch} (champs à enregistrer). `ctx` : {now, sites (par id), parcel}.
 */
function lotAction(lot, action, p, ctx) {
  const now = ctx.now || new Date(), sites = ctx.sites || {};
  const step = lot ? lotStep(lot) : null;
  const centreOk = (id) => sites[id] && sites[id].kind === "centre";
  if (action === "forecast") {
    if (!ctx.parcel) return { error: "Choisissez une parcelle de la coopérative." };
    const kg = kgOf(p.kg_expected); if (kg == null) return { error: "Indiquez la récolte attendue en kg." };
    const day = isoDay(p.expected_on); if (!day) return { error: "Indiquez la date de récolte prévue." };
    if (!centreOk(p.centre_id)) return { error: "Choisissez le centre de groupage qui recevra la récolte." };
    const crop = cleanStr(p.crop || ctx.parcel.crop, 60); if (!crop) return { error: "Indiquez le produit récolté." };
    return { patch: { parcel_id: ctx.parcel.id, owner_id: ctx.parcel.user_id, crop, kg_expected: kg, expected_on: day, centre_id: p.centre_id } };
  }
  if (!lot) return { error: "Lot introuvable." };
  if (action === "harvest") {
    if (step !== "prevu") return { error: "Ce lot a déjà été reçu au centre." };
    const kg = kgOf(p.kg_harvested); if (kg == null) return { error: "Indiquez le poids pesé à la réception, en kg." };
    const at = isoTime(p.harvested_at, now); if (!at) return { error: "Heure de récolte invalide (elle ne peut pas être dans le futur)." };
    const q = p.quality ? String(p.quality).toUpperCase() : null; if (q && !QUALITIES.includes(q)) return { error: "Qualité : A, B ou C." };
    const centre = p.centre_id || lot.centre_id; if (!centreOk(centre)) return { error: "Choisissez le centre de groupage." };
    return { patch: { kg_harvested: kg, harvested_at: at, quality: q, centre_id: centre } };
  }
  if (action === "ship") {
    if (step !== "centre") return { error: step === "prevu" ? "Recevez d'abord le lot au centre." : "Ce lot est déjà parti." };
    const c = sites[p.client_id]; if (!c || c.kind !== "vente") return { error: "Choisissez le point de vente à livrer." };
    const at = isoTime(p.departed_at, now); if (!at) return { error: "Heure de départ invalide." };
    if (Date.parse(at) < Date.parse(lot.harvested_at)) return { error: "Le départ ne peut pas précéder la récolte." };
    return { patch: { client_id: p.client_id, departed_at: at, vehicle: cleanStr(p.vehicle, 60) || null } };
  }
  if (action === "deliver") {
    if (step !== "route") return { error: step === "livre" ? "Ce lot est déjà livré." : "Le lot doit d'abord partir en tournée." };
    const kg = kgOf(p.kg_delivered); if (kg == null) return { error: "Indiquez les kg acceptés par le client." };
    if (kg > num(lot.kg_harvested)) return { error: "Le client ne peut pas accepter plus que le poids récolté (" + lot.kg_harvested + " kg)." };
    const at = isoTime(p.delivered_at, now); if (!at) return { error: "Heure de livraison invalide." };
    if (Date.parse(at) < Date.parse(lot.departed_at)) return { error: "La livraison ne peut pas précéder le départ." };
    return { patch: { kg_delivered: kg, delivered_at: at } };
  }
  return { error: "Action inconnue." };
}

/** Prochain code de lot (L-0001, L-0002…) parmi les codes déjà utilisés. */
function nextLotCode(codes) {
  let max = 0; (codes || []).forEach((c) => { const m = /^L-(\d+)$/.exec(String(c || "")); if (m) max = Math.max(max, +m[1]); });
  return "L-" + String(max + 1).padStart(4, "0");
}

// ---------------------------------------------------------------- Indicateurs
function pct(a, b) { return b > 0 ? Math.round(a / b * 1000) / 10 : null; }
/**
 * Indicateurs du pilote, calculés sur les lots (vues `lotView`) et les parcelles.
 * Chaque indicateur vaut null tant qu'il n'y a pas de quoi le calculer.
 */
function indicators(lots, parcels, sites) {
  const v = (lots || []).map((l) => (l.step ? l : lotView(l)));
  const delivered = v.filter((l) => l.step === "livre");
  const kgH = delivered.reduce((s, l) => s + (num(l.kg_harvested) || 0), 0);
  const kgLoss = delivered.reduce((s, l) => s + (l.loss_kg || 0), 0);
  const timed = delivered.filter((l) => l.hours != null);
  const fast = timed.filter((l) => l.hours < TARGETS.fastHours).length;
  const received = v.filter((l) => l.step !== "prevu" && num(l.kg_expected) > 0);
  const gap = received.length ? received.reduce((s, l) => s + Math.abs(num(l.kg_harvested) - num(l.kg_expected)) / num(l.kg_expected), 0) / received.length * 100 : null;
  const forecast = v.filter((l) => l.step === "prevu").reduce((s, l) => s + (num(l.kg_expected) || 0), 0);
  const ps = parcels || [];
  const stockBy = {};
  v.filter((l) => l.step === "centre").forEach((l) => { stockBy[l.centre_id] = (stockBy[l.centre_id] || 0) + (num(l.kg_harvested) || 0); });
  return {
    forecast_kg: Math.round(forecast * 10) / 10,
    watch: ps.filter((p) => p.health === "Alerte" || p.health === "Surveillance").length,
    located: ps.length ? pct(ps.filter((p) => p.center).length, ps.length) : null,
    loss_pct: pct(kgLoss, kgH),
    fast_pct: timed.length ? pct(fast, timed.length) : null,
    forecast_gap_pct: gap == null ? null : Math.round(gap * 10) / 10,
    delivered: delivered.length,
    stock_kg: stockBy,
    targets: TARGETS,
    sites: (sites || []).length
  };
}

module.exports = { LOT_STEPS, LOT_LABEL, CANALS, QUALITIES, TARGETS, zoneCenter, zoneAreaHa, healthOf, lotStep, lotView, checkSite, lotAction, nextLotCode, indicators };
