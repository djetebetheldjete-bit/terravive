"use strict";
/**
 * harness.js — petit outillage de test, sans aucune dépendance npm.
 *
 * Il démarre le VRAI serveur (server.js) sur un port libre, dans un dossier de
 * données jetable, puis lui envoie de vraies requêtes HTTP.
 *
 * Sécurité des tests :
 *   - l'environnement du serveur de test est construit à la main : les clés
 *     Supabase / IA / e-mail sont VIDES, donc aucun test ne touche la base de
 *     production, n'appelle l'IA ou n'envoie d'e-mail ;
 *   - les données vont dans un dossier temporaire (DATA_DIR) supprimé à la fin.
 */
const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

/** Envoie une requête au serveur de test. Le chemin est transmis tel quel (utile pour les URL mal formées). */
function request(port, method, urlPath, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, opts.headers || {});
    let body = null;
    if (opts.json !== undefined) { body = JSON.stringify(opts.json); headers["content-type"] = "application/json"; }
    else if (opts.body !== undefined) { body = opts.body; }
    if (body !== null) headers["content-length"] = Buffer.byteLength(body);
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.ip) headers["x-forwarded-for"] = opts.ip;
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null; try { json = JSON.parse(text); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error("délai dépassé : " + method + " " + urlPath)));
    req.on("error", reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

/** Extrait « nom=valeur » des en-têtes Set-Cookie d'une réponse (pour le renvoyer ensuite). */
function cookieOf(res) {
  const sc = res.headers["set-cookie"] || [];
  return sc.map((c) => c.split(";")[0]).filter((c) => !/=$/.test(c)).join("; ");
}

/** Démarre server.js (dossier `root`) et attend qu'il réponde. */
async function startServer(root, extraEnv) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "autotests-"));
  const env = Object.assign({
    PATH: process.env.PATH || "",
    SystemRoot: process.env.SystemRoot || "",   // nécessaire à Node sous Windows
    PORT: String(port),
    DATA_DIR: dataDir,
    NODE_ENV: "test",
    // Clés volontairement vides : jamais de base de production ni d'e-mail pendant les tests.
    // (Une clé IA factice peut être passée par le test : aucun test n'atteint un appel à l'IA.)
    SUPABASE_URL: "", SUPABASE_KEY: "",
    ANTHROPIC_API_KEY: "", ANTHROPIC_API_KEYS: "",
    BREVO_API_KEY: "", MAIL_FROM: "", MAIL_WEBHOOK_URL: "", WA_WEBHOOK_URL: "",
    WAVE_API_KEY: "", WAVE_WEBHOOK_SECRET: "", NETLIFY_TOKEN: "", CRON_KEY: "",
    COOKIE_SECURE: "", RENDER: ""
  }, extraEnv || {});
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  let exited = null;
  child.stdout.on("data", (d) => { logs += d; });
  child.stderr.on("data", (d) => { logs += d; });
  child.on("exit", (code, signal) => { exited = { code, signal }; });

  const started = Date.now();
  for (;;) {
    if (exited) throw new Error("Le serveur s'est arrêté au démarrage.\n" + logs.slice(-2000));
    try { const r = await request(port, "GET", "/robots.txt"); if (r.status) break; } catch (e) {}
    if (Date.now() - started > 20000) { child.kill(); throw new Error("Le serveur ne répond pas après 20 s.\n" + logs.slice(-2000)); }
    await new Promise((r) => setTimeout(r, 120));
  }

  return {
    port, dataDir,
    logs: () => logs,
    alive: () => exited === null,
    req: (method, urlPath, opts) => request(port, method, urlPath, opts),
    async stop() {
      if (exited === null) { child.kill(); await new Promise((r) => { child.once("exit", r); setTimeout(r, 3000); }); }
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
    }
  };
}

/** Mini lanceur de tests : affiche ✓ / ✗ et compte les échecs. */
function createRunner(title) {
  const results = [];
  console.log("\n" + title);
  return {
    section(name) { console.log("\n  " + name); },
    async test(label, fn) {
      try { await fn(); results.push({ label, ok: true }); console.log("    ✓ " + label); }
      catch (e) { results.push({ label, ok: false }); console.log("    ✗ " + label + "\n        → " + String((e && e.message) || e).split("\n")[0]); }
    },
    summary() {
      const failed = results.filter((r) => !r.ok).length;
      console.log("\n  ---------------------------------------------");
      console.log("  Tests exécutés : " + results.length + "   réussis : " + (results.length - failed) + "   échoués : " + failed);
      console.log("  Résultat : " + (failed ? "ÉCHEC" : "SUCCÈS") + "\n");
      return failed;
    }
  };
}

/**
 * Contrôles statiques d'une page HTML : langue, titre, affichage mobile, un seul <h1>,
 * et surtout : chaque <script> intégré doit être du JavaScript valide (une seule
 * erreur de syntaxe suffit à casser toute une page).
 */
function checkHtml(file) {
  const problems = [];
  const html = fs.readFileSync(file, "utf8");
  if (!/<html[^>]*\blang="fr/i.test(html)) problems.push("attribut lang=\"fr\" manquant sur <html>");
  if (!/<meta[^>]+name="viewport"/i.test(html)) problems.push("balise viewport manquante (affichage mobile)");
  const t = html.match(/<title>([^<]*)<\/title>/i);
  if (!t || !t[1].trim()) problems.push("<title> manquant ou vide");
  const withoutScripts = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  const h1 = (withoutScripts.match(/<h1\b/gi) || []).length;
  if (h1 !== 1) problems.push("la page doit avoir exactement un <h1> (trouvé : " + h1 + ")");
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, n = 0;
  while ((m = re.exec(html))) {
    const attrs = m[1], code = m[2];
    if (/\bsrc\s*=/.test(attrs) || !code.trim()) continue;
    n++;
    const type = (attrs.match(/\btype\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
    if (/json/i.test(type)) { try { JSON.parse(code); } catch (e) { problems.push("bloc JSON n°" + n + " invalide : " + e.message); } continue; }
    if (type && !/javascript|^module$/i.test(type)) continue;
    if (/^module$/i.test(type)) continue;
    try { new vm.Script(code, { filename: path.basename(file) + " <script n°" + n + ">" }); }
    catch (e) { problems.push("erreur JavaScript dans le <script> n°" + n + " : " + e.message); }
  }
  return problems;
}

module.exports = { startServer, request, cookieOf, createRunner, checkHtml };
