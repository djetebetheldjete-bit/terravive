/**
 * Terravive — Sources de données de sol et d'évapotranspiration (sans dépendance).
 *
 *  1. iSDAsoil (iSDA Africa) — cartes de sol de l'Afrique à 30 m, licence CC BY 4.0.
 *     API gratuite avec compte : POST /login (formulaire username/password) -> jeton 60 min,
 *     puis GET /isdasoil/v2/soilproperty?lat=&lon= (toutes propriétés, toutes profondeurs).
 *     Activée si ISDA_USERNAME et ISDA_PASSWORD sont définis.
 *  2. SoilGrids (ISRIC) — repli mondial à 250 m, sans compte. API « bêta » parfois en pause,
 *     usage raisonnable : 5 appels/minute. Pas de profondeur de roche.
 *  3. Open-Meteo — ET0 FAO (évapotranspiration de référence) prévue, gratuit, sans clé.
 *
 * Chaque fonction renvoie un objet NORMALISÉ (unités fixes) ou lève une erreur explicite.
 * `fetchImpl` est injectable pour les tests (aucun appel réseau en test).
 */
"use strict";

const { textureFromFractions, normalizeTexture } = require("./sol");

const ISDA_BASE = (process.env.ISDA_BASE_URL || "https://api.isda-africa.com").replace(/\/$/, "");
const SOILGRIDS_BASE = (process.env.SOILGRIDS_BASE_URL || "https://rest.isric.org/soilgrids/v2.0").replace(/\/$/, "");
const TIMEOUT_MS = 20000;

function withTimeout(fetchImpl, url, opts, ms) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), ms || TIMEOUT_MS) : null;
  return fetchImpl(url, Object.assign({}, opts || {}, ctrl ? { signal: ctrl.signal } : {}))
    .finally(() => { if (t) clearTimeout(t); });
}
const num = (v) => { const n = Number(v); return v != null && v !== "" && isFinite(n) ? n : null; };
const avg = (arr) => { const a = arr.filter((x) => x != null); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };

// ---------------------------------------------------------------------------
// iSDAsoil
// ---------------------------------------------------------------------------
let isdaToken = null, isdaTokenAt = 0;
function isdaConfigured() { return !!(process.env.ISDA_USERNAME && process.env.ISDA_PASSWORD); }

async function isdaLogin(fetchImpl) {
  if (isdaToken && Date.now() - isdaTokenAt < 50 * 60 * 1000) return isdaToken; // jeton valable 60 min
  const body = new URLSearchParams({ username: process.env.ISDA_USERNAME, password: process.env.ISDA_PASSWORD }).toString();
  const r = await withTimeout(fetchImpl, ISDA_BASE + "/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || !d.access_token) throw new Error("iSDA : connexion refusée (" + r.status + "). Vérifiez ISDA_USERNAME / ISDA_PASSWORD.");
  isdaToken = d.access_token; isdaTokenAt = Date.now();
  return isdaToken;
}

/**
 * Lit la valeur d'une propriété iSDA à une profondeur donnée.
 * Structure documentée : property[nom][i] = { depth: {value:"0-20" ...} | "0-20", value: { value, unit }, uncertainty: [...] }
 * On reste tolérant aux variantes (depth sous forme d'objet ou de texte, value directe).
 */
function isdaPick(props, names, depthWanted) {
  const keys = Object.keys(props || {});
  for (const want of names) {
    const key = keys.find((k) => k.toLowerCase() === want) || keys.find((k) => k.toLowerCase().includes(want));
    if (!key) continue;
    const list = Array.isArray(props[key]) ? props[key] : [props[key]];
    const depthOf = (it) => {
      const d = it && it.depth; if (d == null) return "";
      if (typeof d === "string") return d;
      if (typeof d === "object") return String(d.value != null ? d.value : (d.top != null ? d.top + "-" + d.bottom : ""));
      return String(d);
    };
    let item = depthWanted ? list.find((it) => depthOf(it).replace(/\s|cm/g, "") === depthWanted) : null;
    if (!item) item = list[0];
    if (!item) continue;
    const v = item.value;
    const raw = v && typeof v === "object" ? v.value : v;
    if (raw == null || raw === "") continue;
    return { value: raw, unit: v && typeof v === "object" ? (v.unit || null) : null, key };
  }
  return null;
}

async function fetchIsda(lat, lon, fetchImpl) {
  const f = fetchImpl || fetch;
  const token = await isdaLogin(f);
  // Sans « property » ni « depth », l'API renvoie toutes les propriétés à toutes les profondeurs.
  const url = ISDA_BASE + "/isdasoil/v2/soilproperty?lat=" + encodeURIComponent(lat.toFixed(5)) + "&lon=" + encodeURIComponent(lon.toFixed(5));
  let r = await withTimeout(f, url, { headers: { Authorization: "Bearer " + token } }, 30000);
  if (r.status === 401) { isdaToken = null; const t2 = await isdaLogin(f); r = await withTimeout(f, url, { headers: { Authorization: "Bearer " + t2 } }, 30000); }
  const d = await r.json().catch(() => null);
  if (!r.ok || !d) throw new Error("iSDA : réponse " + r.status);
  return parseIsda(d);
}

function parseIsda(d) {
  const props = (d && d.property) || {};
  const top = "0-20";
  const pick = (names, depth) => isdaPick(props, names, depth || top);
  const tex = pick(["texture_class", "texture"]);
  const sand = pick(["sand_content", "sand"]), silt = pick(["silt_content", "silt"]), clay = pick(["clay_content", "clay"]);
  const stones = pick(["stone_content", "stone", "wpg2"]);
  const bedrock = pick(["bedrock_depth", "bedrock"], "0-200");
  const ph = pick(["ph"]);
  const oc = pick(["carbon_organic", "organic_carbon"]);
  const n = pick(["nitrogen_total", "nitrogen"]);
  const p = pick(["phosphorous_extractable", "phosphorus_extractable", "phosphorous", "phosphorus"]);
  const k = pick(["potassium_extractable", "potassium"]);
  const out = {
    source: "iSDAsoil (30 m)",
    texture: tex ? normalizeTexture(tex.value) : null,
    sand: sand ? num(sand.value) : null, silt: silt ? num(silt.value) : null, clay: clay ? num(clay.value) : null,
    stones: stones ? num(stones.value) : null,
    bedrock_cm: bedrock ? num(bedrock.value) : null,
    ph: ph ? num(ph.value) : null,
    oc_gkg: oc ? num(oc.value) : null,
    n_gkg: n ? num(n.value) : null,
    p_ppm: p ? num(p.value) : null,
    k_ppm: k ? num(k.value) : null
  };
  // pH parfois exprimé ×10 dans certaines diffusions brutes iSDA
  if (out.ph != null && out.ph > 14) out.ph = out.ph / 10;
  if (!out.texture && out.sand != null && out.silt != null && out.clay != null) out.texture = textureFromFractions(out.sand, out.silt, out.clay);
  if (!out.texture && out.ph == null && out.bedrock_cm == null) throw new Error("iSDA : aucune donnée de sol à cet endroit (eau, zone urbaine ou hors couverture).");
  return out;
}

// ---------------------------------------------------------------------------
// SoilGrids (repli)
// ---------------------------------------------------------------------------
async function fetchSoilGrids(lat, lon, fetchImpl) {
  const f = fetchImpl || fetch;
  const props = ["clay", "sand", "silt", "cfvo", "phh2o", "soc", "nitrogen"];
  const depths = ["0-5cm", "5-15cm", "15-30cm"];
  const url = SOILGRIDS_BASE + "/properties/query?lon=" + lon.toFixed(5) + "&lat=" + lat.toFixed(5)
    + props.map((p) => "&property=" + p).join("") + depths.map((x) => "&depth=" + x).join("") + "&value=mean";
  const r = await withTimeout(f, url, { headers: { Accept: "application/json" } }, 30000);
  const d = await r.json().catch(() => null);
  if (!r.ok || !d) throw new Error("SoilGrids : réponse " + r.status + " (service bêta, parfois en pause).");
  return parseSoilGrids(d);
}

function parseSoilGrids(d) {
  const layers = (d && d.properties && d.properties.layers) || [];
  // Moyenne pondérée par épaisseur sur 0–30 cm, convertie en unités usuelles grâce à d_factor.
  const w = { "0-5cm": 5, "5-15cm": 10, "15-30cm": 15 };
  const val = (name) => {
    const L = layers.find((l) => l.name === name); if (!L) return null;
    const fct = (L.unit_measure && L.unit_measure.d_factor) || 1;
    let s = 0, tw = 0;
    (L.depths || []).forEach((dp) => { const m = dp.values && dp.values.mean; const ww = w[dp.label]; if (m != null && ww) { s += (m / fct) * ww; tw += ww; } });
    return tw ? s / tw : null;
  };
  // Unités converties : clay/sand/silt/cfvo -> %, phh2o -> pH, soc -> g/kg, nitrogen -> g/kg
  const clay = val("clay"), sand = val("sand"), silt = val("silt");
  const out = {
    source: "SoilGrids (250 m)",
    sand, silt, clay,
    texture: sand != null && silt != null && clay != null ? textureFromFractions(sand, silt, clay) : null,
    stones: val("cfvo"),
    bedrock_cm: null,
    ph: val("phh2o"),
    oc_gkg: val("soc"),
    n_gkg: val("nitrogen"),
    p_ppm: null, k_ppm: null
  };
  if (!out.texture && out.ph == null) throw new Error("SoilGrids : aucune donnée à cet endroit.");
  return out;
}

/** Estimation du sol : iSDA si configuré, sinon (ou en cas d'échec) SoilGrids. */
async function estimateSoil(lat, lon, fetchImpl) {
  const errors = [];
  if (isdaConfigured()) {
    try { return Object.assign(await fetchIsda(lat, lon, fetchImpl), { fetched_at: new Date().toISOString() }); }
    catch (e) { errors.push(e.message); }
  }
  try { return Object.assign(await fetchSoilGrids(lat, lon, fetchImpl), { fetched_at: new Date().toISOString(), note: errors.length ? "Repli SoilGrids (" + errors[0] + ")" : undefined }); }
  catch (e) { errors.push(e.message); }
  const err = new Error("Aucune source de données de sol n'a répondu. " + errors.join(" · "));
  err.details = errors;
  throw err;
}

// ---------------------------------------------------------------------------
// ET0 (Open-Meteo, prévision des prochains jours)
// ---------------------------------------------------------------------------
const ET0_CACHE = new Map();
async function fetchEt0(lat, lon, fetchImpl) {
  const f = fetchImpl || fetch;
  const key = lat.toFixed(2) + "," + lon.toFixed(2);
  const c = ET0_CACHE.get(key);
  if (c && Date.now() - c.at < 3 * 3600 * 1000) return c.v;
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat.toFixed(4) + "&longitude=" + lon.toFixed(4) + "&daily=et0_fao_evapotranspiration&forecast_days=3&timezone=auto";
  try {
    const r = await withTimeout(f, url, {}, 12000);
    const d = await r.json();
    const arr = d && d.daily && d.daily.et0_fao_evapotranspiration;
    const v = Array.isArray(arr) ? avg(arr.map(num)) : null;
    ET0_CACHE.set(key, { at: Date.now(), v });
    return v;
  } catch (e) { return null; }
}

/** Centre approximatif d'une zone {bbox} ou {polygon} (moyenne des sommets). */
function zoneCenter(zone) {
  if (!zone) return null;
  if (zone.bbox) return { lon: (zone.bbox[0] + zone.bbox[2]) / 2, lat: (zone.bbox[1] + zone.bbox[3]) / 2 };
  if (zone.polygon && zone.polygon.length) {
    const pts = zone.polygon;
    return { lon: pts.reduce((s, p) => s + p[0], 0) / pts.length, lat: pts.reduce((s, p) => s + p[1], 0) / pts.length };
  }
  return null;
}

function _resetForTests() { isdaToken = null; isdaTokenAt = 0; ET0_CACHE.clear(); }

module.exports = { estimateSoil, fetchIsda, fetchSoilGrids, parseIsda, parseSoilGrids, fetchEt0, zoneCenter, isdaConfigured, _resetForTests };
