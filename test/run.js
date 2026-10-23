"use strict";
/**
 * run.js — exécute TOUTE la suite de tests Terravive et renvoie un code de sortie.
 *
 *   node test/run.js            # exécute tout
 *
 * Code de sortie : 0 si tout passe, 1 sinon (utilisable en intégration continue).
 * Zéro dépendance npm. N'appelle jamais api.anthropic.com. N'ouvre aucun port.
 */
const det = require("./test-deterministic");
const sim = require("./test-sim-ai");

async function main() {
  console.log("Terravive — suite de tests (Node natif, zéro dépendance, sans clé API).");
  const r1 = det.run();
  const r2 = await sim.run();

  const tests = r1.total + r2.total;
  const failed = r1.failed + r2.failed;
  const checks = r1.totalChecks + r2.totalChecks;
  const failedChecks = r1.failedChecks + r2.failedChecks;

  console.log("\n================ BILAN GLOBAL ================");
  console.log(`  Tests exécutés : ${tests}`);
  console.log(`  Tests réussis  : ${tests - failed}`);
  console.log(`  Tests échoués  : ${failed}`);
  console.log(`  Vérifications  : ${checks - failedChecks}/${checks} réussies`);
  console.log(`  Résultat       : ${failed ? "ÉCHEC" : "SUCCÈS"}`);
  console.log("==============================================\n");

  if (!failed) {
    console.log("Rappel honnête : ces tests prouvent la STRUCTURE, les garde-fous transmis");
    console.log("et la non-invention dans les données structurées — PAS l'exactitude");
    console.log("agronomique du texte. Pour cela, utiliser GRILLE-AGRONOMIQUE.md (évaluation");
    console.log("humaine par un agronome).\n");
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("Erreur d'exécution de la suite :", e); process.exit(2); });
