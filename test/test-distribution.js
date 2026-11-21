"use strict";
// Tests unitaires du module Distribution (lib/distribution.js) : zéro dépendance.
//   node test/test-distribution.js
const assert = require("assert");
const D = require("../lib/distribution");

let total = 0, failed = 0;
function test(name, fn) {
  total++;
  try { fn(); console.log("  ✓ " + name); } catch (e) { failed++; console.log("  ✗ " + name + "\n      → " + e.message); }
}
console.log("\nDistribution (ASTRIDE) — tests unitaires\n");

const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);

test("centre d'une parcelle : rectangle et polygone", () => {
  const c = D.zoneCenter({ bbox: [-6.70, 4.70, -6.68, 4.72] });
  assert.ok(near(c.lat, 4.71) && near(c.lon, -6.69));
  const p = D.zoneCenter({ polygon: [[-6.70, 4.70], [-6.68, 4.70], [-6.68, 4.72], [-6.70, 4.72]] });
  assert.ok(near(p.lat, 4.71) && near(p.lon, -6.69));
  assert.strictEqual(D.zoneCenter(null), null);
  assert.strictEqual(D.zoneCenter({ polygon: [[1, 2]] }), null);
});
test("surface : un carré de 100 m de côté fait environ 1 ha", () => {
  const dLat = 100 / 111320, dLon = dLat / Math.cos(4.71 * Math.PI / 180);
  const ha = D.zoneAreaHa({ polygon: [[-6.7, 4.71], [-6.7 + dLon, 4.71], [-6.7 + dLon, 4.71 + dLat], [-6.7, 4.71 + dLat]] });
  assert.ok(Math.abs(ha - 1) < 0.02, ha);
});
test("état satellite : mêmes seuils que le tableau de bord", () => {
  assert.strictEqual(D.healthOf(null), null);
  assert.strictEqual(D.healthOf({ ndvi: 0.7, pct_faible: 5, pct_moyen: 10 }), "OK");
  assert.strictEqual(D.healthOf({ ndvi: 0.5, pct_faible: 10, pct_moyen: 45 }), "Surveillance");
  assert.strictEqual(D.healthOf({ ndvi: 0.3, pct_faible: 25, pct_moyen: 0 }), "Alerte");
});
test("sites : un centre exige une capacité, un point de vente un canal", () => {
  assert.ok(D.checkSite({ kind: "centre", name: "Centre Nord", lat: 4.9, lon: -6.6 }).error);
  assert.ok(D.checkSite({ kind: "vente", name: "Marché", lat: 4.9, lon: -6.6, canal: "inconnu" }).error);
  assert.ok(D.checkSite({ kind: "centre", name: "C", lat: 4.9, lon: -6.6, capacity_kg: 100 }).error, "nom trop court");
  assert.ok(D.checkSite({ kind: "centre", name: "Centre", lat: 95, lon: -6.6, capacity_kg: 100 }).error, "latitude impossible");
  const ok = D.checkSite({ kind: "centre", name: " Centre Nord ", lat: "4,9", lon: -6.6, capacity_kg: "8000", cold: true });
  assert.deepStrictEqual(ok.site, { kind: "centre", name: "Centre Nord", lat: 4.9, lon: -6.6, capacity_kg: 8000, canal: null, cold: true });
});

const now = new Date("2026-11-21T12:00:00Z");
const sites = { c1: { id: "c1", kind: "centre" }, v1: { id: "v1", kind: "vente" } };
const parcel = { id: "p1", user_id: "u1", crop: "tomate" };
test("un lot avance dans l'ordre : prévu → au centre → en route → livré", () => {
  const f = D.lotAction(null, "forecast", { kg_expected: 500, expected_on: "2026-11-25", centre_id: "c1" }, { now, sites, parcel });
  assert.ok(!f.error, f.error);
  let lot = Object.assign({ id: "l1" }, f.patch);
  assert.strictEqual(lot.crop, "tomate", "le produit reprend la culture de la parcelle");
  assert.strictEqual(D.lotStep(lot), "prevu");
  assert.ok(D.lotAction(lot, "ship", { client_id: "v1" }, { now, sites }).error, "départ avant réception");
  assert.ok(D.lotAction(lot, "deliver", { kg_delivered: 1 }, { now, sites }).error, "livraison avant départ");
  const h = D.lotAction(lot, "harvest", { kg_harvested: 480, harvested_at: "2026-11-20T08:00:00Z", quality: "a" }, { now, sites });
  assert.ok(!h.error, h.error); lot = Object.assign(lot, h.patch);
  assert.strictEqual(lot.quality, "A"); assert.strictEqual(D.lotStep(lot), "centre");
  assert.ok(D.lotAction(lot, "harvest", { kg_harvested: 1 }, { now, sites }).error, "double réception");
  assert.ok(D.lotAction(lot, "ship", { client_id: "c1" }, { now, sites }).error, "on livre un point de vente, pas un centre");
  const s = D.lotAction(lot, "ship", { client_id: "v1", departed_at: "2026-11-20T10:00:00Z", vehicle: "tricycle" }, { now, sites });
  assert.ok(!s.error, s.error); lot = Object.assign(lot, s.patch);
  assert.ok(D.lotAction(lot, "deliver", { kg_delivered: 500 }, { now, sites }).error, "plus que le poids reçu");
  const d = D.lotAction(lot, "deliver", { kg_delivered: 456, delivered_at: "2026-11-21T08:00:00Z" }, { now, sites });
  assert.ok(!d.error, d.error); lot = Object.assign(lot, d.patch);
  const v = D.lotView(lot);
  assert.strictEqual(v.step, "livre"); assert.strictEqual(v.loss_kg, 24); assert.strictEqual(v.hours, 24);
});
test("dates refusées : dans le futur, ou dans le désordre", () => {
  const lot = { id: "l", kg_expected: 10, centre_id: "c1" };
  assert.ok(D.lotAction(lot, "harvest", { kg_harvested: 10, harvested_at: "2026-11-22T12:00:00Z" }, { now, sites }).error);
  const l2 = Object.assign({}, lot, { kg_harvested: 10, harvested_at: "2026-11-21T10:00:00Z" });
  assert.ok(D.lotAction(l2, "ship", { client_id: "v1", departed_at: "2026-11-21T09:00:00Z" }, { now, sites }).error);
  assert.ok(D.lotAction(null, "forecast", { kg_expected: 10, expected_on: "2026-02-30", centre_id: "c1" }, { now, sites, parcel }).error, "date inexistante");
  assert.ok(D.lotAction(null, "forecast", { kg_expected: 10, expected_on: "2026-12-01", centre_id: "c1" }, { now, sites, parcel: null }).error, "parcelle hors coopérative");
});
test("codes de lot : suivants et sans doublon", () => {
  assert.strictEqual(D.nextLotCode([]), "L-0001");
  assert.strictEqual(D.nextLotCode(["L-0001", "L-0009", "autre"]), "L-0010");
});
test("indicateurs : vides sans données, calculés sur les lots livrés", () => {
  const empty = D.indicators([], [], []);
  assert.strictEqual(empty.loss_pct, null); assert.strictEqual(empty.fast_pct, null); assert.strictEqual(empty.forecast_gap_pct, null);
  const lots = [
    { id: "a", centre_id: "c1", kg_expected: 100, kg_harvested: 100, harvested_at: "2026-11-20T00:00:00Z", departed_at: "2026-11-20T02:00:00Z", kg_delivered: 90, delivered_at: "2026-11-20T20:00:00Z" },
    { id: "b", centre_id: "c1", kg_expected: 100, kg_harvested: 120, harvested_at: "2026-11-18T00:00:00Z", departed_at: "2026-11-18T02:00:00Z", kg_delivered: 100, delivered_at: "2026-11-21T00:00:00Z" },
    { id: "c", centre_id: "c1", kg_expected: 200, kg_harvested: 150, harvested_at: "2026-11-21T00:00:00Z" },
    { id: "d", centre_id: "c1", kg_expected: 300 }
  ];
  const I = D.indicators(lots, [{ health: "Alerte", center: {} }, { health: "OK", center: null }], [{}, {}]);
  assert.strictEqual(I.loss_pct, 13.6, "30 kg perdus sur 220 kg reçus");
  assert.strictEqual(I.fast_pct, 50, "un lot sur deux livré en moins de 48 h");
  assert.strictEqual(I.forecast_gap_pct, 15, "écarts 0 %, 20 % et 25 %");
  assert.strictEqual(I.forecast_kg, 300); assert.strictEqual(I.watch, 1); assert.strictEqual(I.located, 50);
  assert.strictEqual(I.stock_kg.c1, 150, "seul le lot encore au centre compte dans son stock");
});

console.log("\n  " + (total - failed) + "/" + total + " tests réussis\n");
process.exit(failed ? 1 : 0);
