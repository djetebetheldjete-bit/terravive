/**
 * Tests du module sol / racines / arrosage et des sources de données (sans réseau).
 * Lancer : node test-sol.js
 */
"use strict";
const assert = require("assert");
const sol = require("./lib/sol");
const src = require("./lib/sol-sources");

let passed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.error("  ÉCHEC " + name + "\n      " + e.message); process.exitCode = 1; } }

(async () => {
  console.log("Textures (triangle USDA)");
  const cases = [[90, 5, 5, "sand"], [82, 10, 8, "loamy_sand"], [70, 15, 15, "sandy_loam"], [40, 40, 20, "loam"], [20, 65, 15, "silt_loam"],
    [10, 85, 5, "silt"], [60, 10, 30, "sandy_clay_loam"], [35, 30, 35, "clay_loam"], [10, 55, 35, "silty_clay_loam"], [50, 5, 45, "sandy_clay"],
    [5, 45, 50, "silty_clay"], [20, 20, 60, "clay"]];
  for (const [s, si, c, exp] of cases) await t(`${s}/${si}/${c} -> ${exp}`, () => assert.strictEqual(sol.textureFromFractions(s, si, c), exp));
  await t("normalise un code iSDA, un libellé FR et un libellé EN", () => {
    assert.strictEqual(sol.normalizeTexture(9), "sandy_loam");
    assert.strictEqual(sol.normalizeTexture("Argilo-sableux"), "sandy_clay");
    assert.strictEqual(sol.normalizeTexture("Sandy Clay Loam"), "sandy_clay_loam");
    assert.strictEqual(sol.normalizeTexture("n'importe quoi"), null);
  });

  console.log("Cultures et racines");
  await t("trouve une culture avec accent/pluriel/alias", () => {
    assert.strictEqual(sol.findCrop("Tomates").key, "tomate");
    assert.strictEqual(sol.findCrop("mais").key, "maïs");
    assert.strictEqual(sol.findCrop("okra").key, "gombo");
    assert.strictEqual(sol.findCrop("dattier"), null);
  });
  await t("racines de la tomate : 15 cm au repiquage, max à 70 j", () => {
    const tom = sol.CROPS["tomate"];
    assert.strictEqual(sol.rootDepthAt(tom, 0), 0.15);
    assert.ok(Math.abs(sol.rootDepthAt(tom, 70) - 1.1) < 1e-9);
    assert.ok(Math.abs(sol.rootDepthAt(tom, 200) - 1.1) < 1e-9);
    const mid = sol.rootDepthAt(tom, 35); assert.ok(mid > 0.6 && mid < 0.65);
  });
  await t("Kc par stade (tomate)", () => {
    const tom = sol.CROPS["tomate"];
    assert.strictEqual(sol.cropStage(tom, 10).stage, "initial");
    assert.strictEqual(sol.cropStage(tom, 50).stage, "développement");
    assert.strictEqual(sol.cropStage(tom, 90).kc, 1.15);
    assert.ok(sol.cropStage(tom, 200).over);
  });

  console.log("Fiche sol & arrosage");
  const now = new Date("2026-11-04T10:00:00Z");
  await t("tomate à 80 j sur sol sablo-limoneux profond, ET0 = 4", () => {
    const a = sol.soilAdvice({ estimate: { texture: "sandy_loam", bedrock_cm: 200, source: "iSDAsoil (30 m)" }, crop: "Tomate", sownAt: "2026-08-16", et0: 4, now });
    assert.strictEqual(a.stage.days, 80);
    assert.strictEqual(a.stage.name, "mi-saison");
    assert.strictEqual(a.roots.effective_m, 1.1);            // 200 cm = « 200 ou plus » : ne limite pas
    assert.strictEqual(a.irrigation.ru_mm, 143);              // 130 mm/m × 1,1 m
    // ETc = 4 × 1,15 = 4,6 ; p = 0,40 + 0,04 × 0,4 = 0,416 ; RFU = 0,416 × 143 = 59,5
    assert.strictEqual(a.irrigation.p, 0.42);
    assert.strictEqual(a.irrigation.dose_l_m2, 59);
    assert.strictEqual(a.irrigation.interval_days, 13);
    assert.strictEqual(a.sensor.depth_cm, 45);                 // 40 % de 110 cm = 44 -> 45 (plafonné à 45)
    assert.strictEqual(a.sensor.second_depth_cm, 90);
    assert.strictEqual(a.sensor.threshold_pct, 60);
  });
  await t("sol peu profond limite les racines + correction terrain prioritaire", () => {
    const a = sol.soilAdvice({ estimate: { texture: "clay", bedrock_cm: 120, source: "iSDAsoil (30 m)" }, manual: { texture: "Sableux", depth_cm: 40 }, crop: "maïs", sownAt: "2026-07-01", et0: 5, now });
    assert.strictEqual(a.soil.texture, "sand");
    assert.strictEqual(a.soil.textureFrom, "terrain");
    assert.strictEqual(a.roots.effective_m, 0.4);
    assert.ok(a.roots.limited_by_soil);
    assert.ok(a.warnings.some((w) => /peu profond/.test(w)));
    assert.strictEqual(a.sensor.depth_cm, 15);
    assert.strictEqual(a.sensor.second_depth_cm, null);
  });
  await t("cailloux réduisent la réserve", () => {
    const a = sol.soilAdvice({ estimate: { texture: "loam", stones: 30 }, crop: "laitue", sownAt: "2026-10-01", now });
    // laitue 34 j : racines 0,15 + (34/50)(0,4-0,15) = 0,32 m ; RU = 160 × 0,32 × 0,7 = 35,8
    assert.strictEqual(a.irrigation.ru_mm, 36);
    assert.strictEqual(a.irrigation.interval_days, null); // pas d'ET0
    assert.ok(a.warnings.some((w) => /caillouteux/.test(w)));
  });
  await t("riz : pas de dose calculée", () => {
    const a = sol.soilAdvice({ estimate: { texture: "clay" }, crop: "riz", now });
    assert.ok(a.irrigation.paddy); assert.strictEqual(a.sensor.threshold_pct, null);
  });
  await t("texture inconnue : avertissement, pas de dose", () => {
    const a = sol.soilAdvice({ estimate: {}, crop: "tomate", now });
    assert.strictEqual(a.irrigation, undefined); assert.ok(a.warnings[0].includes("bocal"));
  });
  await t("culture inconnue : coefficients génériques signalés", () => {
    const a = sol.soilAdvice({ estimate: { texture: "loam" }, crop: "Dattier", now });
    assert.strictEqual(a.crop.known, false); assert.ok(a.irrigation.dose_l_m2 > 0);
  });
  await t("pérenne (cacao) : racines au maximum", () => {
    const a = sol.soilAdvice({ estimate: { texture: "clay_loam" }, crop: "cacao", now });
    assert.strictEqual(a.roots.effective_m, 0.85);
  });
  await t("interprétation chimique", () => {
    const c = sol.interpretChem({ ph: 5.2, oc_gkg: 4.1, n_gkg: 0.4 });
    assert.strictEqual(c[0].t, "acide"); assert.strictEqual(c[1].t, "faible"); assert.strictEqual(c[2].t, "faible");
  });

  console.log("Sources (réponses simulées)");
  const isdaResp = { property: {
    texture_class: [{ depth: { value: "0-20", unit: "cm" }, value: { value: "sandy clay loam", unit: null } }],
    bedrock_depth: [{ depth: { value: "0-200", unit: "cm" }, value: { value: 87, unit: "cm" } }],
    ph: [{ depth: { value: "0-20", unit: "cm" }, value: { value: 5.4, unit: null } }, { depth: { value: "20-50", unit: "cm" }, value: { value: 5.0, unit: null } }],
    carbon_organic: [{ depth: { value: "0-20", unit: "cm" }, value: { value: 9.2, unit: "g/kg" } }],
    stone_content: [{ depth: { value: "0-20", unit: "cm" }, value: { value: 12, unit: "%" } }]
  } };
  await t("parseIsda", () => {
    const e = src.parseIsda(isdaResp);
    assert.strictEqual(e.texture, "sandy_clay_loam"); assert.strictEqual(e.bedrock_cm, 87); assert.strictEqual(e.ph, 5.4);
    assert.strictEqual(e.oc_gkg, 9.2); assert.strictEqual(e.stones, 12);
  });
  const sgResp = { properties: { layers: [
    { name: "clay", unit_measure: { d_factor: 10 }, depths: [{ label: "0-5cm", values: { mean: 150 } }, { label: "5-15cm", values: { mean: 180 } }, { label: "15-30cm", values: { mean: 220 } }] },
    { name: "sand", unit_measure: { d_factor: 10 }, depths: [{ label: "0-5cm", values: { mean: 650 } }, { label: "5-15cm", values: { mean: 620 } }, { label: "15-30cm", values: { mean: 580 } }] },
    { name: "silt", unit_measure: { d_factor: 10 }, depths: [{ label: "0-5cm", values: { mean: 200 } }, { label: "5-15cm", values: { mean: 200 } }, { label: "15-30cm", values: { mean: 200 } }] },
    { name: "phh2o", unit_measure: { d_factor: 10 }, depths: [{ label: "0-5cm", values: { mean: 58 } }, { label: "5-15cm", values: { mean: 57 } }, { label: "15-30cm", values: { mean: 56 } }] }
  ] } };
  await t("parseSoilGrids (moyenne pondérée 0–30 cm)", () => {
    const e = src.parseSoilGrids(sgResp);
    assert.ok(Math.abs(e.clay - 19.5) < 0.01); assert.strictEqual(e.texture, "sandy_loam"); assert.ok(Math.abs(e.ph - 5.67) < 0.01);
  });
  function mockFetch(routes) {
    const calls = [];
    const f = async (url, opts) => {
      calls.push({ url, opts });
      for (const [re, h] of routes) if (re.test(url)) { const [status, body] = h(url, opts); return { ok: status < 400, status, json: async () => body }; }
      throw new Error("réseau coupé");
    };
    f.calls = calls; return f;
  }
  await t("estimateSoil : iSDA configuré (login en formulaire + jeton)", async () => {
    process.env.ISDA_USERNAME = "u"; process.env.ISDA_PASSWORD = "p"; src._resetForTests();
    const f = mockFetch([[/\/login$/, () => [200, { access_token: "TOK" }]], [/soilproperty/, () => [200, isdaResp]]]);
    const e = await src.estimateSoil(6.82, -5.28, f);
    assert.strictEqual(e.source, "iSDAsoil (30 m)");
    assert.strictEqual(f.calls[0].opts.body, "username=u&password=p");
    assert.strictEqual(f.calls[1].opts.headers.Authorization, "Bearer TOK");
    await src.estimateSoil(6.83, -5.28, f);
    assert.strictEqual(f.calls.filter((c) => /login/.test(c.url)).length, 1); // jeton réutilisé
  });
  await t("estimateSoil : iSDA en panne -> repli SoilGrids", async () => {
    src._resetForTests();
    const f = mockFetch([[/\/login$/, () => [500, {}]], [/soilgrids/, () => [200, sgResp]]]);
    const e = await src.estimateSoil(6.82, -5.28, f);
    assert.strictEqual(e.source, "SoilGrids (250 m)"); assert.ok(/Repli/.test(e.note));
  });
  await t("estimateSoil : tout en panne -> erreur claire", async () => {
    delete process.env.ISDA_USERNAME; delete process.env.ISDA_PASSWORD; src._resetForTests();
    const f = mockFetch([[/soilgrids/, () => [503, null]]]);
    await assert.rejects(() => src.estimateSoil(6.82, -5.28, f), /Aucune source/);
  });
  await t("fetchEt0 : moyenne des 3 jours, puis cache", async () => {
    src._resetForTests();
    const f = mockFetch([[/open-meteo/, () => [200, { daily: { et0_fao_evapotranspiration: [3.9, 4.2, 4.5] } }]]]);
    assert.ok(Math.abs((await src.fetchEt0(6.8, -5.3, f)) - 4.2) < 1e-9);
    await src.fetchEt0(6.8, -5.3, f); assert.strictEqual(f.calls.length, 1);
  });
  await t("zoneCenter", () => {
    assert.deepStrictEqual(src.zoneCenter({ bbox: [-5.3, 6.8, -5.2, 6.9] }), { lon: -5.25, lat: 6.85 });
  });

  console.log(process.exitCode ? "\nDes tests ont échoué." : `\n${passed} tests réussis.`);
})();
