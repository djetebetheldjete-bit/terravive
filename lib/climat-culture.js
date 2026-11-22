"use strict";
// Terravive — le climat de la parcelle appliqué à SA culture :
//   calendrier des stades (FAO-56) à partir de la date de semis,
//   climat attendu à chaque stade (pluie, chaleur, nuits chaudes, poches sèches, fortes pluies),
//   besoin en eau et plan d'arrosage (dose et fréquence selon le sol, litres pour la parcelle),
//   meilleure période de semis pour cette culture à cet endroit.
// Tout est calculé à partir de la climatologie de la parcelle (~35 ans) et des coefficients FAO-56 de la
// culture : ce sont des valeurs « en année moyenne », à ajuster avec la météo réelle de la saison.

const SOL = require("./sol");

const STAGE_LABELS = ["Installation (semis / reprise)", "Croissance", "Floraison et formation des fruits / grains", "Maturation et récolte"];
const DRY_SPELL = 10;      // jours secs d'affilée considérés comme une « poche sèche »
const CAN_L = 10;          // contenance d'un arrosoir (L)
const MAX_INTERVAL = 14;   // au-delà, le besoin est trop faible pour parler d'un rythme d'arrosage
const MAX_CANS = 300;      // au-delà, compter des arrosoirs n'a plus de sens pratique

function isNum(v) { return typeof v === "number" && Number.isFinite(v); }
function r0(x) { return isNum(x) ? Math.round(x) : null; }
function r1(x) { return isNum(x) ? Math.round(x * 10) / 10 : null; }
function doyOf(dateStr) { const d = new Date(dateStr + "T12:00:00Z"), j = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); let n = Math.floor((d - j) / 864e5) + 1; if (n > 365) n = 365; return n; }
function addDays(dateStr, k) { const d = new Date(dateStr + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
function idx(doy) { return ((doy - 1) % 365 + 365) % 365; }
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
function frDate(s) { const d = new Date(s + "T12:00:00Z"); return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()]; }

/** Pluie efficace (méthode USDA, FAO) sur une période de n jours, à partir du cumul P (mm). */
function effectiveRain(P, n) {
  if (!(P > 0)) return 0;
  const monthly = P * 30 / n; // ramené à un mois
  const pe = monthly <= 250 ? monthly * (125 - 0.2 * monthly) / 125 : 125 + 0.1 * monthly;
  return Math.max(0, pe * n / 30);
}

/** Calendrier des stades à partir du semis (longueurs FAO-56 de la culture). */
function calendar(crop, sownAt) {
  let start = sownAt; const out = [];
  crop.st.forEach((len, i) => { const end = addDays(start, len - 1); out.push({ i, label: STAGE_LABELS[i], from: start, to: end, days: len }); start = addDays(end, 1); });
  return out;
}

/** Statistiques climatiques d'une fenêtre [doy0, doy0+n) d'après la climatologie jour par jour. */
function windowStats(clim, rainClim, doy0, n) {
  let rain = 0, et0 = 0, hot = 0, nights = 0, et0n = 0;
  for (let k = 0; k < n; k++) {
    const j = idx(doy0 - 1 + k);
    rain += (rainClim.doy.rain[j] || 0);
    if (clim.doy.et0 && isNum(clim.doy.et0[j])) { et0 += clim.doy.et0[j]; et0n++; }
    hot += clim.doy.phot[j] || 0; nights += clim.doy.pnight[j] || 0;
  }
  // Poches sèches et fortes pluies : fréquence sur les années observées (pluie de la source choisie).
  const years = Object.keys(rainClim.rainByYear || {});
  let dryYears = 0, heavyYears = 0, nY = 0;
  years.forEach((y) => {
    const arr = rainClim.rainByYear[y]; let run = 0, maxRun = 0, heavy = false, ok = true;
    for (let k = 0; k < n; k++) { const v = arr[idx(doy0 - 1 + k)]; if (v == null) { ok = false; break; } if (v < 1) { run++; maxRun = Math.max(maxRun, run); } else run = 0; if (v >= 50) heavy = true; }
    if (!ok) return; nY++; if (maxRun >= DRY_SPELL) dryYears++; if (heavy) heavyYears++;
  });
  return { rain_mm: r0(rain), et0_mm: et0n ? r0(et0 * n / et0n) : null, hot_days: r1(hot), warm_nights: r1(nights),
    dry_spell_pct: nY ? r0(100 * dryYears / nY) : null, heavy_rain_pct: nY ? r0(100 * heavyYears / nY) : null, years: nY };
}

/** Réserve facilement utilisable du sol (mm = L/m²) à une profondeur racinaire donnée. */
function readilyAvailable(texture, stones, zr, p) {
  const tex = texture && SOL.TEXTURES[texture]; if (!tex) return null;
  const awc = (tex.awc[0] + tex.awc[1]) / 2;
  return p * awc * zr * (1 - (stones || 0) / 100);
}

/**
 * Analyse culture × climat.
 * @param {object} c { cropName, sownAt (AAAA-MM-JJ, facultatif), areaM2, irrigation, soil:{estimate, manual}, clim (source température + ET0), rainClim (source pluie), today }
 */
function cropClimate(c) {
  const found = SOL.findCrop(c.cropName);
  if (!found) return { error: c.cropName ? "Culture « " + c.cropName + " » sans références de cycle dans Terravive : lecture générale seulement." : "Renseignez la culture (et la date de semis) dans « Sol & racines » pour appliquer le climat à votre culture." };
  const crop = found.data;
  if (crop.per) return { error: "Culture pérenne : la lecture par stades ne s'applique pas." };
  if (!c.clim || !c.clim.doy || !c.rainClim || !c.rainClim.doy) return { error: "Climat de la parcelle pas encore calculé." };
  const area = c.areaM2 > 0 ? c.areaM2 : null;
  const soil = SOL.effectiveSoil((c.soil || {}).estimate, (c.soil || {}).manual);
  const hasEt0 = !!c.clim.doy.et0;
  const cycle = crop.st.reduce((a, b) => a + b, 0);

  // --- meilleure période de semis : on essaie un semis chaque semaine de l'année ---
  function score(doy0) {
    let need = 0, d = doy0, heatFlower = 0, heavyHarvest = 0, dry = 0;
    crop.st.forEach((len, i) => {
      const w = windowStats(c.clim, c.rainClim, d, len), kc = i === 0 ? crop.kc[0] : i === 2 ? crop.kc[1] : (crop.kc[0] + crop.kc[1]) / 2;
      const etc = w.et0_mm != null ? w.et0_mm * (i === 3 ? (crop.kc[1] + crop.kc[2]) / 2 : kc) : null;
      if (etc != null) need += Math.max(0, etc - effectiveRain(w.rain_mm, len));
      if (i === 2) heatFlower = w.hot_days;
      if (i === 3) heavyHarvest = w.heavy_rain_pct || 0;
      if (i <= 2) dry += (w.dry_spell_pct || 0) / 3;
      d += len;
    });
    return { doy: doy0, need_mm: r0(need), heat_flower_days: heatFlower, heavy_harvest_pct: heavyHarvest, dry_pct: r0(dry) };
  }
  const tries = []; for (let d = 1; d <= 365; d += 7) tries.push(score(d));
  const maxNeed = Math.max(1, ...tries.map((t) => t.need_mm || 0));
  tries.forEach((t) => { t.score = (hasEt0 ? 50 * (t.need_mm || 0) / maxNeed : 0) + 3 * (t.heat_flower_days || 0) + 0.3 * t.heavy_harvest_pct + 0.3 * t.dry_pct; });
  const ranked = tries.slice().sort((a, b) => a.score - b.score);
  const year = (c.today || new Date().toISOString().slice(0, 10)).slice(0, 4);
  const toDate = (doy) => addDays(year + "-01-01", doy - 1);
  // regroupe les meilleures semaines en périodes contiguës
  const good = ranked.slice(0, 6).map((t) => t.doy).sort((a, b) => a - b), windows = [];
  good.forEach((d) => { const w = windows[windows.length - 1]; if (w && d - w.to <= 7) w.to = d; else windows.push({ from: d, to: d }); });
  const sowing = {
    best: windows.slice(0, 2).map((w) => { const t = tries.find((x) => x.doy === w.from); return { from: frDate(toDate(w.from)), to: frDate(toDate(w.to + 6)), need_mm: t.need_mm, heat_flower_days: t.heat_flower_days }; }),
    worst: (() => { const t = ranked[ranked.length - 1]; return { around: frDate(toDate(t.doy)), heat_flower_days: t.heat_flower_days, need_mm: t.need_mm }; })(),
    basis: "Semis simulé chaque semaine de l'année sur le climat moyen de la parcelle : besoin d'arrosage" + (hasEt0 ? "" : " (non calculable : évapotranspiration indisponible pour cette source)") + ", chaleur pendant la floraison, poches sèches, fortes pluies à la récolte."
  };

  const out = { crop: found.key, cycle_days: cycle, sowing, source: { temperature: c.clim.label || null, rain: c.rainClim.label || null } };
  if (!c.sownAt) { out.notes = ["Indiquez la date de semis dans « Sol & racines » pour obtenir le calendrier, les risques par stade et le plan d'arrosage de votre culture."]; return out; }

  // --- calendrier et climat attendu à chaque stade ---
  const cal = calendar(crop, String(c.sownAt).slice(0, 10));
  let totalNeed = 0, totalEtc = 0, peak = null;
  const stages = cal.map((s, i) => {
    const w = windowStats(c.clim, c.rainClim, doyOf(s.from), s.days);
    const kc = i === 0 ? crop.kc[0] : i === 1 ? (crop.kc[0] + crop.kc[1]) / 2 : i === 2 ? crop.kc[1] : (crop.kc[1] + crop.kc[2]) / 2;
    const etc = w.et0_mm != null ? w.et0_mm * kc : null;
    const pe = effectiveRain(w.rain_mm, s.days);
    const need = etc != null ? Math.max(0, etc - pe) : null;
    if (need != null) { totalNeed += need; totalEtc += etc; }
    // dose par arrosage selon le sol, à la profondeur racinaire du milieu du stade
    const mid = Math.round(cal.slice(0, i).reduce((a, x) => a + x.days, 0) + s.days / 2);
    const zr = SOL.rootDepthAt(crop, mid);
    const etcDay = etc != null ? etc / s.days : null;
    const p = Math.min(0.8, Math.max(0.1, crop.p + (etcDay != null ? 0.04 * (5 - etcDay) : 0)));
    const raw = soil.texture ? readilyAvailable(soil.texture, soil.stones, zr, p) : null;
    const needDay = need != null ? need / s.days : null;
    const st = { label: s.label, from: s.from, to: s.to, days: s.days, kc: Math.round(kc * 100) / 100,
      rain_mm: w.rain_mm, etc_mm: r0(etc), need_mm: r0(need), hot_days: w.hot_days, warm_nights: w.warm_nights,
      dry_spell_pct: w.dry_spell_pct, heavy_rain_pct: w.heavy_rain_pct, root_cm: r0(zr * 100), advice: [] };
    if (needDay != null) {
      st.need_l_m2_week = r1(needDay * 7);
      if (area) st.need_l_week_parcel = r0(needDay * 7 * area);
      const interval = raw != null && needDay > 0 ? Math.max(1, Math.round(raw / needDay)) : null;
      if (raw != null && interval != null && interval <= MAX_INTERVAL) {
        st.dose_l_m2 = r0(raw); st.interval_days = interval;
        if (area) {
          st.dose_l_parcel = r0(raw * area);
          const cans = Math.ceil(raw * area / CAN_L);
          if (cans <= MAX_CANS) st.cans_per_watering = cans; else st.cans_impractical = true;
        }
      } else if (need != null && need >= 5) st.light_need = true;
      if (!peak || needDay > peak.needDay) peak = { label: s.label, needDay, from: s.from, to: s.to };
    }
    // conseils propres au stade
    if (need != null && need < 5) st.advice.push("La pluie couvre normalement le besoin à ce stade : arrosez seulement en cas de poche sèche.");
    else if (st.light_need) st.advice.push("Besoin d'eau faible à ce stade (≈ " + st.need_l_m2_week + " L/m² par semaine) : la pluie couvre presque tout ; arrosez seulement après plusieurs jours sans pluie.");
    if (w.dry_spell_pct >= 40 && i <= 2) st.advice.push("Une poche sèche de " + DRY_SPELL + " jours ou plus survient " + w.dry_spell_pct + " années sur 100 à cette période : gardez de quoi arroser et paillez.");
    if (i === 2 && w.hot_days >= 3) st.advice.push("En moyenne " + w.hot_days + " jours au-dessus de 35 °C pendant la floraison : risque de chute des fleurs. Arrosez aux heures fraîches, ombrage léger, ou décalez le semis.");
    if (i === 2 && w.warm_nights >= 15 && ["tomate", "poivron", "piment", "riz", "maïs"].includes(found.key)) st.advice.push("Nuits chaudes fréquentes (" + w.warm_nights + " nuits > 23 °C) : la nouaison peut souffrir, préférez une variété tolérante à la chaleur.");
    if (i === 3 && w.heavy_rain_pct >= 30) st.advice.push("Une pluie de plus de 50 mm tombe " + w.heavy_rain_pct + " années sur 100 pendant la récolte : récoltez dès maturité, drainez, attention à la pourriture des fruits.");
    return st;
  });
  out.calendar = stages;
  out.irrigation = {
    total_need_mm: hasEt0 ? r0(totalNeed) : null, total_etc_mm: hasEt0 ? r0(totalEtc) : null,
    total_need_l_parcel: hasEt0 && area ? r0(totalNeed * area) : null,
    peak: peak ? { stage: peak.label, from: peak.from, to: peak.to, l_m2_week: r1(peak.needDay * 7), l_week_parcel: area ? r0(peak.needDay * 7 * area) : null } : null,
    soil_known: !!soil.texture, method: c.irrigation || null
  };
  const notes = [];
  if (!hasEt0) notes.push("Évapotranspiration indisponible pour cette source : le besoin en eau ne peut pas être calculé (il l'est avec la source ERA5).");
  if (!soil.texture) notes.push("Sol inconnu : renseignez-le (« Sol & racines ») pour obtenir la dose par arrosage et la fréquence.");
  const bigDose = stages.find((s) => s.cans_impractical);
  if (bigDose && (c.irrigation === "arrosoir" || !c.irrigation)) notes.push("À l'arrosoir, arroser toute la parcelle demanderait plus de " + MAX_CANS + " arrosoirs à chaque passage (" + bigDose.dose_l_parcel.toLocaleString("fr-FR") + " L) : arrosez seulement au pied des plants, paillez, et envisagez un goutte-à-goutte ou une pompe.");
  else if (c.irrigation === "arrosoir" && peak && area && peak.needDay * 7 * area > 3000) notes.push("Au pic de besoin, il faut environ " + r0(peak.needDay * 7 * area / CAN_L) + " arrosoirs de 10 L par semaine pour toute la parcelle : paillage, arrosage au pied et réserve d'eau sont indispensables.");
  if (c.irrigation === "pluvial" && hasEt0 && totalNeed > 50) notes.push("En culture pluviale, la pluie ne couvre pas tout le besoin (" + r0(totalNeed) + " mm manquants en année moyenne) : prévoyez au moins un arrosage d'appoint aux stades sensibles.");
  // le semis réel est-il dans une bonne période ?
  const sowDoy = doyOf(String(c.sownAt).slice(0, 10)), mine = tries.reduce((b, t) => (Math.abs(t.doy - sowDoy) < Math.abs(b.doy - sowDoy) ? t : b), tries[0]);
  const rank = ranked.indexOf(mine) + 1;
  out.sowing.current = { rank, of: ranked.length, verdict: rank <= 10 ? "favorable" : rank <= 30 ? "moyenne" : "défavorable" };
  notes.unshift("Votre date de semis (" + frDate(String(c.sownAt).slice(0, 10)) + ") est " + (rank <= 10 ? "dans une période favorable" : rank <= 30 ? "dans une période moyenne" : "dans une période défavorable") + " pour " + found.key + " à cet endroit (" + rank + "e semaine sur " + ranked.length + ").");
  out.notes = notes;
  out.assumptions = "Valeurs d'une année moyenne (~35 ans) : la météo de la saison peut s'en écarter. Stades et coefficients de la culture : FAO-56" + (crop.src === "ind" ? " (valeurs indicatives pour cette culture)" : "") + ". Arrosoir de " + CAN_L + " L. Poche sèche : " + DRY_SPELL + " jours de suite sans pluie utile (< 1 mm).";
  return out;
}

/** Résumé court (pour le conseiller et les alertes). */
function cropClimateLines(cc) {
  if (!cc || cc.error) return [];
  const L = [];
  if (cc.sowing && cc.sowing.best && cc.sowing.best.length) L.push("Période de semis la plus favorable ici pour " + cc.crop + " : " + cc.sowing.best.map((b) => b.from + " – " + b.to).join(" ou ") + ".");
  (cc.notes || []).slice(0, 2).forEach((n) => L.push(n));
  if (cc.irrigation && cc.irrigation.peak) L.push("Pic de besoin en eau : " + cc.irrigation.peak.stage.toLowerCase() + " (" + frDate(cc.irrigation.peak.from) + " – " + frDate(cc.irrigation.peak.to) + "), environ " + cc.irrigation.peak.l_m2_week + " L/m² par semaine en année moyenne.");
  (cc.calendar || []).forEach((s) => s.advice.forEach((a) => L.push(s.label + " : " + a)));
  return L.slice(0, 8);
}

module.exports = { cropClimate, cropClimateLines, effectiveRain, calendar, windowStats };
