"use strict";
/**
 * load-server.js — charge le VRAI server.js de production dans un bac à sable (vm),
 * SANS le modifier, SANS ouvrir de port réseau, SANS clé API réelle, SANS appeler
 * api.anthropic.com.
 *
 * Pourquoi ce procédé :
 *  - server.js est un fichier monolithique « zéro dépendance » qui, à la fin, crée un
 *    serveur HTTP et appelle server.listen(...). On ne veut NI ouvrir un port, NI
 *    exiger une clé API, NI écrire dans le dossier du dépôt pendant les tests.
 *  - On exécute donc le code source réel dans un contexte vm où « http » est remplacé
 *    par un faux (createServer().listen() ne fait rien) et où fetch() est un faux qui
 *    ne contacte jamais le réseau. Les fonctions déclarées en `function ...` (parseArea,
 *    planSystem, planUserMessage, etc.) deviennent accessibles sur le global du contexte.
 *  - On teste ainsi le CODE DE PRODUCTION lui-même (pas une copie), en lecture seule.
 *
 * Zéro dépendance npm : uniquement les modules intégrés de Node (fs, path, vm, os).
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");

// Emplacement du server.js de production. Surchargable par la variable
// d'environnement TERRAVIVE_SERVER si la suite est exécutée depuis ailleurs.
function resolveServerPath() {
  if (process.env.TERRAVIVE_SERVER) return path.resolve(process.env.TERRAVIVE_SERVER);
  // Par défaut : ../server.js (ce fichier est dans test/lib/)
  return path.resolve(__dirname, "..", "..", "server.js");
}

// Faux module http : createServer(...).listen(...) ne fait rien (aucun port ouvert).
const fakeHttp = {
  createServer() {
    return { listen() { return this; }, on() { return this; }, close() { return this; } };
  },
};

// Faux fetch : ne contacte JAMAIS le réseau. Renvoie une réponse neutre au format
// attendu par callClaude() (pour que, si du code l'appelle par erreur, rien ne parte
// vers l'extérieur). Les tests qui ont besoin d'une « réponse IA » passent par
// generatePlanMessages()/mockModel ci-dessous, pas par ce fetch.
async function fakeFetch() {
  return {
    ok: true,
    status: 200,
    async json() { return { content: [{ type: "text", text: "[RÉPONSE SIMULÉE — fetch neutralisé en test]" }] }; },
    async text() { return ""; },
  };
}

function loadServer() {
  const serverPath = resolveServerPath();
  const src = fs.readFileSync(serverPath, "utf8");

  // __dirname du sandbox = dossier temporaire jetable, pour que loadEnv(.env),
  // mkdirSync(DATA_DIR) et PUBLIC_DIR n'écrivent PAS dans le dépôt pendant les tests.
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "terravive-test-"));

  const fakeRequire = (name) => {
    if (name === "http" || name === "https") return fakeHttp;
    if (name === "fs") return fs;
    if (name === "path") return path;
    if (name === "crypto") return require("crypto");
    if (name === "os") return os;
    // Le code de production n'importe rien d'autre (zéro dépendance).
    throw new Error("Module non prévu en test : " + name);
  };

  const sandbox = {
    module: { exports: {} },
    exports: {},
    require: fakeRequire,
    __dirname: sandboxDir,
    __filename: path.join(sandboxDir, "server.js"),
    console: { log() {}, error() {}, warn() {}, info() {} }, // silencieux
    process: Object.assign(Object.create(Object.getPrototypeOf(process)), process, {
      env: Object.assign({}, process.env, {
        // Clé factice : rend API_KEY « présente » sans valeur réelle, et aucune requête
        // ne part (fetch est neutralisé). Base de données désactivée.
        ANTHROPIC_API_KEY: "sk-ant-test-FACTICE-ne-pas-utiliser",
        ANTHROPIC_API_KEYS: "",
        SUPABASE_URL: "",
        SUPABASE_KEY: "",
        PORT: "0",
        ADMIN_EMAILS: "",
      }),
    }),
    Buffer,
    URL,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    setInterval: () => ({ unref() {}, ref() {} }), // n'arme aucun timer (pas de blocage)
    clearInterval: () => {},
    fetch: fakeFetch,
    global: null,
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  const script = new vm.Script(src, { filename: serverPath });
  script.runInContext(sandbox, { timeout: 10000 });

  // Récupère les fonctions de production réellement utiles aux tests.
  const picked = {};
  ["parseArea", "planSystem", "planUserMessage", "advisorSystem"].forEach((name) => {
    if (typeof sandbox[name] === "function") picked[name] = sandbox[name];
  });
  if (!picked.parseArea || !picked.planSystem || !picked.planUserMessage) {
    throw new Error(
      "Fonctions attendues introuvables dans server.js (parseArea / planSystem / planUserMessage). " +
      "Le format du fichier a peut-être changé."
    );
  }
  picked.__serverPath = serverPath;
  picked.__sandboxDir = sandboxDir;
  return picked;
}

/**
 * Construit les DEUX messages réellement envoyés au modèle pour un profil de parcelle,
 * en utilisant le VRAI planSystem() et le VRAI planUserMessage() de production.
 * Ne contacte aucun fournisseur : renvoie simplement { system, user }.
 */
function buildPlanMessages(api, clean) {
  return { system: api.planSystem(), user: api.planUserMessage(clean) };
}

/**
 * Simule l'appel au modèle : au lieu d'appeler api.anthropic.com, renvoie la réponse
 * fournie par le test (fixture Markdown). Reproduit le même post-traitement que
 * callClaude() (concatène les blocs de type "text" et trim()).
 */
async function mockModel({ system, user }, simulatedBlocksOrText) {
  void system; void user; // le mock n'a pas besoin du contenu des messages
  let blocks;
  if (typeof simulatedBlocksOrText === "string") {
    blocks = [{ type: "text", text: simulatedBlocksOrText }];
  } else if (Array.isArray(simulatedBlocksOrText)) {
    blocks = simulatedBlocksOrText;
  } else {
    blocks = [{ type: "text", text: String(simulatedBlocksOrText || "") }];
  }
  return blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

module.exports = { loadServer, buildPlanMessages, mockModel, resolveServerPath };
