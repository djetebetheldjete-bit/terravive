"use strict";
// Tests unitaires : indices climatiques (lib/climat.js) et lecture satellite (lib/satellite.js).
//   node test/test-climat.js
const assert = require("assert");
const C = require("../lib/climat");
const SAT = require("../lib/satellite");

let total = 0, failed = 0;
function test(name, fn) { total++; try { fn(); console.log("  ✓ " + name); } catch (e) { failed++; console.log("  ✗ " + name + "\n      → " + e.message); } }
console.log("\nClimat et satellite — tests unitaires\n");

// Série synthétique déterministe : années complètes, pluie et températures contrôlées.
function build(years, f) {
  const dates = [], pluie = [], tmax = [], tmin = [];
  for (let y = years[0]; y <= years[1]; y++) {
    const d0 = Date.UTC(y, 0, 1), n = (Date.UTC(y + 1, 0, 1) - d0) / 864e5;
    for (let i = 0; i < n; i++) {
      const d = new Date(d0 + i * 864e5).toISOString().slice(0, 10);
      const v = f(y, i, d); dates.push(d); pluie.push(v.p); tmax.push(v.tx); tmin.push(v.tn);
    }
  }
  return { dates, pluie, tmax, tmin };
}
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

test("contrôle qualité : pluie négative, TX < TN et valeurs impossibles sont écartées", () => {
  const s = { dates: ["2020-01-01", "2020-01-02", "2020-01-03"], pluie: [-1, 5, 900], tmax: [30, 20, 31], tmin: [22, 25, 21] };
  const { days, qc } = C.qualityControl(s);
  assert.strictEqual(qc.negative_rain, 1); assert.strictEqual(qc.tx_below_tn, 1); assert.strictEqual(qc.impossible, 1);
  assert.strictEqual(days[0].p, null); assert.strictEqual(days[1].tx, null); assert.strictEqual(days[2].p, null);
});
test("jour de l'année sur 365 jours (le 29 février rejoint le 28)", () => {
  assert.strictEqual(C.dayOfYear("2021-01-01"), 1); assert.strictEqual(C.dayOfYear("2020-02-29"), 59); assert.strictEqual(C.dayOfYear("2021-12-31"), 365);
});
test("indices de pluie : CDD, CWD, R50mm, Rx1day, Rx5day, PRCPTOT et SDII exacts", () => {
  // 1 année : 10 mm tous les 10 jours, sauf un épisode de 3 jours à 60 mm (jours 100-102) et 40 jours secs en début d'année
  const s = build([2001, 2001], (y, i) => ({ p: i < 40 ? 0 : (i >= 100 && i <= 102) ? 60 : (i % 10 === 0 ? 10 : 0), tx: 30, tn: 22 }));
  const r = C.yearlyIndices(C.qualityControl(s).days, { base: [2001, 2001] });
  assert.strictEqual(r.idx.CDD[2001], 40, "CDD"); assert.strictEqual(r.idx.CWD[2001], 3, "CWD");
  assert.strictEqual(r.idx.R50mm[2001], 3); assert.strictEqual(r.idx.Rx1day[2001], 60); assert.strictEqual(r.idx.Rx5day[2001], 180);
  const wet10 = Array.from({ length: 365 }, (_, i) => i).filter((i) => i >= 40 && !(i >= 100 && i <= 102) && i % 10 === 0).length;
  assert.strictEqual(r.idx.PRCPTOT[2001], wet10 * 10 + 180); assert.strictEqual(r.idx.SDII[2001], Math.round((wet10 * 10 + 180) / (wet10 + 3) * 10) / 10);
});
test("indices de température : SU35, TR23, TXx, TNn", () => {
  const s = build([2002, 2002], (y, i) => ({ p: 0, tx: i < 20 ? 36 : 32, tn: i < 5 ? 24 : 21 }));
  const r = C.yearlyIndices(C.qualityControl(s).days, { base: [2002, 2002] });
  assert.strictEqual(r.idx.SU35[2002], 20); assert.strictEqual(r.idx.TR23[2002], 5); assert.strictEqual(r.idx.TXx[2002], 36); assert.strictEqual(r.idx.TNn[2002], 21);
});
test("une année avec plus de 15 jours manquants est exclue de l'indice", () => {
  const s = build([2003, 2003], (y, i) => ({ p: i < 20 ? null : 5, tx: 30, tn: 22 }));
  const r = C.yearlyIndices(C.qualityControl(s).days, { base: [2003, 2003] });
  assert.ok(!r.idx.PRCPTOT || r.idx.PRCPTOT[2003] == null); assert.strictEqual(r.idx.SU35[2003], 0, "les températures restent calculées");
});
test("tendance : pente de Sen et Mann-Kendall détectent une hausse nette", () => {
  const byYear = {}; for (let y = 1991; y <= 2020; y++) byYear[y] = 10 + (y - 1991) * 0.8 + (rnd() - 0.5) * 2;
  const t = C.trend(byYear);
  assert.ok(t.significant && t.direction === "hausse", JSON.stringify(t)); assert.ok(Math.abs(t.slope_per_decade - 8) < 1.5, "pente ≈ +8 par décennie : " + t.slope_per_decade);
});
test("tendance : pas de conclusion sur une série sans tendance, ni sur moins de 10 ans", () => {
  const byYear = {}; for (let y = 1991; y <= 2020; y++) byYear[y] = 50 + (rnd() - 0.5) * 20;
  assert.strictEqual(C.trend(byYear).significant, false);
  assert.strictEqual(C.trend({ 2001: 1, 2002: 2, 2003: 3 }), null);
});
test("analyse complète : phrases prudentes, indices clés présents, normales mensuelles", () => {
  const s = build([1991, 2020], (y, i) => ({ p: (i % 7 === 0) ? 8 + rnd() * 30 : 0, tx: 31 + (y - 1991) * 0.08 + rnd() * 3, tn: 22 + rnd() * 2 }));
  const a = C.analyse(s);
  assert.strictEqual(a.years, 30); assert.deepStrictEqual(a.base, [1991, 2020]);
  const su = a.readings.find((r) => r.code === "SU35"); assert.ok(su && su.question && su.action);
  const cdd = a.readings.find((r) => r.code === "CDD"); assert.ok(/moyenne/.test(cdd.sentence));
  assert.strictEqual(a.monthly.length, 12); assert.ok(a.monthly[0].rain_mm > 0);
  const cmp = C.compareSources(a, a); assert.ok(cmp.every((c) => c.agree), "une source comparée à elle-même est d'accord");
});
test("satellite : fiabilité selon le nombre d'images et les nuages", () => {
  assert.strictEqual(SAT.reliability({ images: 6, clouds: 12 }).level, "bonne");
  assert.strictEqual(SAT.reliability({ images: 2, clouds: 70 }).level, "moyenne");
  assert.strictEqual(SAT.reliability({ images: 1 }).level, "faible");
});
test("satellite : une baisse nette déclenche une inspection, jamais un « diagnostic »", () => {
  const i = SAT.interpretNdvi({ ndvi: 0.42, pct_faible: 10, pct_moyen: 20, images: 5 }, { ndvi: 0.6, at: "2026-10-01" });
  assert.strictEqual(i.level, "inspect"); assert.ok(/observation de terrain/.test(i.text));
  assert.ok(!/maladie\b(?! ou)/i.test(i.text.replace(i.limits, "")), "le texte ne nomme pas de maladie");
  assert.strictEqual(SAT.interpretNdvi({ ndvi: 0.7, pct_faible: 2, pct_moyen: 10, images: 5 }, { ndvi: 0.68 }).level, "ok");
  assert.strictEqual(SAT.interpretNdvi({ ndvi: 0.42, pct_faible: 30, images: 1 }, null).level, "watch", "une seule image : prudence");
});


const CC = require("../lib/climat-culture");
// Climat synthétique de type San-Pédro : saisons des pluies avr.-juil. et sept.-nov., chaleur > 35 °C en févr.-mars.
function sanPedroLike() {
  const zone = (i) => ((i >= 90 && i < 200) || (i >= 245 && i < 320)) ? "pluie" : (i >= 31 && i < 90) ? "chaleur" : "sec";
  const s = build([1991, 2020], (y, i) => ({ p: zone(i) === "pluie" ? (i % 2 === 0 ? 12 : 0) : (i % 9 === 0 ? 4 : 0), tx: zone(i) === "chaleur" ? 35.5 + (i % 3) : 31, tn: 23.5 }));
  s.et0 = s.dates.map((d) => ({ pluie: 3.5, chaleur: 5, sec: 4.2 })[zone(C.dayOfYear(d) - 1)]);
  return C.analyse(s);
}
const clim = sanPedroLike();
const ctx = (o) => Object.assign({ cropName: "tomate", areaM2: 1000, irrigation: "arrosoir", soil: { manual: { texture: "sand" } }, clim: clim.clim, rainClim: clim.clim, today: "2026-11-22" }, o);
test("climat × culture : calendrier des 4 stades FAO-56 de la tomate à partir du semis", () => {
  const r = CC.cropClimate(ctx({ sownAt: "2026-10-01" }));
  assert.ok(!r.error, r.error); assert.strictEqual(r.calendar.length, 4); assert.strictEqual(r.cycle_days, 135);
  assert.strictEqual(r.calendar[0].from, "2026-10-01"); assert.strictEqual(r.calendar[0].to, "2026-10-30");
  assert.strictEqual(r.calendar[3].to, "2027-02-12");
});
test("arrosage : besoin = ETc − pluie efficace ; dose et fréquence selon le sol sableux et les racines", () => {
  const r = CC.cropClimate(ctx({ sownAt: "2026-12-01" }));   // cycle en saison sèche
  const s = r.calendar[2];
  assert.ok(s.need_mm > 50, "saison sèche : il faut arroser (" + s.need_mm + " mm)");
  assert.ok(s.dose_l_m2 > 0 && s.interval_days >= 1, "dose et fréquence calculées");
  assert.ok(Math.abs(s.dose_l_parcel - s.dose_l_m2 * 1000) <= 500, "dose pour 1 000 m² ≈ dose par m² × 1 000");
  assert.ok(s.cans_impractical && s.cans_per_watering == null, "1 000 m² à l'arrosoir : trop d'arrosoirs, on le dit au lieu de les compter");
  assert.ok(r.notes.some((x) => /au pied des plants/.test(x)), "conseil pratique pour l'arrosoir");
  const garden = CC.cropClimate(ctx({ sownAt: "2026-12-01", areaM2: 50 })).calendar[2];
  assert.ok(Math.abs(garden.cans_per_watering - garden.dose_l_parcel / 10) <= 1, "petit jardin de 50 m² : nombre d'arrosoirs de 10 L");
  assert.ok(r.irrigation.total_need_mm > 0 && r.irrigation.peak, "total et pic de besoin");
  const wet = CC.cropClimate(ctx({ sownAt: "2026-04-01" }));
  assert.ok(wet.calendar[1].need_mm < s.need_mm, "en saison des pluies, moins d'arrosage");
});
test("chaleur à la floraison signalée, et meilleure période de semis qui l'évite", () => {
  const bad = CC.cropClimate(ctx({ sownAt: "2026-12-10" }));    // floraison en février-mars (chaleur)
  assert.ok(bad.calendar[2].hot_days >= 3 && bad.calendar[2].advice.some((a) => /35 °C/.test(a)), JSON.stringify(bad.calendar[2]));
  assert.ok(["moyenne", "défavorable"].includes(bad.sowing.current.verdict));
  assert.ok(bad.sowing.best.length >= 1 && bad.sowing.best[0].heat_flower_days < bad.calendar[2].hot_days, "la période conseillée évite la chaleur à la floraison");
});
test("sans date de semis : seulement la meilleure période ; sans sol : pas de dose inventée", () => {
  const r = CC.cropClimate(ctx({ sownAt: null })); assert.ok(r.sowing.best.length && !r.calendar && /date de semis/.test(r.notes[0]));
  const n = CC.cropClimate(ctx({ sownAt: "2026-12-01", soil: {} })); assert.ok(n.calendar[2].dose_l_m2 == null && n.notes.some((x) => /Sol inconnu/.test(x)));
  assert.ok(CC.cropClimate(ctx({ cropName: "" })).error, "sans culture : message clair");
});
test("pluie efficace (méthode USDA) bornée et nulle sans pluie", () => {
  assert.strictEqual(CC.effectiveRain(0, 30), 0); const pe = CC.effectiveRain(100, 30); assert.ok(pe > 80 && pe < 100, pe);
});
console.log("\n  " + (total - failed) + "/" + total + " tests réussis\n");
process.exit(failed ? 1 : 0);
