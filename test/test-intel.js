"use strict";
/**
 * test-intel.js — tests de bout en bout de « l'intelligence agricole » de Terravive :
 * moteur satellite Vertea (relayé par le serveur), climat de la parcelle (deux sources), fiche parcelle,
 * conseiller contextualisé, alertes, file hors ligne, et le scénario complet « tomate à San-Pédro ».
 *
 * Vertea et Open-Meteo sont remplacés par un faux service local (aucun appel réseau, aucune clé) :
 * on vérifie ce que fait Terravive de leurs réponses, pas les services eux-mêmes.
 *   node test/test-intel.js
 */
const assert = require("assert");
const http = require("http");
const path = require("path");
const { startServer, cookieOf, createRunner } = require("./harness");

const ROOT = path.join(__dirname, "..");
const TOKEN = "jeton-de-test-vertea";

// ---------- Faux Vertea + faux Open-Meteo ----------
const calls = { vertea: [], meteo: 0, tokens: [], ai: [] };
let ndviQueue = [];
function series(y0, y1, rainShift) {
  const dates = [], pluie = [], tmax = [], tmin = [];
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = y0; y <= y1; y++) {
    const d0 = Date.UTC(y, 0, 1), n = (Date.UTC(y + 1, 0, 1) - d0) / 864e5;
    for (let i = 0; i < n; i++) {
      dates.push(new Date(d0 + i * 864e5).toISOString().slice(0, 10));
      const wetSeason = (i > 90 && i < 200) || (i > 250 && i < 320);
      pluie.push(wetSeason && rnd() < 0.45 ? Math.round((3 + rnd() * 40 + rainShift) * 10) / 10 : 0);
      tmax.push(Math.round((30 + rnd() * 4 + (y - y0) * 0.06) * 10) / 10);  // réchauffement progressif
      tmin.push(Math.round((21.5 + rnd() * 2) * 10) / 10);
    }
  }
  return { dates, pluie, tmax, tmin };
}
const mock = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => { body += c; }); req.on("end", () => {
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/v1/messages") {          // API Claude (factice) : on garde la consigne reçue
      let b = {}; try { b = JSON.parse(body || "{}"); } catch (e) {}
      calls.ai.push(b);
      return send(200, { content: [{ type: "text", text: "## Ce que l'on sait\nRéponse de test.\n## Hypothèses\n…\n## Ce que je recommande\n…\n## À vérifier sur le terrain\n…" }], stop_reason: "end_turn" });
    }
    if (u.pathname === "/v1/forecast") {          // prévisions Open-Meteo (factices) : forte pluie dans 2 jours
      const day = (k) => new Date(Date.now() + k * 864e5).toISOString().slice(0, 10);
      return send(200, { current: { temperature_2m: 29, relative_humidity_2m: 80, precipitation: 0, weather_code: 2 },
        daily: { time: [day(0), day(1), day(2), day(3)], weather_code: [2, 61, 65, 3], temperature_2m_max: [31, 30, 28, 32], temperature_2m_min: [23, 23, 22, 23], precipitation_probability_max: [20, 70, 90, 30], precipitation_sum: [0, 12, 55, 2] } });
    }
    if (u.pathname === "/reverse") return send(200, { display_name: "San-Pédro, Côte d'Ivoire" });
    if (u.pathname.indexOf("/properties") === 0 || u.pathname.indexOf("/soilgrids") === 0) return send(503, { detail: "indisponible (test)" });
    if (u.pathname === "/v1/archive") {           // Open-Meteo (ERA5)
      calls.meteo++;
      const y0 = +u.searchParams.get("start_date").slice(0, 4), y1 = +u.searchParams.get("end_date").slice(0, 4);
      const s = series(y0, y1, 0);
      return send(200, { daily: { time: s.dates, precipitation_sum: s.pluie, temperature_2m_max: s.tmax, temperature_2m_min: s.tmin } });
    }
    calls.tokens.push(req.headers["x-vertea-token"] || "");
    let p = {}; try { p = JSON.parse(body || "{}"); } catch (e) {}
    calls.vertea.push({ op: u.pathname.slice(1), body: p });
    if (u.pathname === "/ndvi") {
      const v = ndviQueue.shift() || 0.6;
      return send(200, { ndvi_moyen: v, pct_sain: 60, pct_moyen: 25, pct_faible: v < 0.5 ? 30 : 5, surface_ha: 0.1, images_utilisees: 5, couverture_nuageuse_moy: 18.4, periode_depuis: p.date_debut, periode_fin: p.date_fin, date_derniere_image: "2026-11-15", tile_url: "https://exemple/tuiles/{z}/{x}/{y}" });
    }
    if (u.pathname === "/climat") { const s = series(p.annee_debut, p.annee_fin, 2); return send(200, Object.assign({ lat: p.lat, lon: p.lon }, s)); }
    if (u.pathname === "/irrigation") return send(200, { et0: 4.2, message: "ok" });
    return send(404, { erreur: "route inconnue" });
  });
});

async function main() {
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const MOCK = "http://127.0.0.1:" + mock.address().port;
  const t = createRunner("Terravive — intelligence agricole (Vertea, climat, conseiller, alertes, scénario)");
  const srv = await startServer(ROOT, { VERTEA_URL: MOCK, VERTEA_TOKEN: TOKEN, OPEN_METEO_ARCHIVE_URL: MOCK, OPEN_METEO_FORECAST_URL: MOCK, NOMINATIM_URL: MOCK, SOILGRIDS_BASE_URL: MOCK, ANTHROPIC_BASE_URL: MOCK, ANTHROPIC_API_KEY: "cle-factice-de-test", ADMIN_EMAILS: "admin@test.ci" });
  const { req } = srv;
  const post = (url, cookie, json) => req("POST", url, { cookie, json, ip: "10.40.0.1" });
  let C = null, other = null, parcelId = null;
  // parcelle de 1 000 m² (≈ 31,6 m × 31,6 m) près de San-Pédro
  const dLat = 31.62 / 111320, dLon = dLat / Math.cos(4.75 * Math.PI / 180);
  const zone = { polygon: [[-6.64, 4.75], [-6.64 + dLon, 4.75], [-6.64 + dLon, 4.75 + dLat], [-6.64, 4.75 + dLat]] };

  try {
    t.section("Vertea intégré : le serveur Terravive relaie les analyses satellite");
    await t.test("préparation : un producteur et sa parcelle", async () => {
      const r = await req("POST", "/api/auth/register", { json: { as: "planteur", phone: "0711223344", pin: "2580", name: "Koffi Producteur", region: "San-Pédro" }, ip: "10.40.0.2" });
      assert.strictEqual(r.status, 200, r.text); C = cookieOf(r);
      const o = await req("POST", "/api/auth/register", { json: { as: "planteur", phone: "0799887766", pin: "1470", name: "Autre" }, ip: "10.40.0.3" });
      other = cookieOf(o);
      const p = await post("/api/parcels", C, { name: "Tomates du bas-fond", zone });
      assert.strictEqual(p.status, 200, p.text); parcelId = p.json.parcel.id;
    });
    await t.test("une analyse NDVI passe par Terravive, avec le jeton partagé, sur la zone de la parcelle", async () => {
      assert.strictEqual((await post("/api/sat/ndvi", null, { parcel_id: parcelId })).status, 401, "réservé aux comptes connectés");
      assert.strictEqual((await post("/api/sat/ndvi", other, { parcel_id: parcelId })).status, 404, "la parcelle d'un autre est inaccessible");
      assert.strictEqual((await post("/api/sat/inconnue", C, { parcel_id: parcelId })).status, 404);
      ndviQueue = [0.62];
      const r = await post("/api/sat/ndvi", C, { parcel_id: parcelId, date_debut: "2026-05-01", date_fin: "2026-11-01" });
      assert.strictEqual(r.status, 200, r.text);
      const last = calls.vertea[calls.vertea.length - 1];
      assert.strictEqual(last.op, "ndvi"); assert.deepStrictEqual(last.body.polygon, zone.polygon, "la zone vient de la parcelle enregistrée");
      assert.ok(!("parcel_id" in last.body), "l'identifiant interne n'est pas envoyé à Vertea");
      assert.strictEqual(calls.tokens[calls.tokens.length - 1], TOKEN);
      assert.strictEqual(r.json.fiabilite.level, "bonne", "5 images, 18 % de nuages");
      assert.strictEqual(r.json.interpretation.level, "ok");
    });
    await t.test("l'analyse suivante est comparée à la précédente ; une baisse nette demande une inspection", async () => {
      ndviQueue = [0.41];
      const r = await post("/api/sat/ndvi", C, { parcel_id: parcelId, date_debut: "2026-06-01", date_fin: "2026-11-20" });
      assert.strictEqual(r.json.interpretation.level, "inspect");
      assert.ok(/observation de terrain/i.test(r.json.interpretation.text));
      assert.ok(/ne permet pas de nommer une maladie/i.test(r.json.interpretation.limits));
      const h = await req("GET", "/api/parcels/sat?parcel=" + parcelId, { cookie: C });
      assert.strictEqual(h.status, 200); assert.strictEqual(h.json.observations.filter((o) => o.kind === "ndvi").length, 2, "historique de la parcelle");
      assert.strictEqual(h.json.observations[0].summary.clouds, 18.4, "les métadonnées (nuages) sont gardées");
      assert.strictEqual((await req("GET", "/api/parcels/sat?parcel=" + parcelId, { cookie: other })).status, 404);
    });

    t.section("Climat de la parcelle : deux sources, mêmes calculs, mis en cache");
    await t.test("~35 ans de données, indices calculés pour CHIRPS et ERA5, sources comparées", async () => {
      const r = await req("GET", "/api/parcels/climate?parcel=" + parcelId, { cookie: C });
      assert.strictEqual(r.status, 200, r.text);
      const s = r.json.sources;
      assert.ok(s.chirps && !s.chirps.error, JSON.stringify(s.chirps).slice(0, 200)); assert.ok(s.era5 && !s.era5.error, JSON.stringify(s.era5).slice(0, 200));
      assert.ok(s.era5.years >= 30, "au moins 30 ans : " + s.era5.years);
      const su = s.era5.readings.find((x) => x.code === "SU35");
      assert.ok(su && su.trend && su.question && su.action, "indice SU35 avec question et conseil");
      assert.ok(Array.isArray(r.json.comparison) && r.json.comparison.length > 5, "comparaison des deux sources");
      assert.ok(/Open-Meteo/.test(s.era5.label) && /CHIRPS/.test(s.chirps.label), "chaque source est nommée");
      assert.ok(s.chirps.limits && s.era5.qc && s.era5.qc.days > 10000, "limites et contrôle qualité affichés");
      const climCall = calls.vertea.find((c) => c.op === "climat");
      assert.ok(climCall && Math.abs(climCall.body.lat - 4.75) < 0.01, "le point envoyé est le centre de la parcelle");
    });
    await t.test("le résultat est mis en cache : pas de nouvel appel aux sources la deuxième fois", async () => {
      const m0 = calls.meteo, v0 = calls.vertea.filter((c) => c.op === "climat").length;
      const r = await req("GET", "/api/parcels/climate?parcel=" + parcelId, { cookie: C });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(calls.meteo, m0); assert.strictEqual(calls.vertea.filter((c) => c.op === "climat").length, v0);
      assert.ok(r.json.sources.era5.cached_at, "date du calcul indiquée");
      assert.strictEqual((await req("GET", "/api/parcels/climate?parcel=" + parcelId, { cookie: other })).status, 404, "parcelle d'un autre : refusé");
    });


    t.section("Scénario complet : tomate à San-Pédro (1 000 m², sol sableux, arrosoir, petit budget)");
    const daysAgo = (k) => new Date(Date.now() - k * 864e5).toISOString().slice(0, 10);
    const log = (json) => post("/api/fieldlog", C, Object.assign({ parcel_id: parcelId }, json));
    await t.test("1-2. producteur et parcelle : la surface calculée depuis le contour fait bien ~1 000 m²", async () => {
      const r = await req("GET", "/api/parcels", { cookie: C });
      const p = r.json.parcels.find((x) => x.id === parcelId);
      assert.ok(p && Math.abs(p.area_m2 - 1000) < 15, "surface : " + (p && p.area_m2));
    });
    await t.test("3. plantation : culture, date de semis, sol observé au champ (sableux)", async () => {
      const r = await post("/api/parcels/soil", C, { id: parcelId, crop: "tomate", sown_at: daysAgo(70) });
      assert.strictEqual(r.status, 200, r.text);
      const m = await post("/api/parcels/soil/manual", C, { id: parcelId, texture: "sand" });
      assert.strictEqual(m.status, 200, m.text);
    });
    await t.test("4. fiche parcelle : variété, mode biologique, stade, moyens ; les données manquantes diminuent", async () => {
      const before = await req("GET", "/api/parcels/fiche?parcel=" + parcelId, { cookie: C });
      assert.strictEqual(before.status, 200, before.text);
      assert.ok(before.json.missing.some((m) => m.field === "variety"), "la variété manque au départ");
      assert.strictEqual((await post("/api/parcels/fiche", C, { parcel_id: parcelId, mode: "magie" })).status, 400, "valeur inconnue refusée");
      const r = await post("/api/parcels/fiche", C, { parcel_id: parcelId, variety: "Mongal F1", mode: "bio", stage: "fructification", irrigation: "arrosoir", mechanization: "manuel", budget: "limite", campaign: "Grande saison 2026" });
      assert.strictEqual(r.status, 200, r.text);
      assert.ok(!r.json.missing.some((m) => ["variety", "mode", "stage", "irrigation", "crop", "sown_at", "soil", "ndvi"].includes(m.field)), JSON.stringify(r.json.missing));
      assert.strictEqual(r.json.completeness, 100);
      assert.strictEqual((await req("GET", "/api/parcels/fiche?parcel=" + parcelId, { cookie: other })).status, 404, "fiche privée");
    });
    await t.test("5. observation notée ; envoyée deux fois (réseau coupé), elle n'est gardée qu'une fois", async () => {
      const cid = "a1b2c3d4e5f6a7b8c9d0e1f2";
      for (let i = 0; i < 2; i++) assert.strictEqual((await log({ client_id: cid, date: daysAgo(3), kind: "observation", note: "Quelques feuilles jaunes en bas des plants" })).status, 200);
      const l = await req("GET", "/api/fieldlog?parcel=" + parcelId, { cookie: C });
      assert.strictEqual(l.json.entries.filter((e) => e.id === cid).length, 1, "pas de doublon");
    });
    await t.test("6-7. le conseiller reçoit la vraie fiche de la parcelle et des règles de prudence", async () => {
      calls.ai.length = 0;
      const r = await post("/api/chat", C, { message: "Mes feuilles du bas jaunissent, que faire ?", parcel_id: parcelId });
      assert.strictEqual(r.status, 200, r.text);
      const sys = calls.ai[0].system;
      for (const s of ["tomate", "Mongal F1", "biologique", "Arrosoir", "Sableux", "Quelques feuilles jaunes", "NDVI"]) assert.ok(sys.includes(s), "le contexte doit contenir « " + s + " »");
      for (const s of ["Ce que l'on sait", "Hypothèses", "Ce que je recommande", "N'affirme JAMAIS", "aucune chimie de synthèse", "Ne recommande aucun produit phytosanitaire sans diagnostic"]) assert.ok(sys.includes(s), "règle attendue : " + s);
      calls.ai.length = 0;
      await post("/api/chat", other, { message: "Et moi ?", parcel_id: parcelId });
      assert.ok(!calls.ai[0] || !calls.ai[0].system.includes("Mongal F1"), "jamais la parcelle d'un autre compte");
    });
    await t.test("8. interventions avec leur coût (FCFA)", async () => {
      for (const e of [{ kind: "semis", note: "Plants repiqués", amount_fcfa: 15000, date: daysAgo(70) }, { kind: "compost", qty: 300, amount_fcfa: 6000, date: daysAgo(72) },
        { kind: "arrosage", qty: 400, date: daysAgo(10) }, { kind: "traitement", qty: 2, product: "Purin de neem", amount_fcfa: 2500, date: daysAgo(20) },
        { kind: "observation", note: "Main-d'œuvre récolte", amount_fcfa: 10000, date: daysAgo(2) }]) {
        const r = await log(e); assert.strictEqual(r.status, 200, r.text);
      }
      assert.strictEqual((await log({ kind: "arrosage", qty: 10, amount_fcfa: "beaucoup", date: daysAgo(1) })).status, 400, "montant invalide refusé");
    });
    await t.test("9-10. récolte et rendement calculé (t/ha)", async () => {
      assert.strictEqual((await log({ kind: "recolte", qty: 1800, date: daysAgo(8) })).status, 200);
      assert.strictEqual((await log({ kind: "recolte", qty: 1700, date: daysAgo(1) })).status, 200);
      const r = await req("GET", "/api/impact?parcel=" + parcelId, { cookie: C });
      assert.strictEqual(r.status, 200, r.text);
      const y = JSON.stringify(r.json.report).match(/"yield_t_ha":([\d.]+)/);
      assert.ok(y && Math.abs(+y[1] - 35) < 1, "3 500 kg sur 1 000 m² ≈ 35 t/ha : " + (y && y[1]));
    });
    await t.test("11-12. ventes notées et résultat économique calculé, sans valeur inventée", async () => {
      assert.strictEqual((await log({ kind: "vente", qty: 1000, date: daysAgo(1) })).status, 400, "une vente sans montant est refusée");
      assert.strictEqual((await log({ kind: "vente", qty: 2000, amount_fcfa: 600000, note: "Marché de San-Pédro", date: daysAgo(6) })).status, 200);
      assert.strictEqual((await log({ kind: "vente", qty: 1200, amount_fcfa: 420000, note: "Commerçante", date: daysAgo(1) })).status, 200);
      const e = (await req("GET", "/api/impact?parcel=" + parcelId, { cookie: C })).json.economics;
      assert.strictEqual(e.revenue_fcfa, 1020000); assert.strictEqual(e.cost_fcfa, 33500); assert.strictEqual(e.margin_fcfa, 986500);
      assert.strictEqual(e.avg_price_fcfa_kg, Math.round(1020000 / 3200)); assert.strictEqual(e.unsold_kg, 300);
    });
    await t.test("alertes : zone à inspecter (satellite) et forte pluie annoncée, avec leur source", async () => {
      const r = await req("GET", "/api/alerts", { cookie: C });
      assert.strictEqual(r.status, 200, r.text);
      const a = r.json.alerts;
      assert.ok(a.some((x) => x.level === "inspect" && /inspecter/i.test(x.title) && /Satellite/.test(x.source)), JSON.stringify(a));
      assert.ok(a.some((x) => /Forte pluie/.test(x.title) && /55 mm/.test(x.text)), "pluie forte prévue détectée");
      assert.ok(!a.some((x) => /maladie/i.test(x.title)), "aucune alerte ne prétend nommer une maladie");
    });
    await t.test("cohérence du carnet : une récolte avant le semis est signalée", async () => {
      const p2 = await post("/api/parcels", C, { name: "Essai", zone: { bbox: [-6.65, 4.76, -6.6497, 4.7603] } });
      await post("/api/parcels/soil", C, { id: p2.json.parcel.id, crop: "piment", sown_at: daysAgo(5) });
      await post("/api/fieldlog", C, { parcel_id: p2.json.parcel.id, kind: "recolte", qty: 40, date: daysAgo(30) });
      const f = await req("GET", "/api/parcels/fiche?parcel=" + p2.json.parcel.id, { cookie: C });
      assert.ok(f.json.warnings.some((w) => w.code === "HARVEST_BEFORE_SOWING"), JSON.stringify(f.json.warnings));
    });

    t.section("Santé du serveur");
    await t.test("aucune erreur fatale journalisée", async () => {
      assert.ok(srv.alive());
      assert.ok(!/Rejet non géré|Exception non gérée|Requête en erreur/i.test(srv.logs()), srv.logs().slice(-800));
    });
  } finally {
    await srv.stop(); mock.close();
  }
  process.exit(t.summary() ? 1 : 0);
}
main().catch((e) => { console.error("Erreur d'exécution des tests :", e); process.exit(2); });
