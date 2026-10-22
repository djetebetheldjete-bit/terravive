"use strict";
/**
 * harness.js — micro-cadre de test SANS dépendance (pas de Jest, pas de Mocha, pas d'npm).
 * Fournit test(), assert helpers, et un bilan. Compatible Node 18+ natif.
 *
 * Usage :
 *   const T = require("./lib/harness");
 *   T.test("mon cas", () => { T.ok(cond, "message"); });
 *   ... puis T.report() renvoie {passed, failed} et imprime le bilan.
 */

const results = [];
let current = null;

function test(name, fn) {
  current = { name, checks: [], error: null };
  try {
    fn();
  } catch (e) {
    current.error = e && e.message ? e.message : String(e);
  }
  results.push(current);
  current = null;
}

function record(pass, message) {
  if (!current) throw new Error("assertion hors d'un test()");
  current.checks.push({ pass: !!pass, message: message || "" });
  if (!pass && !current.error) {
    // On ne jette pas : on laisse le test enchaîner les vérifications, mais on
    // marque l'échec. (Un throw explicite via fail() reste possible.)
  }
  return !!pass;
}

function ok(cond, message) { return record(!!cond, message); }
function equal(actual, expected, message) {
  const pass = actual === expected;
  return record(pass, (message || "") + (pass ? "" : ` (attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)})`));
}
function contains(haystack, needle, message) {
  const pass = typeof haystack === "string" && haystack.indexOf(needle) !== -1;
  return record(pass, (message || `doit contenir « ${needle} »`) + (pass ? "" : " — ABSENT"));
}
function notContains(haystack, needle, message) {
  const pass = typeof haystack === "string" && haystack.indexOf(needle) === -1;
  return record(pass, (message || `ne doit PAS contenir « ${needle} »`) + (pass ? "" : " — PRÉSENT à tort"));
}
function match(haystack, regex, message) {
  const pass = typeof haystack === "string" && regex.test(haystack);
  return record(pass, (message || `doit correspondre à ${regex}`) + (pass ? "" : " — NON TROUVÉ"));
}

function report(opts) {
  opts = opts || {};
  let passed = 0, failed = 0, failedChecks = 0, totalChecks = 0;
  const lines = [];
  for (const r of results) {
    const bad = r.checks.filter((c) => !c.pass);
    totalChecks += r.checks.length;
    failedChecks += bad.length;
    const testFailed = !!r.error || bad.length > 0;
    if (testFailed) failed++; else passed++;
    const mark = testFailed ? "ÉCHEC" : "OK   ";
    lines.push(`  [${mark}] ${r.name}`);
    if (r.error) lines.push(`         erreur : ${r.error}`);
    for (const c of bad) lines.push(`         ✗ ${c.message}`);
    if (opts.verbose) for (const c of r.checks.filter((c) => c.pass)) lines.push(`         ✓ ${c.message}`);
  }
  const header = `\n=== ${opts.title || "Résultats"} ===`;
  const footer = `  ---\n  Tests : ${passed} OK, ${failed} en échec (${results.length} au total) · Vérifications : ${totalChecks - failedChecks}/${totalChecks} réussies`;
  console.log([header, ...lines, footer].join("\n"));
  return { passed, failed, total: results.length, totalChecks, failedChecks };
}

function reset() { results.length = 0; current = null; }

module.exports = { test, ok, equal, contains, notContains, match, report, reset };
