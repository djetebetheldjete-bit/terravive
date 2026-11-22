"use strict";
// Terravive — indices climatiques d'une parcelle (zéro dépendance).
// Chaîne : séries journalières → contrôle qualité → indices annuels → tendances → lecture agricole.
// Définitions des indices : ETCCDI (Expert Team on Climate Change Detection and Indices, OMM),
// avec des seuils adaptés aux tropiques (SU35, TR23, R50mm) car SU25 / TR20 y sont saturés.
// Tendances : pente de Sen (robuste) + test de Mann-Kendall (bilatéral, seuil 5 %).

const MISSING_DAYS_MAX = 15; // une année est exclue pour un indice s'il manque plus de 15 jours

function isNum(v) { return typeof v === "number" && Number.isFinite(v); }
function mean(a) { const b = a.filter(isNum); return b.length ? b.reduce((s, x) => s + x, 0) / b.length : null; }
function sd(a) { const m = mean(a); const b = a.filter(isNum); if (b.length < 2) return null; return Math.sqrt(b.reduce((s, x) => s + (x - m) * (x - m), 0) / (b.length - 1)); }
function percentile(arr, p) {
  const a = arr.filter(isNum).sort((x, y) => x - y); if (!a.length) return null;
  const h = (a.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return a[lo] + (a[hi] - a[lo]) * (h - lo);
}
function r1(x) { return isNum(x) ? Math.round(x * 10) / 10 : null; }
function r2(x) { return isNum(x) ? Math.round(x * 100) / 100 : null; }

/**
 * Contrôle qualité (même règles que RClimDex) : pluie négative → manquante ; TX < TN → les deux manquantes ;
 * valeurs physiquement impossibles → manquantes ; valeurs au-delà de moyenne ± 4 écarts-types du mois → manquantes.
 * Renvoie { days:[{d,y,m,doy,p,tx,tn}], qc:{...} }.
 */
function qualityControl(series) {
  const dates = series.dates || [], P = series.pluie || [], TX = series.tmax || [], TN = series.tmin || [];
  const qc = { days: dates.length, negative_rain: 0, tx_below_tn: 0, impossible: 0, outliers: 0, missing_p: 0, missing_t: 0 };
  const days = dates.map((d, i) => {
    let p = isNum(P[i]) ? P[i] : null, tx = isNum(TX[i]) ? TX[i] : null, tn = isNum(TN[i]) ? TN[i] : null;
    const e0 = series.et0 && isNum(series.et0[i]) && series.et0[i] >= 0 && series.et0[i] < 20 ? series.et0[i] : null;
    if (p != null && p < 0) { p = null; qc.negative_rain++; }
    if (p != null && p > 500) { p = null; qc.impossible++; }
    if (tx != null && (tx < -30 || tx > 60)) { tx = null; qc.impossible++; }
    if (tn != null && (tn < -40 || tn > 45)) { tn = null; qc.impossible++; }
    if (tx != null && tn != null && tx < tn) { tx = null; tn = null; qc.tx_below_tn++; }
    const y = +d.slice(0, 4), m = +d.slice(5, 7);
    return { d, y, m, doy: dayOfYear(d), p, tx, tn, e0 };
  });
  // valeurs aberrantes de température : moyenne ± 4 écarts-types par mois calendaire
  for (const k of ["tx", "tn"]) {
    for (let m = 1; m <= 12; m++) {
      const v = days.filter((x) => x.m === m).map((x) => x[k]), mu = mean(v), s = sd(v);
      if (mu == null || s == null || s === 0) continue;
      days.forEach((x) => { if (x.m === m && isNum(x[k]) && Math.abs(x[k] - mu) > 4 * s) { x[k] = null; qc.outliers++; } });
    }
  }
  qc.missing_p = days.filter((x) => x.p == null).length;
  qc.missing_t = days.filter((x) => x.tx == null || x.tn == null).length;
  return { days, qc };
}
// Jour de l'année sur 365 jours (le 29 février est rapproché du 28) : comparaisons d'une année à l'autre.
function dayOfYear(d) {
  const y = +d.slice(0, 4), m = +d.slice(5, 7), day = Math.min(+d.slice(8, 10), m === 2 ? 28 : 31);
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return cum[m - 1] + day; // 1..365
}

// Seuils « calendaires » : 90e centile de TX (ou TN) pour chaque jour de l'année, fenêtre de 5 jours,
// calculé sur la période de base. (RClimDex ajoute un rééchantillonnage pour la période de base ; non fait ici.)
function calendarPercentile(days, key, p, base) {
  const buckets = Array.from({ length: 366 }, () => []);
  days.forEach((x) => { if (x.y >= base[0] && x.y <= base[1] && isNum(x[key])) buckets[x.doy].push(x[key]); });
  const out = new Array(366).fill(null);
  for (let d = 1; d <= 365; d++) {
    let vals = [];
    for (let k = -2; k <= 2; k++) { let dd = d + k; if (dd < 1) dd += 365; if (dd > 365) dd -= 365; vals = vals.concat(buckets[dd]); }
    out[d] = percentile(vals, p);
  }
  return out;
}

/** Indices annuels. Renvoie { years:[...], base:[a,b], idx:{CODE:{year:value}} }. */
function yearlyIndices(days, opts) {
  const years = [...new Set(days.map((x) => x.y))].sort((a, b) => a - b);
  const base = (opts && opts.base) || [Math.max(years[0], 1991), Math.min(years[years.length - 1], 2020)];
  const tx90 = calendarPercentile(days, "tx", 0.9, base), tn90 = calendarPercentile(days, "tn", 0.9, base);
  const wetBase = days.filter((x) => x.y >= base[0] && x.y <= base[1] && isNum(x.p) && x.p >= 1).map((x) => x.p);
  const p95 = percentile(wetBase, 0.95);
  const idx = {}; const set = (k, y, v) => { (idx[k] = idx[k] || {})[y] = v; };
  for (const y of years) {
    const yd = days.filter((x) => x.y === y), nP = yd.filter((x) => x.p == null).length, nT = yd.filter((x) => x.tx == null || x.tn == null).length;
    const fullYear = yd.length >= 360;
    if (fullYear && nP <= MISSING_DAYS_MAX) {
      const ps = yd.map((x) => x.p), wet = ps.filter((v) => isNum(v) && v >= 1);
      const tot = wet.reduce((s, v) => s + v, 0);
      set("PRCPTOT", y, r1(tot)); set("SDII", y, wet.length ? r1(tot / wet.length) : 0);
      set("R10mm", y, ps.filter((v) => isNum(v) && v >= 10).length); set("R20mm", y, ps.filter((v) => isNum(v) && v >= 20).length);
      set("R50mm", y, ps.filter((v) => isNum(v) && v >= 50).length);
      set("Rx1day", y, r1(Math.max(...ps.filter(isNum))));
      let rx5 = 0; for (let i = 0; i + 4 < ps.length; i++) { let s5 = 0, ok = true; for (let k = 0; k < 5; k++) { if (!isNum(ps[i + k])) { ok = false; break; } s5 += ps[i + k]; } if (ok) rx5 = Math.max(rx5, s5); }
      set("Rx5day", y, r1(rx5));
      let cdd = 0, cwd = 0, c1 = 0, c2 = 0;
      ps.forEach((v) => { if (!isNum(v)) { c1 = 0; c2 = 0; return; } if (v < 1) { c1++; c2 = 0; } else { c2++; c1 = 0; } cdd = Math.max(cdd, c1); cwd = Math.max(cwd, c2); });
      set("CDD", y, cdd); set("CWD", y, cwd);
      if (p95 != null) set("R95pTOT", y, r1(wet.filter((v) => v > p95).reduce((s, v) => s + v, 0)));
    }
    if (fullYear && nT <= MISSING_DAYS_MAX) {
      const tx = yd.map((x) => x.tx), tn = yd.map((x) => x.tn);
      set("TXx", y, r1(Math.max(...tx.filter(isNum)))); set("TNn", y, r1(Math.min(...tn.filter(isNum))));
      set("SU35", y, tx.filter((v) => isNum(v) && v > 35).length); set("TR23", y, tn.filter((v) => isNum(v) && v > 23).length);
      const valid = yd.filter((x) => isNum(x.tx) && isNum(x.tn));
      set("DTR", y, r1(mean(valid.map((x) => x.tx - x.tn))));
      const hot = yd.map((x) => isNum(x.tx) && tx90[x.doy] != null && x.tx > tx90[x.doy]);
      set("TX90p", y, r1(100 * hot.filter(Boolean).length / Math.max(1, valid.length)));
      set("TN90p", y, r1(100 * yd.filter((x) => isNum(x.tn) && tn90[x.doy] != null && x.tn > tn90[x.doy]).length / Math.max(1, valid.length)));
      let wsdi = 0, run = 0; hot.concat([false]).forEach((h) => { if (h) run++; else { if (run >= 6) wsdi += run; run = 0; } });
      set("WSDI", y, wsdi);
    }
  }
  return { years, base, idx, p95: r1(p95) };
}

// ---------- Tendance : pente de Sen + test de Mann-Kendall ----------
function normCdf(z) { // approximation d'Abramowitz-Stegun (erreur < 1e-7)
  const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
/** Tendance d'une série annuelle {year:value}. Renvoie {n, slope_per_decade, p, significant, direction} ou null. */
function trend(byYear) {
  const pts = Object.keys(byYear || {}).map(Number).sort((a, b) => a - b).filter((y) => isNum(byYear[y])).map((y) => [y, byYear[y]]);
  const n = pts.length; if (n < 10) return null;
  const slopes = []; let S = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    slopes.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
    S += Math.sign(pts[j][1] - pts[i][1]);
  }
  // variance de S avec correction des ex aequo
  const ties = {}; pts.forEach((p) => { ties[p[1]] = (ties[p[1]] || 0) + 1; });
  let tieSum = 0; Object.values(ties).forEach((t) => { if (t > 1) tieSum += t * (t - 1) * (2 * t + 5); });
  const varS = (n * (n - 1) * (2 * n + 5) - tieSum) / 18;
  const z = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
  const p = varS > 0 ? 2 * (1 - normCdf(Math.abs(z))) : 1;
  const slope = percentile(slopes, 0.5);
  return { n, slope_per_decade: r2(slope * 10), p: Math.round(p * 1000) / 1000, significant: p < 0.05, direction: slope > 0 ? "hausse" : slope < 0 ? "baisse" : "stable" };
}

// ---------- Lecture agricole ----------
const INDEX_INFO = {
  CDD: { name: "Jours secs consécutifs (le plus long épisode)", unit: "jours", q: "Combien de jours secs d'affilée faut-il prévoir ?",
    act: "Prévoir des variétés à cycle court, un paillage et de l'irrigation d'appoint ; caler le semis après l'installation des pluies.", worse: "hausse" },
  CWD: { name: "Jours humides consécutifs", unit: "jours", q: "Les périodes humides durent-elles longtemps ?",
    act: "Les longues périodes humides favorisent les maladies fongiques : aérer la culture, surveiller après chaque série de pluies.", worse: "hausse" },
  PRCPTOT: { name: "Pluie annuelle (jours de pluie)", unit: "mm", q: "Combien pleut-il par an ?", act: "Sert à choisir les cultures et à dimensionner l'irrigation.", worse: "baisse" },
  SDII: { name: "Intensité moyenne d'une journée de pluie", unit: "mm/jour", q: "Les pluies sont-elles violentes ?",
    act: "Des pluies plus intenses accentuent l'érosion : billons en courbes de niveau, couverture du sol.", worse: "hausse" },
  R50mm: { name: "Jours de très fortes pluies (≥ 50 mm)", unit: "jours", q: "Combien de pluies très fortes par an ?",
    act: "Prévoir des rigoles de drainage, éviter les bas-fonds inondables pour les cultures sensibles.", worse: "hausse" },
  Rx1day: { name: "Pluie maximale en un jour", unit: "mm", q: "Quelle est la plus forte pluie de l'année ?",
    act: "Dimensionner les drains et protéger les planches contre le ruissellement.", worse: "hausse" },
  Rx5day: { name: "Pluie maximale en 5 jours", unit: "mm", q: "Quel cumul maximal en quelques jours ?",
    act: "Risque d'engorgement : surélever les planches, drainer.", worse: "hausse" },
  R95pTOT: { name: "Pluie tombée lors des jours très pluvieux", unit: "mm", q: "Quelle part de la pluie arrive en averses extrêmes ?",
    act: "Plus la pluie arrive en averses extrêmes, moins elle profite à la culture : favoriser l'infiltration (paillage, compost).", worse: "hausse" },
  SU35: { name: "Jours chauds (température max > 35 °C)", unit: "jours", q: "Combien de jours de forte chaleur ?",
    act: "Stress thermique à la floraison : variétés tolérantes, ombrage léger, arrosage aux heures fraîches, éviter que la floraison tombe sur les pics de chaleur.", worse: "hausse" },
  TR23: { name: "Nuits chaudes (température min > 23 °C)", unit: "jours", q: "Les nuits sont-elles trop chaudes ?",
    act: "Des nuits chaudes réduisent la nouaison de certaines cultures (tomate, riz, maïs) : choisir des variétés adaptées.", worse: "hausse" },
  TXx: { name: "Température maximale de l'année", unit: "°C", q: "Quel est le pic de chaleur ?", act: "Repère pour le choix des variétés et l'ombrage.", worse: "hausse" },
  TX90p: { name: "Jours anormalement chauds pour la saison", unit: "% des jours", q: "Les journées chaudes deviennent-elles plus fréquentes ?",
    act: "Anticiper l'arrosage et la protection des jeunes plants.", worse: "hausse" },
  WSDI: { name: "Jours en vague de chaleur (≥ 6 jours de suite)", unit: "jours", q: "Y a-t-il des vagues de chaleur ?",
    act: "Prévoir des réserves d'eau et décaler les semis sensibles.", worse: "hausse" }
};
const KEY_INDICES = ["CDD", "CWD", "PRCPTOT", "SDII", "R50mm", "Rx1day", "Rx5day", "R95pTOT", "SU35", "TR23", "TXx", "TX90p", "WSDI"];

function fmtP(p) { return p < 0.001 ? "p < 0,001" : "p = " + String(p).replace(".", ","); }
function readIndex(code, byYear) {
  const info = INDEX_INFO[code]; if (!info) return null;
  const vals = Object.values(byYear || {}).filter(isNum); if (!vals.length) return null;
  const tr = trend(byYear);
  let sentence = "En moyenne : " + r1(mean(vals)) + " " + info.unit + " par an (sur " + vals.length + " années).";
  let flag = "neutre";
  if (tr) {
    if (tr.significant && tr.direction !== "stable") {
      sentence += " Évolution nette : " + (tr.direction === "hausse" ? "+" : "") + tr.slope_per_decade + " " + info.unit + " par décennie (test de Mann-Kendall, " + fmtP(tr.p) + ").";
      flag = tr.direction === info.worse ? "defavorable" : "favorable";
    } else sentence += " Pas d'évolution nette détectée sur la période (" + fmtP(tr.p) + ") : la variabilité d'une année à l'autre domine.";
  } else sentence += " Série trop courte pour juger d'une tendance.";
  return { code, name: info.name, unit: info.unit, question: info.q, mean: r1(mean(vals)), min: r1(Math.min(...vals)), max: r1(Math.max(...vals)), trend: tr, flag, sentence, action: info.act, series: byYear };
}

/** Pluie moyenne et nombre moyen de jours de pluie par mois (années complètes). */
function monthlyNormals(days) {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const byY = {};
    days.forEach((x) => { if (x.m === m && isNum(x.p)) { const o = byY[x.y] = byY[x.y] || { s: 0, w: 0, n: 0 }; o.s += x.p; o.n++; if (x.p >= 1) o.w++; } });
    const ys = Object.values(byY).filter((o) => o.n >= 25);
    out.push({ month: m, rain_mm: r1(mean(ys.map((o) => o.s))), wet_days: r1(mean(ys.map((o) => o.w))), years: ys.length });
  }
  return out;
}

/**
 * Climatologie « jour de l'année » (fenêtre glissante de 15 jours, toutes années confondues) :
 * pluie moyenne, probabilité d'un jour de pluie, Tmax moyenne, probabilité Tmax > 35 °C et Tmin > 23 °C,
 * ET0 moyenne (si la source la fournit). Sert à appliquer le climat au calendrier d'une culture.
 * Plus : pluie journalière de chaque année complète (risque de poches sèches sur une période donnée) et
 * évolution des jours > 35 °C par mois entre les 10 premières et les 10 dernières années.
 */
function climatology(days) {
  const acc = Array.from({ length: 366 }, () => ({ p: [], tx: [], tn: [], e0: [] }));
  days.forEach((x) => { const a = acc[x.doy]; if (isNum(x.p)) a.p.push(x.p); if (isNum(x.tx)) a.tx.push(x.tx); if (isNum(x.tn)) a.tn.push(x.tn); if (isNum(x.e0)) a.e0.push(x.e0); });
  const win = (d, k) => { let v = []; for (let j = -7; j <= 7; j++) { let dd = d + j; if (dd < 1) dd += 365; if (dd > 365) dd -= 365; v = v.concat(acc[dd][k]); } return v; };
  const doy = { rain: [], pwet: [], tx: [], phot: [], pnight: [], et0: [] };
  let hasE0 = false;
  for (let d = 1; d <= 365; d++) {
    const p = win(d, "p"), tx = win(d, "tx"), tn = win(d, "tn"), e0 = win(d, "e0");
    doy.rain.push(r2(mean(p))); doy.pwet.push(p.length ? r2(p.filter((v) => v >= 1).length / p.length) : null);
    doy.tx.push(r1(mean(tx))); doy.phot.push(tx.length ? r2(tx.filter((v) => v > 35).length / tx.length) : null);
    doy.pnight.push(tn.length ? r2(tn.filter((v) => v > 23).length / tn.length) : null);
    doy.et0.push(e0.length ? r2(mean(e0)) : null); if (e0.length) hasE0 = true;
  }
  if (!hasE0) doy.et0 = null;
  const rainByYear = {};
  const years = [...new Set(days.map((x) => x.y))];
  years.forEach((y) => { const yd = days.filter((x) => x.y === y); if (yd.length < 360) return; const arr = new Array(365).fill(null); yd.forEach((x) => { if (arr[x.doy - 1] == null) arr[x.doy - 1] = isNum(x.p) ? r1(x.p) : null; }); rainByYear[y] = arr; });
  const ys = years.sort((a, b) => a - b), early = ys.slice(0, 10), late = ys.slice(-10);
  const hotByMonth = (set) => Array.from({ length: 12 }, (_, m) => { const per = set.map((y) => days.filter((x) => x.y === y && x.m === m + 1 && isNum(x.tx)).filter((x) => x.tx > 35).length); return r1(mean(per)); });
  return { doy, rainByYear, hot35_by_month: ys.length >= 20 ? { early: hotByMonth(early), recent: hotByMonth(late), early_years: [early[0], early[early.length - 1]], recent_years: [late[0], late[late.length - 1]] } : null };
}

/** Analyse complète d'une source. */
function analyse(series, opts) {
  const { days, qc } = qualityControl(series);
  if (!days.length) return { error: "Aucune donnée journalière." };
  const yi = yearlyIndices(days, opts);
  const readings = KEY_INDICES.map((k) => readIndex(k, yi.idx[k])).filter(Boolean);
  return {
    period: [days[0].d, days[days.length - 1].d], years: yi.years.length, base: yi.base, p95_mm: yi.p95, qc,
    readings, monthly: monthlyNormals(days), clim: climatology(days)
  };
}

/** Comparaison de deux sources sur un même indice (accord des moyennes et des tendances). */
function compareSources(a, b) {
  const out = [];
  (a.readings || []).forEach((ra) => {
    const rb = (b.readings || []).find((x) => x.code === ra.code); if (!rb) return;
    const diff = ra.mean == null || rb.mean == null ? null : ra.mean === rb.mean ? 0 : Math.round(100 * Math.abs(ra.mean - rb.mean) / Math.max(Math.abs(ra.mean), Math.abs(rb.mean)));
    const sameTrend = ra.trend && rb.trend ? (ra.trend.significant === rb.trend.significant && (!ra.trend.significant || ra.trend.direction === rb.trend.direction)) : null;
    out.push({ code: ra.code, gap_pct: diff, same_trend: sameTrend, agree: diff != null && diff <= 25 && sameTrend !== false });
  });
  return out;
}

module.exports = { climatology, qualityControl, yearlyIndices, trend, analyse, compareSources, monthlyNormals, dayOfYear, INDEX_INFO, KEY_INDICES };
