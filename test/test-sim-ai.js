"use strict";
/**
 * test-sim-ai.js — FLUX COMPLET AVEC RÉPONSE IA SIMULÉE.
 *
 * Ce que ça fait, sans jamais appeler api.anthropic.com :
 *  1) construit les messages réels (planSystem() + planUserMessage()) pour le scénario ;
 *  2) « appelle le modèle » via mockModel() qui renvoie une FIXTURE Markdown (réponse IA
 *     simulée), avec le même post-traitement que callClaude() de production ;
 *  3) note la réponse avec la GRILLE AUTOMATIQUE structurelle (grille-auto.js).
 *
 * Il inclut aussi un CONTRE-EXEMPLE (fixture « mauvaise ») pour prouver que la grille
 * DÉTECTE réellement les défauts (sinon une grille qui dit toujours « OK » ne vaut rien).
 */
const fs = require("fs");
const path = require("path");
const T = require("./lib/harness");
const { loadServer, buildPlanMessages, mockModel } = require("./lib/load-server");
const { evaluateItk } = require("./lib/grille-auto");
const { scenarios } = require("./scenarios");

const FIX_DIR = path.join(__dirname, "fixtures");

async function run() {
  T.reset();
  const api = loadServer();

  // --- Bon flux : chaque scénario à fixture doit passer toute la grille ---
  // On construit les messages réels, on simule la réponse IA (fixture), puis on note.
  // mockModel est async : on résout tout AVANT d'enregistrer le test (synchrone).
  for (const sc of scenarios) {
    if (!sc.fixture) continue;
    const simulated = fs.readFileSync(path.join(FIX_DIR, sc.fixture), "utf8");
    const messages = buildPlanMessages(api, sc.input);
    // eslint-disable-next-line no-await-in-loop
    const itk = await mockModel(messages, simulated);
    const g = evaluateItk(itk, sc.itkAttendus);
    T.test(`Flux simulé ${sc.id} — messages réels + réponse IA simulée + grille`, () => {
      T.contains(messages.system, "## 18.", "invite système de production utilisée");
      T.contains(messages.user, sc.input.crop, "message utilisateur contient la culture");
      T.ok(itk.length > 500, "réponse IA simulée non vide");
      for (const item of g.items) T.ok(item.pass, `grille[${item.id}] : ${item.detail}`);
      T.equal(g.score, g.max, `grille complète (${g.score}/${g.max})`);
    });
  }

  // --- Contre-exemple : la grille DOIT détecter les défauts ---
  T.test("Contre-exemple (fixture volontairement mauvaise) — la grille détecte les défauts", () => {
    const bad = fs.readFileSync(path.join(FIX_DIR, "99_mauvais_exemple.md"), "utf8");
    const g = evaluateItk(bad, { haStr: "0.1", exigeCalculQuantite: true });
    const byId = {};
    for (const it of g.items) byId[it.id] = it.pass;
    // On vérifie que chacun de ces défauts est bien ATTRAPÉ (pass === false).
    T.equal(byId["18_sections_ordre"], false, "détecte les sections manquantes (tronqué 14→18)");
    T.equal(byId["non_tronque"], false, "détecte la troncature");
    T.equal(byId["pas_intro_avant_1"], false, "détecte l'introduction avant ## 1");
    T.equal(byId["pas_emoji"], false, "détecte l'emoji");
    T.equal(byId["pas_de_prix_invente"], false, "détecte le prix inventé en FCFA");
    T.ok(g.score < g.max, `score dégradé attendu (${g.score}/${g.max})`);
  });

  return T.report({ title: "FLUX AVEC RÉPONSE IA SIMULÉE + GRILLE AUTOMATIQUE" });
}

module.exports = { run };

if (require.main === module) {
  run().then((r) => process.exit(r.failed ? 1 : 0));
}
