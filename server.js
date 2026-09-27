/**
 * Terravive — l'agriculture durable accompagnée par l'intelligence artificielle.
 *
 * Principe (même modèle que Bâtisseur) : l'agriculteur décrit sa parcelle, et l'IA
 * bâtit avec lui un PLAN DE CULTURE DURABLE personnalisé (calendrier des tâches,
 * fertilisation naturelle, gestion de l'eau, protection biologique, biodiversité),
 * puis reste disponible comme CONSEILLER (diagnostic, questions au fil de la saison).
 *
 * Zéro dépendance : Node.js 18+ (http, fs, crypto). Stockage : Supabase (si configuré)
 * ou fichiers locaux. Mots de passe hachés (scrypt), sessions par jeton aléatoire.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---------- Configuration ----------
function loadEnv(file) {
  try {
    fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line) => {
      if (line.trim().startsWith("#")) return;
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (process.env[m[1]] === undefined) process.env[m[1]] = v; }
    });
  } catch (e) {}
}
loadEnv(path.join(__dirname, ".env"));

const API_KEYS = (function () {
  const many = (process.env.ANTHROPIC_API_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const one = (process.env.ANTHROPIC_API_KEY || "").trim();
  const all = []; many.concat(one ? [one] : []).forEach((k) => { if (k && all.indexOf(k) === -1) all.push(k); });
  return all;
})();
const API_KEY = API_KEYS[0];
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const USE_DB = !!(SUPABASE_URL && SUPABASE_KEY);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

// ---------- Utilitaires HTTP ----------
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".ico": "image/x-icon", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".jpg": "image/jpeg" };
function sendJson(res, code, obj) { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); }
function readBody(req) { return new Promise((resolve, reject) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 6e6) req.destroy(); }); req.on("end", () => resolve(b)); req.on("error", reject); }); }
function normEmail(s) { return String(s || "").trim().toLowerCase(); }
function validEmail(s) { return typeof s === "string" && s.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function newId() { return crypto.randomBytes(12).toString("hex"); }

// Limitation de débit (protège le coût d'API)
const RL = {};
function rateOk(key, limit, windowMs) { const now = Date.now(); const arr = (RL[key] || []).filter((t) => now - t < windowMs); arr.push(now); RL[key] = arr; return arr.length <= limit; }
function clientIp(req) { return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || (req.socket && req.socket.remoteAddress) || "x"; }

// ---------- Accès Supabase (REST, sans dépendance) ----------
async function sb(pathPart, opts = {}) {
  const res = await fetch(SUPABASE_URL + "/rest/v1" + pathPart, Object.assign({}, opts, {
    headers: Object.assign({ apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" }, opts.headers || {})
  }));
  const text = await res.text(); let data; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) { const e = new Error("Base : erreur " + res.status); e.status = res.status; throw e; }
  return data;
}

// ---------- Stockage local (repli quand pas de base) ----------
const STORE_FILE = path.join(DATA_DIR, "store.json");
function loadStore() { try { return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); } catch (e) { return { users: {}, emails: {}, sessions: {}, plans: {} }; } }
function saveStore(s) { try { fs.writeFileSync(STORE_FILE, JSON.stringify(s, null, 2)); } catch (e) {} }

// ---------- Mots de passe & sessions ----------
function hashPassword(pw) { const salt = crypto.randomBytes(16); const hash = crypto.scryptSync(String(pw), salt, 64); return salt.toString("hex") + ":" + hash.toString("hex"); }
function verifyPassword(pw, stored) { try { const [s, h] = String(stored || "").split(":"); if (!s || !h) return false; const hash = crypto.scryptSync(String(pw), Buffer.from(s, "hex"), 64); const a = Buffer.from(h, "hex"); return a.length === hash.length && crypto.timingSafeEqual(a, hash); } catch (e) { return false; } }
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 60;
const SESSION_COOKIE = "trv_session";
const COOKIE_SECURE = (process.env.RENDER || process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "1") ? "; Secure" : "";

async function findUserByEmail(email) {
  const e = normEmail(email);
  if (USE_DB) { try { const r = await sb(`/trv_users?email=eq.${encodeURIComponent(e)}&select=*`); return (r && r[0]) || null; } catch (err) { return null; } }
  const s = loadStore(); const id = s.emails[e]; return id ? (s.users[id] || null) : null;
}
async function getUserById(id) {
  if (!id) return null;
  if (USE_DB) { try { const r = await sb(`/trv_users?id=eq.${encodeURIComponent(id)}&select=*`); return (r && r[0]) || null; } catch (e) { return null; } }
  return loadStore().users[id] || null;
}
async function createUser({ email, name, password, region }) {
  const e = normEmail(email);
  const user = { id: newId(), email: e, name: String(name || "").trim().slice(0, 80) || e.split("@")[0], pass: hashPassword(password), region: String(region || "").trim().slice(0, 80) || null, created_at: new Date().toISOString() };
  if (USE_DB) { await sb(`/trv_users`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([user]) }); }
  else { const s = loadStore(); s.users[user.id] = user; s.emails[e] = user.id; saveStore(s); }
  return user;
}
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex"); const created_at = new Date().toISOString();
  if (USE_DB) { await sb(`/trv_sessions`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ token, user_id: userId, created_at }]) }); }
  else { const s = loadStore(); s.sessions[token] = { userId, at: Date.now() }; saveStore(s); }
  return token;
}
async function deleteSession(token) {
  if (!token) return;
  if (USE_DB) { try { await sb(`/trv_sessions?token=eq.${encodeURIComponent(token)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); } catch (e) {} return; }
  const s = loadStore(); if (s.sessions[token]) { delete s.sessions[token]; saveStore(s); }
}
async function getSessionUser(token) {
  if (!token) return null;
  if (USE_DB) {
    try { const r = await sb(`/trv_sessions?token=eq.${encodeURIComponent(token)}&select=user_id,created_at`); const x = r && r[0]; if (!x) return null; if (Date.now() - new Date(x.created_at).getTime() > SESSION_TTL_MS) { await deleteSession(token); return null; } return await getUserById(x.user_id); } catch (e) { return null; }
  }
  const s = loadStore(); const x = s.sessions[token]; if (!x) return null; if (Date.now() - (x.at || 0) > SESSION_TTL_MS) { delete s.sessions[token]; saveStore(s); return null; } return s.users[x.userId] || null;
}
function parseCookies(req) { const h = req.headers.cookie || ""; const out = {}; h.split(";").forEach((p) => { const i = p.indexOf("="); if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return out; }
function setSessionCookie(res, token) { res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${COOKIE_SECURE}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`); }
function clearSessionCookie(res) { res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${COOKIE_SECURE}; Max-Age=0`); }
async function currentUser(req) { const t = parseCookies(req)[SESSION_COOKIE]; return t ? await getSessionUser(t) : null; }
function isAdmin(u) { return !!u && ADMIN_EMAILS.includes(normEmail(u.email)); }
function publicUser(u) { return u ? { id: u.id, email: u.email, name: u.name, region: u.region || null, isAdmin: isAdmin(u) } : null; }

// ---------- Plans de culture ----------
async function savePlan(rec) {
  if (USE_DB) { try { await sb(`/trv_plans?on_conflict=id`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([rec]) }); } catch (e) { console.error("savePlan:", e.message); } return; }
  const s = loadStore(); s.plans[rec.id] = rec; saveStore(s);
}
async function getPlan(id) {
  if (USE_DB) { try { const r = await sb(`/trv_plans?id=eq.${encodeURIComponent(id)}&select=*`); return (r && r[0]) || null; } catch (e) { return null; } }
  return loadStore().plans[id] || null;
}
async function listPlansForUser(userId) {
  if (USE_DB) { try { return (await sb(`/trv_plans?user_id=eq.${encodeURIComponent(userId)}&select=id,title,crop,region,created_at&order=created_at.desc`)) || []; } catch (e) { return []; } }
  return Object.values(loadStore().plans).filter((p) => p.user_id === userId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

// ---------- Appel IA (bascule de clés) ----------
const RETRYABLE = [408, 409, 429, 500, 502, 503, 504, 529];
let KEY_CURSOR = 0;
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function callClaude(system, messages, model) {
  const body = JSON.stringify({ model: model || MODEL, max_tokens: 4096, system, messages: messages.map((m) => ({ role: m.role, content: m.content })) });
  const n = API_KEYS.length || 1; const start = KEY_CURSOR; KEY_CURSOR = (KEY_CURSOR + 1) % n; let lastErr = null;
  for (let i = 0; i < n; i++) {
    const key = API_KEYS[(start + i) % n];
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body });
      const data = await r.json().catch(() => ({}));
      if (r.ok) return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      const status = r.status; lastErr = Object.assign(new Error((data && data.error && data.error.message) || ("Erreur IA " + status)), { status });
      if (status === 400 || status === 404) throw lastErr;
      if ((status === 429 || status === 529) && i < n - 1) await sleep(600);
    } catch (e) { if (e && (e.status === 400 || e.status === 404)) throw e; lastErr = e; }
  }
  throw lastErr || new Error("Aucune clé API disponible.");
}

// ---------- Invites IA (agriculture durable) ----------
const DURABLE_CONTEXT = `Tu es un ingénieur agronome spécialisé en AGRICULTURE DURABLE et en AGROÉCOLOGIE, avec une grande expérience du climat tropical et de l'Afrique de l'Ouest (notamment la Côte d'Ivoire). Tu t'adresses à des agriculteurs et agricultrices qui ne sont pas des experts : sois clair, concret, bienveillant, en français simple.

Tes principes, toujours : privilégier les pratiques durables — rotation et association des cultures, compost et fumure organique, paillage, gestion économe de l'eau, protection biologique (préparations naturelles, plantes répulsives, auxiliaires), préservation des sols et de la biodiversité. Tu réduis au maximum les intrants chimiques et n'en proposes qu'en dernier recours, avec prudence et dosage. Tu adaptes tes conseils au climat, à la saison et aux moyens locaux (matériaux disponibles sur place). Tu ne donnes jamais de conseil dangereux pour la santé ou l'environnement.`;

function planSystem() {
  return DURABLE_CONTEXT + `

TÂCHE : à partir des informations de la parcelle, rédige un PLAN DE CULTURE DURABLE personnalisé, en français, au format Markdown, avec EXACTEMENT ces sections (titres en ##) :

## Aperçu
Deux ou trois phrases : la culture, l'objectif, et pourquoi l'approche durable choisie convient à cette parcelle.

## Calendrier de culture
Une liste chronologique des phases (préparation du sol → semis/plantation → entretien → fertilisation naturelle → gestion de l'eau → protection biologique → récolte). Pour chaque phase : la période indicative (semaine/mois après le démarrage) et les gestes concrets à faire. Utilise des puces.

## Pratiques durables recommandées
Rotation, associations bénéfiques (compagnonnage), compost/paillage, économie d'eau, biodiversité. Puces courtes et actionnables.

## Fertilisation & protection naturelles
Quelles fumures organiques, quels traitements naturels (ex. purins, savon noir, cendre, plantes répulsives), et comment les préparer avec des moyens locaux.

## Rendement attendu & bénéfices écologiques
Une fourchette réaliste de rendement, et les bénéfices durables (sol vivant, moins d'eau, moins de produits chimiques, revenus).

## Points de vigilance
Les 3 à 5 erreurs à éviter et les signaux d'alerte à surveiller.

Reste réaliste et honnête sur les incertitudes (climat, ravageurs). N'invente pas de chiffres précis : donne des fourchettes. Ne mets pas d'introduction avant la première section.`;
}
function planUserMessage(p) {
  return `Voici ma parcelle :
- Culture souhaitée : ${p.crop}
- Région / localité : ${p.region || "non précisée"}
- Surface : ${p.area || "non précisée"}
- Type de sol : ${p.soil || "non précisé"}
- Saison / période de démarrage : ${p.season || "non précisée"}
- Objectif principal : ${p.goal || "produire durablement"}
- Moyens / contraintes : ${p.notes || "aucun détail supplémentaire"}

Rédige mon plan de culture durable.`;
}
function advisorSystem(plan) {
  let s = DURABLE_CONTEXT + `

Tu réponds aux questions de l'agriculteur au fil de sa saison : diagnostic de problèmes (à partir de sa description : feuilles jaunes, taches, insectes, sol…), conseils d'arrosage, de fertilisation naturelle, de protection biologique, de récolte. Réponses courtes, concrètes, pas à pas. Si un symptôme peut avoir plusieurs causes, propose comment les distinguer. Termine par l'action durable la plus simple à essayer en premier.`;
  if (plan) s += `\n\nContexte de sa parcelle : culture « ${plan.crop} », région « ${plan.region || "?"} », sol « ${plan.soil || "?"} », saison « ${plan.season || "?"} ».`;
  return s;
}

// ---------- Points d'entrée API ----------
async function handleRegister(req, res) {
  try {
    let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
    const email = normEmail(p.email);
    if (!validEmail(email)) return sendJson(res, 400, { error: "Adresse e-mail invalide." });
    if (typeof p.password !== "string" || p.password.length < 6) return sendJson(res, 400, { error: "Le mot de passe doit contenir au moins 6 caractères." });
    if (await findUserByEmail(email)) return sendJson(res, 409, { error: "Un compte existe déjà avec cette adresse. Connectez-vous." });
    const user = await createUser({ email, name: p.name, password: p.password, region: p.region });
    const token = await createSession(user.id); setSessionCookie(res, token);
    sendJson(res, 200, { user: publicUser(user) });
  } catch (e) { sendJson(res, 500, { error: e.message || "Erreur serveur." }); }
}
async function handleLogin(req, res) {
  try {
    let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
    const user = await findUserByEmail(p.email);
    if (!user || !verifyPassword(p.password, user.pass)) return sendJson(res, 401, { error: "E-mail ou mot de passe incorrect." });
    const token = await createSession(user.id); setSessionCookie(res, token);
    sendJson(res, 200, { user: publicUser(user) });
  } catch (e) { sendJson(res, 500, { error: e.message || "Erreur serveur." }); }
}
async function handleLogout(req, res) { const t = parseCookies(req)[SESSION_COOKIE]; await deleteSession(t); clearSessionCookie(res); sendJson(res, 200, { ok: true }); }
async function handleMe(req, res) { sendJson(res, 200, { user: publicUser(await currentUser(req)) }); }

async function handlePlan(req, res) {
  if (!API_KEY) return sendJson(res, 500, { error: "Clé IA manquante (ANTHROPIC_API_KEY)." });
  const user = await currentUser(req);
  if (!user) return sendJson(res, 401, { error: "Connectez-vous pour créer votre plan." });
  if (!rateOk("plan:" + user.id, 20, 24 * 60 * 60 * 1000)) return sendJson(res, 429, { error: "Vous avez généré beaucoup de plans aujourd'hui. Reprenez plus tard." });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const crop = String(p.crop || "").trim().slice(0, 120);
  if (!crop) return sendJson(res, 400, { error: "Indiquez au moins la culture souhaitée." });
  const clean = { crop, region: String(p.region || "").slice(0, 120), area: String(p.area || "").slice(0, 80), soil: String(p.soil || "").slice(0, 80), season: String(p.season || "").slice(0, 80), goal: String(p.goal || "").slice(0, 120), notes: String(p.notes || "").slice(0, 500) };
  try {
    const content = await callClaude(planSystem(), [{ role: "user", content: planUserMessage(clean) }]);
    const rec = { id: newId(), user_id: user.id, title: crop + (clean.region ? " — " + clean.region : ""), crop, region: clean.region || null, area: clean.area || null, soil: clean.soil || null, season: clean.season || null, goal: clean.goal || null, notes: clean.notes || null, content, created_at: new Date().toISOString() };
    await savePlan(rec);
    sendJson(res, 200, { plan: rec });
  } catch (e) { sendJson(res, e.status || 500, { error: e.message || "La génération a échoué." }); }
}
async function handlePlansList(req, res) { const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Non connecté." }); sendJson(res, 200, { plans: await listPlansForUser(user.id) }); }
async function handlePlanGet(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Non connecté." });
  const id = new URL(req.url, "http://x").searchParams.get("id");
  const plan = id ? await getPlan(id) : null;
  if (!plan || plan.user_id !== user.id) return sendJson(res, 404, { error: "Plan introuvable." });
  sendJson(res, 200, { plan });
}
async function handleChat(req, res) {
  if (!API_KEY) return sendJson(res, 500, { error: "Clé IA manquante (ANTHROPIC_API_KEY)." });
  const user = await currentUser(req);
  if (!user) return sendJson(res, 401, { error: "Connectez-vous pour poser une question." });
  if (!rateOk("chat:" + user.id, 120, 24 * 60 * 60 * 1000)) return sendJson(res, 429, { error: "Beaucoup de questions aujourd'hui — reprenez un peu plus tard." });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const q = String(p.message || "").trim(); if (!q) return sendJson(res, 400, { error: "Message vide." });
  let plan = null; if (p.planId) { const pl = await getPlan(p.planId); if (pl && pl.user_id === user.id) plan = pl; }
  const history = Array.isArray(p.history) ? p.history.slice(-8).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })) : [];
  try {
    const reply = await callClaude(advisorSystem(plan), history.concat([{ role: "user", content: q.slice(0, 2000) }]));
    sendJson(res, 200, { reply });
  } catch (e) { sendJson(res, e.status || 500, { error: e.message || "La réponse a échoué." }); }
}
async function handleAdminUsers(req, res) {
  const u = await currentUser(req); if (!isAdmin(u)) return sendJson(res, 403, { error: "Réservé à l'administrateur." });
  let users = [], plans = [];
  if (USE_DB) { try { users = (await sb(`/trv_users?select=id,email,name,region,created_at&order=created_at.desc`)) || []; plans = (await sb(`/trv_plans?select=user_id`)) || []; } catch (e) {} }
  else { const s = loadStore(); users = Object.values(s.users); plans = Object.values(s.plans); }
  const count = {}; plans.forEach((p) => { count[p.user_id] = (count[p.user_id] || 0) + 1; });
  sendJson(res, 200, { users: users.map((x) => ({ id: x.id, email: x.email, name: x.name, region: x.region || null, created_at: x.created_at, plans: count[x.id] || 0 })), totalPlans: plans.length });
}

// ---------- Fichiers statiques ----------
function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/accueil.html";
  if (urlPath === "/app") urlPath = "/app.html";
  if (urlPath === "/accueil") urlPath = "/accueil.html";
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end("Accès interdit"); }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); return res.end("Page introuvable"); }
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

// ---------- Routeur ----------
const server = http.createServer((req, res) => {
  const url = (req.url || "").split("?")[0];
  if (req.method === "POST" && url === "/api/auth/register") return handleRegister(req, res);
  if (req.method === "POST" && url === "/api/auth/login") return handleLogin(req, res);
  if (req.method === "POST" && url === "/api/auth/logout") return handleLogout(req, res);
  if (req.method === "GET" && url === "/api/auth/me") return handleMe(req, res);
  if (req.method === "POST" && url === "/api/plan") return handlePlan(req, res);
  if (req.method === "GET" && url === "/api/plans") return handlePlansList(req, res);
  if (req.method === "GET" && url === "/api/plan") return handlePlanGet(req, res);
  if (req.method === "POST" && url === "/api/chat") return handleChat(req, res);
  if (req.method === "GET" && url === "/api/admin/users") return handleAdminUsers(req, res);
  if (req.method === "GET") return serveStatic(req, res);
  res.writeHead(405); res.end("Méthode non autorisée");
});

server.listen(PORT, () => {
  console.log(`\n  Terravive — agriculture durable accompagnée par l'IA`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Modèle : ${MODEL} · Clés API : ${API_KEYS.length}`);
  console.log(`  Mémoire : ${USE_DB ? "Supabase" : "fichiers locaux"}`);
  console.log(`  Admin : ${ADMIN_EMAILS.length ? ADMIN_EMAILS.join(", ") : "(définir ADMIN_EMAILS)"}\n`);
});
