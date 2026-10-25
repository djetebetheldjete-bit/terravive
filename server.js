/**
 * Terravive — l'agriculture durable accompagnée par l'intelligence artificielle.
 *
 * Principe (même modèle que Bâtisseur) : l'agriculteur décrit sa parcelle, et l'IA
 * bâtit avec lui un ITINÉRAIRE TECHNIQUE DE CULTURE complet et personnalisé,
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
// Longueur max (tokens) pour la génération du plan — l'itinéraire complet (18 sections,
// fiches d'action chiffrées, budget, résumé) est long : 8000 coupait vers la section 13,
// 16000 vers la section 17. Relevé à 24000 (le modèle accepte cette longueur) et le prompt
// demande en plus de TOUJOURS finir le résumé (## 18) de façon concise.
const PLAN_MAX_TOKENS = parseInt(process.env.PLAN_MAX_TOKENS, 10) || 24000;
// Longueur max pour un projet Arduino (le sketch commenté + le guide peuvent être longs).
const ARDUINO_MAX_TOKENS = parseInt(process.env.ARDUINO_MAX_TOKENS, 10) || 9000;
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const USE_DB = !!(SUPABASE_URL && SUPABASE_KEY);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

// ---------- Utilitaires HTTP ----------
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".ico": "image/x-icon", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".webmanifest": "application/manifest+json; charset=utf-8", ".json": "application/json; charset=utf-8" };
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
  if (!res.ok) {
    const detail = typeof data === "string" ? data : JSON.stringify(data);
    const e = new Error("Base : erreur " + res.status + (detail ? " — " + detail.slice(0, 500) : ""));
    e.status = res.status;
    throw e;
  }
  return data;
}

// ---------- Stockage local (repli quand pas de base) ----------
const STORE_FILE = path.join(DATA_DIR, "store.json");
function loadStore() { try { const s = JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); if (!s.devices) s.devices = {}; if (!s.stations) s.stations = {}; if (!s.readings) s.readings = {}; if (!s.questions) s.questions = []; if (!s.parcels) s.parcels = {}; if (!s.coops) s.coops = {}; if (!s.coopMembers) s.coopMembers = []; if (!s.coopEquip) s.coopEquip = []; if (!s.coopResa) s.coopResa = []; if (!s.coopBuy) s.coopBuy = []; if (!s.coopBuyJoin) s.coopBuyJoin = []; if (!s.animReqs) s.animReqs = []; return s; } catch (e) { return { users: {}, emails: {}, sessions: {}, plans: {}, devices: {}, stations: {}, readings: {}, questions: [], parcels: {}, coops: {}, coopMembers: [], coopEquip: [], coopResa: [], coopBuy: [], coopBuyJoin: [], animReqs: [] }; } }
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
function isAnimator(u) { return !!u && (!!u.animator || isAdmin(u)); }
function publicUser(u) { return u ? { id: u.id, email: u.email, name: u.name, region: u.region || null, isAdmin: isAdmin(u), animator: isAnimator(u) } : null; }
async function setUserAnimator(userId, val) {
  if (USE_DB) { try { await sb(`/trv_users?id=eq.${encodeURIComponent(userId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ animator: !!val }) }); } catch (e) { console.error("setUserAnimator:", e.message); } return; }
  const s = loadStore(); if (s.users[userId]) { s.users[userId].animator = !!val; saveStore(s); }
}
// Demandes pour devenir animateur (soumises par l'agriculteur, décidées par le propriétaire).
async function listAnimRequests(status) {
  if (USE_DB) { try { const q = status ? `&status=eq.${encodeURIComponent(status)}` : ""; return (await sb(`/trv_anim_requests?select=*${q}&order=created_at.desc`)) || []; } catch (e) { return []; } }
  let a = (loadStore().animReqs || []); if (status) a = a.filter((r) => r.status === status); return a.slice().sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
}
async function getAnimRequestByUser(userId) {
  if (USE_DB) { try { const r = await sb(`/trv_anim_requests?user_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.desc&limit=1`); return (r && r[0]) || null; } catch (e) { return null; } }
  const a = (loadStore().animReqs || []).filter((r) => r.user_id === userId).sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))); return a[0] || null;
}
async function getAnimRequest(id) {
  if (!id) return null;
  if (USE_DB) { try { const r = await sb(`/trv_anim_requests?id=eq.${encodeURIComponent(id)}&select=*`); return (r && r[0]) || null; } catch (e) { return null; } }
  return (loadStore().animReqs || []).find((r) => r.id === id) || null;
}
async function addAnimRequest(rec) {
  if (USE_DB) { try { await sb(`/trv_anim_requests`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([rec]) }); } catch (e) { console.error("addAnimRequest:", e.message); } return; }
  const s = loadStore(); (s.animReqs = s.animReqs || []).push(rec); saveStore(s);
}
async function updateAnimRequest(id, fields) {
  if (USE_DB) { try { await sb(`/trv_anim_requests?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(fields) }); } catch (e) {} return; }
  const s = loadStore(); const r = (s.animReqs || []).find((x) => x.id === id); if (r) { Object.assign(r, fields); saveStore(s); }
}

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

// ---------- Journal des questions posées au conseiller ----------
// Permet au formateur de voir ce que les cultivateurs cherchent à comprendre.
async function logQuestion(rec) {
  try {
    if (USE_DB) { await sb(`/trv_questions`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([rec]) }); return; }
    const s = loadStore(); if (!Array.isArray(s.questions)) s.questions = []; s.questions.push(rec); if (s.questions.length > 2000) s.questions = s.questions.slice(-2000); saveStore(s);
  } catch (e) { /* le journal ne doit jamais bloquer la réponse */ }
}
async function recentQuestions(limit) {
  limit = limit || 300;
  if (USE_DB) { try { return (await sb(`/trv_questions?select=question,crop,created_at&order=created_at.desc&limit=${limit}`)) || []; } catch (e) { return []; } }
  const s = loadStore(); const arr = Array.isArray(s.questions) ? s.questions.slice() : [];
  return arr.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit);
}
// Thèmes agrégés par mots-clés (pour voir d'un coup d'œil les sujets qui reviennent).
const Q_THEMES = [
  { label: "Sol & fertilité", rx: /\b(sol|fertilit|compost|fumier|humus|mati[èe]re organique|ph|acide|amendement)\b/i },
  { label: "Eau & irrigation", rx: /\b(eau|arros|irrig|goutte|pluie|s[ée]cheresse|paillage)\b/i },
  { label: "Fertilisation", rx: /\b(engrais|fertilis|azote|npk|fumure|nutrit)\b/i },
  { label: "Ravageurs & maladies", rx: /\b(ravageur|insecte|puceron|chenille|maladie|champignon|mildiou|tache|pourri|n[ée]matode|traitement|pesticide)\b/i },
  { label: "Semis & calendrier", rx: /\b(semis|semer|plant|pépini|repiqu|[ée]cartement|densit|calendrier|saison)\b/i },
  { label: "Carences (feuilles)", rx: /\b(jauniss|jaune|carence|feuille|flétri|rabougri)\b/i },
  { label: "Récolte & conservation", rx: /\b(r[ée]colt|maturit|conserv|stock|s[ée]chage|perte)\b/i },
  { label: "Satellite & outils", rx: /\b(ndvi|satellite|capteur|carte|durabilit|indice)\b/i },
  { label: "Durabilité & pratiques", rx: /\b(rotation|association|agroforest|biodiversit|couverture|carbone|biologique)\b/i },
];
function themeCounts(rows) {
  const c = Q_THEMES.map((t) => ({ label: t.label, count: 0 }));
  (rows || []).forEach((r) => { const q = String(r.question || ""); Q_THEMES.forEach((t, i) => { if (t.rx.test(q)) c[i].count++; }); });
  return c.filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
}

// ---------- Parcelles enregistrées (limites de la zone, revisualisables) ----------
async function saveParcel(rec) {
  if (USE_DB) { try { await sb(`/trv_parcels?on_conflict=id`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([rec]) }); } catch (e) { console.error("saveParcel:", e.message); } return; }
  const s = loadStore(); s.parcels[rec.id] = rec; saveStore(s);
}
async function listParcelsForUser(userId) {
  if (USE_DB) { try { return (await sb(`/trv_parcels?user_id=eq.${encodeURIComponent(userId)}&select=id,name,geom,created_at&order=created_at.desc`)) || []; } catch (e) { return []; } }
  return Object.values(loadStore().parcels).filter((p) => p.user_id === userId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
async function deleteParcel(userId, id) {
  if (USE_DB) { try { await sb(`/trv_parcels?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); } catch (e) {} return; }
  const s = loadStore(); const p = s.parcels[id]; if (p && p.user_id === userId) { delete s.parcels[id]; saveStore(s); }
}
// Garde-fou : une « zone » valide = { bbox:[o,s,e,n] } OU { polygon:[[lng,lat],...] }.
function cleanZone(z) {
  if (!z || typeof z !== "object") return null;
  if (Array.isArray(z.bbox) && z.bbox.length === 4 && z.bbox.every((n) => typeof n === "number" && isFinite(n))) return { bbox: z.bbox.map(Number) };
  if (Array.isArray(z.polygon) && z.polygon.length >= 3 && z.polygon.length <= 500 && z.polygon.every((pt) => Array.isArray(pt) && pt.length === 2 && isFinite(pt[0]) && isFinite(pt[1]))) return { polygon: z.polygon.map((pt) => [Number(pt[0]), Number(pt[1])]) };
  return null;
}

// ---------- Coopératives (relais humain + base achats groupés / mise en marché) ----------
function coopCode() { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let c = ""; for (let i = 0; i < 6; i++) c += A[Math.floor(Math.random() * A.length)]; return c; }
async function createCoop(rec) {
  if (USE_DB) { try { await sb(`/trv_coops`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([rec]) }); } catch (e) { console.error("createCoop:", e.message); } return; }
  const s = loadStore(); s.coops[rec.id] = rec; saveStore(s);
}
async function getCoopById(id) {
  if (!id) return null;
  if (USE_DB) { try { const r = await sb(`/trv_coops?id=eq.${encodeURIComponent(id)}&select=*`); return (r && r[0]) || null; } catch (e) { return null; } }
  return loadStore().coops[id] || null;
}
async function getCoopByCode(code) {
  const c = String(code || "").trim().toUpperCase(); if (!c) return null;
  if (USE_DB) { try { const r = await sb(`/trv_coops?code=eq.${encodeURIComponent(c)}&select=*`); return (r && r[0]) || null; } catch (e) { return null; } }
  return Object.values(loadStore().coops).find((x) => x.code === c) || null;
}
async function getMembership(userId) {
  if (USE_DB) { try { const r = await sb(`/trv_coop_members?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`); return (r && r[0]) || null; } catch (e) { return null; } }
  return (loadStore().coopMembers || []).find((m) => m.user_id === userId) || null;
}
async function listCoopMembers(coopId) {
  if (USE_DB) { try { return (await sb(`/trv_coop_members?coop_id=eq.${encodeURIComponent(coopId)}&select=*&order=joined_at.asc`)) || []; } catch (e) { return []; } }
  return (loadStore().coopMembers || []).filter((m) => m.coop_id === coopId).sort((a, b) => String(a.joined_at).localeCompare(String(b.joined_at)));
}
async function addMembership(rec) {
  if (USE_DB) { try { await sb(`/trv_coop_members`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([rec]) }); } catch (e) { console.error("addMembership:", e.message); } return; }
  const s = loadStore(); s.coopMembers.push(rec); saveStore(s);
}
async function removeMembership(userId) {
  if (USE_DB) { try { await sb(`/trv_coop_members?user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); } catch (e) {} return; }
  const s = loadStore(); s.coopMembers = (s.coopMembers || []).filter((m) => m.user_id !== userId); saveStore(s);
}
// Statistiques d'un membre pour la vue animateur (relais humain).
async function memberStats(userId) {
  let plans = [], parcels = [];
  try { plans = await listPlansForUser(userId); } catch (e) {}
  try { parcels = await listParcelsForUser(userId); } catch (e) {}
  const crops = {}; let lastCrop = null;
  (plans || []).forEach((p, i) => { const c = (p.crop || "").trim(); if (c) { crops[c.toLowerCase()] = (crops[c.toLowerCase()] || 0) + 1; if (i === 0) lastCrop = c; } });
  return { plans: (plans || []).length, parcels: (parcels || []).length, lastCrop, crops: Object.keys(crops) };
}

// ---------- Coopérative : matériel partagé + achats groupés (stockage) ----------
async function listEquipment(coopId) {
  if (USE_DB) { try { return (await sb(`/trv_coop_equipment?coop_id=eq.${encodeURIComponent(coopId)}&select=*&order=created_at.desc`)) || []; } catch (e) { return []; } }
  return (loadStore().coopEquip || []).filter((x) => x.coop_id === coopId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
async function getEquipment(id) {
  if (!id) return null;
  if (USE_DB) { try { const r = await sb(`/trv_coop_equipment?id=eq.${encodeURIComponent(id)}&select=*`); return (r && r[0]) || null; } catch (e) { return null; } }
  return (loadStore().coopEquip || []).find((x) => x.id === id) || null;
}
async function addEquipment(rec) {
  if (USE_DB) { try { await sb(`/trv_coop_equipment`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([rec]) }); } catch (e) { console.error("addEquipment:", e.message); } return; }
  const s = loadStore(); (s.coopEquip = s.coopEquip || []).push(rec); saveStore(s);
}
async function deleteEquipment(id) {
  if (USE_DB) { try { await sb(`/trv_coop_equipment?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); } catch (e) {} try { await sb(`/trv_coop_resa?equipment_id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); } catch (e) {} return; }
  const s = loadStore(); s.coopEquip = (s.coopEquip || []).filter((x) => x.id !== id); s.coopResa = (s.coopResa || []).filter((r) => r.equipment_id !== id); saveStore(s);
}
async function listResa(coopId) {
  if (USE_DB) { try { return (await sb(`/trv_coop_resa?coop_id=eq.${encodeURIComponent(coopId)}&select=*&order=created_at.desc`)) || []; } catch (e) { return []; } }
  return (loadStore().coopResa || []).filter((r) => r.coop_id === coopId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
async function getResa(id) {
  if (!id) return null;
  if (USE_DB) { try { const r = await sb(`/trv_coop_resa?id=eq.${encodeURIComponent(id)}&select=*`); return (r && r[0]) || null; } catch (e) { return null; } }
  return (loadStore().coopResa || []).find((x) => x.id === id) || null;
}
async function addResa(rec) {
  if (USE_DB) { try { await sb(`/trv_coop_resa`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([rec]) }); } catch (e) { console.error("addResa:", e.message); } return; }
  const s = loadStore(); (s.coopResa = s.coopResa || []).push(rec); saveStore(s);
}
async function updateResaStatus(id, status) {
  if (USE_DB) { try { await sb(`/trv_coop_resa?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status }) }); } catch (e) {} return; }
  const s = loadStore(); const r = (s.coopResa || []).find((x) => x.id === id); if (r) { r.status = status; saveStore(s); }
}
async function listBuy(coopId) {
  if (USE_DB) { try { return (await sb(`/trv_coop_buy?coop_id=eq.${encodeURIComponent(coopId)}&select=*&order=created_at.desc`)) || []; } catch (e) { return []; } }
  return (loadStore().coopBuy || []).filter((x) => x.coop_id === coopId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
async function getBuy(id) {
  if (!id) return null;
  if (USE_DB) { try { const r = await sb(`/trv_coop_buy?id=eq.${encodeURIComponent(id)}&select=*`); return (r && r[0]) || null; } catch (e) { return null; } }
  return (loadStore().coopBuy || []).find((x) => x.id === id) || null;
}
async function addBuy(rec) {
  if (USE_DB) { try { await sb(`/trv_coop_buy`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([rec]) }); } catch (e) { console.error("addBuy:", e.message); } return; }
  const s = loadStore(); (s.coopBuy = s.coopBuy || []).push(rec); saveStore(s);
}
async function updateBuyStatus(id, status) {
  if (USE_DB) { try { await sb(`/trv_coop_buy?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status }) }); } catch (e) {} return; }
  const s = loadStore(); const b = (s.coopBuy || []).find((x) => x.id === id); if (b) { b.status = status; saveStore(s); }
}
async function deleteBuy(id) {
  if (USE_DB) { try { await sb(`/trv_coop_buy?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); } catch (e) {} try { await sb(`/trv_coop_buy_join?buy_id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); } catch (e) {} return; }
  const s = loadStore(); s.coopBuy = (s.coopBuy || []).filter((x) => x.id !== id); s.coopBuyJoin = (s.coopBuyJoin || []).filter((j) => j.buy_id !== id); saveStore(s);
}
async function listBuyJoins(buyId) {
  if (USE_DB) { try { return (await sb(`/trv_coop_buy_join?buy_id=eq.${encodeURIComponent(buyId)}&select=*`)) || []; } catch (e) { return []; } }
  return (loadStore().coopBuyJoin || []).filter((j) => j.buy_id === buyId);
}
async function setBuyJoin(buyId, userId, qty, name) {
  if (USE_DB) {
    try { await sb(`/trv_coop_buy_join?buy_id=eq.${encodeURIComponent(buyId)}&user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); } catch (e) {}
    if (qty > 0) { try { await sb(`/trv_coop_buy_join`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ id: newId(), buy_id: buyId, user_id: userId, qty, name: name || null, created_at: new Date().toISOString() }]) }); } catch (e) { console.error("setBuyJoin:", e.message); } }
    return;
  }
  const s = loadStore(); s.coopBuyJoin = (s.coopBuyJoin || []).filter((j) => !(j.buy_id === buyId && j.user_id === userId));
  if (qty > 0) s.coopBuyJoin.push({ id: newId(), buy_id: buyId, user_id: userId, qty, name: name || null, created_at: new Date().toISOString() });
  saveStore(s);
}

// ---------- Bibliothèque partagée : réutilisation par CULTURE + SECTEUR ----------
// Si un itinéraire a déjà été établi pour la même culture dans la même région, on le
// ressert (instantané et gratuit) au lieu de rappeler l'IA. Base COMMUNE à tous les
// utilisateurs : ce qu'une personne crée pour un secteur profite aux suivantes.
function normKey(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "") // enlève les accents
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function sectorKey(crop, region) {
  const c = normKey(crop), r = normKey(region);
  if (!c || !r) return null; // pas de « secteur » tant qu'il manque la culture OU la région
  return c + "|" + r;
}
async function findSharedPlan(crop, region) {
  const key = sectorKey(crop, region);
  if (!key) return null;
  let rows = [];
  if (USE_DB) {
    try { rows = (await sb(`/trv_plans?select=id,crop,region,created_at&order=created_at.desc&limit=500`)) || []; }
    catch (e) { return null; }
  } else {
    rows = Object.values(loadStore().plans)
      .map((p) => ({ id: p.id, crop: p.crop, region: p.region, created_at: p.created_at }))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }
  const hit = rows.find((p) => sectorKey(p.crop, p.region) === key);
  return hit ? await getPlan(hit.id) : null;
}

// ---------- Projets d'automatisation agricole (Arduino) ----------
async function saveDevice(rec) {
  if (USE_DB) { try { await sb(`/trv_devices?on_conflict=id`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([rec]) }); } catch (e) { console.error("saveDevice:", e.message); } return; }
  const s = loadStore(); s.devices[rec.id] = rec; saveStore(s);
}
async function getDevice(id) {
  if (USE_DB) { try { const r = await sb(`/trv_devices?id=eq.${encodeURIComponent(id)}&select=*`); return (r && r[0]) || null; } catch (e) { return null; } }
  return loadStore().devices[id] || null;
}
async function listDevicesForUser(userId) {
  if (USE_DB) { try { return (await sb(`/trv_devices?user_id=eq.${encodeURIComponent(userId)}&select=id,title,kind,sector,created_at&order=created_at.desc`)) || []; } catch (e) { return []; } }
  return Object.values(loadStore().devices).filter((d) => d.user_id === userId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
// Mémoire partagée : un projet déjà créé pour le même TYPE dans le même SECTEUR est resservi.
function deviceKey(kind, sector) {
  const k = normKey(kind);
  if (!k) return null;
  const s = normKey(sector);
  return k + "|" + (s || "*"); // sans secteur renseigné, on partage par type seul
}
async function findSharedDevice(kind, sector) {
  const key = deviceKey(kind, sector);
  if (!key) return null;
  let rows = [];
  if (USE_DB) {
    try { rows = (await sb(`/trv_devices?select=id,kind,sector,created_at&order=created_at.desc&limit=500`)) || []; }
    catch (e) { return null; }
  } else {
    rows = Object.values(loadStore().devices)
      .map((d) => ({ id: d.id, kind: d.kind, sector: d.sector, created_at: d.created_at }))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }
  const hit = rows.find((d) => deviceKey(d.kind, d.sector) === key);
  return hit ? await getDevice(hit.id) : null;
}

// ---------- Station connectée + mesures des capteurs ----------
async function getOrCreateStation(userId) {
  if (USE_DB) {
    try {
      const r = await sb(`/trv_stations?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`);
      if (r && r[0]) return r[0];
      const rec = { id: newId(), user_id: userId, name: "Ma parcelle", device_key: "trv_" + crypto.randomBytes(16).toString("hex"), created_at: new Date().toISOString() };
      await sb(`/trv_stations`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([rec]) });
      return rec;
    } catch (e) { return null; }
  }
  const s = loadStore();
  let st = Object.values(s.stations).find((x) => x.user_id === userId);
  if (!st) { st = { id: newId(), user_id: userId, name: "Ma parcelle", device_key: "trv_" + crypto.randomBytes(16).toString("hex"), created_at: new Date().toISOString() }; s.stations[st.id] = st; saveStore(s); }
  return st;
}
async function getStationByKey(key) {
  if (!key) return null;
  if (USE_DB) { try { const r = await sb(`/trv_stations?device_key=eq.${encodeURIComponent(key)}&select=*&limit=1`); return (r && r[0]) || null; } catch (e) { return null; } }
  return Object.values(loadStore().stations).find((x) => x.device_key === key) || null;
}
async function saveReading(rec) {
  if (USE_DB) { try { await sb(`/trv_readings`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([rec]) }); } catch (e) { console.error("saveReading:", e.message); } return; }
  const s = loadStore(); s.readings[rec.id] = rec;
  // on garde au plus 500 mesures par utilisateur en local (évite de gonfler le fichier)
  const mine = Object.values(s.readings).filter((x) => x.user_id === rec.user_id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (mine.length > 500) mine.slice(500).forEach((x) => { delete s.readings[x.id]; });
  saveStore(s);
}
async function recentReadings(userId, limit) {
  const n = limit || 48;
  if (USE_DB) { try { return (await sb(`/trv_readings?user_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.desc&limit=${n}`)) || []; } catch (e) { return []; } }
  return Object.values(loadStore().readings).filter((x) => x.user_id === userId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, n);
}
async function clearReadings(userId) {
  if (USE_DB) { try { await sb(`/trv_readings?user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); } catch (e) { console.error("clearReadings:", e.message); } return; }
  const s = loadStore(); Object.values(s.readings).forEach((r) => { if (r.user_id === userId) delete s.readings[r.id]; }); saveStore(s);
}

// ---------- Météo (Open-Meteo, gratuit, sans clé) ----------
const WEATHER_CACHE = new Map(); // region -> { at, ttl, data }
const WEATHER_TTL = 30 * 60 * 1000;
const WEATHER_RETRY = 90 * 1000; // en cas d'échec, on retente vite (évite de figer une erreur 30 min)
// Géocodage en PRIORITÉ en Côte d'Ivoire via Nominatim (OpenStreetMap), qui gère
// un vrai filtre pays (countrycodes=ci). L'API d'Open-Meteo ignore ce filtre et
// renvoyait "San pedro" -> San Pedro Sula (Honduras). Nominatim trouve San-Pédro (CI).
async function geocodeCI(region) {
  const q = encodeURIComponent((region && String(region).trim()) || "Yamoussoukro");
  const headers = { "User-Agent": "Terravive/1.0 (agriculture durable - Cote d'Ivoire)", "Accept-Language": "fr" };
  const parse = (x) => {
    if (!x) return null;
    const parts = String(x.display_name || "").split(",").map((s) => s.trim());
    return { name: parts[0] || "", admin1: parts[1] || "", latitude: +x.lat, longitude: +x.lon };
  };
  try {
    // 1) filtré sur la Côte d'Ivoire
    let r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ci&q=${q}`, { headers }).then((x) => x.json());
    if (r && r[0]) return parse(r[0]);
    // 2) dernier recours : recherche mondiale
    r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`, { headers }).then((x) => x.json());
    if (r && r[0]) return parse(r[0]);
  } catch (e) {}
  return null;
}
// Prévisions Open-Meteo pour des coordonnées précises (partagé par la météo région et GPS).
async function openMeteoForecast(lat, lon) {
  const f = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=4&timezone=auto`).then((r) => r.json());
  if (!f || !f.current) return null;
  return {
    current: { temp: Math.round(f.current.temperature_2m), hum: f.current.relative_humidity_2m, rain: f.current.precipitation, code: f.current.weather_code },
    daily: f.daily ? f.daily.time.map((t, i) => ({ date: t, code: f.daily.weather_code[i], tmax: Math.round(f.daily.temperature_2m_max[i]), tmin: Math.round(f.daily.temperature_2m_min[i]), rainP: f.daily.precipitation_probability_max ? f.daily.precipitation_probability_max[i] : null })) : []
  };
}
async function fetchWeather(region) {
  const key = normKey(region) || "_";
  const hit = WEATHER_CACHE.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
  let data = null, ok = false;
  try {
    const g = await geocodeCI(region);
    const lat = g ? g.latitude : 6.82, lon = g ? g.longitude : -5.28; // défaut : Yamoussoukro (Côte d'Ivoire)
    const place = g ? (g.name + (g.admin1 ? ", " + g.admin1 : "")) : "Yamoussoukro";
    const fc = await openMeteoForecast(lat, lon);
    if (fc) { ok = true; data = Object.assign({ place, lat, lon }, fc); }
    else { data = { place, lat, lon, current: null, daily: [] }; }
  } catch (e) { data = null; }
  // On ne fige PAS un échec pendant 30 min : en cas de problème, on retente au bout de 90 s.
  WEATHER_CACHE.set(key, { at: Date.now(), ttl: ok ? WEATHER_TTL : WEATHER_RETRY, data });
  return data;
}
// Météo pour une position GPS précise (+ nom du lieu par géocodage inverse).
async function fetchWeatherLatLon(lat, lon) {
  const key = "ll:" + lat.toFixed(3) + "," + lon.toFixed(3);
  const hit = WEATHER_CACHE.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
  let data = null, ok = false;
  try {
    let place = "Ma position";
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=12&lat=${lat}&lon=${lon}`, { headers: { "User-Agent": "Terravive/1.0 (agriculture durable - Cote d'Ivoire)", "Accept-Language": "fr" } }).then((x) => x.json());
      if (r && r.display_name) place = String(r.display_name).split(",").slice(0, 2).map((s) => s.trim()).join(", ");
    } catch (e) {}
    const fc = await openMeteoForecast(lat, lon);
    if (fc) { ok = true; data = Object.assign({ place, lat, lon }, fc); }
    else { data = { place, lat, lon, current: null, daily: [] }; }
  } catch (e) { data = null; }
  WEATHER_CACHE.set(key, { at: Date.now(), ttl: ok ? WEATHER_TTL : WEATHER_RETRY, data });
  return data;
}

// ---------- Appel IA (bascule de clés) ----------
const RETRYABLE = [408, 409, 429, 500, 502, 503, 504, 529];
let KEY_CURSOR = 0;
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function callClaude(system, messages, model, maxTokens) {
  const body = JSON.stringify({ model: model || MODEL, max_tokens: maxTokens || 4096, system, messages: messages.map((m) => ({ role: m.role, content: m.content })) });
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

Tes principes, toujours : privilégier les pratiques durables — rotation et association des cultures, compost et fumure organique, paillage, gestion économe de l'eau, protection biologique (préparations naturelles, plantes répulsives, auxiliaires), préservation des sols et de la biodiversité. Tu réduis au maximum les intrants chimiques et n'en proposes qu'en dernier recours, avec prudence et dosage. Tu adaptes tes conseils au climat, à la saison et aux moyens locaux (matériaux disponibles sur place). Tu ne donnes jamais de conseil dangereux pour la santé ou l'environnement.

STYLE : écris de façon sobre et professionnelle. N'utilise JAMAIS d'emojis ni d'icônes (pas de 🌱, 😊, 💧, etc.), ni dans le texte ni dans les listes. Pour une liste, utilise simplement des tirets.`;

function planSystem() {
  return DURABLE_CONTEXT + `

TÂCHE : à partir des informations de la parcelle, rédige un ITINÉRAIRE TECHNIQUE DE CULTURE (ITK) COMPLET et personnalisé, en français, au format Markdown. L'ITK est la suite ORDONNÉE de toutes les opérations techniques, de la préparation de la parcelle jusqu'à l'après-récolte. Pour CHAQUE opération, précise : QUAND (période, ou stade / nombre de semaines après le semis), COMMENT (le geste concret : dose, écartement, méthode…) et POURQUOI (en une phrase simple).

MÉTHODE DE TRAVAIL (à appliquer dans TOUT l'itinéraire) :
1) DISTINGUE toujours trois niveaux d'information, sans jamais les confondre : ce que la personne a FOURNI (culture, région, surface, sol, pH, saison, mode, structure, objectif, moyens) ; ce qui est RÉELLEMENT connu de façon générale pour cette culture et cette zone ; et tes HYPOTHÈSES de travail quand une donnée manque. Une hypothèse n'est JAMAIS présentée comme une mesure réelle : annonce-la clairement (« en supposant que… », « faute d'analyse de sol, je pars de l'hypothèse que… »).
2) Si une information ESSENTIELLE manque (ex. pH, pluviométrie locale, ravageur dominant), signale la limite ET propose une méthode SIMPLE et peu coûteuse pour l'obtenir (observation, test maison, plante indicatrice, petite analyse), plutôt que d'inventer.
3) FICHE D'ACTION — pour CHAQUE opération agricole importante (préparation, fumure de fond, semis/plantation, fertilisation d'entretien, irrigation, protection, récolte…), présente des fiches concrètes et utilisables sur le terrain qui couvrent, dans la mesure où les données le permettent : (1) l'OPÉRATION à réaliser ; (2) l'OBJECTIF agronomique (pourquoi) ; (3) la PÉRIODE ou le STADE de réalisation ; (4) le MATÉRIEL nécessaire ; (5) les INTRANTS nécessaires ; (6) la QUANTITÉ PAR UNITÉ DE SURFACE (dose, avec son unité) ; (7) la QUANTITÉ TOTALE pour la superficie de l'exploitation (voir règle de CALCUL ci-dessous) ; (8) la MÉTHODE d'application ; (9) la FRÉQUENCE ou la durée ; (10) le COÛT indicatif UNIQUEMENT si des prix fiables existent (sinon, ne mets rien et renvoie au budget à compléter en section 16) ; (11) les RISQUES et PRÉCAUTIONS ; (12) l'INDICATEUR permettant de vérifier que l'opération a réussi. Si l'une de ces informations ne peut pas être donnée de façon fiable, dis-le au lieu d'inventer. N'alourdis pas inutilement : regroupe en quelques lignes claires (une courte liste à tirets par opération), pas un formulaire rigide.
4) FIABILITÉ SCIENTIFIQUE : n'invente JAMAIS de dose d'engrais ou de pesticide, de rendement, de prix ni de coefficient agronomique. Donne des FOURCHETTES prudentes et, quand les données sont insuffisantes, nomme ce qui manque. Distingue clairement les conseils GÉNÉRAUX de ceux qui exigent une analyse de sol, une observation de terrain ou la confirmation d'un agronome.
5) PRODUITS PHYTOSANITAIRES : privilégie la prévention, la surveillance et la lutte intégrée. Toute recommandation chimique reste un DERNIER recours et doit respecter les autorisations locales, l'étiquette du produit et les délais avant récolte (délai de sécurité) ; rappelle les équipements de protection.
6) ADAPTE au producteur : français clair, chaque terme technique expliqué en quelques mots à sa première apparition ; propose des solutions pour les PETITS producteurs (moyens limités) comme pour les exploitations mieux équipées.
7) CALCUL DES QUANTITÉS — quand une dose de référence est CONNUE et JUSTIFIÉE, calcule la quantité totale pour la parcelle : Quantité totale = dose par hectare × superficie en hectares. VÉRIFIE TOUJOURS LES UNITÉS avant de calculer : convertis d'abord la surface fournie en hectares (1 ha = 10 000 m² ; ex. 500 m² = 0,05 ha ; 1000 m² = 0,1 ha). Ne confonds JAMAIS : kilogrammes et grammes ; litres et millilitres ; dose PAR PLANT et dose PAR HECTARE ; quantité de produit COMMERCIAL et quantité de MATIÈRE ACTIVE. Montre le calcul en une ligne (dose × surface) pour que la personne puisse le refaire. NE calcule PAS une dose d'engrais à partir d'un simple objectif de rendement si les informations sur le sol et les besoins de la culture manquent : dans ce cas, n'invente pas de total — indique les informations à obtenir d'abord (analyse de sol, besoins de la variété). Donne les doses en FOURCHETTES ; quand tu donnes une fourchette, calcule le total sur la fourchette (ex. « de A à B kg » → « de A×S à B×S »). L'application te fournit déjà la surface convertie en hectares : utilise cette valeur. Rappels de conversion : 1 ha = 10 000 m² = 100 ares ; 1 t = 1 000 kg. Formules selon l'unité de la dose : kg/ha → total kg = dose × ha ; t/ha → total kg = dose × ha × 1 000 ; g/plant → total g = dose × nombre de plants. Pour les semences, plants et intrants vendus en sacs, ajoute si besoin une MARGE clairement indiquée (pertes, bordures, remplacements). AFFICHE la formule ET le résultat pour chaque quantité importante, pour que la personne puisse vérifier. Si la surface est absente ou invalide, NE calcule aucun total dépendant de la surface et demande une valeur valide.
8) CALENDRIER — cale le calendrier sur le cycle de la culture, la date ou la saison de démarrage et les conditions locales connues. Si une DATE de plantation est fournie, construis des dates indicatives et distingue la date PRÉVUE de la date réellement OBSERVÉE. Si la date de plantation n'est PAS renseignée, utilise des repères RELATIFS au stade de développement (ex. « 2 semaines après le semis », « à la floraison ») plutôt que d'inventer des dates précises. Si la SAISON agricole n'est pas connue, signale cette information manquante, propose un calendrier CONDITIONNEL et demande de confirmer le calendrier local des pluies avant de fixer les opérations qui dépendent de la saison.
9) SIGNALER LES INCERTITUDES — toute recommandation appuyée sur une donnée DÉDUITE et non mesurée ni observée (le régime des pluies estimé d'après le nom de la région, le type de sol supposé, un ravageur non observé) doit être annoncée comme telle, et, quand l'enjeu est important (dose, chaulage, traitement), renvoyer à une analyse de sol ou à une observation de terrain — y compris le DIAGNOSTIC PAR PHOTO de l'application. Ne transforme JAMAIS une tendance générale en fait local : présente le régime climatique comme un schéma général à confronter au calendrier des pluies réellement observé sur place ces dernières années. N'affirme pas qu'une recommandation est « scientifiquement validée » sans justification suffisante.
10) SÉCURISER LES DOSES — avant de proposer une dose d'intrant sensible (engrais minéral, amendement, produit phytosanitaire), classe-la : (A) dose issue d'une référence technique identifiable et pertinente ; (B) fourchette indicative dont tu précises les conditions d'application ; (C) dose à déterminer après observation ou analyse ; (D) information indisponible. Ne présente jamais une dose comme universelle : tiens compte de la culture, du stade, du sol et du contexte, et distingue la MATIÈRE ACTIVE de la formulation commerciale. Ne calcule pas une dose de chaux sur la seule base du pH (la texture et le pouvoir tampon comptent). Respecte les homologations, les étiquettes et les délais avant récolte. Si aucune source fiable n'est disponible, écris exactement : « Dose à confirmer auprès d'un technicien agricole ou d'une référence technique adaptée à votre zone. »
11) ADAPTER AUX MOYENS — ne présume JAMAIS que le producteur possède une pompe, un tracteur, un goutte-à-goutte ou un accès permanent à l'eau si ce n'est pas renseigné. Quand c'est pertinent, propose trois niveaux de solution : (1) minimale et abordable, (2) intermédiaire, (3) améliorée, en donnant pour chacune l'avantage, la limite, le besoin en travail et le risque. Ne recommande pas un équipement coûteux si une solution plus accessible est techniquement acceptable.
12) COHÉRENCE — garde les quantités IDENTIQUES d'une section à l'autre (une même quantité ne doit pas varier entre une fiche d'action, le budget et le résumé). Le résumé opérationnel (## 18) ne doit jamais contredire les fiches. Si un calcul ne peut pas être fait, affiche la RAISON au lieu d'inventer une valeur. N'affirme pas qu'un calcul a été « vérifié automatiquement ».
13) ADAPTATION LOCALE (Côte d'Ivoire) — contextualise avec la localité saisie. Quand c'est pertinent, situe la parcelle dans une grande ZONE agro-écologique (ex. zone forestière humide du Sud/Sud-Ouest, zone de transition forêt-savane du Centre, savane soudanienne du Nord) SANS supposer qu'une région administrative est homogène : reste prudent et renvoie aux observations locales. Ne présente JAMAIS un calendrier agricole général comme une prévision météo actuelle. DISPONIBILITÉ LOCALE : ne prétends jamais qu'une variété, un intrant, un fournisseur ou un équipement est disponible dans la localité sans preuve ; quand la disponibilité n'est pas vérifiée, écris « Disponibilité locale à confirmer auprès d'un fournisseur ou d'un technicien agricole de votre zone. » N'invente AUCUN prix, coordonnée, stock ni référence commerciale. Enfin, classe explicitement les pratiques en trois niveaux : pratiques RÉALISABLES immédiatement avec les moyens déclarés ; AMÉLIORATIONS utiles mais facultatives ; INVESTISSEMENTS nécessitant des moyens supplémentaires (jamais imposés).

MODE DE CONDUITE (déterminant) — le mode choisi doit INFLUENCER RÉELLEMENT les recommandations, de façon cohérente du diagnostic (## 1) jusqu'au résumé (## 18). Il agit surtout sur : préparation du sol (## 3), fumure et fertilisation (## 4 et ## 7), irrigation (## 8), protection (## 9), résidus (## 13), rotations/associations et biodiversité (## 14), coûts et équipements (## 16), indicateurs de suivi. Ne modifie PAS artificiellement les sections qui ne dépendent pas du mode. Le mode ne lève JAMAIS les garde-fous : il ne justifie ni dose inventée, ni diagnostic phytosanitaire sans preuve, ni prix inventé, ni rendement garanti, ni intrant déclaré « autorisé » sans vérification. Ne recommande une pratique QUE si elle est adaptée à la culture, au sol, à la saison et aux moyens — ne l'impose jamais au seul motif qu'elle appartient à la catégorie du mode ; si une pratique du mode est inaccessible (matériel, budget, intrant indisponible), propose une ALTERNATIVE techniquement acceptable et explique ses limites.
- AGROÉCOLOGIE / RÉGÉNÉRATIF : vise l'amélioration progressive de la santé du sol — couverture du sol, apports organiques adaptés, rotations et associations, biodiversité fonctionnelle, lutte intégrée, réduction des pertes d'eau et d'éléments, limitation du brûlage. N'affirme pas que toutes ces pratiques conviennent à toutes les cultures et parcelles : retiens celles qui sont adaptées au contexte et signale les limites.
- AGRICULTURE BIOLOGIQUE : priorité à la prévention, aux rotations, à la fertilité organique et aux méthodes de lutte autorisées par le référentiel applicable ; AUCUN intrant chimique de synthèse. N'affirme PAS qu'un intrant est « autorisé en bio » sans vérification — écris « à vérifier auprès du référentiel ou de l'organisme applicable ». Distingue trois niveaux : pratique INSPIRÉE du bio ; production conduite selon un CAHIER DES CHARGES ; production CERTIFIÉE bio — et ne présente JAMAIS une exploitation comme certifiée sans preuve.
- AGRICULTURE DE CONSERVATION : examine les trois principes — perturbation minimale du sol (non-labour / semis direct), couverture permanente du sol, diversification et rotation. Adapte leur application à la culture, au climat, aux résidus réellement disponibles, à la pression des adventices et au MATÉRIEL du producteur. N'IMPOSE PAS le semis direct si les conditions techniques ou le matériel ne le permettent pas : propose une transition progressive (travail du sol réduit, paillage, couverture) en expliquant les limites.
- CONVENTIONNEL RAISONNÉ : apports d'intrants JUSTIFIÉS et adaptés aux besoins, surveillance des ravageurs et maladies, lutte intégrée, respect des étiquettes et homologations, usage raisonné de l'eau, suivi des coûts et des résultats. Ce mode n'est PAS l'usage systématique ni excessif de produits chimiques : raisonne chaque intrant et privilégie la prévention avant le curatif.
Si le mode indiqué n'est pas reconnu, ou s'il est absent, traite-le comme « non précisé » et propose une approche agroécologique adaptée, sans bloquer la génération.
COMPARAISON DES MODES : si la personne demande (dans ses objectifs ou ses observations) de COMPARER les modes pour sa culture et sa parcelle, présente, mode par mode : pratiques recommandées, intrants nécessaires, besoin en main-d'œuvre, investissements éventuels, avantages, limites, risques, informations manquantes. Ne déclare AUCUN mode systématiquement supérieur : la comparaison dépend du contexte et des objectifs.

Respecte EXACTEMENT ces sections (titres en ##), dans cet ordre :

## 1. Diagnostic de la parcelle
La culture visée ; la zone agro-écologique et le régime des pluies (bimodal ou monomodal) de la région, qui détermine le calendrier ; le type de sol avec ses atouts et ses risques (ex. sableux = bien drainé mais pauvre et lessivable ; argileux = retient l'eau et les éléments mais peut s'asphyxier ; limoneux = bon potentiel mais sensible à la battance). Si une texture COMPOSÉE est indiquée (ex. argilo-sableux, limono-sableux, sablo-argileux, argilo-limoneux, « terre franche » argilo-limono-sableux), raisonne sur la fraction DOMINANTE (le premier terme) tempérée par la fraction secondaire : un sol argilo-sableux retient mieux l'eau qu'un sableux pur tout en se drainant plus vite qu'un argileux ; un limono-sableux est léger et facile à travailler mais sujet à la battance et au lessivage ; une terre franche (argilo-limono-sableux) est le profil le plus équilibré. Adapte le travail du sol, la fertilisation et l'irrigation en conséquence ; le pH du sol UNIQUEMENT s'il a été fourni ; le précédent cultural si connu ; et l'objectif de la personne. Déduis-en les grands choix de l'itinéraire. Si une information manque, indique clairement l'hypothèse que tu prends — et ne reproche jamais à la personne de ne pas avoir une donnée (comme le pH).
TYPOLOGIE DE L'AGROSYSTÈME : tiens compte du MODE de conduite indiqué (conventionnel, biologique, agriculture de conservation, agroécologie/régénératif) et de la STRUCTURE voulue (monoculture, polyculture/cultures associées, agroforesterie). Adapte TOUT l'itinéraire à ce choix : par exemple, en mode biologique n'autorise aucun intrant chimique de synthèse ; en agriculture de conservation, mise sur le non-labour, la couverture permanente du sol et la rotation ; en agroforesterie/polyculture, intègre d'emblée les arbres et les associations. Si la personne a choisi la monoculture, signale avec bienveillance l'intérêt d'introduire un peu de diversité (rotation, association, bordures) pour la résilience, sans lui imposer.
FACTEURS À PESER dans ce diagnostic : le climat et la saison ; les caractéristiques connues du sol ; la disponibilité en eau ; le matériel disponible et les moyens financiers du producteur (souvent décrits dans « Moyens / contraintes ») ; les principaux ravageurs et maladies de la culture dans la zone ; et les objectifs de rendement et de commercialisation. Pour chacun, précise s'il s'agit d'une donnée FOURNIE par la personne, d'une donnée GÉNÉRALE connue pour la culture et la zone, ou d'une HYPOTHÈSE — et n'avance jamais une hypothèse comme un fait mesuré.

## 2. Choix de la variété et des semences
Type de variété adapté au climat local et à l'objectif (résistance aux maladies, cycle court ou long, tolérance à la chaleur ou à la sécheresse), qualité des semences (semences saines, taux de germination), et préparation éventuelle (pré-germination, traitement — en privilégiant les solutions naturelles). Si tu cites des noms de variétés, présente-les comme des EXEMPLES courants et ajoute « Disponibilité locale à confirmer auprès d'un fournisseur ou d'un technicien agricole de votre zone. » — n'affirme jamais qu'une variété précise est disponible dans la localité sans preuve, et n'invente ni prix ni fournisseur. Relie CHAQUE variété citée aux conditions PRÉCISES (climat humide ou sec, pression des maladies, longueur du cycle) : ne regroupe pas sous l'étiquette « tolérante à la chaleur humide » (ou similaire) une variété qui ne l'est pas réellement pour ce contexte ; si une variété convient surtout à une zone moins humide, dis-le.

## 3. Préparation du sol
Défrichage et nettoyage de la parcelle, travail du sol (labour, hersage, planage) et forme de culture (à plat, en billons, en buttes ou en planches) choisie selon le sol et le besoin de drainage. Rappelle l'intérêt d'un travail du sol limité et de la matière organique pour préserver un sol vivant, quand c'est possible.

## 4. Fumure de fond et amendement
Apports organiques avant plantation (compost, fumier bien décomposé) et leur enfouissement — ils nourrissent le sol ET tamponnent doucement le pH.
Gestion du pH : si le pH du sol est FOURNI, utilise-le — sol acide (pH inférieur à ~6) : conseille un chaulage léger (chaux agricole ou cendre de bois) pour le remonter ; sol alcalin (pH supérieur à ~7,5) : évite le chaulage et mise sur la matière organique ; pH proche de 6–7 : rien à corriger, c'est idéal. Donne les apports en FOURCHETTES, et précise que la dose exacte de chaux dépend aussi de la TEXTURE et du pouvoir tampon du sol (un sol léger/sableux demande moins de chaux qu'un sol argileux) : pour une dose sûre, une analyse de sol reste préférable.
Si le pH N'EST PAS fourni (c'est souvent le cas, et c'est NORMAL), ne bloque pas et ne l'invente pas : rappelle simplement que beaucoup de sols tropicaux sont légèrement acides, propose des moyens SIMPLES et peu coûteux de l'ESTIMER si la personne le souhaite — en étant honnête sur leurs LIMITES : les bandelettes de pH bon marché ou une petite analyse sont les plus fiables ; le test maison au vinaigre et au bicarbonate ne donne qu'une indication très grossière (il révèle surtout un sol calcaire par l'effervescence au vinaigre) et NE fournit PAS une valeur de pH ; les plantes indicatrices sont peu fiables sous les tropiques. NE chiffre JAMAIS une dose de chaux à partir d'un test maison : un chaulage dosé exige un pH réellement mesuré et la texture du sol. En attendant, avance avec une approche prudente qui marche dans tous les cas : beaucoup de matière organique (elle corrige doucement l'acidité) et observation de la culture.
Donne des ordres de grandeur réalistes sous forme de FOURCHETTES, jamais de chiffres inventés précis.
La valeur fertilisante réelle d'un apport organique dépend fortement de la MATURITÉ et de la QUALITÉ du compost ou du fumier (un compost jeune ou pauvre nourrit beaucoup moins) : relie la dose à cette qualité et à l'observation de la culture, plutôt qu'à un chiffre fixe, et commence plutôt vers le bas de la fourchette quand la qualité est incertaine. ADAPTE le plan de fumure à la quantité de compost RÉELLEMENT DISPONIBLE et aux moyens déclarés : ne présente pas plusieurs tonnes comme si leur approvisionnement était garanti. Si la ressource est limitée (petit budget), demande ou estime d'abord la quantité disponible, PRIORISE les apports (concentrer au pied et aux stades clés plutôt que couvrir toute la surface) et propose de PRODUIRE le compost sur place ; dimensionne le tonnage en conséquence au lieu d'un chiffre théorique.

## 5. Semis / plantation
Date de semis conseillée selon le régime des pluies de la région ; pour une culture SENSIBLE AUX MALADIES en climat humide (ex. tomate en zone forestière), raisonne la fenêtre de plantation aussi en fonction de la PRESSION DES MALADIES — viser si possible une période moins humide, ou renforcer la protection (planches surélevées, variété tolérante, aération, prophylaxie) — sans inventer de dates locales ; pépinière puis repiquage si la culture s'y prête (durée en pépinière) ; DENSITÉ et ÉCARTEMENT (distance entre les lignes et sur la ligne) ; profondeur de semis ; et un nombre indicatif de plants ou de graines pour la surface donnée. VÉRIFIE que la densité annoncée est COHÉRENTE avec l'écartement donné (densité à l'hectare ≈ 10 000 ÷ (interligne en m × distance sur la ligne en m)) et ne te contredis pas entre l'écartement et le nombre de plants ; pour une culture sensible aux maladies, privilégie un interligne suffisant pour l'aération ; JUSTIFIE l'écartement et la densité retenus selon la VARIÉTÉ, le TUTEURAGE, la CONDUITE et le RISQUE SANITAIRE, et n'IMPOSE PAS une distance unique : explique le compromis (en climat humide, un interligne plus large améliore l'aération et réduit les maladies, mais abaisse la densité) et laisse la personne arbitrer selon son contexte.

## 6. Entretien de la culture
Démariage / éclaircissage, désherbage (sarclage manuel, paillage pour limiter les mauvaises herbes et garder l'humidité), buttage, tuteurage si nécessaire. Précise les périodes (nombre de semaines après le semis).

## 7. Fertilisation d'entretien (fertilisation raisonnée)
Raisonne la fertilisation : la BONNE dose, au BON moment, adaptée au sol, à la saison et à la variété (une même culture n'a pas les mêmes besoins sur sol pauvre ou riche, ni en saison humide ou sèche). Privilégie toujours les fumures organiques.
Si un apport minéral est nécessaire, FRACTIONNE-le (plusieurs petits apports plutôt qu'un seul gros) et relie chaque apport à un stade (reprise, pleine croissance, floraison, fructification). Pour l'AZOTE, qui est très mobile et facilement perdu : ne le mets jamais tout d'un coup, apporte-le pendant la phase de croissance, sur une parcelle PROPRE (désherbée juste avant), bien réparti, et si possible juste avant une pluie ou un arrosage pour limiter les pertes. Donne les apports en FOURCHETTES et rappelle de ne pas sur-fertiliser (gaspillage, pollution, et parfois baisse de rendement ou maladies). Pour les engrais liquides naturels (purins, thés de compost ou de fiente), propose des ressources réellement DISPONIBLES LOCALEMENT dans la zone : ne cite pas comme locale une plante qui ne l'est pas (par exemple, l'ortie et la consoude sont des plantes tempérées peu présentes en zone tropicale ; privilégie des plantes communes sur place). Quand tu n'es pas sûr de la disponibilité, dis-le et laisse le choix à la personne.
Si la personne irrigue au goutte-à-goutte, propose la FERTIGATION : dissoudre un engrais soluble dans l'eau d'irrigation et l'apporter en petites quantités fréquentes, directement près des racines — c'est plus efficace et ça gaspille beaucoup moins d'engrais.

## 8. Gestion de l'eau et irrigation
Besoin en eau par stade (la culture est plus sensible à la sécheresse à certains moments, ex. floraison et formation des fruits), et rôle de la pluie face au déficit hydrique (pluie insuffisante par rapport à l'évaporation).
Si la personne N'A PAS indiqué de mode d'irrigation, ou n'en possède pas, NE SUPPOSE RIEN : PROPOSE-lui toi-même une ou plusieurs solutions ADAPTÉES À SES MOYENS, en les classant du plus simple et économique au plus avancé, et en expliquant en une ligne le coût, l'effort et l'intérêt de chacune :
- Pluvial strict (sans arrosage) : caler le calendrier sur la saison des pluies et RETENIR l'eau — paillage épais, cuvettes/poquets (type zaï), binage, demi-lunes, brise-vent, matière organique qui garde l'humidité.
- Arrosage manuel (arrosoir, seau) tôt le matin ou en soirée, alimenté par une COLLECTE d'eau de pluie (toiture + fût, bassin, citerne) pour tenir en saison sèche.
- Goutte-à-goutte « maison » très peu coûteux : bouteilles ou bidons percés près du pied, poteries enterrées (ollas) — idéal pour peu de moyens et peu de surface.
- Goutte-à-goutte ou petite aspersion avec du matériel acheté si le budget le permet : c'est le plus économe en eau et le plus régulier.
Recommande EN PRIORITÉ la solution la plus réaliste au vu de ses moyens et de la surface indiquée, puis dis vers quoi il pourra évoluer plus tard. Dans tous les cas, rappelle les gestes d'économie d'eau (paillage, arrosage aux heures fraîches) et ADAPTE le reste de l'itinéraire (date de semis, densité, choix de variété plus résistante à la sécheresse) à l'eau réellement disponible.

## 9. Protection phytosanitaire (lutte intégrée)
Principaux ravageurs et maladies de cette culture dans la région, et les signes à surveiller. Présente-les avec le BON niveau de certitude, en distinguant : un RISQUE GÉNÉRAL associé à la culture ; un risque PLAUSIBLE selon les conditions locales (saison, humidité, zone) ; un problème EFFECTIVEMENT OBSERVÉ sur la parcelle ; un DIAGNOSTIC CONFIRMÉ par des éléments suffisants. Ne présente jamais une maladie comme présente sur la parcelle au seul motif qu'elle est connue sur cette culture — utilise « risque à surveiller », « problème possible selon les conditions locales », « diagnostic à confirmer par l'observation ou une analyse adaptée ». Un diagnostic ferme demande une OBSERVATION de terrain : invite la personne à confirmer en observant les symptômes, et renvoie au DIAGNOSTIC PAR PHOTO de l'application en cas de doute. Ne présente pas un produit comme « autorisé localement » sans vérification. Présente la protection dans CET ORDRE : d'abord la PRÉVENTION (rotation des cultures, variétés résistantes, hygiène de la parcelle, associations de cultures) ; ensuite la lutte BIOLOGIQUE et les préparations NATURELLES (ex. savon noir, extrait de neem, cendre, plantes répulsives, auxiliaires) ; et seulement EN DERNIER RECOURS un produit chimique, à dose prudente et avec les précautions d'usage. Ne donne jamais de conseil dangereux pour la santé ou l'environnement.
PRÉPARATIONS NATURELLES — ENCADREMENT OBLIGATOIRE : ne présente JAMAIS une préparation naturelle (neem, savon noir, ail, piment, cendre…) comme universellement efficace, inoffensive parce que « naturelle », ou utilisable sans précaution. Pour CHAQUE préparation proposée, précise : (a) le PROBLÈME CIBLÉ (ravageur ou symptôme précis — une préparation ne vaut pas contre « tout ») ; (b) le NIVEAU DE CONFIANCE en distinguant usage traditionnel, effet possible, et efficacité réellement établie, et dis-le clairement quand les preuves sont insuffisantes ou incertaines ; (c) les LIMITES et la PHYTOTOXICITÉ possible (une préparation peut brûler les feuilles ou nuire à la culture selon sa composition, sa concentration et les conditions d'application) ; (d) les effets possibles sur les AUXILIAIRES ET POLLINISATEURS, même pour une préparation naturelle — éviter les pulvérisations sur les fleurs ouvertes et pendant l'activité des pollinisateurs ; (e) un ESSAI PRÉALABLE sur quelques plantes, hors forte chaleur et plein soleil, à observer avant toute extension, et NE PAS étendre si des dégâts apparaissent ; (f) la PROTECTION de l'utilisateur adaptée au risque d'irritation (surtout ail et piment : yeux, peau, ne pas inhaler les aérosols), sans prétendre qu'un équipement garantit une sécurité absolue. N'INVENTE JAMAIS de concentration, de dose « universelle », de fréquence, de délai avant récolte, de taux d'efficacité, de résultat d'essai, de référence scientifique ni d'homologation ; quand une donnée manque (ex. délai avant récolte), signale-le et renvoie aux règles applicables au produit réellement utilisé. Points spécifiques : NEEM — l'effet dépend du produit, de sa composition, de sa préparation et du ravageur ciblé ; pas « sans danger » parce que végétal ; attention aux pollinisateurs ; pour un produit commercial, suivre l'étiquette et les règles locales. SAVON NOIR — tous les savons noirs ne conviennent pas aux plantes (composition et additifs variables, risque de phytotoxicité) ; vérifier la compatibilité avec la culture, tester sur quelques plants d'abord, ne pas appliquer sur toute la parcelle si des dégâts apparaissent. AIL ET PIMENT — efficacité variable, ne remplacent pas un diagnostic du problème ; risque d'irritation (yeux, peau) et de brûlure du feuillage, effets possibles sur des organismes non ciblés. CENDRE — pas un insecticide universel ni une solution systématique contre les maladies ; composition variable selon le matériau brûlé ; modifie le pH du sol et apporte des sels/éléments minéraux en quantités variables → sur un sol au pH INCONNU, pas d'apport important ou répété sans vérification ; jamais de cendre issue de déchets peints, traités, plastifiés ou de matériaux d'origine inconnue. Dans tous les cas : d'abord le DIAGNOSTIC (identifier le ravageur/symptôme, sinon demander une observation plus précise ou un diagnostic complémentaire) puis la PRÉVENTION ; ne conseille pas de mélanges improvisés sans compatibilité démontrée ; et pour un produit phytosanitaire commercial, privilégie un produit autorisé pour la culture et l'usage ciblés, en respectant l'étiquette et les règles locales.

## 10. Suivi des stades et reconnaître les carences
Les grands stades de la culture (levée, croissance végétative, floraison, fructification/remplissage, maturité) avec, pour chacun, un repère de durée indicatif, pour que la personne sache toujours où elle en est dans le cycle.
Apprends-lui aussi à OBSERVER les feuilles pour repérer tôt un problème — mais présente ces signes comme des INDICES À CONFIRMER, JAMAIS comme un diagnostic certain : un même symptôme peut avoir PLUSIEURS CAUSES (carence réelle, mais aussi excès ou manque d'eau, maladie, ravageur, stade de la plante, pH qui bloque l'assimilation, lessivage sur sol sableux). Pour CHAQUE signe, donne la ou les causes POSSIBLES et dis ce qu'il faut OBSERVER pour les distinguer :
- feuilles entièrement jaunes (limbe et nervures), surtout sur les vieilles feuilles du bas, plante peu vigoureuse : évoque un manque d'AZOTE, mais aussi un engorgement, un lessivage (fortes pluies sur sol sableux) ou des racines abîmées ; à distinguer en regardant l'humidité du sol, la répartition (bas ou haut de la plante) et la vigueur d'ensemble ;
- plante rabougrie, feuilles vert très foncé ou teintées de violet : évoque un manque de PHOSPHORE, mais le froid, un sol compact ou un enracinement limité donnent des signes proches ; à confronter au stade et aux conditions ;
- jeunes feuilles jaunes mais nervures restées vertes : évoque un manque de FER (ou d'un autre oligo-élément), souvent lié à un pH ÉLEVÉ qui BLOQUE l'assimilation plutôt qu'à une absence réelle dans le sol → vérifier le pH avant tout apport ;
- taches ou plages jaunes/nécrosées sur les vieilles feuilles, ou nécrose au bout des fruits : évoque un manque de CALCIUM (fréquent sur sol sableux), mais le plus souvent dû à des à-coups d'arrosage plutôt qu'à une absence de calcium dans le sol → régulariser l'eau d'abord.
Tiens compte du STADE de la culture, du TYPE DE SOL et de l'HISTORIQUE des apports avant de conclure. N'IMPOSE PAS une dose corrective précise sur la seule foi d'un symptôme : commence par l'observation (et, si besoin, la mesure du pH ou une petite analyse) ; si un apport se justifie, privilégie une correction organique prudente et renvoie, pour un intrant minéral ciblé, à une analyse ou à un technicien. Invite à utiliser le DIAGNOSTIC PAR PHOTO de l'application en cas de doute et à surveiller l'évolution sur quelques jours avant d'agir davantage.

## 11. Récolte
Les signes de maturité à reconnaître, la période indicative et la méthode de récolte pour préserver la qualité et limiter les pertes.

## 12. Après-récolte
Séchage, tri, conditionnement, stockage et réduction des pertes, pour préserver la qualité et limiter le gaspillage (la valorisation des résidus est traitée à la section suivante).

## 13. Valorisation des résidus et déchets agricoles (économie circulaire)
Section OBLIGATOIRE et PROPRE À CETTE CULTURE. Commence par citer les résidus et sous-produits que CETTE culture précise génère réellement (par exemple, selon la culture : tiges et cannes, feuilles et fanes, rafles / spathes / épis vides, cosses, balles, coques ou écales, épluchures, pulpe, écarts de tri…). Puis, pour CHACUN, propose un moyen CONCRET de le réutiliser plutôt que de le brûler ou de le jeter, en précisant QUAND, COMMENT et POURQUOI, et en allant du plus simple au plus avancé. Classe les pistes dans cet ordre de priorité :
- Retour au sol (à privilégier) : compostage en tas ou en fosse (avec un repère de durée) ; paillage avec les résidus, broyés ou hachés, pour garder l'humidité, limiter les mauvaises herbes et nourrir le sol en se décomposant ; ou enfouissement / engrais vert.
- Alimentation animale : fanes, sons, pulpes, écarts et sous-produits qui peuvent nourrir volailles, petits ruminants ou porcs — en précisant lesquels conviennent et sous quelle forme (frais, séché, bouilli).
- Énergie et autres usages : biochar (charbon vert) obtenu à partir des résidus ligneux, excellent pour améliorer durablement le sol ; briquettes ou combustible ; substrat pour culture de champignons ; litière ; ou biométhanisation (biogaz + jus de digestion comme engrais) si la personne en a les moyens.
- Petit revenu : sous-produits vendables (coques, son, compost en surplus, fourrage) selon le contexte local.
Explique à chaque fois l'intérêt en une phrase (moins de déchets, un sol nourri gratuitement, une économie ou un revenu en plus). DÉCONSEILLE clairement le brûlage des résidus comme pratique par défaut : il détruit la matière organique, appauvrit le sol et pollue. Adapte toutes les propositions aux moyens locaux (Côte d'Ivoire) et à la quantité réellement disponible sur la surface indiquée.

## 14. Biodiversité, associations et services écosystémiques
Section OBLIGATOIRE, dans l'esprit des agrosystèmes durables. Traite concrètement, pour CETTE culture et ce contexte :
- ASSOCIATIONS DE CULTURES (plantes compagnes) : propose 1 à 3 associations bénéfiques et dis POURQUOI (ex. une légumineuse comme le niébé ou le haricot qui fixe l'azote et enrichit le sol pour une céréale ; une plante répulsive qui éloigne certains ravageurs ; une plante couvre-sol qui limite les mauvaises herbes). Donne l'agencement (lignes alternées, bordures…).
- ROTATION DES CULTURES : que cultiver AVANT et APRÈS cette culture sur la même parcelle, et pourquoi (couper le cycle des ravageurs/maladies, alterner cultures gourmandes et cultures qui restituent, éviter d'épuiser le sol).
- BIODIVERSITÉ FONCTIONNELLE : gestes simples pour attirer les AUXILIAIRES et POLLINISATEURS utiles (haies, bandes fleuries, zones non cultivées, refuges) et pour protéger la VIE DU SOL (vers de terre, bactéries, mycorhizes) — matière organique, sol couvert, travail du sol limité.
- COUVERTURE DU SOL ET AGROFORESTERIE quand c'est pertinent : plantes de couverture entre les cycles, arbres ou arbustes utiles en bordure/association (ombrage, azote, fourrage, bois, fruits) pour un système plus résilient.
- SERVICES RENDUS : rappelle en une phrase ce que ces choix apportent (fertilité entretenue, moins de ravageurs, meilleure rétention d'eau, pollinisation, résilience au climat).

## 15. Climat et stockage de carbone
En quelques lignes simples : comment cet itinéraire aide la parcelle à STOCKER du carbone dans le sol et la biomasse (matière organique, compost, couverture végétale, non-brûlage des résidus, agroforesterie) et à mieux RÉSISTER au changement climatique (sécheresses, pluies violentes). Indique, en ordre de grandeur et en restant prudent (fourchette, jamais de chiffre inventé précis), que les pratiques agroécologiques peuvent séquestrer du carbone et réduire les émissions par rapport à une conduite avec brûlage et beaucoup d'intrants chimiques. Relie cela à un bénéfice concret pour la personne (sol plus fertile et plus vivant, qui retient mieux l'eau).

## 16. Rendement attendu et repères économiques
Une FOURCHETTE réaliste de rendement (en précisant l'unité, ex. t/ha, ou une estimation sur la surface indiquée), présentée comme un POTENTIEL INDICATIF et non une promesse : le rendement réel varie fortement selon le sol, la saison, la variété et la conduite. Tiens compte des CONTRAINTES réelles déclarées (culture pluviale, sol pauvre, petits moyens, arrosage manuel, forte pression de maladies) qui tirent souvent le rendement vers le BAS de la fourchette : présente alors le rendement en TROIS SCÉNARIOS — PRUDENT, INTERMÉDIAIRE, FAVORABLE — en explicitant pour CHACUN les HYPOTHÈSES qui le portent (pression sanitaire, eau réellement disponible, moyens techniques, fertilité, variété). En conditions contraintes (pluvial, sol pauvre, petits moyens), le scénario PRUDENT doit servir de repère principal, et le scénario favorable rester une exception à ne PAS présenter comme attendue (ne gonfle pas le plafond). Si tu ne disposes pas de RÉFÉRENCES LOCALES fiables pour chiffrer solidement, DIS-LE explicitement et donne des ordres de grandeur prudents au lieu d'imposer une fourchette ; n'invente aucun chiffre précis et ne remplace pas une fourchette par une autre sans base. Ajoute les bénéfices durables de l'approche (sol vivant, moins d'eau, moins de produits chimiques, meilleurs revenus dans la durée).
BUDGET PRÉVISIONNEL : n'invente JAMAIS de prix local. Construis un tableau que le producteur complétera avec ses prix réels, pour la superficie indiquée. Colonnes exactes :
| Poste | Quantité prévue | Unité | Prix unitaire | Coût total | Origine du prix | Vérifié / Estimé |
Postes (adapte-les à la culture) : Semences ou plants ; Fertilisation et amendements ; Protection phytosanitaire ; Irrigation ; Matériel et équipements ; Main-d'œuvre ; Transport ; Emballage et commercialisation ; Autres charges. Reporte dans « Quantité prévue » les quantités DÉJÀ calculées plus haut (cohérence obligatoire) ; laisse « Prix unitaire » et « Coût total » à compléter quand tu n'as pas de prix fiable, et marque la ligne « Estimé » tant que le producteur n'a pas donné son prix (« Vérifié » seulement s'il l'a fourni). SÉPARE les coûts d'INVESTISSEMENT (matériel durable) des CHARGES du cycle, évite de compter deux fois le même coût, et signale les postes souvent OUBLIÉS (transport, emballage, pertes).
Seulement SI des prix sont fournis, calcule et montre : Coût total de production = somme des charges retenues ; Chiffre d'affaires brut = quantité commercialisable (ou rendement estimé) × prix de vente ; Marge prévisionnelle = chiffre d'affaires − charges incluses. Précise ce qui est EXCLU du calcul (main-d'œuvre familiale, amortissement du matériel, pertes post-récolte…). Au besoin, propose trois scénarios : prudent, intermédiaire, favorable. Ne présente JAMAIS une marge estimée comme un bénéfice garanti, et rappelle les hypothèses qui influencent le résultat (les prix changent selon le marché et la saison). DIS-LE clairement : la MARGE PRÉVISIONNELLE n'est pas le BÉNÉFICE RÉEL — elle ne compte que les charges retenues ; la main-d'œuvre familiale, l'amortissement du matériel et les pertes post-récolte en sont souvent exclus et réduiraient le bénéfice réel.

## 17. Calendrier récapitulatif
Un TABLEAU Markdown clair qui résume, par période (semaine par semaine ou mois par mois, à partir du semis/plantation), les opérations clés. Utilise exactement ces colonnes :
| Période | Opération | À faire concrètement |
C'est la feuille de route que la personne pourra suivre tout au long de la saison. Si une date ou une saison de démarrage est fournie, cale le calendrier dessus ; si la date de plantation n'est PAS renseignée, exprime la colonne « Période » en repères RELATIFS au stade (ex. « semaine 0 : semis », « 2 semaines après semis », « floraison ») plutôt que d'inventer des dates précises.

## 18. Résumé opérationnel (à lire en premier)
Une synthèse COURTE et actionnable qui reprend l'essentiel de l'itinéraire ci-dessus, en cinq blocs clairs (ne répète pas tout le détail, renvoie aux sections correspondantes) :
- LES 5 PREMIÈRES ACTIONS à réaliser, dans l'ordre (la toute première chose à faire, puis les suivantes).
- LES INFORMATIONS MANQUANTES qui amélioreraient le conseil (ex. pH, pluviométrie locale, ravageur observé) et comment les obtenir simplement.
- LES RISQUES PRIORITAIRES à surveiller (climat, ravageur ou maladie clé, carence probable) et le signe qui doit alerter.
- LES RESSOURCES NÉCESSAIRES : intrants et QUANTITÉS à prévoir (semences, compost, matériel d'irrigation, main-d'œuvre), adaptées à la surface indiquée.
- LES DÉPENSES À ANTICIPER : les principaux postes de coût à prévoir (sans inventer de prix).
- LES INDICATEURS DE SUIVI simples pour savoir si la culture va bien (levée, couleur des feuilles, stade atteint, présence de ravageurs).
- LES DÉCISIONS EN ATTENTE : ce qui doit attendre une mesure ou une validation technique (ex. dose de chaux après analyse de pH, dose minérale après analyse de sol).

RÈGLES IMPORTANTES :
- Reste réaliste et honnête sur les incertitudes (climat, ravageurs, variétés réellement disponibles localement) ; n'invente jamais de chiffres précis, donne des fourchettes.
- Adapte TOUT aux moyens locaux (Côte d'Ivoire, matériaux et intrants disponibles sur place).
- Langage simple et accessible, sans jargon inutile ; quand tu emploies un terme technique, explique-le en quelques mots.
- Privilégie toujours les solutions durables et agroécologiques.
- Produis les 18 sections dans l'ordre (## 1 à ## 18) ; ne mets aucune introduction avant la première section ## 1, et termine par le résumé opérationnel (## 18).
- COMPLÉTUDE OBLIGATOIRE : l'itinéraire doit TOUJOURS être rendu ENTIER, du ## 1 jusqu'au résumé ## 18 inclus. Sois complet mais CONCIS : phrases courtes, pas de redites entre sections (renvoie à une autre section plutôt que de répéter). Garde de la place pour la fin : si une section s'allonge, resserre-la pour être certain de toujours terminer le calendrier (## 17) ET le résumé opérationnel (## 18). Ne t'arrête jamais en milieu de section ou de tableau.`;
}
// Conversion déterministe de la surface saisie (texte libre) en hectares.
// Sert à fournir à l'IA une valeur fiable et à refuser les surfaces invalides.
function parseArea(raw) {
  if (raw == null || String(raw).trim() === "") return { ok: false, reason: "non précisée" };
  const s = String(raw).toLowerCase().replace(/,/g, ".").trim();
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return { ok: false, reason: "aucune valeur numérique" };
  const val = parseFloat(m[0]);
  if (!isFinite(val) || val <= 0) return { ok: false, reason: "valeur nulle ou négative" };
  let ha;
  if (/\bha\b|hectare/.test(s)) ha = val;                 // hectares
  else if (/\bares?\b/.test(s)) ha = val / 100;           // 1 are = 0,01 ha
  else if (/m²|m2|m\^2|m[eè]tre/.test(s)) ha = val / 10000; // 1 ha = 10 000 m²
  else return { ok: false, reason: "unité non reconnue (préciser m² ou ha)" };
  const m2 = Math.round(ha * 10000);
  let haStr = ha >= 1 ? (Number.isInteger(ha) ? String(ha) : ha.toFixed(2))
                      : ha.toFixed(ha < 0.01 ? 4 : 3);
  haStr = haStr.replace(/\.?0+$/, "");
  return { ok: true, ha, m2, haStr };
}
function planUserMessage(p) {
  const a = parseArea(p.area);
  let surfaceLine;
  if (a.ok) {
    surfaceLine = `- Surface : ${p.area} (valeur convertie par l'application : ${a.haStr} ha = ${a.m2} m² — UTILISE cette conversion pour TOUS les calculs de quantité)`;
  } else if (p.area && String(p.area).trim() !== "") {
    surfaceLine = `- Surface : ${p.area} — ATTENTION : superficie inexploitable pour le calcul (${a.reason}) ; NE CALCULE AUCUNE quantité totale dépendant de la surface et demande une valeur valide (ex. « 500 m² » ou « 1 ha »)`;
  } else {
    surfaceLine = `- Surface : non précisée — NE CALCULE AUCUNE quantité totale dépendant de la surface ; demande la superficie et son unité`;
  }
  return `Voici ma parcelle :
- Culture souhaitée : ${p.crop}
- Région / localité : ${p.region || "non précisée"}
${surfaceLine}
- Type de sol : ${p.soil || "non précisé"}
- pH du sol : ${p.ph ? p.ph : "non précisé (la personne n'a pas cette valeur)"}
- Saison / période de démarrage : ${p.season || "non précisée"}
- Mode de conduite souhaité : ${p.mode || "non précisé (propose une approche agroécologique adaptée)"}
- Structure de culture souhaitée : ${p.structure || "non précisée"}
- Objectif principal : ${p.goal || "produire durablement"}
- Moyens / contraintes : ${p.notes || "aucun détail supplémentaire"}

Rédige mon itinéraire technique de culture complet.`;
}
// Langues locales proposées (traduction best-effort par l'IA).
const CHAT_LANGS = {
  fr: null,
  dioula: "dioula (jula)",
  baoule: "baoulé",
  bete: "bété",
  senoufo: "sénoufo",
  agni: "agni",
  malinke: "malinké",
};
function advisorSystem(plan, lang) {
  let s = DURABLE_CONTEXT + `

Tu réponds aux questions de l'agriculteur au fil de sa saison : diagnostic de problèmes (à partir de sa description : feuilles jaunes, taches, insectes, sol…), conseils d'arrosage, de fertilisation naturelle, de protection biologique, de récolte. Réponses courtes, concrètes, pas à pas. Si un symptôme peut avoir plusieurs causes, propose comment les distinguer. Termine par l'action durable la plus simple à essayer en premier.`;
  if (plan) s += `\n\nContexte de sa parcelle : culture « ${plan.crop} », région « ${plan.region || "?"} », sol « ${plan.soil || "?"} », saison « ${plan.season || "?"} ».`;
  const lname = lang && CHAT_LANGS[lang];
  if (lname) {
    s += `\n\nLANGUE : réponds en ${lname} (une langue de Côte d'Ivoire), dans un langage simple et parlé. C'est une aide de compréhension, pas une traduction officielle : si tu n'es pas sûr d'un mot technique, garde le terme en français entre parenthèses. Reste fidèle au conseil agronomique. Ne préviens pas que tu traduis, réponds directement.`;
  }
  return s;
}

// ---------- Automatisation agricole (Arduino) ----------
function arduinoSystem() {
  return `Tu es un FORMATEUR en électronique pratique et en automatisation pour l'AGRICULTURE DURABLE, à l'aise avec Arduino, au service d'agriculteurs d'Afrique de l'Ouest (notamment la Côte d'Ivoire). Tu t'adresses à des personnes qui débutent en électronique : sois clair, concret, bienveillant, en français simple, et explique chaque terme technique en quelques mots.

TÂCHE : à partir du BESOIN d'automatisation décrit par la personne (ex. arroser automatiquement quand la terre est sèche, surveiller une serre, alerter en cas de gel, surveiller le niveau d'une cuve d'eau…), produis un PROJET ARDUINO COMPLET et prêt à réaliser, en français, au format Markdown. Écris de façon sobre et professionnelle, sans emojis ni icônes.

Respecte EXACTEMENT ces sections (titres en ##), dans cet ordre :

## 1. Ce que fait ce montage
En quelques phrases simples : le principe, ce que la personne va obtenir, et en quoi c'est utile et durable (ex. économie d'eau, intervention au bon moment).

## 2. Matériel nécessaire
Une LISTE à puces : chaque composant, son rôle en une phrase, et une précision utile (ex. capteur d'humidité CAPACITIF de préférence, car il ne rouille pas). Rappelle les précautions : un actionneur de puissance (pompe, électrovanne, ventilateur) a TOUJOURS sa PROPRE alimentation et passe PAR UN RELAIS — jamais directement sur une broche de l'Arduino (trop de courant). Reste sur du matériel courant et peu coûteux, disponible localement.

## 3. Le câblage (où brancher chaque fil)
Explique broche par broche, en texte clair, où va chaque fil (ex. « le fil de signal du capteur → broche A0 »). Donne des repères simples (VCC = +, GND = masse/−). Mentionne une LED témoin + sa résistance 220 Ω si c'est utile.

## 4. Le programme Arduino (sketch)
Donne le sketch COMPLET dans UN SEUL bloc de code délimité par trois accents graves et le mot cpp (\`\`\`cpp … \`\`\`). Le code doit être ABONDAMMENT COMMENTÉ en français (comme un cours), avec :
- un en-tête qui rappelle le but, le matériel et la sécurité ;
- des constantes de RÉGLAGE clairement regroupées et expliquées (seuils, durées, pauses…), faciles à calibrer ;
- setup() et loop() expliqués ;
- l'affichage de mesures sur le moniteur série (Serial) pour que la personne comprenne ce qui se passe ;
- des sécurités (ex. ne pas faire tourner la pompe à vide, respecter une pause mini entre deux actions).
Le code doit compiler tel quel pour une carte Arduino Uno et rester simple à lire.

## 5. Tester puis installer
Explique comment TESTER d'abord en simulation sur Wokwi (créer un nouveau projet Arduino Uno, coller le sketch, lancer la simulation) AVANT de câbler le vrai matériel ; puis comment téléverser le sketch sur la vraie carte avec le logiciel Arduino, et où placer capteurs et actionneurs au champ.

## 6. Réglages à calibrer et sécurité
Comment calibrer les seuils sur SA terre / SA situation (ex. lire la valeur du capteur quand c'est sec puis humide et choisir un seuil entre les deux). Rappelle les précautions d'eau + électricité (protéger les connexions de la pluie, alimentation adaptée, pompe via relais).

## 7. Aller plus loin
2 ou 3 améliorations concrètes et utiles (ex. ajouter un capteur de pluie, un capteur de niveau de cuve, une plage horaire d'arrosage, l'envoi d'une alerte), en une ligne chacune.

RÈGLE SPÉCIALE — ARROSAGE : si le besoin concerne l'arrosage automatique, fais un montage ENRICHI (pas seulement l'humidité du sol). Intègre, quand c'est pertinent, PLUSIEURS paramètres et explique chacun : humidité du sol (capteur capacitif), détection de PLUIE (ne pas arroser s'il pleut), température et humidité de l'air (capteur DHT — arroser de préférence aux heures fraîches pour limiter l'évaporation), NIVEAU de la cuve d'eau (sécurité : ne pas faire tourner la pompe à vide), PLAGE HORAIRE d'arrosage (éviter midi), durée d'arrosage et pause minimale entre deux arrosages, LED témoin et journal série. Garde le code lisible et bien commenté malgré ces ajouts.

RÈGLES GÉNÉRALES :
- Reste réaliste et prudent ; ne propose jamais de montage dangereux (eau + secteur 220 V sans précautions, etc.).
- Adapte aux moyens locaux (composants courants, petit budget).
- Langage simple, pédagogique.
- Ne mets aucune introduction avant la première section ## 1.`;
}
function arduinoUserMessage(d) {
  return `Voici le projet d'automatisation que je veux réaliser :
- Type de projet : ${d.kind || "non précisé"}
- Région / secteur : ${d.sector || "non précisé"}
- Ce que je veux automatiser (en détail) : ${d.need || "non précisé"}
- Mon matériel ou mes contraintes : ${d.gear || "non précisé"}

Rédige le projet Arduino complet, avec le sketch commenté.`;
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
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const crop = String(p.crop || "").trim().slice(0, 120);
  if (!crop) return sendJson(res, 400, { error: "Indiquez au moins la culture souhaitée." });
  const clean = { crop, region: String(p.region || "").slice(0, 120), area: String(p.area || "").slice(0, 80), soil: String(p.soil || "").slice(0, 80), ph: String(p.ph || "").slice(0, 40), season: String(p.season || "").slice(0, 80), mode: String(p.mode || "").slice(0, 80), structure: String(p.structure || "").slice(0, 80), goal: String(p.goal || "").slice(0, 120), notes: String(p.notes || "").slice(0, 500) };
  const fresh = p.fresh === true || p.fresh === "1" || p.fresh === 1;

  // 1) RÉUTILISATION : un itinéraire existe-t-il déjà pour cette culture dans ce secteur ?
  //    Si oui (et que la personne n'a pas demandé expressément un nouveau), on le ressert
  //    immédiatement — gratuit, instantané, sans toucher la limite ni le coût IA.
  if (!fresh) {
    try {
      const existing = await findSharedPlan(crop, clean.region);
      if (existing && existing.content) return sendJson(res, 200, { plan: existing, reused: true, sector: clean.region || null });
    } catch (e) { /* en cas de souci de lecture, on bascule simplement sur la génération */ }
  }

  // 2) GÉNÉRATION par l'IA (compte dans la limite journalière et dans le coût).
  if (!rateOk("plan:" + user.id, 20, 24 * 60 * 60 * 1000)) return sendJson(res, 429, { error: "Vous avez généré beaucoup de plans aujourd'hui. Reprenez plus tard." });
  try {
    const content = await callClaude(planSystem(), [{ role: "user", content: planUserMessage(clean) }], null, PLAN_MAX_TOKENS);
    const rec = { id: newId(), user_id: user.id, title: crop + (clean.region ? " — " + clean.region : ""), crop, region: clean.region || null, area: clean.area || null, soil: clean.soil || null, season: clean.season || null, goal: clean.goal || null, notes: clean.notes || null, content, created_at: new Date().toISOString() };
    await savePlan(rec);
    sendJson(res, 200, { plan: rec, reused: false });
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
// --- Parcelles enregistrées ---
async function handleParcelsList(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Non connecté." });
  const rows = await listParcelsForUser(user.id);
  // Normalise geom (texte JSON en base, objet en local) pour renvoyer toujours un objet zone.
  const parcels = (rows || []).map((p) => { let z = p.geom; if (typeof z === "string") { try { z = JSON.parse(z); } catch (e) { z = null; } } return { id: p.id, name: p.name, zone: cleanZone(z), created_at: p.created_at }; }).filter((p) => p.zone);
  sendJson(res, 200, { parcels });
}
async function handleParcelSave(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Connectez-vous pour enregistrer une parcelle." });
  if (!rateOk("parcel:" + user.id, 60, 24 * 60 * 60 * 1000)) return sendJson(res, 429, { error: "Trop d'enregistrements aujourd'hui." });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const zone = cleanZone(p.zone);
  if (!zone) return sendJson(res, 400, { error: "Dessinez d'abord une parcelle valide sur la carte." });
  const name = (String(p.name || "").trim().slice(0, 80)) || ("Parcelle " + new Date().toLocaleDateString("fr-FR"));
  const rec = { id: newId(), user_id: user.id, name, geom: JSON.stringify(zone), created_at: new Date().toISOString() };
  await saveParcel(rec);
  sendJson(res, 200, { parcel: { id: rec.id, name, zone, created_at: rec.created_at } });
}
async function handleParcelDelete(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Non connecté." });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  if (!p.id) return sendJson(res, 400, { error: "Parcelle manquante." });
  await deleteParcel(user.id, String(p.id));
  sendJson(res, 200, { ok: true });
}
// --- Coopérative ---
async function coopPublic(coop) { return coop ? { id: coop.id, name: coop.name, region: coop.region || null, code: coop.code, created_at: coop.created_at } : null; }
async function handleCoopMe(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Non connecté." });
  const m = await getMembership(user.id);
  if (!m) return sendJson(res, 200, { coop: null, animator: isAnimator(user) });
  const coop = await getCoopById(m.coop_id);
  if (!coop) { await removeMembership(user.id); return sendJson(res, 200, { coop: null, animator: isAnimator(user) }); }
  const members = await listCoopMembers(coop.id);
  let animateur = null; try { const a = members.find((x) => x.role === "animateur"); if (a) { const au = await getUserById(a.user_id); animateur = au ? (au.name || au.email) : null; } } catch (e) {}
  sendJson(res, 200, { coop: await coopPublic(coop), role: m.role, membersCount: members.length, animateur, isAnimateur: m.role === "animateur", animator: isAnimator(user) });
}
async function handleCoopCreate(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Connectez-vous pour créer une coopérative." });
  if (!isAnimator(user)) return sendJson(res, 403, { error: "Seul un animateur désigné par Terravive peut créer une coopérative. Demandez l'accès au responsable." });
  if (await getMembership(user.id)) return sendJson(res, 400, { error: "Vous faites déjà partie d'une coopérative. Quittez-la d'abord." });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const name = String(p.name || "").trim().slice(0, 100); if (name.length < 2) return sendJson(res, 400, { error: "Donnez un nom à la coopérative." });
  let code; for (let i = 0; i < 6; i++) { code = coopCode(); if (!(await getCoopByCode(code))) break; }
  const coop = { id: newId(), name, region: String(p.region || "").trim().slice(0, 100) || null, code, owner_id: user.id, created_at: new Date().toISOString() };
  await createCoop(coop);
  await addMembership({ id: newId(), coop_id: coop.id, user_id: user.id, role: "animateur", joined_at: new Date().toISOString() });
  sendJson(res, 200, { coop: await coopPublic(coop), role: "animateur" });
}
async function handleCoopJoin(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Connectez-vous pour rejoindre une coopérative." });
  if (await getMembership(user.id)) return sendJson(res, 400, { error: "Vous faites déjà partie d'une coopérative." });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const coop = await getCoopByCode(p.code);
  if (!coop) return sendJson(res, 404, { error: "Code de coopérative introuvable. Vérifiez auprès de votre animateur." });
  await addMembership({ id: newId(), coop_id: coop.id, user_id: user.id, role: "membre", joined_at: new Date().toISOString() });
  sendJson(res, 200, { coop: await coopPublic(coop), role: "membre" });
}
async function handleCoopLeave(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Non connecté." });
  const m = await getMembership(user.id); if (!m) return sendJson(res, 200, { ok: true });
  const members = await listCoopMembers(m.coop_id);
  if (m.role === "animateur" && members.length > 1) return sendJson(res, 400, { error: "En tant qu'animateur, vous ne pouvez pas quitter tant qu'il reste des membres. Transférez d'abord ou retirez les membres." });
  await removeMembership(user.id);
  if (members.length <= 1) { try { if (USE_DB) await sb(`/trv_coops?id=eq.${encodeURIComponent(m.coop_id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); else { const s = loadStore(); delete s.coops[m.coop_id]; saveStore(s); } } catch (e) {} }
  sendJson(res, 200, { ok: true });
}
async function handleCoopOverview(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Non connecté." });
  const m = await getMembership(user.id); if (!m) return sendJson(res, 404, { error: "Aucune coopérative." });
  if (m.role !== "animateur") return sendJson(res, 403, { error: "Réservé à l'animateur de la coopérative." });
  const coop = await getCoopById(m.coop_id);
  const rows = await listCoopMembers(m.coop_id);
  const members = []; const cropAgg = {}; let totalParcels = 0;
  for (const mem of rows) {
    let u = null; try { u = await getUserById(mem.user_id); } catch (e) {}
    const st = await memberStats(mem.user_id);
    totalParcels += st.parcels;
    st.crops.forEach((c) => { cropAgg[c] = (cropAgg[c] || 0) + 1; });
    members.push({ id: mem.user_id, name: (u && u.name) || "—", region: (u && u.region) || null, role: mem.role, plans: st.plans, parcels: st.parcels, lastCrop: st.lastCrop, joined_at: mem.joined_at });
  }
  const cultures = Object.keys(cropAgg).map((c) => ({ culture: c, membres: cropAgg[c] })).sort((a, b) => b.membres - a.membres);
  sendJson(res, 200, { coop: await coopPublic(coop), totals: { membres: rows.length, parcelles: totalParcels, cultures: cultures.length }, members, cultures });
}
// --- Kit de l'animateur : gérer les itinéraires des membres (même sans téléphone) ---
async function animateurMemberCoop(user, memberId) {
  if (!user || !memberId) return null;
  const m = await getMembership(user.id);
  if (!m || m.role !== "animateur") return null;
  const members = await listCoopMembers(m.coop_id);
  if (!members.some((x) => x.user_id === memberId)) return null;
  return m.coop_id;
}
async function handleCoopMemberPlans(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Non connecté." });
  const memberId = new URL(req.url, "http://x").searchParams.get("memberId");
  if (!(await animateurMemberCoop(user, memberId))) return sendJson(res, 403, { error: "Membre introuvable dans votre coopérative." });
  sendJson(res, 200, { plans: await listPlansForUser(memberId) });
}
async function handleCoopMemberPlanGet(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Non connecté." });
  const u = new URL(req.url, "http://x"); const memberId = u.searchParams.get("memberId"); const id = u.searchParams.get("id");
  if (!(await animateurMemberCoop(user, memberId))) return sendJson(res, 403, { error: "Accès refusé." });
  const plan = id ? await getPlan(id) : null;
  if (!plan || plan.user_id !== memberId) return sendJson(res, 404, { error: "Itinéraire introuvable." });
  sendJson(res, 200, { plan });
}
async function handleCoopMemberPlanCreate(req, res) {
  if (!API_KEY) return sendJson(res, 500, { error: "Clé IA manquante (ANTHROPIC_API_KEY)." });
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Non connecté." });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const memberId = String(p.memberId || "");
  if (!(await animateurMemberCoop(user, memberId))) return sendJson(res, 403, { error: "Membre introuvable dans votre coopérative." });
  const crop = String(p.crop || "").trim().slice(0, 120);
  if (!crop) return sendJson(res, 400, { error: "Indiquez au moins la culture." });
  if (!rateOk("coopplan:" + user.id, 40, 24 * 60 * 60 * 1000)) return sendJson(res, 429, { error: "Beaucoup d'itinéraires générés aujourd'hui. Reprenez plus tard." });
  const clean = { crop, region: String(p.region || "").slice(0, 120), area: String(p.area || "").slice(0, 80), soil: String(p.soil || "").slice(0, 80), ph: String(p.ph || "").slice(0, 40), season: String(p.season || "").slice(0, 80), mode: String(p.mode || "").slice(0, 80), structure: String(p.structure || "").slice(0, 80), goal: String(p.goal || "").slice(0, 120), notes: String(p.notes || "").slice(0, 500) };
  let content = null, reused = false;
  try { const ex = await findSharedPlan(crop, clean.region); if (ex && ex.content) { content = ex.content; reused = true; } } catch (e) {}
  try {
    if (!content) content = await callClaude(planSystem(), [{ role: "user", content: planUserMessage(clean) }], null, PLAN_MAX_TOKENS);
    const rec = { id: newId(), user_id: memberId, title: crop + (clean.region ? " — " + clean.region : ""), crop, region: clean.region || null, area: clean.area || null, soil: clean.soil || null, season: clean.season || null, goal: clean.goal || null, notes: clean.notes || null, content, created_at: new Date().toISOString() };
    await savePlan(rec);
    sendJson(res, 200, { plan: rec, reused });
  } catch (e) { sendJson(res, e.status || 500, { error: e.message || "La génération a échoué." }); }
}
// --- Coopérative : matériel partagé + achats groupés (handlers) ---
async function coopCtx(req) {
  const user = await currentUser(req);
  if (!user) return { code: 401, error: "Connectez-vous." };
  const m = await getMembership(user.id);
  if (!m) return { code: 400, error: "Vous ne faites pas partie d'une coopérative." };
  return { user, m };
}
async function userNameMap(coopId) {
  const map = {};
  try { const members = await listCoopMembers(coopId); for (const mm of members) { let u = null; try { u = await getUserById(mm.user_id); } catch (e) {} map[mm.user_id] = (u && (u.name || u.email)) || "Membre"; } } catch (e) {}
  return map;
}
// Matériel partagé
async function handleEquipList(req, res) {
  const c = await coopCtx(req); if (c.error) return sendJson(res, c.code, { error: c.error });
  const names = await userNameMap(c.m.coop_id);
  const items = (await listEquipment(c.m.coop_id)).map((e) => ({ id: e.id, name: e.name, kind: e.kind || null, note: e.note || null, ownerName: names[e.owner_id] || "Membre", isOwner: e.owner_id === c.user.id, created_at: e.created_at }));
  const resas = (await listResa(c.m.coop_id)).map((r) => ({ id: r.id, equipment_id: r.equipment_id, equipment_name: r.equipment_name || null, byName: names[r.user_id] || "Membre", isMine: r.user_id === c.user.id, date_from: r.date_from, date_to: r.date_to || null, note: r.note || null, status: r.status, created_at: r.created_at }));
  sendJson(res, 200, { items, resas, isAnimateur: c.m.role === "animateur" });
}
async function handleEquipAdd(req, res) {
  const c = await coopCtx(req); if (c.error) return sendJson(res, c.code, { error: c.error });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const name = String(p.name || "").trim().slice(0, 100); if (name.length < 2) return sendJson(res, 400, { error: "Donnez un nom au matériel." });
  const rec = { id: newId(), coop_id: c.m.coop_id, owner_id: c.user.id, name, kind: String(p.kind || "").trim().slice(0, 60) || null, note: String(p.note || "").trim().slice(0, 300) || null, status: "dispo", created_at: new Date().toISOString() };
  await addEquipment(rec); sendJson(res, 200, { ok: true, id: rec.id });
}
async function handleEquipDelete(req, res) {
  const c = await coopCtx(req); if (c.error) return sendJson(res, c.code, { error: c.error });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const eq = await getEquipment(String(p.id || ""));
  if (!eq || eq.coop_id !== c.m.coop_id) return sendJson(res, 404, { error: "Matériel introuvable." });
  if (eq.owner_id !== c.user.id && c.m.role !== "animateur") return sendJson(res, 403, { error: "Seul le propriétaire ou l'animateur peut retirer ce matériel." });
  await deleteEquipment(eq.id); sendJson(res, 200, { ok: true });
}
async function handleEquipReserve(req, res) {
  const c = await coopCtx(req); if (c.error) return sendJson(res, c.code, { error: c.error });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const eq = await getEquipment(String(p.equipmentId || ""));
  if (!eq || eq.coop_id !== c.m.coop_id) return sendJson(res, 404, { error: "Matériel introuvable." });
  const from = String(p.from || "").slice(0, 20); if (!from) return sendJson(res, 400, { error: "Indiquez au moins la date souhaitée." });
  const rec = { id: newId(), coop_id: c.m.coop_id, equipment_id: eq.id, equipment_name: eq.name, user_id: c.user.id, date_from: from, date_to: String(p.to || "").slice(0, 20) || null, note: String(p.note || "").trim().slice(0, 200) || null, status: "demandée", created_at: new Date().toISOString() };
  await addResa(rec); sendJson(res, 200, { ok: true, id: rec.id });
}
async function handleEquipResaUpdate(req, res) {
  const c = await coopCtx(req); if (c.error) return sendJson(res, c.code, { error: c.error });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const resa = await getResa(String(p.id || ""));
  if (!resa || resa.coop_id !== c.m.coop_id) return sendJson(res, 404, { error: "Réservation introuvable." });
  const status = String(p.status || ""); const allowed = ["acceptée", "refusée", "annulée", "terminée"];
  if (allowed.indexOf(status) < 0) return sendJson(res, 400, { error: "Statut invalide." });
  const eq = await getEquipment(resa.equipment_id);
  const isOwner = !!(eq && eq.owner_id === c.user.id); const isRequester = resa.user_id === c.user.id; const isAnim = c.m.role === "animateur";
  if (status === "annulée") { if (!isRequester && !isAnim) return sendJson(res, 403, { error: "Accès refusé." }); }
  else { if (!isOwner && !isAnim) return sendJson(res, 403, { error: "Seul le propriétaire du matériel ou l'animateur peut valider." }); }
  await updateResaStatus(resa.id, status); sendJson(res, 200, { ok: true });
}
// Achats groupés
async function handleBuyList(req, res) {
  const c = await coopCtx(req); if (c.error) return sendJson(res, c.code, { error: c.error });
  const names = await userNameMap(c.m.coop_id);
  const rows = await listBuy(c.m.coop_id); const out = [];
  for (const b of rows) {
    const joins = await listBuyJoins(b.id);
    let total = 0, mine = 0; const participants = [];
    for (const j of joins) { const q = Number(j.qty) || 0; total += q; if (j.user_id === c.user.id) mine = q; participants.push({ name: names[j.user_id] || j.name || "Membre", qty: q }); }
    out.push({ id: b.id, item: b.item, unit: b.unit, deadline: b.deadline || null, note: b.note || null, status: b.status, created_at: b.created_at, creatorName: names[b.created_by] || "Membre", isCreator: b.created_by === c.user.id, total: Math.round(total * 100) / 100, mine, count: joins.length, participants });
  }
  sendJson(res, 200, { buys: out, isAnimateur: c.m.role === "animateur" });
}
async function handleBuyCreate(req, res) {
  const c = await coopCtx(req); if (c.error) return sendJson(res, c.code, { error: c.error });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const item = String(p.item || "").trim().slice(0, 100); if (item.length < 2) return sendJson(res, 400, { error: "Indiquez ce qu'on achète (ex. engrais NPK, semences de maïs)." });
  const rec = { id: newId(), coop_id: c.m.coop_id, created_by: c.user.id, item, unit: String(p.unit || "").trim().slice(0, 30) || "unité", deadline: String(p.deadline || "").slice(0, 20) || null, note: String(p.note || "").trim().slice(0, 300) || null, status: "ouvert", created_at: new Date().toISOString() };
  await addBuy(rec); sendJson(res, 200, { ok: true, id: rec.id });
}
async function handleBuyJoin(req, res) {
  const c = await coopCtx(req); if (c.error) return sendJson(res, c.code, { error: c.error });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const b = await getBuy(String(p.buyId || ""));
  if (!b || b.coop_id !== c.m.coop_id) return sendJson(res, 404, { error: "Achat groupé introuvable." });
  if (b.status !== "ouvert") return sendJson(res, 400, { error: "Cet achat groupé est clôturé." });
  let qty = Number(p.qty); if (!isFinite(qty) || qty < 0) qty = 0; qty = Math.min(qty, 1e9);
  await setBuyJoin(b.id, c.user.id, qty, c.user.name || null); sendJson(res, 200, { ok: true });
}
async function handleBuyClose(req, res) {
  const c = await coopCtx(req); if (c.error) return sendJson(res, c.code, { error: c.error });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const b = await getBuy(String(p.id || ""));
  if (!b || b.coop_id !== c.m.coop_id) return sendJson(res, 404, { error: "Achat groupé introuvable." });
  if (b.created_by !== c.user.id && c.m.role !== "animateur") return sendJson(res, 403, { error: "Seul le créateur ou l'animateur peut clôturer." });
  await updateBuyStatus(b.id, b.status === "ouvert" ? "clos" : "ouvert"); sendJson(res, 200, { ok: true });
}
async function handleBuyDelete(req, res) {
  const c = await coopCtx(req); if (c.error) return sendJson(res, c.code, { error: c.error });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const b = await getBuy(String(p.id || ""));
  if (!b || b.coop_id !== c.m.coop_id) return sendJson(res, 404, { error: "Achat groupé introuvable." });
  if (b.created_by !== c.user.id && c.m.role !== "animateur") return sendJson(res, 403, { error: "Seul le créateur ou l'animateur peut supprimer." });
  await deleteBuy(b.id); sendJson(res, 200, { ok: true });
}
async function handleChat(req, res) {
  if (!API_KEY) return sendJson(res, 500, { error: "Clé IA manquante (ANTHROPIC_API_KEY)." });
  const user = await currentUser(req);
  if (!user) return sendJson(res, 401, { error: "Connectez-vous pour poser une question." });
  if (!rateOk("chat:" + user.id, 120, 24 * 60 * 60 * 1000)) return sendJson(res, 429, { error: "Beaucoup de questions aujourd'hui — reprenez un peu plus tard." });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const q = String(p.message || "").trim(); if (!q) return sendJson(res, 400, { error: "Message vide." });
  let plan = null; if (p.planId) { const pl = await getPlan(p.planId); if (pl && pl.user_id === user.id) plan = pl; }
  const lang = (typeof p.lang === "string" && Object.prototype.hasOwnProperty.call(CHAT_LANGS, p.lang) && p.lang !== "fr") ? p.lang : null;
  const history = Array.isArray(p.history) ? p.history.slice(-8).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })) : [];
  try {
    const reply = await callClaude(advisorSystem(plan, lang), history.concat([{ role: "user", content: q.slice(0, 2000) }]));
    sendJson(res, 200, { reply });
    // Journal (après la réponse, sans bloquer) : ce que les cultivateurs cherchent à comprendre.
    logQuestion({ id: newId(), user_id: user.id, question: q.slice(0, 400), crop: (plan && plan.crop) || String(p.crop || "").slice(0, 80) || null, created_at: new Date().toISOString() });
  } catch (e) { sendJson(res, e.status || 500, { error: e.message || "La réponse a échoué." }); }
}
// ---------- Diagnostic des maladies par photo ----------
function diagnosticSystem() {
  return DURABLE_CONTEXT + `

TÂCHE : un cultivateur t'envoie une PHOTO d'une plante (feuille, tige, fruit, racine…) qui semble malade, carencée ou attaquée, parfois avec le nom de la culture et une courte description. Tu es un APPUI au diagnostic, PAS un remplaçant d'un technicien agricole.

Règles d'honnêteté, très importantes :
- Si l'image n'est pas une plante, est trop floue, trop sombre ou insuffisante pour te prononcer, dis-le simplement et explique quelle photo reprendre (ex. une feuille atteinte de près, à la lumière du jour, le dessus ET le dessous).
- Ne donne JAMAIS un diagnostic certain à partir d'une seule photo. Parle de cause PROBABLE, et propose au plus les 1 à 3 hypothèses les plus vraisemblables.
- Reste dans le contexte tropical ouest-africain / Côte d'Ivoire.
- N'invente pas de certitude et ne donne aucun conseil dangereux pour la santé ou l'environnement.

Réponds en français simple, au format Markdown, avec EXACTEMENT ces sections (titres en ##), dans cet ordre :

## Ce que je vois
Décris les symptômes visibles sur la photo (taches, couleur, trous, flétrissement, insectes, moisissure…). Si la photo ne permet pas de voir, dis-le ici et demande une meilleure photo, puis arrête-toi.

## Cause probable
La ou les hypothèses les plus vraisemblables (maladie fongique, bactérienne, virale, carence, ravageur, stress hydrique…). Indique ton degré de confiance en mots simples (ex. « assez probable », « à confirmer »).

## Gravité et urgence
Est-ce bénin ou cela peut-il se propager vite au reste de la parcelle ? Faut-il agir aujourd'hui ?

## Que faire maintenant
Les gestes concrets, en commençant TOUJOURS par les solutions durables et à portée de main (retirer et brûler/enterrer les parties atteintes, préparations naturelles, assainissement, espacement, gestion de l'eau). Ne propose un produit chimique qu'en DERNIER recours, sans nom de marque — seulement la matière active, avec un rappel de lire la notice, de respecter le dosage et le délai avant récolte.

## Éviter que ça revienne
2 à 4 conseils de prévention simples (rotation, variétés, drainage, propreté des outils…).

## À confirmer sur place
Rappelle gentiment qu'une photo a ses limites et conseille de confronter le diagnostic à un agent agricole ou à l'animateur de la coopérative en cas de doute ou si cela s'aggrave.`;
}
async function handleDiagnostic(req, res) {
  if (!API_KEY) return sendJson(res, 500, { error: "Clé IA manquante (ANTHROPIC_API_KEY)." });
  const user = await currentUser(req);
  if (!user) return sendJson(res, 401, { error: "Connectez-vous pour utiliser le diagnostic." });
  if (!rateOk("diag:" + user.id, 40, 24 * 60 * 60 * 1000)) return sendJson(res, 429, { error: "Beaucoup de diagnostics aujourd'hui — reprenez un peu plus tard." });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  let img = String(p.image || "");
  let media = "image/jpeg";
  const m = img.match(/^data:(image\/(?:jpeg|png|webp));base64,(.*)$/i);
  if (m) { media = m[1].toLowerCase(); img = m[2]; }
  img = img.replace(/\s/g, "");
  if (!img || img.length < 100) return sendJson(res, 400, { error: "Ajoutez une photo de la plante." });
  if (img.length > 5.4e6) return sendJson(res, 413, { error: "Photo trop lourde — reprenez-la (elle est normalement réduite automatiquement)." });
  const crop = String(p.crop || "").trim().slice(0, 80);
  const desc = String(p.description || "").trim().slice(0, 500);
  let intro = "Voici une photo d'une plante qui semble malade ou attaquée.";
  if (crop) intro += " Culture : " + crop + ".";
  if (desc) intro += " Observation du cultivateur : " + desc + ".";
  intro += "\n\nQue vois-tu, et que me conseilles-tu ?";
  const content = [
    { type: "image", source: { type: "base64", media_type: media, data: img } },
    { type: "text", text: intro }
  ];
  try {
    const diagnosis = await callClaude(diagnosticSystem(), [{ role: "user", content }], null, 2000);
    sendJson(res, 200, { diagnosis });
    logQuestion({ id: newId(), user_id: user.id, question: "[photo] " + (crop || "plante") + (desc ? " — " + desc.slice(0, 120) : ""), crop: crop || null, created_at: new Date().toISOString() });
  } catch (e) { sendJson(res, e.status || 500, { error: e.message || "Le diagnostic a échoué." }); }
}
// GET /api/admin/questions : journal des questions (réservé formateur).
async function handleAdminQuestions(req, res) {
  const u = await currentUser(req); if (!isAdmin(u)) return sendJson(res, 403, { error: "Réservé à l'administrateur." });
  const rows = await recentQuestions(300);
  const recent = rows.slice(0, 60).map((r) => ({ question: r.question, crop: r.crop || null, at: r.created_at }));
  sendJson(res, 200, { total: rows.length, themes: themeCounts(rows), recent });
}
async function handleAdminUsers(req, res) {
  const u = await currentUser(req); if (!isAdmin(u)) return sendJson(res, 403, { error: "Réservé à l'administrateur." });
  let users = [], plans = [];
  if (USE_DB) { try { users = (await sb(`/trv_users?select=id,email,name,region,animator,created_at&order=created_at.desc`)) || []; plans = (await sb(`/trv_plans?select=user_id`)) || []; } catch (e) {} }
  else { const s = loadStore(); users = Object.values(s.users); plans = Object.values(s.plans); }
  const count = {}; plans.forEach((p) => { count[p.user_id] = (count[p.user_id] || 0) + 1; });
  sendJson(res, 200, { users: users.map((x) => ({ id: x.id, email: x.email, name: x.name, region: x.region || null, created_at: x.created_at, plans: count[x.id] || 0, animator: !!x.animator, isAdmin: isAdmin(x) })), totalPlans: plans.length });
}
// L'agriculteur consulte / soumet sa demande pour devenir animateur.
async function handleAnimRequestGet(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Non connecté." });
  if (isAnimator(user)) return sendJson(res, 200, { animator: true, request: null });
  const r = await getAnimRequestByUser(user.id);
  sendJson(res, 200, { animator: false, request: r ? { status: r.status, created_at: r.created_at, message: r.message || null } : null });
}
async function handleAnimRequestCreate(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Connectez-vous d'abord." });
  if (isAnimator(user)) return sendJson(res, 400, { error: "Vous êtes déjà animateur." });
  if (!rateOk("animreq:" + user.id, 5, 24 * 60 * 60 * 1000)) return sendJson(res, 429, { error: "Trop de demandes aujourd'hui. Réessayez demain." });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const existing = await getAnimRequestByUser(user.id);
  if (existing && existing.status === "en_attente") return sendJson(res, 200, { ok: true, status: "en_attente", already: true });
  const rec = { id: newId(), user_id: user.id, name: user.name || null, email: user.email, region: String(p.region || user.region || "").trim().slice(0, 100) || null, message: String(p.message || "").trim().slice(0, 500) || null, status: "en_attente", created_at: new Date().toISOString(), decided_at: null };
  await addAnimRequest(rec);
  sendJson(res, 200, { ok: true, status: "en_attente" });
}
// Le propriétaire liste et décide des demandes.
async function handleAdminAnimRequests(req, res) {
  const u = await currentUser(req); if (!isAdmin(u)) return sendJson(res, 403, { error: "Réservé à l'administrateur." });
  const pending = await listAnimRequests("en_attente");
  sendJson(res, 200, { requests: pending.map((r) => ({ id: r.id, name: r.name || null, email: r.email, region: r.region || null, message: r.message || null, created_at: r.created_at })) });
}
async function handleAdminAnimDecide(req, res) {
  const u = await currentUser(req); if (!isAdmin(u)) return sendJson(res, 403, { error: "Réservé à l'administrateur." });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const r = await getAnimRequest(String(p.id || "")); if (!r) return sendJson(res, 404, { error: "Demande introuvable." });
  const approve = !(p.approve === false || p.approve === "false" || p.approve === 0);
  if (approve) await setUserAnimator(r.user_id, true);
  await updateAnimRequest(r.id, { status: approve ? "acceptée" : "refusée", decided_at: new Date().toISOString() });
  sendJson(res, 200, { ok: true, status: approve ? "acceptée" : "refusée", email: r.email });
}
// Accorder / retirer le statut d'animateur à une adresse (réservé au propriétaire).
async function handleAdminSetAnimator(req, res) {
  const u = await currentUser(req); if (!isAdmin(u)) return sendJson(res, 403, { error: "Réservé à l'administrateur." });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const email = normEmail(p.email); if (!validEmail(email)) return sendJson(res, 400, { error: "Adresse e-mail invalide." });
  const target = await findUserByEmail(email); if (!target) return sendJson(res, 404, { error: "Aucun compte avec cette adresse. La personne doit d'abord créer son compte." });
  const grant = !(p.grant === false || p.grant === "false" || p.grant === 0);
  await setUserAnimator(target.id, grant);
  sendJson(res, 200, { ok: true, email: target.email, name: target.name || null, animator: grant });
}

async function handleArduino(req, res) {
  if (!API_KEY) return sendJson(res, 500, { error: "Clé IA manquante (ANTHROPIC_API_KEY)." });
  const user = await currentUser(req);
  if (!user) return sendJson(res, 401, { error: "Connectez-vous pour créer votre projet." });
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const kind = String(p.kind || "").trim().slice(0, 120);
  const need = String(p.need || "").trim().slice(0, 800);
  if (!kind && !need) return sendJson(res, 400, { error: "Indiquez au moins ce que vous voulez automatiser." });
  const clean = { kind: kind || "Projet Arduino", sector: String(p.sector || "").slice(0, 120), need, gear: String(p.gear || "").slice(0, 400) };
  const fresh = p.fresh === true || p.fresh === "1" || p.fresh === 1;

  // 1) RÉUTILISATION : un projet existe-t-il déjà pour ce type dans ce secteur ?
  if (!fresh) {
    try {
      const existing = await findSharedDevice(clean.kind, clean.sector);
      if (existing && existing.content) return sendJson(res, 200, { device: existing, reused: true, sector: clean.sector || null });
    } catch (e) { /* on bascule sur la génération */ }
  }

  // 2) GÉNÉRATION par l'IA (compte dans la limite et le coût).
  if (!rateOk("arduino:" + user.id, 20, 24 * 60 * 60 * 1000)) return sendJson(res, 429, { error: "Vous avez généré beaucoup de projets aujourd'hui. Reprenez plus tard." });
  try {
    const content = await callClaude(arduinoSystem(), [{ role: "user", content: arduinoUserMessage(clean) }], null, ARDUINO_MAX_TOKENS);
    const rec = { id: newId(), user_id: user.id, title: clean.kind + (clean.sector ? " — " + clean.sector : ""), kind: clean.kind, sector: clean.sector || null, need: clean.need || null, content, created_at: new Date().toISOString() };
    await saveDevice(rec);
    sendJson(res, 200, { device: rec, reused: false });
  } catch (e) { sendJson(res, e.status || 500, { error: e.message || "La génération a échoué." }); }
}
async function handleDevicesList(req, res) { const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Non connecté." }); sendJson(res, 200, { devices: await listDevicesForUser(user.id) }); }
async function handleDeviceGet(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Non connecté." });
  const id = new URL(req.url, "http://x").searchParams.get("id");
  const device = id ? await getDevice(id) : null;
  if (!device || device.user_id !== user.id) return sendJson(res, 404, { error: "Projet introuvable." });
  sendJson(res, 200, { device });
}

// Réception des mesures envoyées par une carte (ESP32). Pas de cookie : la carte
// s'authentifie avec sa CLÉ D'APPAREIL (device_key). Entrée simple et robuste.
async function handleIngest(req, res) {
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const key = String(p.key || req.headers["x-device-key"] || "").trim();
  const station = await getStationByKey(key);
  if (!station) return sendJson(res, 401, { error: "Clé d'appareil inconnue." });
  if (!rateOk("ingest:" + station.id, 300, 60 * 60 * 1000)) return sendJson(res, 429, { error: "Trop de mesures. Ralentissez l'envoi." });
  const num = (v, min, max) => { const n = Number(v); return (isFinite(n)) ? Math.max(min, Math.min(max, n)) : null; };
  const rec = {
    id: newId(), user_id: station.user_id, station_id: station.id,
    soil: (p.soil != null) ? Math.round(num(p.soil, 0, 100)) : null,
    temp: (p.temp != null) ? Math.round(num(p.temp, -20, 80) * 10) / 10 : null,
    hum: (p.hum != null) ? Math.round(num(p.hum, 0, 100)) : null,
    level: (p.level != null) ? Math.round(num(p.level, 0, 100)) : null,
    created_at: new Date().toISOString()
  };
  await saveReading(rec);
  sendJson(res, 200, { ok: true });
}
async function handleStation(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Non connecté." });
  const st = await getOrCreateStation(user.id);
  if (!st) return sendJson(res, 500, { error: "Impossible de préparer la station." });
  sendJson(res, 200, { station: { id: st.id, name: st.name, device_key: st.device_key } });
}
async function handleWeather(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Non connecté." });
  const u = new URL(req.url, "http://x");
  const lat = parseFloat(u.searchParams.get("lat")), lon = parseFloat(u.searchParams.get("lon"));
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return sendJson(res, 400, { error: "Coordonnées invalides." });
  sendJson(res, 200, { weather: await fetchWeatherLatLon(lat, lon) });
}
async function handleReadingsClear(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Non connecté." });
  await clearReadings(user.id);
  sendJson(res, 200, { ok: true });
}
async function handleDashboard(req, res) {
  const user = await currentUser(req); if (!user) return sendJson(res, 401, { error: "Non connecté." });
  const [plans, devices, readings] = await Promise.all([listPlansForUser(user.id), listDevicesForUser(user.id), recentReadings(user.id, 48)]);
  const region = (user.region) || (plans[0] && plans[0].region) || "";
  const weather = await fetchWeather(region);
  const latest = readings[0] || null;
  sendJson(res, 200, {
    user: { name: user.name, region: user.region || null },
    counts: { plans: plans.length, devices: devices.length, readings: readings.length },
    latest,
    readings: readings.slice().reverse(), // du plus ancien au plus récent (pour le graphique)
    recentPlans: plans.slice(0, 4),
    recentDevices: devices.slice(0, 4),
    weather
  });
}

// ---------- Fichiers statiques ----------
function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/accueil.html";
  if (urlPath === "/app") urlPath = "/app.html";
  if (urlPath === "/accueil") urlPath = "/accueil.html";
  if (urlPath === "/arduino") urlPath = "/arduino.html";
  if (urlPath === "/tableau" || urlPath === "/dashboard") urlPath = "/tableau.html";
  if (urlPath === "/quality") urlPath = "/quality.html";
  if (urlPath === "/stock") urlPath = "/stock.html";
  if (urlPath === "/comprendre") urlPath = "/comprendre.html";
  if (urlPath === "/conseiller" || urlPath === "/chat") urlPath = "/conseiller.html";
  if (urlPath === "/cooperative" || urlPath === "/coop") urlPath = "/cooperative.html";
  if (urlPath === "/diagnostic" || urlPath === "/diagnostic.html") urlPath = "/diagnostic.html";
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end("Accès interdit"); }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); return res.end("Page introuvable"); }
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}


// ---------- Quality Guard (contrôles déterministes, sans modification automatique) ----------
// Détecte un pH déclaré inconnu/non précisé, quelle que soit la ponctuation entre
// « pH » et le qualificatif (« pH : non précisé », « Le pH est inconnu », etc.).
const QG_PH_UNKNOWN = /pH[\s:]*(?:du sol\s*)?(?:est\s+)?(?:inconnu|non\s+pr[ée]cis|non\s+mesur|non\s+connu|non\s+fourni)/i;
// Dose de chaux/chaulage chiffrée (nombre + unité à proximité du mot chaux/chaulage).
const QG_LIME_DOSE = /(?:\d+(?:[.,]\d+)?\s*(?:kg|g|t|tonnes?)[^.\n]{0,35}(?:chaux|chaulage)|(?:chaux|chaulage)[^.\n]{0,35}\d+(?:[.,]\d+)?\s*(?:kg|g|t|tonnes?))/i;
// Montant chiffré en francs CFA (digits suivis de FCFA/CFA/XOF) — prix potentiellement inventé.
const QG_FCFA_AMOUNT = /\d[\d\s., ]*\s*(?:F\s*CFA|FCFA|CFA|XOF)\b/i;

// Trois niveaux de gravité (Partie 4). Poids utilisés pour le score indicatif.
const QG_SEVERITIES = ["critique", "important", "mineur"];
const QG_STATUSES = ["a_traiter", "en_cours", "resolue"];
const QG_WEIGHT = { critique: 30, important: 12, mineur: 4 };
// Compatibilité : anciens enregistrements en high/medium/low.
function qgMapSeverity(s) {
  s = String(s || "").toLowerCase();
  if (s === "high") return "critique";
  if (s === "medium") return "important";
  if (s === "low") return "mineur";
  return QG_SEVERITIES.includes(s) ? s : "mineur";
}
// Fabrique une anomalie structurée et complète (Parties 4 & 5).
function qgMake(o) {
  return {
    id: o.code, code: o.code,
    severity: o.severity,
    title: o.title,
    description: o.description,
    message: o.description,            // alias conservé pour l'historique et l'affichage
    justification: o.justification,
    correction: o.correction,          // action corrective concrète, jamais une dose inventée
    missing: o.missing || null,        // informations manquantes à compléter
    needs_human: !!o.needs_human,      // gravité à confirmer par un humain
    status: "a_traiter"                // à traiter | en_cours | resolue
  };
}
// Score qualité INDICATIF et STRUCTUREL (ne juge pas l'exactitude agronomique).
// 100 moins une pénalité par anomalie NON résolue. Jamais présenté comme une note agronomique.
function qualityScore(anomalies) {
  let s = 100;
  for (const a of (anomalies || [])) {
    if (a && a.status !== "resolue") s -= (QG_WEIGHT[a.severity] || 4);
  }
  return Math.max(0, Math.min(100, s));
}
// Statut d'un audit à partir de ses anomalies NON résolues (critique → error).
function qualityStatusFromAnomalies(anomalies) {
  const open = (anomalies || []).filter(a => a && a.status !== "resolue");
  if (open.some(a => a.severity === "critique")) return "error";
  return open.length ? "warn" : "ok";
}

function qualityAnalyzePlan(plan) {
  const content = String((plan && (plan.content || plan.notes)) || "");
  const headings = (content.match(/^#{1,3}\s*(?:\d{1,2}\s*[\.\-:)]|section\s+\d{1,2})/gim) || []).length;
  const anomalies = [];
  if (!content.trim()) anomalies.push(qgMake({
    code: "vide", severity: "critique", title: "Itinéraire vide",
    description: "Cet itinéraire est vide : il n'y a aucun texte à contrôler.",
    justification: "Sans texte, aucun contrôle n'est possible : le résultat ne pourrait pas être fiable.",
    correction: "Générez ou collez l'itinéraire complet, puis relancez le contrôle.",
    missing: "Le contenu de l'itinéraire."
  }));
  if (content.trim() && headings < 18) anomalies.push(qgMake({
    code: "sections", severity: "important", title: "Sections manquantes",
    description: `Vous ne retrouvez que ${headings} section(s) numérotée(s) : vérifiez que les 18 sections de l'itinéraire sont bien présentes.`,
    justification: "Un itinéraire Terravive complet compte 18 sections ; il en manque, le plan est peut-être tronqué.",
    correction: "Vérifiez que la génération n'a pas été coupée et complétez les sections absentes avant diffusion.",
    missing: `${Math.max(0, 18 - headings)} section(s) sur 18.`
  }));
  if (/chaulage|chaux/i.test(content) && QG_PH_UNKNOWN.test(content) && QG_LIME_DOSE.test(content)) {
    anomalies.push(qgMake({
      code: "chaux_ph", severity: "critique", title: "Chaulage chiffré sans pH connu",
      description: "Une dose de chaux est chiffrée alors que le pH du sol n'est pas connu : à vérifier avant de conseiller un chaulage.",
      justification: "Doser la chaux sans connaître le pH peut dégrader le sol : c'est une décision agricole potentiellement dommageable.",
      correction: "Faites mesurer le pH (test de sol) avant de fixer une dose ; en l'absence de mesure, présentez le chaulage comme conditionnel, sans chiffre.",
      missing: "La mesure du pH du sol."
    }));
  }
  if (/\b(?:garanti|sans aucun risque|sans danger|efficacité garantie)\b/i.test(content)) anomalies.push(qgMake({
    code: "categorique", severity: "important", title: "Formulation trop catégorique",
    description: "Formulation trop catégorique (« garanti », « sans risque »…) : pensez à rappeler l'incertitude et les précautions d'usage.",
    justification: "Une promesse absolue peut pousser à une décision à tort, sans tenir compte des aléas.",
    correction: "Reformulez prudemment (« dans de bonnes conditions », « selon les observations »), en rappelant les précautions.",
    missing: null
  }));
  if (QG_FCFA_AMOUNT.test(content)) anomalies.push(qgMake({
    code: "fcfa", severity: "important", title: "Montant chiffré en F CFA",
    description: "Un montant en F CFA est chiffré dans l'itinéraire : vérifiez qu'il n'est pas inventé — les prix doivent venir du producteur.",
    justification: "Un prix inventé par le modèle fausse l'estimation économique présentée au producteur.",
    correction: "Remplacez le montant par un champ à renseigner par le producteur, ou indiquez clairement la source du prix.",
    missing: "Les prix locaux réels, saisis par le producteur."
  }));
  if (/\bmarge\b/i.test(content) && !/n['’]est pas\s+(?:le\s+|un\s+)?b[ée]n[ée]fice/i.test(content)) {
    anomalies.push(qgMake({
      code: "marge", severity: "mineur", title: "« Marge » sans rappel marge ≠ bénéfice",
      description: "La « marge » est mentionnée sans rappeler qu'elle n'est pas le bénéfice réel du producteur : à vérifier.",
      justification: "Sans rappel, la marge peut être confondue avec le bénéfice réel.",
      correction: "Ajoutez une phrase : « la marge n'est pas le bénéfice réel ; elle ignore le travail familial et l'amortissement ».",
      missing: null
    }));
  }
  if (/rendement/i.test(content) && /(?:\bt\s*\/\s*ha\b|tonnes?\b)/i.test(content) && !/(prudent|sc[ée]nario|indicatif|repère|ordre de grandeur)/i.test(content)) {
    anomalies.push(qgMake({
      code: "rendement", severity: "mineur", title: "Rendement chiffré sans cadrage",
      description: "Un rendement chiffré (t/ha) apparaît sans cadrage prudent (scénario, ordre de grandeur, valeur indicative) : à vérifier.",
      justification: "Un rendement annoncé sans cadrage peut être pris pour une garantie.",
      correction: "Encadrez par un scénario prudent / intermédiaire / favorable et la mention « indicatif, à confirmer localement ».",
      missing: null
    }));
  }
  if (/\b(?:prix|coût|FCFA|XOF)\b/i.test(content) && /(?:à compléter|à vérifier localement|non vérifié)/i.test(content)) {
    anomalies.push(qgMake({
      code: "eco_a_verifier", severity: "mineur", title: "Estimations économiques à confirmer",
      description: "Des estimations économiques sont marquées « à compléter / à vérifier localement » : pensez à les confirmer avec le producteur.",
      justification: "Des montants explicitement « à compléter » restent à valider avant diffusion.",
      correction: "Confirmez les chiffres avec le producteur avant de diffuser l'itinéraire.",
      missing: null
    }));
  }
  return {
    headings,
    anomalies,
    alerts: anomalies,                       // alias conservé (rétrocompatibilité)
    score: qualityScore(anomalies),
    status: qualityStatusFromAnomalies(anomalies)
  };
}

// Normalise une ligne d'audit (stockée en base ou en local, éventuellement ancienne)
// vers une forme homogène et complète pour l'affichage et le tableau de bord.
function qualityNormalizeAudit(row) {
  if (!row || typeof row !== "object") return null;
  // Idempotent : accepte une ligne brute (alerts/issues) OU un audit déjà normalisé (anomalies).
  const raw = Array.isArray(row.anomalies) ? row.anomalies
            : Array.isArray(row.alerts) ? row.alerts
            : Array.isArray(row.issues) ? row.issues : [];
  const anomalies = raw.map((a, i) => {
    a = a && typeof a === "object" ? a : { message: String(a || "") };
    const severity = qgMapSeverity(a.severity);
    const status = QG_STATUSES.includes(a.status) ? a.status : "a_traiter";
    const description = a.description || a.message || a.title || "Anomalie";
    return {
      id: a.id || a.code || ("a" + i),
      code: a.code || a.id || ("a" + i),
      severity, status,
      title: a.title || description.slice(0, 60),
      description, message: description,
      justification: a.justification || null,
      correction: a.correction || null,
      missing: a.missing || null,
      needs_human: !!a.needs_human
    };
  });
  const status = row.status && ["ok", "warn", "error"].includes(row.status)
    ? row.status : qualityStatusFromAnomalies(anomalies);
  return {
    id: row.id, plan_id: row.plan_id || null,
    title: row.title || row.plan_title || "Itinéraire",
    crop: row.crop || null, region: row.region || null,
    created_at: row.created_at || null, created_by: row.created_by || null,
    status,
    score: (typeof row.score === "number") ? row.score : qualityScore(anomalies),
    alert_count: anomalies.length,
    resolved_count: anomalies.filter(a => a.status === "resolue").length,
    anomalies
  };
}

// Agrégats du tableau de bord à partir des audits NORMALISÉS (données réelles).
// Distingue une ABSENCE de données (null) d'un vrai zéro.
function qualityAggregate(audits) {
  const list = (audits || []).map(qualityNormalizeAudit).filter(Boolean);
  if (!list.length) {
    return { total: 0, conformes: null, a_verifier: null, critiques: null,
             importants: null, mineurs: null, resolues: null, dernier: null };
  }
  let conformes = 0, aVerifier = 0, critiques = 0, importants = 0, mineurs = 0, resolues = 0, dernier = null;
  const cropCount = {}, problemCount = {};
  for (const a of list) {
    if (a.status === "ok") conformes++; else aVerifier++;
    if (a.crop) cropCount[a.crop] = (cropCount[a.crop] || 0) + 1;
    for (const an of a.anomalies) {
      if (an.severity === "critique") critiques++;
      else if (an.severity === "important") importants++;
      else mineurs++;
      if (an.status === "resolue") resolues++;
      const key = an.title || an.code || "Anomalie";
      problemCount[key] = (problemCount[key] || 0) + 1;
    }
    if (a.created_at && (!dernier || String(a.created_at) > String(dernier))) dernier = a.created_at;
  }
  const top = (obj) => Object.entries(obj).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([label, count]) => ({ label, count }));
  return { total: list.length, conformes, a_verifier: aVerifier, critiques, importants, mineurs, resolues, dernier,
           top_crops: top(cropCount), top_problems: top(problemCount) };
}

// ---------- Rôles & permissions (Partie 6) ----------
// admin via ADMIN_EMAILS (inchangé). Rôles optionnels via QUALITY_AUDITORS / QUALITY_VIEWERS.
// Défaut (variables vides) : seuls les administrateurs ont accès → comportement préservé.
const QG_AUDITORS = (process.env.QUALITY_AUDITORS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const QG_VIEWERS = (process.env.QUALITY_VIEWERS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const QG_PERMS = {
  admin: ["read", "audit", "resolve", "export", "compare", "notify", "logs"],
  auditeur: ["read", "audit", "resolve", "export", "compare", "notify"],
  lecteur: ["read", "export", "compare", "notify"]
};
function qualityRole(u) {
  if (!u) return null;
  const e = normEmail(u.email);
  if (ADMIN_EMAILS.includes(e)) return "admin";
  if (QG_AUDITORS.includes(e)) return "auditeur";
  if (QG_VIEWERS.includes(e)) return "lecteur";
  return null;
}
function qualityCan(u, action) { const r = qualityRole(u); return !!r && QG_PERMS[r].includes(action); }
// Garde commune : renvoie l'utilisateur autorisé, ou répond 401/403 et renvoie null.
async function qualityGuard(req, res, action) {
  const user = await currentUser(req);
  if (!user) { sendJson(res, 401, { error: "Non connecté." }); return null; }
  if (!qualityCan(user, action)) { sendJson(res, 403, { error: "Accès refusé : votre rôle ne permet pas cette action." }); return null; }
  return user;
}

// ---------- Limitation de débit simple (en mémoire, anti-abus) ----------
const QG_RATE = new Map();
function qualityRateLimit(req, res, key, maxPerMin) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").toString().split(",")[0].trim();
  const bucket = key + ":" + ip;
  const now = Date.now();
  const entry = QG_RATE.get(bucket) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
  entry.count++; QG_RATE.set(bucket, entry);
  if (QG_RATE.size > 5000) { for (const [k, v] of QG_RATE) if (now > v.reset) QG_RATE.delete(k); }
  if (entry.count > maxPerMin) { sendJson(res, 429, { error: "Trop de requêtes, patientez une minute." }); return false; }
  return true;
}

// ---------- Journal d'actions (append-only) ----------
async function qualityLog(action, user, ref) {
  const row = { id: crypto.randomBytes(10).toString("hex"), action: String(action).slice(0, 60),
                actor: user ? normEmail(user.email) : null, ref: ref || null, created_at: new Date().toISOString() };
  try {
    if (USE_DB) { await sb("/trv_quality_logs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([row]) }); }
    else { const st = loadStore(); if (!Array.isArray(st.qualityLogs)) st.qualityLogs = []; st.qualityLogs.push(row); if (st.qualityLogs.length > 1000) st.qualityLogs = st.qualityLogs.slice(-1000); saveStore(st); }
  } catch (e) { console.warn("Quality log failed:", e.message); } // ne bloque jamais l'action principale
}
async function qualityListLogs() {
  if (USE_DB) { try { return (await sb("/trv_quality_logs?select=*&order=created_at.desc&limit=100")) || []; } catch (e) { return []; } }
  const st = loadStore(); return (st.qualityLogs || []).slice().reverse().slice(0, 100);
}

// ---------- Notifications in-app (Partie 5) ----------
async function qualityNotify(n) {
  const row = { id: crypto.randomBytes(10).toString("hex"), type: n.type, severity: n.severity || "info",
                message: String(n.message || "").slice(0, 300), audit_id: n.audit_id || null,
                dedup: n.dedup || null, read: false, created_at: new Date().toISOString() };
  try {
    if (USE_DB) {
      if (row.dedup) { // dédup : ne pas recréer une notification identique non lue
        const ex = await sb(`/trv_quality_notifications?select=id&dedup=eq.${encodeURIComponent(row.dedup)}&read=eq.false&limit=1`);
        if (ex && ex.length) return;
      }
      await sb("/trv_quality_notifications", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([row]) });
    } else {
      const st = loadStore(); if (!Array.isArray(st.qualityNotifs)) st.qualityNotifs = [];
      if (row.dedup && st.qualityNotifs.some((x) => x.dedup === row.dedup && !x.read)) return;
      st.qualityNotifs.push(row); if (st.qualityNotifs.length > 500) st.qualityNotifs = st.qualityNotifs.slice(-500); saveStore(st);
    }
  } catch (e) { console.warn("Quality notify failed:", e.message); }
}
async function qualityListNotifs() {
  if (USE_DB) { try { return (await sb("/trv_quality_notifications?select=*&order=created_at.desc&limit=50")) || []; } catch (e) { return []; } }
  const st = loadStore(); return (st.qualityNotifs || []).slice().reverse().slice(0, 50);
}
async function qualityMarkNotif(id, all) {
  try {
    if (USE_DB) {
      const q = all ? "/trv_quality_notifications?read=eq.false" : `/trv_quality_notifications?id=eq.${encodeURIComponent(id)}`;
      await sb(q, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ read: true }) });
    } else {
      const st = loadStore(); (st.qualityNotifs || []).forEach((x) => { if (all || x.id === id) x.read = true; }); saveStore(st);
    }
    return true;
  } catch (e) { return false; }
}

// ---------- Comparaison de deux audits (Partie 4) ----------
// Compare deux audits du MÊME itinéraire. « corrigée » = l'anomalie n'est plus détectée
// OU est marquée résolue dans l'audit récent (jamais de correction sans preuve enregistrée).
function qualityCompare(auditA, auditB) {
  const a = qualityNormalizeAudit(auditA), b = qualityNormalizeAudit(auditB);
  if (!a || !b) return { error: "Audit introuvable." };
  if (a.plan_id && b.plan_id && a.plan_id !== b.plan_id) return { error: "Les deux audits ne portent pas sur le même itinéraire." };
  // older = plus ancien, newer = plus récent
  const older = String(a.created_at) <= String(b.created_at) ? a : b;
  const newer = older === a ? b : a;
  const byCode = (arr) => { const m = {}; for (const x of arr) m[x.code || x.id] = x; return m; };
  const oldM = byCode(older.anomalies), newM = byCode(newer.anomalies);
  const nouvelles = [], corrigees = [], persistantes = [];
  for (const code of Object.keys(newM)) {
    const an = newM[code];
    if (!oldM[code]) { if (an.status === "resolue") corrigees.push({ ...an, note: "présente mais marquée résolue" }); else nouvelles.push(an); }
    else if (an.status === "resolue") corrigees.push({ ...an, note: "marquée résolue dans le contrôle récent" });
    else persistantes.push(an);
  }
  for (const code of Object.keys(oldM)) { if (!newM[code]) corrigees.push({ ...oldM[code], note: "n'est plus détectée dans le contrôle récent" }); }
  const scoreComparable = typeof older.score === "number" && typeof newer.score === "number";
  return {
    older: { id: older.id, created_at: older.created_at, status: older.status, score: older.score },
    newer: { id: newer.id, created_at: newer.created_at, status: newer.status, score: newer.score },
    nouvelles, corrigees, persistantes,
    score_delta: scoreComparable ? (newer.score - older.score) : null,
    score_comparable: scoreComparable,
    status_change: older.status !== newer.status ? { from: older.status, to: newer.status } : null
  };
}

// ---------- Export CSV (Partie 3) ----------
// Protection anti-injection de formules : préfixe les cellules commençant par = + - @ etc.
function qgCsvCell(v) {
  let s = (v === null || v === undefined) ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function qualityAuditsToCsv(audits) {
  const sep = ";";
  const head = ["ID audit", "Itinéraire", "Culture", "Localisation", "Date", "Statut", "Score", "Anomalies", "Résolues"];
  const lines = [head.join(sep)];
  for (const raw of audits) {
    const a = qualityNormalizeAudit(raw); if (!a) continue;
    lines.push([a.id, a.title, a.crop || "", a.region || "", a.created_at || "", a.status, (typeof a.score === "number" ? a.score : ""), a.alert_count, a.resolved_count].map(qgCsvCell).join(sep));
  }
  return "﻿" + lines.join("\r\n"); // BOM UTF-8 pour Excel + accents français
}
function qualityAnomaliesToCsv(audit) {
  const a = qualityNormalizeAudit(audit); const sep = ";";
  const head = ["ID audit", "Itinéraire", "Culture", "Date", "Anomalie", "Gravité", "Statut", "Description", "Justification", "Correction", "Info manquante"];
  const lines = [head.join(sep)];
  for (const an of a.anomalies) {
    lines.push([a.id, a.title, a.crop || "", a.created_at || "", an.title, an.severity, an.status, an.description || "", an.justification || "", an.correction || "", an.missing || ""].map(qgCsvCell).join(sep));
  }
  if (!a.anomalies.length) lines.push([a.id, a.title, a.crop || "", a.created_at || "", "(aucune anomalie)", "", "", "", "", "", ""].map(qgCsvCell).join(sep));
  return "﻿" + lines.join("\r\n");
}
function sendCsv(res, filename, csv) {
  res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"` });
  res.end(csv);
}


// Filtrage des audits (Partie 6) : culture, statut, gravité, période. Fonction pure.
function qualityFilterAudits(audits, f) {
  f = f || {};
  const list = (audits || []).map(qualityNormalizeAudit).filter(Boolean);
  return list.filter(a => {
    if (f.crop && String(a.crop || "").toLowerCase() !== String(f.crop).toLowerCase()) return false;
    if (f.status && a.status !== f.status) return false;
    if (f.severity && !a.anomalies.some(an => an.severity === f.severity)) return false;
    if (f.from && (!a.created_at || String(a.created_at) < String(f.from))) return false;
    if (f.to && (!a.created_at || String(a.created_at) > String(f.to) + "T23:59:59.999Z")) return false;
    return true;
  });
}
async function qualityListPlans() {
  if (USE_DB) return (await sb("/trv_plans?select=id,title,crop,region,content,notes,created_at&order=created_at.desc&limit=50")) || [];
  return Object.values(loadStore().plans || {}).sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||""))).slice(0,50);
}
async function qualityListAudits() {
  if (USE_DB) {
    try {
      // select=* : robuste si une colonne (kind, score…) n'existe pas encore en base.
      const rows = (await sb("/trv_quality_audits?select=*&order=created_at.desc&limit=100")) || [];
      // Les enregistrements de banc de tests ne sont pas des audits d'itinéraires.
      return rows.filter((row) => row.kind !== "tests").slice(0, 50);
    }
    catch (e) { console.warn("Quality Guard history unavailable:", e.message); return []; }
  }
  const st = loadStore(); return (st.qualityAudits || []).slice().reverse().slice(0,50);
}
async function qualityGetAudit(id) {
  if (!id || typeof id !== "string") return null;
  if (USE_DB) {
    const rows = await sb(`/trv_quality_audits?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    return (rows && rows[0]) || null;
  }
  const st = loadStore(); return (st.qualityAudits || []).find(a => a && a.id === id) || null;
}
// Enregistre (upsert) un audit : écriture tolérante au schéma. On tente la ligne complète ;
// si une colonne manque encore en base, on réessaie avec les colonnes de base pour ne JAMAIS
// perdre l'audit. Renvoie {saved, warning}.
async function qualitySaveAudit(audit, { patch } = {}) {
  const full = {
    id: audit.id, plan_id: audit.plan_id, title: audit.title,
    status: audit.status, alert_count: audit.alert_count, alerts: audit.anomalies,
    created_at: audit.created_at, created_by: audit.created_by,
    // Colonnes ajoutées (voir schema.sql / migration idempotente).
    crop: audit.crop, region: audit.region, score: audit.score,
    // Compatibilité avec l'ancien schéma de production.
    kind: "audit", plan_title: audit.title, issues: audit.anomalies
  };
  const base = {
    id: audit.id, plan_id: audit.plan_id, title: audit.title,
    status: audit.status, alert_count: audit.alert_count, alerts: audit.anomalies,
    created_at: audit.created_at, created_by: audit.created_by
  };
  if (USE_DB) {
    const method = patch ? "PATCH" : "POST";
    const url = patch ? `/trv_quality_audits?id=eq.${encodeURIComponent(audit.id)}` : "/trv_quality_audits";
    try {
      await sb(url, { method, headers: { Prefer: patch ? "return=minimal" : "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(patch ? full : [full]) });
      return { saved: true, warning: null };
    } catch (e1) {
      try {
        await sb(url, { method, headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch ? base : [base]) });
        return { saved: true, warning: "Audit enregistré en mode compatibilité (certaines colonnes — culture, score — ne sont pas encore présentes en base : exécutez la migration schema.sql). Détail : " + e1.message };
      } catch (e2) {
        console.error("Quality Guard save failed:", e2.message);
        return { saved: false, warning: "Contrôle effectué, mais l'historique n'a pas pu être enregistré dans Supabase. Vérifiez la table trv_quality_audits et ses permissions. Détail technique : " + e2.message };
      }
    }
  }
  try {
    const st = loadStore(); if (!Array.isArray(st.qualityAudits)) st.qualityAudits = [];
    const row = { ...base, crop: audit.crop, region: audit.region, score: audit.score, kind: "audit", issues: audit.anomalies };
    const i = st.qualityAudits.findIndex(a => a && a.id === audit.id);
    if (i >= 0) st.qualityAudits[i] = row; else st.qualityAudits.push(row);
    if (st.qualityAudits.length > 500) st.qualityAudits = st.qualityAudits.slice(-500);
    saveStore(st); return { saved: true, warning: null };
  } catch (e) { return { saved: false, warning: "Contrôle effectué, mais l'historique local n'a pas pu être enregistré." }; }
}
function qgParseFilters(req) {
  let q = {};
  try { q = Object.fromEntries(new URL(req.url, "http://x").searchParams); } catch (e) {}
  const f = {};
  if (q.crop) f.crop = String(q.crop).slice(0, 80);
  if (["ok", "warn", "error"].includes(q.status)) f.status = q.status;
  if (QG_SEVERITIES.includes(q.severity)) f.severity = q.severity;
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || "")) f.from = q.from;
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || "")) f.to = q.to;
  return f;
}
async function handleQualityOverview(req,res) {
  const user = await qualityGuard(req,res,"read"); if (!user) return;
  try {
    const plans = await qualityListPlans();
    const allAudits = await qualityListAudits();
    const normalizedAll = allAudits.map(qualityNormalizeAudit).filter(Boolean);
    const filters = qgParseFilters(req);
    const filtered = qualityFilterAudits(allAudits, filters);
    const crops = Array.from(new Set(normalizedAll.map(a => a.crop).filter(Boolean))).sort();
    const notifs = await qualityListNotifs();
    sendJson(res,200,{
      user:{name:user.name||"administrateur",email:user.email},
      role: qualityRole(user),
      source:USE_DB?"supabase":"local",
      plans:plans.map(p=>{const q=qualityAnalyzePlan(p);return {id:p.id,title:p.title,crop:p.crop,region:p.region,created_at:p.created_at,sections:q.headings,status:q.status,score:q.score};}),
      audits: filtered.map(a => ({ id:a.id, plan_id:a.plan_id, title:a.title, crop:a.crop, region:a.region, created_at:a.created_at, status:a.status, score:a.score, alert_count:a.alert_count, resolved_count:a.resolved_count })),
      metrics: qualityAggregate(filtered),
      metrics_total: normalizedAll.length,
      unread: notifs.filter(n => !n.read).length,
      filters, crops
    });
  } catch(e) { console.error("Quality overview:",e.message); sendJson(res,500,{error:"Impossible de charger vos données pour le moment. Réessayez dans un instant."}); }
}
async function handleQualityAudit(req,res) {
  const user = await qualityGuard(req,res,"audit"); if (!user) return;
  if (!qualityRateLimit(req,res,"audit",30)) return;
  try {
    const body = JSON.parse(await readBody(req) || "{}");
    if (!body.id || typeof body.id !== "string") return sendJson(res,400,{error:"Aucun itinéraire sélectionné."});
    let plan = null;
    if (USE_DB) { const rows = await sb(`/trv_plans?id=eq.${encodeURIComponent(body.id)}&select=id,title,crop,region,content,notes,created_at&limit=1`); plan = rows && rows[0]; }
    else plan = (loadStore().plans || {})[body.id] || null;
    if (!plan) return sendJson(res,404,{error:"Itinéraire introuvable."});
    const q = qualityAnalyzePlan(plan);
    const audit = {
      id:crypto.randomBytes(12).toString("hex"), plan_id:plan.id,
      title:plan.title||plan.crop||"Itinéraire", crop:plan.crop||null, region:plan.region||null,
      status:q.status, alert_count:q.anomalies.length, score:q.score, anomalies:q.anomalies,
      created_at:new Date().toISOString(), created_by:user.email
    };
    const { saved, warning } = await qualitySaveAudit(audit);
    await qualityLog("audit_create", user, { audit_id: audit.id, plan_id: plan.id, status: q.status });
    // Notifications (Partie 5) : anomalie critique, nouvel audit à vérifier, échec d'enregistrement.
    const critiques = q.anomalies.filter(a => a.severity === "critique" && a.status !== "resolue");
    if (critiques.length) await qualityNotify({ type:"critique", severity:"critique", message:`Anomalie critique dans « ${audit.title} » : ${critiques[0].title}.`, audit_id:audit.id, dedup:`crit:${audit.id}` });
    else if (q.status !== "ok") await qualityNotify({ type:"nouvel_audit", severity:"warn", message:`Nouvel audit à vérifier : « ${audit.title} ».`, audit_id:audit.id, dedup:`verif:${audit.id}` });
    if (!saved) { await qualityNotify({ type:"echec", severity:"error", message:`Échec d'enregistrement de l'audit « ${audit.title} ».`, audit_id:audit.id, dedup:`fail:${audit.id}` }); await qualityLog("audit_save_failed", user, { audit_id: audit.id }); }
    sendJson(res,200,{ok:true,auditId:audit.id,status:q.status,score:q.score,sections:q.headings,anomalies:q.anomalies,alerts:q.anomalies,saved,warning});
  } catch(e) { console.error("Quality audit:",e.message);sendJson(res,500,{error:"Le contrôle n'a pas pu aboutir. Réessayez dans un instant ; en cas de besoin, le détail technique est dans les journaux Render."}); }
}
// Fiche détaillée d'un audit (Partie 3). GET /api/quality/audit?id=...
async function handleQualityAuditGet(req,res) {
  const user = await qualityGuard(req,res,"read"); if (!user) return;
  try {
    let id = ""; try { id = new URL(req.url, "http://x").searchParams.get("id") || ""; } catch(e) {}
    if (!id) return sendJson(res,400,{error:"Audit non précisé."});
    const row = await qualityGetAudit(id);
    if (!row) return sendJson(res,404,{error:"Audit introuvable."});
    const audit = qualityNormalizeAudit(row);
    // Métadonnées du plan si l'itinéraire existe encore (sinon : non disponible, jamais inventé).
    let plan = null;
    if (audit.plan_id) {
      try {
        if (USE_DB) { const rows = await sb(`/trv_plans?id=eq.${encodeURIComponent(audit.plan_id)}&select=title,crop,region,created_at&limit=1`); plan = rows && rows[0] || null; }
        else plan = (loadStore().plans || {})[audit.plan_id] || null;
      } catch(e) { plan = null; }
    }
    if (plan) {
      audit.crop = audit.crop || plan.crop || null;
      audit.region = audit.region || plan.region || null;
    }
    sendJson(res,200,{ audit, plan_available: !!plan });
  } catch(e) { console.error("Quality audit get:",e.message); sendJson(res,500,{error:"Impossible de charger cette fiche pour le moment."}); }
}
// Changement de statut d'une anomalie (Partie 5). POST /api/quality/issue {auditId, issueId, status}
async function handleQualityIssue(req,res) {
  const user = await qualityGuard(req,res,"resolve"); if (!user) return;
  try {
    const body = JSON.parse(await readBody(req) || "{}");
    const auditId = typeof body.auditId === "string" ? body.auditId : "";
    const issueId = typeof body.issueId === "string" ? body.issueId : "";
    const status = body.status;
    if (!auditId || !issueId) return sendJson(res,400,{error:"Audit ou anomalie non précisé."});
    if (!QG_STATUSES.includes(status)) return sendJson(res,400,{error:"Statut invalide."});
    const row = await qualityGetAudit(auditId);
    if (!row) return sendJson(res,404,{error:"Audit introuvable."});
    const audit = qualityNormalizeAudit(row);
    const anomaly = audit.anomalies.find(a => a.id === issueId || a.code === issueId);
    if (!anomaly) return sendJson(res,404,{error:"Anomalie introuvable dans cet audit."});
    const before = anomaly.status;
    anomaly.status = status;
    audit.status = qualityStatusFromAnomalies(audit.anomalies);
    audit.score = qualityScore(audit.anomalies);
    audit.alert_count = audit.anomalies.length;
    const { saved, warning } = await qualitySaveAudit(audit, { patch: true });
    await qualityLog("issue_status", user, { audit_id: audit.id, issue: anomaly.code, from: before, to: status });
    if (status === "resolue" && before !== "resolue") await qualityNotify({ type:"resolue", severity:"ok", message:`Anomalie résolue dans « ${audit.title} » : ${anomaly.title}.`, audit_id:audit.id });
    sendJson(res,200,{ ok:true, saved, warning, audit });
  } catch(e) { console.error("Quality issue:",e.message); sendJson(res,500,{error:"Le statut n'a pas pu être mis à jour pour le moment."}); }
}
// Comparaison de deux audits (Partie 4). GET /api/quality/compare?a=..&b=..
async function handleQualityCompare(req,res) {
  const user = await qualityGuard(req,res,"compare"); if (!user) return;
  try {
    const u = new URL(req.url, "http://x");
    const a = u.searchParams.get("a") || "", b = u.searchParams.get("b") || "";
    if (!a || !b) return sendJson(res,400,{error:"Deux audits sont nécessaires pour comparer."});
    if (a === b) return sendJson(res,400,{error:"Choisissez deux audits différents."});
    const rowA = await qualityGetAudit(a), rowB = await qualityGetAudit(b);
    if (!rowA || !rowB) return sendJson(res,404,{error:"Audit introuvable."});
    const result = qualityCompare(rowA, rowB);
    if (result.error) return sendJson(res,400,{error:result.error});
    sendJson(res,200,{ ok:true, comparison: result });
  } catch(e) { console.error("Quality compare:",e.message); sendJson(res,500,{error:"La comparaison n'a pas pu être réalisée."}); }
}
// Export CSV (Partie 3). GET /api/quality/export.csv[?id=auditId | filtres]
async function handleQualityExport(req,res) {
  const user = await qualityGuard(req,res,"export"); if (!user) return;
  if (!qualityRateLimit(req,res,"export",20)) return;
  try {
    const id = (() => { try { return new URL(req.url,"http://x").searchParams.get("id") || ""; } catch(e) { return ""; } })();
    const stamp = new Date().toISOString().slice(0,10);
    if (id) {
      const row = await qualityGetAudit(id);
      if (!row) return sendJson(res,404,{error:"Audit introuvable."});
      await qualityLog("export_csv", user, { audit_id: id, kind: "audit" });
      return sendCsv(res, `terravive-audit-${id.slice(0,8)}-${stamp}.csv`, qualityAnomaliesToCsv(row));
    }
    const all = await qualityListAudits();
    const filters = qgParseFilters(req);
    const filtered = qualityFilterAudits(all, filters);
    await qualityLog("export_csv", user, { kind: "liste", count: filtered.length, filters });
    return sendCsv(res, `terravive-audits-${stamp}.csv`, qualityAuditsToCsv(filtered));
  } catch(e) { console.error("Quality export:",e.message); sendJson(res,500,{error:"L'export n'a pas pu être généré."}); }
}
// Notifications (Partie 5). GET liste / POST marquer lu.
async function handleQualityNotifs(req,res) {
  const user = await qualityGuard(req,res,"notify"); if (!user) return;
  try { const list = await qualityListNotifs(); sendJson(res,200,{ notifications:list, unread:list.filter(n=>!n.read).length }); }
  catch(e) { console.error("Quality notifs:",e.message); sendJson(res,500,{error:"Notifications indisponibles pour le moment."}); }
}
async function handleQualityNotifRead(req,res) {
  const user = await qualityGuard(req,res,"notify"); if (!user) return;
  try {
    const body = JSON.parse(await readBody(req) || "{}");
    if (!body.all && (typeof body.id !== "string" || !body.id)) return sendJson(res,400,{error:"Notification non précisée."});
    const ok = await qualityMarkNotif(body.id, !!body.all);
    sendJson(res,200,{ ok });
  } catch(e) { console.error("Quality notif read:",e.message); sendJson(res,500,{error:"Mise à jour impossible."}); }
}
// Journal d'actions (Partie 7). Réservé aux administrateurs.
async function handleQualityLogs(req,res) {
  const user = await qualityGuard(req,res,"logs"); if (!user) return;
  try { sendJson(res,200,{ logs: await qualityListLogs() }); }
  catch(e) { console.error("Quality logs:",e.message); sendJson(res,500,{error:"Journal indisponible pour le moment."}); }
}
// Suggestion de reformulation prudente par l'IA (Partie 9, OPTIONNEL, non automatique).
// Réutilise callClaude et les variables d'environnement existantes. Aucune clé côté client.
async function handleQualitySuggest(req,res) {
  const user = await qualityGuard(req,res,"audit"); if (!user) return;
  if (!qualityRateLimit(req,res,"suggest",15)) return;
  if (!API_KEY) return sendJson(res,503,{error:"Assistance IA non configurée (ANTHROPIC_API_KEY absente). Les corrections déterministes restent disponibles."});
  try {
    const body = JSON.parse(await readBody(req) || "{}");
    const auditId = typeof body.auditId === "string" ? body.auditId : "";
    const issueId = typeof body.issueId === "string" ? body.issueId : "";
    if (!auditId || !issueId) return sendJson(res,400,{error:"Audit ou anomalie non précisé."});
    const row = await qualityGetAudit(auditId);
    if (!row) return sendJson(res,404,{error:"Audit introuvable."});
    const audit = qualityNormalizeAudit(row);
    const anomaly = audit.anomalies.find(a => a.id === issueId || a.code === issueId);
    if (!anomaly) return sendJson(res,404,{error:"Anomalie introuvable."});
    const system = DURABLE_CONTEXT + "\n\nRÔLE : tu aides un administrateur à corriger un itinéraire. On te donne UNE anomalie détectée. Explique le problème, propose une correction concrète, identifie les données manquantes, distingue faits/estimations/hypothèses et signale si une validation humaine est nécessaire. RÈGLES ABSOLUES : n'invente AUCUNE dose d'engrais, de chaux ou de produit ; ne garantis aucun rendement ni bénéfice ; ne transforme pas une hypothèse en fait ; pas de recommandation phytosanitaire dangereuse sans informations suffisantes. Réponds en 5 lignes maximum.";
    const prompt = `Anomalie (gravité ${anomaly.severity}) : ${anomaly.title}\nDescription : ${anomaly.description}\nCorrection déterministe déjà proposée : ${anomaly.correction || "—"}\n\nPropose une reformulation prudente et concrète.`;
    const suggestion = await callClaude(system, [{ role:"user", content: prompt }], null, 450);
    if (!suggestion || !suggestion.trim()) return sendJson(res,502,{error:"Réponse IA vide. La correction déterministe reste utilisable."});
    sendJson(res,200,{ ok:true, suggestion });
  } catch(e) { console.error("Quality suggest:",e.message); sendJson(res,502,{error:"L'assistance IA est momentanément indisponible. Réessayez plus tard ; la correction déterministe reste utilisable."}); }
}
async function handleQualityTests(req,res) {
  const user = await currentUser(req);
  if (!user) return sendJson(res,401,{error:"Non connecté."});
  if (!isAdmin(user)) return sendJson(res,403,{error:"Réservé à l'administrateur."});
  const sampleGood = {content:Array.from({length:18},(_,i)=>`## ${i+1}. Section test`).join("\n")};
  const sampleMissing = {content:"## 1. Diagnostic\nTexte de test."};
  const sampleUnknownPh = {content:"Le pH est inconnu. Ne pas appliquer de chaux sans mesure."};
  // pH non mesuré ET dose de chaux chiffrée : doit déclencher l'alerte haute (phrasés réels Terravive).
  const sampleLimeNoPh = {content:"pH : non précisé. Appliquer 800 kg de chaux à l'hectare avant semis."};
  const cases = [
    // --- Détection (Partie 2) ---
    {name:"Contenu vide détecté (gravité critique)",fn:()=>qualityAnalyzePlan({content:""}).anomalies.some(a=>a.severity==="critique"&&a.code==="vide")},
    {name:"18 sections numérotées détectées",fn:()=>qualityAnalyzePlan(sampleGood).headings===18},
    {name:"Plan complet sans anomalie → score 100",fn:()=>{const q=qualityAnalyzePlan(sampleGood);return q.anomalies.length===0&&q.score===100&&q.status==="ok";}},
    {name:"Sections manquantes signalées",fn:()=>qualityAnalyzePlan(sampleMissing).anomalies.some(a=>/18 sections/.test(a.message))},
    {name:"Absence de dose de chaux avec pH inconnu",fn:()=>!qualityAnalyzePlan(sampleUnknownPh).anomalies.some(a=>a.code==="chaux_ph")},
    {name:"Dose de chaux chiffrée + pH non précisé → critique",fn:()=>qualityAnalyzePlan(sampleLimeNoPh).anomalies.some(a=>a.severity==="critique"&&a.code==="chaux_ph")},
    {name:"Montant chiffré en F CFA signalé (important)",fn:()=>qualityAnalyzePlan({content:"Coût estimé : 125 000 FCFA par hectare."}).anomalies.some(a=>a.code==="fcfa"&&a.severity==="important")},
    {name:"Marge sans distinction bénéfice signalée (mineur)",fn:()=>qualityAnalyzePlan({content:"La marge attendue est intéressante pour le producteur."}).anomalies.some(a=>a.code==="marge"&&a.severity==="mineur")},
    {name:"Marge avec distinction bénéfice non signalée",fn:()=>!qualityAnalyzePlan({content:"La marge n'est pas le bénéfice réel ; elle ignore le travail familial."}).anomalies.some(a=>a.code==="marge")},
    {name:"Rendement t/ha sans cadrage prudent signalé",fn:()=>qualityAnalyzePlan({content:"Le rendement visé est de 25 t/ha."}).anomalies.some(a=>a.code==="rendement")},
    {name:"Rendement t/ha avec cadrage prudent non signalé",fn:()=>!qualityAnalyzePlan({content:"Scénario prudent : rendement indicatif de 25 t/ha, à confirmer localement."}).anomalies.some(a=>a.code==="rendement")},
    {name:"Formulations absolues signalées",fn:()=>qualityAnalyzePlan({content:"Cette solution est garantie sans aucun risque."}).anomalies.some(a=>a.code==="categorique")},
    // --- Anomalies structurées (Parties 4 & 5) ---
    {name:"Chaque anomalie porte titre/justification/correction",fn:()=>qualityAnalyzePlan(sampleLimeNoPh).anomalies.every(a=>a.title&&a.justification&&a.correction&&QG_SEVERITIES.includes(a.severity)&&a.status==="a_traiter")},
    {name:"Anomalie chaux signale l'info manquante (pH)",fn:()=>{const a=qualityAnalyzePlan(sampleLimeNoPh).anomalies.find(x=>x.code==="chaux_ph");return a&&/pH/i.test(a.missing||"");}},
    // --- Score & statut (Partie 3) ---
    {name:"Score : une anomalie critique pénalise de 30",fn:()=>qualityScore([{severity:"critique",status:"a_traiter"}])===70},
    {name:"Score : anomalie résolue ne pénalise plus",fn:()=>qualityScore([{severity:"critique",status:"resolue"}])===100},
    {name:"Statut : critique ouverte → error",fn:()=>qualityStatusFromAnomalies([{severity:"critique",status:"a_traiter"}])==="error"},
    {name:"Statut : critique résolue → ok",fn:()=>qualityStatusFromAnomalies([{severity:"critique",status:"resolue"}])==="ok"},
    {name:"Statut : seulement mineure ouverte → warn",fn:()=>qualityStatusFromAnomalies([{severity:"mineur",status:"a_traiter"}])==="warn"},
    // --- Normalisation des anciens enregistrements (compat) ---
    {name:"Normalise un ancien audit (high→critique, statut par défaut)",fn:()=>{const n=qualityNormalizeAudit({id:"x",alerts:[{severity:"high",message:"vieux"}]});return n.anomalies[0].severity==="critique"&&n.anomalies[0].status==="a_traiter"&&n.anomalies[0].id;}},
    {name:"Normalise un audit stocké en 'issues' (ancien schéma)",fn:()=>qualityNormalizeAudit({id:"y",issues:[{severity:"medium",message:"m"}]}).anomalies[0].severity==="important"},
    // --- Tableau de bord (Partie 6) ---
    {name:"Agrégat : aucune donnée → total 0 et compteurs null",fn:()=>{const m=qualityAggregate([]);return m.total===0&&m.critiques===null;}},
    {name:"Agrégat : compte conformes / à vérifier / gravités",fn:()=>{const m=qualityAggregate([{id:"1",status:"error",alerts:[{severity:"critique",status:"a_traiter"}]},{id:"2",status:"ok",alerts:[]}]);return m.total===2&&m.conformes===1&&m.a_verifier===1&&m.critiques===1;}},
    {name:"Agrégat : zéro critique distinct d'absence de données",fn:()=>{const m=qualityAggregate([{id:"1",status:"ok",alerts:[]}]);return m.critiques===0&&m.total===1;}},
    // --- Filtres (Partie 6) ---
    {name:"Filtre par statut",fn:()=>qualityFilterAudits([{id:"1",status:"error",alerts:[{severity:"critique"}]},{id:"2",status:"ok",alerts:[]}],{status:"ok"}).length===1},
    {name:"Filtre par gravité",fn:()=>qualityFilterAudits([{id:"1",status:"warn",alerts:[{severity:"mineur"}]},{id:"2",status:"error",alerts:[{severity:"critique"}]}],{severity:"critique"}).length===1},
    {name:"Filtre par culture (insensible à la casse)",fn:()=>qualityFilterAudits([{id:"1",crop:"Tomate",alerts:[]},{id:"2",crop:"Maïs",alerts:[]}],{crop:"tomate"}).length===1},
    // --- Séparation audits / tests ---
    {name:"Les enregistrements kind:'tests' ne sont pas des audits",fn:()=>{const n=qualityNormalizeAudit({id:"t",kind:"tests",alerts:[]});return n&&n.id==="t";}},
    // --- Tableau de bord avancé (Partie 8) ---
    {name:"Agrégat : cultures les plus contrôlées",fn:()=>{const m=qualityAggregate([{id:"1",crop:"Tomate",alerts:[]},{id:"2",crop:"Tomate",alerts:[]},{id:"3",crop:"Maïs",alerts:[]}]);return m.top_crops[0].label==="Tomate"&&m.top_crops[0].count===2;}},
    {name:"Agrégat : problèmes les plus fréquents",fn:()=>{const m=qualityAggregate([{id:"1",alerts:[{code:"fcfa",title:"Montant FCFA",severity:"important"}]},{id:"2",alerts:[{code:"fcfa",title:"Montant FCFA",severity:"important"}]}]);return m.top_problems[0].count===2;}},
    // --- Comparaison d'audits (Partie 4) ---
    {name:"Compare : refuse deux itinéraires différents",fn:()=>!!qualityCompare({id:"1",plan_id:"p1",created_at:"2026-01-01",alerts:[]},{id:"2",plan_id:"p2",created_at:"2026-01-02",alerts:[]}).error},
    {name:"Compare : anomalie disparue = corrigée",fn:()=>{const c=qualityCompare({id:"1",plan_id:"p",created_at:"2026-01-01",alerts:[{code:"fcfa",title:"FCFA",severity:"important"}]},{id:"2",plan_id:"p",created_at:"2026-01-02",alerts:[]});return c.corrigees.length===1&&c.nouvelles.length===0;}},
    {name:"Compare : anomalie persistante détectée",fn:()=>{const c=qualityCompare({id:"1",plan_id:"p",created_at:"2026-01-01",alerts:[{code:"fcfa",title:"FCFA",severity:"important",status:"a_traiter"}]},{id:"2",plan_id:"p",created_at:"2026-01-02",alerts:[{code:"fcfa",title:"FCFA",severity:"important",status:"a_traiter"}]});return c.persistantes.length===1&&c.corrigees.length===0;}},
    {name:"Compare : delta de score calculé si comparable",fn:()=>{const c=qualityCompare({id:"1",plan_id:"p",created_at:"2026-01-01",score:70,alerts:[]},{id:"2",plan_id:"p",created_at:"2026-01-02",score:100,alerts:[]});return c.score_comparable&&c.score_delta===30;}},
    {name:"Compare : anomalie marquée résolue = corrigée (preuve)",fn:()=>{const c=qualityCompare({id:"1",plan_id:"p",created_at:"2026-01-01",alerts:[{code:"fcfa",title:"FCFA",severity:"important",status:"a_traiter"}]},{id:"2",plan_id:"p",created_at:"2026-01-02",alerts:[{code:"fcfa",title:"FCFA",severity:"important",status:"resolue"}]});return c.corrigees.length===1;}},
    // --- Export CSV (Partie 3) ---
    {name:"CSV : neutralise l'injection de formule",fn:()=>qgCsvCell("=SUM(A1:A2)").startsWith("'=")},
    {name:"CSV : échappe les séparateurs et guillemets",fn:()=>qgCsvCell('a;"b"')==='"a;""b"""'},
    {name:"CSV liste : BOM UTF-8 + en-tête",fn:()=>{const c=qualityAuditsToCsv([{id:"1",title:"ITK",crop:"Tomate",status:"ok",alerts:[]}]);return c.charCodeAt(0)===0xFEFF&&/ID audit;Itin/.test(c);}},
    {name:"CSV anomalies : une ligne par anomalie",fn:()=>{const c=qualityAnomaliesToCsv({id:"1",title:"ITK",alerts:[{code:"fcfa",title:"FCFA",severity:"important",status:"a_traiter",description:"d"}]});return c.split("\r\n").length===2;}},
    // --- Permissions (Partie 6) ---
    {name:"Permissions : lecteur ne peut pas lancer d'audit",fn:()=>QG_PERMS.lecteur.indexOf("audit")===-1&&QG_PERMS.lecteur.indexOf("read")>=0},
    {name:"Permissions : auditeur peut résoudre, pas voir le journal",fn:()=>QG_PERMS.auditeur.indexOf("resolve")>=0&&QG_PERMS.auditeur.indexOf("logs")===-1},
    {name:"Permissions : admin a le journal",fn:()=>QG_PERMS.admin.indexOf("logs")>=0}
  ];
  const results=cases.map(c=>{try{const ok=!!c.fn();return{name:c.name,ok,detail:ok?"Conforme à ce qui est attendu":"Résultat inattendu, à revoir"};}catch(e){return{name:c.name,ok:false,detail:e.message};}});
  sendJson(res,200,{total:results.length,passed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results});
}

// ============================================================================
// Terravive Stock — module de gestion des stocks agricoles (intégré au serveur).
// Réutilise : auth de session (currentUser), stockage Supabase REST (sb) ou local
// (loadStore/saveStore), sendJson/readBody. Zéro dépendance ajoutée.
// Règle d'or : le disponible se CALCULE à partir des mouvements, jamais stocké en double.
// ============================================================================
const STOCK_UNITS = ["kg", "g", "t", "l", "unite", "caisse", "sac"];
const STOCK_LOSS_CAUSES = ["pourriture", "degradation", "invendu", "transport", "stockage", "autre"];
const STOCK_PAY_METHODS = ["especes", "mobile_money", "virement", "livraison"];
const STOCK_ADMINS = (process.env.STOCK_ADMINS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const STOCK_OPERATORS = (process.env.STOCK_OPERATORS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const STOCK_VIEWERS = (process.env.STOCK_VIEWERS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const STOCK_PUBLIC_ENABLED = /^(1|true|on|oui)$/i.test((process.env.STOCK_PUBLIC_ENABLED || "").trim());
const STOCK_PERMS = {
  admin: ["read", "products", "harvest", "sale", "validate", "loss", "payment", "producers", "export", "logs"],
  operateur: ["read", "products", "harvest", "sale", "validate", "loss", "payment", "producers", "export"],
  lecteur: ["read", "export"]
};
// Rôles Stock CONNECTÉS aux acteurs existants de Terravive :
//  - administrateur (propriétaire)            → rôle "admin"  (tout + journal)
//  - animateur de coopérative                 → rôle "operateur" (gère le stock de la coop)
//  - overrides facultatifs par variables d'env (STOCK_ADMINS / STOCK_OPERATORS / STOCK_VIEWERS)
// Un cultivateur « simple » n'a pas accès à la gestion interne ; côté clients, c'est la
// vitrine publique (lecture, et commandes une fois activées) qui s'adresse à eux.
function stockRole(u) {
  if (!u) return null;
  const e = normEmail(u.email);
  if (u.isAdmin || ADMIN_EMAILS.includes(e) || STOCK_ADMINS.includes(e)) return "admin";
  if (u.animator || STOCK_OPERATORS.includes(e)) return "operateur";
  if (STOCK_VIEWERS.includes(e)) return "lecteur";
  return null;
}
function stockCan(u, action) { const r = stockRole(u); return !!r && STOCK_PERMS[r].includes(action); }
// Images intégrées (reprises du prototype). Galerie par défaut, modifiable par admin/animateur.
const STOCK_DEFAULT_IMAGES = {
  tomate: "/stock/img/tomate.webp", concombre: "/stock/img/concombre.webp", piment: "/stock/img/piment.webp",
  aubergine: "/stock/img/aubergine.webp", laitue: "/stock/img/laitue.webp", gombo: "/stock/img/gombo.webp", poivron: "/stock/img/poivron.webp"
};
const STOCK_IMG_PATHS = new Set(Object.values(STOCK_DEFAULT_IMAGES));
function stockDefaultImage(name) {
  const n = String(name || "").toLowerCase();
  for (const key of Object.keys(STOCK_DEFAULT_IMAGES)) if (n.includes(key)) return STOCK_DEFAULT_IMAGES[key];
  return null;
}
// Sécurité : on n'accepte QUE nos chemins intégrés ou une data URL image bornée (pas d'URL externe).
function stockCleanImage(v) {
  if (typeof v !== "string" || !v) return undefined;             // undefined = ne pas changer
  if (v === "none") return null;                                 // retirer l'image
  if (STOCK_IMG_PATHS.has(v)) return v;                          // image intégrée
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= 600000) return v; // photo (<~440 Ko)
  return undefined;                                              // tout le reste est ignoré
}
async function stockGuard(req, res, action) {
  const user = await currentUser(req);
  if (!user) { sendJson(res, 401, { error: "Non connecté." }); return null; }
  if (!stockCan(user, action)) { sendJson(res, 403, { error: "Accès refusé : votre rôle ne permet pas cette action." }); return null; }
  return user;
}
const stkNow = () => new Date().toISOString();
const stkId = () => crypto.randomBytes(12).toString("hex");
const STOCK_TABLES = ["stock_products", "stock_producers", "stock_movements", "stock_harvests", "stock_sales", "stock_sale_items", "stock_payments", "stock_losses", "stock_logs"];
function stkLoad() { const s = loadStore(); for (const k of STOCK_TABLES) if (!Array.isArray(s[k])) s[k] = []; return s; }
// Accès données unifié (datasets de taille coopérative : on lit tout et on calcule en JS).
async function stkAll(table) {
  if (USE_DB) { try { return (await sb(`/trv_${table}?select=*&limit=5000`)) || []; } catch (e) { console.warn("stock read " + table + ":", e.message); return []; } }
  return stkLoad()[table].slice();
}
async function stkInsert(table, row) {
  if (USE_DB) await sb(`/trv_${table}`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([row]) });
  else { const s = stkLoad(); s[table].push(row); saveStore(s); }
  return row;
}
async function stkUpdate(table, id, patch) {
  if (USE_DB) await sb(`/trv_${table}?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
  else { const s = stkLoad(); const r = s[table].find(x => x.id === id); if (r) Object.assign(r, patch); saveStore(s); }
}
async function stkGet(table, id) {
  if (USE_DB) { const r = await sb(`/trv_${table}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`); return (r && r[0]) || null; }
  return stkLoad()[table].find(x => x.id === id) || null;
}
async function stockLog(action, user, ref) {
  const row = { id: stkId(), action: String(action).slice(0, 60), actor: user ? normEmail(user.email) : null, ref: ref || null, created_at: stkNow() };
  try { if (USE_DB) await sb("/trv_stock_audit_logs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([row]) }); else { const s = stkLoad(); s.stock_logs.push(row); saveStore(s); } } catch (e) { console.warn("stock log:", e.message); }
}
// Disponible d'un produit = somme signée de ses mouvements.
function stockOnHand(movements, productId) {
  let q = 0; for (const m of movements) if (m.product_id === productId) q += (m.type === "in" ? Number(m.qty) : -Number(m.qty));
  return Math.round(q * 1000) / 1000;
}
function stkNum(v) { const n = Number(v); return (isFinite(n)) ? n : NaN; }
function stkStatus(onhand, min) { if (onhand <= 0) return "rupture"; if (min > 0 && onhand <= min) return "bas"; return "ok"; }

// ---------- Produits ----------
async function handleStockProducts(req, res) {
  const user = await stockGuard(req, res, "read"); if (!user) return;
  try {
    const products = await stkAll("stock_products");
    const movements = await stkAll("stock_movements");
    const producers = await stkAll("stock_producers");
    const pmap = {}; for (const p of producers) pmap[p.id] = p.name;
    const rows = products.map(p => { const on = stockOnHand(movements, p.id); return { id: p.id, name: p.name, category: p.category || null, unit: p.unit, min_qty: Number(p.min_qty || 0), price: Number(p.price || 0), producer_id: p.producer_id || null, producer_name: p.producer_id ? (pmap[p.producer_id] || null) : null, is_public: !!p.is_public, image: p.image || null, on_hand: on, status: stkStatus(on, Number(p.min_qty || 0)) }; });
    rows.sort((a, b) => a.name.localeCompare(b.name));
    sendJson(res, 200, { products: rows, role: stockRole(user), units: STOCK_UNITS, default_images: STOCK_DEFAULT_IMAGES });
  } catch (e) { console.error("stock products:", e.message); sendJson(res, 500, { error: "Impossible de charger les produits pour le moment." }); }
}
async function handleStockProductCreate(req, res) {
  const user = await stockGuard(req, res, "products"); if (!user) return;
  try {
    const b = JSON.parse(await readBody(req) || "{}");
    const name = String(b.name || "").trim();
    if (!name) return sendJson(res, 400, { error: "Le nom du produit est obligatoire." });
    const unit = STOCK_UNITS.includes(b.unit) ? b.unit : "kg";
    const min_qty = Math.max(0, stkNum(b.min_qty) || 0);
    const price = Math.max(0, stkNum(b.price) || 0);
    let producer_id = null;
    if (b.producer_id) { const pr = await stkGet("stock_producers", String(b.producer_id)); if (!pr) return sendJson(res, 400, { error: "Producteur introuvable." }); producer_id = pr.id; }
    let image = stockCleanImage(b.image);
    if (image === undefined) image = stockDefaultImage(name);   // image par défaut selon le nom (tomate, concombre…)
    const row = { id: stkId(), name, category: b.category ? String(b.category).slice(0, 80) : null, unit, min_qty, price, producer_id, is_public: !!b.is_public, image, created_at: stkNow(), updated_at: stkNow(), created_by: user.email };
    await stkInsert("stock_products", row);
    await stockLog("product_create", user, { product_id: row.id });
    sendJson(res, 200, { ok: true, product: row });
  } catch (e) { console.error("stock product create:", e.message); sendJson(res, 500, { error: "Le produit n'a pas pu être enregistré." }); }
}
async function handleStockProductUpdate(req, res) {
  const user = await stockGuard(req, res, "products"); if (!user) return;
  try {
    const b = JSON.parse(await readBody(req) || "{}");
    if (!b.id) return sendJson(res, 400, { error: "Produit non précisé." });
    const p = await stkGet("stock_products", String(b.id)); if (!p) return sendJson(res, 404, { error: "Produit introuvable." });
    const patch = { updated_at: stkNow() };
    if (b.name !== undefined) { const n = String(b.name).trim(); if (!n) return sendJson(res, 400, { error: "Le nom ne peut pas être vide." }); patch.name = n; }
    if (b.category !== undefined) patch.category = b.category ? String(b.category).slice(0, 80) : null;
    if (b.unit !== undefined && STOCK_UNITS.includes(b.unit)) patch.unit = b.unit;
    if (b.min_qty !== undefined) patch.min_qty = Math.max(0, stkNum(b.min_qty) || 0);
    if (b.price !== undefined) patch.price = Math.max(0, stkNum(b.price) || 0);
    if (b.is_public !== undefined) patch.is_public = !!b.is_public;
    if (b.image !== undefined) { const im = stockCleanImage(b.image); if (im !== undefined) patch.image = im; }
    await stkUpdate("stock_products", p.id, patch);
    await stockLog("product_update", user, { product_id: p.id });
    sendJson(res, 200, { ok: true });
  } catch (e) { console.error("stock product update:", e.message); sendJson(res, 500, { error: "La modification n'a pas pu être enregistrée." }); }
}
async function handleStockProductGet(req, res) {
  const user = await stockGuard(req, res, "read"); if (!user) return;
  try {
    let id = ""; try { id = new URL(req.url, "http://x").searchParams.get("id") || ""; } catch (e) {}
    if (!id) return sendJson(res, 400, { error: "Produit non précisé." });
    const p = await stkGet("stock_products", id); if (!p) return sendJson(res, 404, { error: "Produit introuvable." });
    const movements = (await stkAll("stock_movements")).filter(m => m.product_id === id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const on = stockOnHand(movements, id);
    sendJson(res, 200, { product: { ...p, on_hand: on, status: stkStatus(on, Number(p.min_qty || 0)) }, movements: movements.slice(0, 100) });
  } catch (e) { console.error("stock product get:", e.message); sendJson(res, 500, { error: "Impossible de charger ce produit." }); }
}

// ---------- Producteurs ----------
async function handleStockProducers(req, res) {
  const user = await stockGuard(req, res, "read"); if (!user) return;
  try { const list = (await stkAll("stock_producers")).sort((a, b) => String(a.name).localeCompare(String(b.name))); sendJson(res, 200, { producers: list }); }
  catch (e) { console.error("stock producers:", e.message); sendJson(res, 500, { error: "Impossible de charger les producteurs." }); }
}
async function handleStockProducerCreate(req, res) {
  const user = await stockGuard(req, res, "producers"); if (!user) return;
  try {
    const b = JSON.parse(await readBody(req) || "{}");
    const name = String(b.name || "").trim(); if (!name) return sendJson(res, 400, { error: "Le nom du producteur est obligatoire." });
    const row = { id: stkId(), name, phone: b.phone ? String(b.phone).slice(0, 40) : null, region: b.region ? String(b.region).slice(0, 80) : null, cooperative: b.cooperative ? String(b.cooperative).slice(0, 120) : null, consent_public: !!b.consent_public, created_at: stkNow(), created_by: user.email };
    await stkInsert("stock_producers", row);
    await stockLog("producer_create", user, { producer_id: row.id });
    sendJson(res, 200, { ok: true, producer: row });
  } catch (e) { console.error("stock producer create:", e.message); sendJson(res, 500, { error: "Le producteur n'a pas pu être enregistré." }); }
}

// ---------- Récoltes (entrée en stock) ----------
async function handleStockHarvests(req, res) {
  const user = await stockGuard(req, res, "read"); if (!user) return;
  try {
    const list = (await stkAll("stock_harvests")).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const products = await stkAll("stock_products"); const pm = {}; for (const p of products) pm[p.id] = p.name;
    const producers = await stkAll("stock_producers"); const rm = {}; for (const p of producers) rm[p.id] = p.name;
    sendJson(res, 200, { harvests: list.slice(0, 200).map(h => ({ ...h, product_name: pm[h.product_id] || "—", producer_name: h.producer_id ? (rm[h.producer_id] || "—") : null })) });
  } catch (e) { console.error("stock harvests:", e.message); sendJson(res, 500, { error: "Impossible de charger les récoltes." }); }
}
async function handleStockHarvestCreate(req, res) {
  const user = await stockGuard(req, res, "harvest"); if (!user) return;
  try {
    const b = JSON.parse(await readBody(req) || "{}");
    const product = await stkGet("stock_products", String(b.product_id || "")); if (!product) return sendJson(res, 400, { error: "Sélectionnez un produit valide." });
    const qty = stkNum(b.qty); if (!(qty > 0)) return sendJson(res, 400, { error: "La quantité récoltée doit être supérieure à zéro." });
    let producer_id = null; if (b.producer_id) { const pr = await stkGet("stock_producers", String(b.producer_id)); if (!pr) return sendJson(res, 400, { error: "Producteur introuvable." }); producer_id = pr.id; }
    const id = stkId();
    const harvest = { id, product_id: product.id, producer_id, qty, unit: STOCK_UNITS.includes(b.unit) ? b.unit : product.unit, quality: b.quality ? String(b.quality).slice(0, 40) : null, parcel: b.parcel ? String(b.parcel).slice(0, 120) : null, batch_ref: b.batch_ref ? String(b.batch_ref).slice(0, 60) : null, harvested_at: /^\d{4}-\d{2}-\d{2}$/.test(b.harvested_at || "") ? b.harvested_at : null, created_at: stkNow(), created_by: user.email };
    await stkInsert("stock_harvests", harvest);
    // Mouvement d'entrée correspondant.
    await stkInsert("stock_movements", { id: stkId(), product_id: product.id, type: "in", qty, reason: "harvest", ref_type: "harvest", ref_id: id, note: null, created_at: stkNow(), created_by: user.email });
    await stockLog("harvest_create", user, { harvest_id: id, product_id: product.id, qty });
    sendJson(res, 200, { ok: true, harvest });
  } catch (e) { console.error("stock harvest create:", e.message); sendJson(res, 500, { error: "La récolte n'a pas pu être enregistrée." }); }
}

// ---------- Pertes (sortie de stock, tracée) ----------
async function handleStockLosses(req, res) {
  const user = await stockGuard(req, res, "read"); if (!user) return;
  try {
    const list = (await stkAll("stock_losses")).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const products = await stkAll("stock_products"); const pm = {}, prc = {}; for (const p of products) { pm[p.id] = p.name; prc[p.id] = Number(p.price || 0); }
    sendJson(res, 200, { losses: list.slice(0, 200).map(l => ({ ...l, product_name: pm[l.product_id] || "—", value: Number(l.qty) * (prc[l.product_id] || 0) })) });
  } catch (e) { console.error("stock losses:", e.message); sendJson(res, 500, { error: "Impossible de charger les pertes." }); }
}
async function handleStockLossCreate(req, res) {
  const user = await stockGuard(req, res, "loss"); if (!user) return;
  try {
    const b = JSON.parse(await readBody(req) || "{}");
    const product = await stkGet("stock_products", String(b.product_id || "")); if (!product) return sendJson(res, 400, { error: "Sélectionnez un produit valide." });
    const qty = stkNum(b.qty); if (!(qty > 0)) return sendJson(res, 400, { error: "La quantité perdue doit être supérieure à zéro." });
    const cause = STOCK_LOSS_CAUSES.includes(b.cause) ? b.cause : "autre";
    const movements = await stkAll("stock_movements"); const avail = stockOnHand(movements, product.id);
    if (qty > avail) return sendJson(res, 400, { error: `Perte supérieure au stock disponible (disponible : ${avail}).` });
    const id = stkId();
    const loss = { id, product_id: product.id, qty, cause, note: b.note ? String(b.note).slice(0, 300) : null, lost_at: /^\d{4}-\d{2}-\d{2}$/.test(b.lost_at || "") ? b.lost_at : null, created_at: stkNow(), created_by: user.email };
    await stkInsert("stock_losses", loss);
    await stkInsert("stock_movements", { id: stkId(), product_id: product.id, type: "out", qty, reason: "loss", ref_type: "loss", ref_id: id, note: cause, created_at: stkNow(), created_by: user.email });
    await stockLog("loss_create", user, { loss_id: id, product_id: product.id, qty, cause });
    sendJson(res, 200, { ok: true, loss });
  } catch (e) { console.error("stock loss create:", e.message); sendJson(res, 500, { error: "La perte n'a pas pu être enregistrée." }); }
}

// ---------- Ventes ----------
async function handleStockSales(req, res) {
  const user = await stockGuard(req, res, "read"); if (!user) return;
  try {
    const list = (await stkAll("stock_sales")).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    sendJson(res, 200, { sales: list.slice(0, 200).map(s => ({ ...s, total: Number(s.total || 0), paid: Number(s.paid || 0), remaining: Math.max(0, Number(s.total || 0) - Number(s.paid || 0)) })) });
  } catch (e) { console.error("stock sales:", e.message); sendJson(res, 500, { error: "Impossible de charger les ventes." }); }
}
async function handleStockSaleGet(req, res) {
  const user = await stockGuard(req, res, "read"); if (!user) return;
  try {
    let id = ""; try { id = new URL(req.url, "http://x").searchParams.get("id") || ""; } catch (e) {}
    const sale = await stkGet("stock_sales", id); if (!sale) return sendJson(res, 404, { error: "Vente introuvable." });
    const items = (await stkAll("stock_sale_items")).filter(i => i.sale_id === id);
    const payments = (await stkAll("stock_payments")).filter(p => p.sale_id === id);
    const products = await stkAll("stock_products"); const pm = {}; for (const p of products) pm[p.id] = p.name;
    const total = Number(sale.total || 0), paid = Number(sale.paid || 0);
    sendJson(res, 200, { sale: { ...sale, total, paid, remaining: Math.max(0, total - paid), settlement: paid <= 0 ? "impaye" : paid >= total ? "solde" : "partiel" }, items: items.map(i => ({ ...i, product_name: pm[i.product_id] || "—", qty: Number(i.qty), unit_price: Number(i.unit_price), subtotal: Number(i.subtotal) })), payments });
  } catch (e) { console.error("stock sale get:", e.message); sendJson(res, 500, { error: "Impossible de charger cette vente." }); }
}
async function handleStockSaleCreate(req, res) {
  const user = await stockGuard(req, res, "sale"); if (!user) return;
  if (!qualityRateLimit(req, res, "stock_sale", 60)) return;
  try {
    const b = JSON.parse(await readBody(req) || "{}");
    const rawItems = Array.isArray(b.items) ? b.items : [];
    if (!rawItems.length) return sendJson(res, 400, { error: "Ajoutez au moins une ligne à la vente." });
    const products = await stkAll("stock_products"); const pById = {}; for (const p of products) pById[p.id] = p;
    const items = []; let total = 0;
    for (const it of rawItems) {
      const p = pById[String(it.product_id || "")]; if (!p) return sendJson(res, 400, { error: "Un produit de la vente est introuvable." });
      const qty = stkNum(it.qty); if (!(qty > 0)) return sendJson(res, 400, { error: "Chaque ligne doit avoir une quantité positive." });
      // Le serveur recalcule : prix fourni sinon prix du produit ; sous-total = qty × prix.
      const unit_price = (it.unit_price !== undefined && stkNum(it.unit_price) >= 0) ? stkNum(it.unit_price) : Number(p.price || 0);
      const subtotal = Math.round(qty * unit_price * 100) / 100;
      total += subtotal;
      items.push({ id: stkId(), product_id: p.id, qty, unit_price, subtotal });
    }
    total = Math.round(total * 100) / 100;
    const id = stkId();
    const reference = "V-" + new Date().toISOString().slice(2, 10).replace(/-/g, "") + "-" + id.slice(0, 4).toUpperCase();
    const sale = { id, reference, customer_name: b.customer_name ? String(b.customer_name).slice(0, 120) : null, status: "brouillon", total, paid: 0, sold_at: /^\d{4}-\d{2}-\d{2}$/.test(b.sold_at || "") ? b.sold_at : null, created_at: stkNow(), validated_at: null, created_by: user.email };
    await stkInsert("stock_sales", sale);
    for (const it of items) await stkInsert("stock_sale_items", { ...it, sale_id: id });
    await stockLog("sale_create", user, { sale_id: id, total });
    sendJson(res, 200, { ok: true, saleId: id, reference, total, status: "brouillon" });
  } catch (e) { console.error("stock sale create:", e.message); sendJson(res, 500, { error: "La vente n'a pas pu être créée." }); }
}
// Validation ATOMIQUE (RPC en base, logique en mémoire en local). Décrémente le stock.
async function stockValidateSale(saleId, actor) {
  if (USE_DB) {
    const out = await sb("/rpc/trv_stock_validate_sale", { method: "POST", body: JSON.stringify({ p_sale_id: saleId, p_actor: actor }) });
    return out && typeof out === "object" ? out : { ok: false, error: "Réponse inattendue de la base." };
  }
  const s = stkLoad();
  const sale = s.stock_sales.find(x => x.id === saleId);
  if (!sale) return { ok: false, error: "Vente introuvable." };
  if (sale.status === "validee") return { ok: false, error: "Cette vente est déjà validée." };
  if (sale.status === "annulee") return { ok: false, error: "Cette vente est annulée." };
  const items = s.stock_sale_items.filter(i => i.sale_id === saleId);
  const need = {}; for (const i of items) need[i.product_id] = (need[i.product_id] || 0) + Number(i.qty);
  for (const pid of Object.keys(need)) { const avail = stockOnHand(s.stock_movements, pid); if (need[pid] > avail) return { ok: false, error: `Stock insuffisant pour un produit (demandé ${need[pid]}, disponible ${avail}).` }; }
  for (const i of items) s.stock_movements.push({ id: stkId(), product_id: i.product_id, type: "out", qty: Number(i.qty), reason: "sale", ref_type: "sale", ref_id: saleId, created_at: stkNow(), created_by: actor });
  sale.status = "validee"; sale.validated_at = stkNow();
  s.stock_logs.push({ id: stkId(), action: "sale_validate", actor: normEmail(actor), ref: { sale_id: saleId }, created_at: stkNow() });
  saveStore(s);
  return { ok: true };
}
async function handleStockSaleValidate(req, res) {
  const user = await stockGuard(req, res, "validate"); if (!user) return;
  try {
    const b = JSON.parse(await readBody(req) || "{}");
    const id = String(b.id || ""); if (!id) return sendJson(res, 400, { error: "Vente non précisée." });
    const sale = await stkGet("stock_sales", id); if (!sale) return sendJson(res, 404, { error: "Vente introuvable." });
    const r = await stockValidateSale(id, user.email);
    if (!r.ok) return sendJson(res, 400, { error: r.error || "Validation impossible." });
    await stockLog("sale_validate", user, { sale_id: id });
    sendJson(res, 200, { ok: true });
  } catch (e) { console.error("stock sale validate:", e.message); sendJson(res, 500, { error: "La validation n'a pas pu aboutir." }); }
}
async function handleStockSaleCancel(req, res) {
  const user = await stockGuard(req, res, "validate"); if (!user) return;
  try {
    const b = JSON.parse(await readBody(req) || "{}");
    const id = String(b.id || ""); const sale = await stkGet("stock_sales", id); if (!sale) return sendJson(res, 404, { error: "Vente introuvable." });
    if (sale.status === "annulee") return sendJson(res, 400, { error: "Cette vente est déjà annulée." });
    // Si elle était validée, on COMPENSE par des mouvements d'entrée (traçable, pas de suppression).
    if (sale.status === "validee") {
      const items = (await stkAll("stock_sale_items")).filter(i => i.sale_id === id);
      for (const i of items) await stkInsert("stock_movements", { id: stkId(), product_id: i.product_id, type: "in", qty: Number(i.qty), reason: "adjustment", ref_type: "sale_cancel", ref_id: id, note: "annulation vente", created_at: stkNow(), created_by: user.email });
    }
    await stkUpdate("stock_sales", id, { status: "annulee" });
    await stockLog("sale_cancel", user, { sale_id: id });
    sendJson(res, 200, { ok: true });
  } catch (e) { console.error("stock sale cancel:", e.message); sendJson(res, 500, { error: "L'annulation n'a pas pu aboutir." }); }
}

// ---------- Paiements ----------
async function handleStockPaymentCreate(req, res) {
  const user = await stockGuard(req, res, "payment"); if (!user) return;
  try {
    const b = JSON.parse(await readBody(req) || "{}");
    const sale = await stkGet("stock_sales", String(b.sale_id || "")); if (!sale) return sendJson(res, 404, { error: "Vente introuvable." });
    if (sale.status === "annulee") return sendJson(res, 400, { error: "Vente annulée : aucun paiement possible." });
    const amount = stkNum(b.amount); if (!(amount > 0)) return sendJson(res, 400, { error: "Le montant doit être supérieur à zéro." });
    const method = STOCK_PAY_METHODS.includes(b.method) ? b.method : "especes";
    const paidBefore = Number(sale.paid || 0);
    const row = { id: stkId(), sale_id: sale.id, amount, method, reference: b.reference ? String(b.reference).slice(0, 80) : null, paid_at: /^\d{4}-\d{2}-\d{2}$/.test(b.paid_at || "") ? b.paid_at : null, created_at: stkNow(), created_by: user.email };
    await stkInsert("stock_payments", row);
    await stkUpdate("stock_sales", sale.id, { paid: Math.round((paidBefore + amount) * 100) / 100 });
    await stockLog("payment_create", user, { sale_id: sale.id, amount, method });
    sendJson(res, 200, { ok: true, payment: row });
  } catch (e) { console.error("stock payment create:", e.message); sendJson(res, 500, { error: "Le paiement n'a pas pu être enregistré." }); }
}

// ---------- Tableau de bord (données réelles) ----------
function stkInPeriod(dateStr, from, to) {
  if (!dateStr) return true;
  const d = String(dateStr).slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}
async function handleStockOverview(req, res) {
  const user = await stockGuard(req, res, "read"); if (!user) return;
  try {
    let from = "", to = ""; try { const q = new URL(req.url, "http://x").searchParams; from = /^\d{4}-\d{2}-\d{2}$/.test(q.get("from") || "") ? q.get("from") : ""; to = /^\d{4}-\d{2}-\d{2}$/.test(q.get("to") || "") ? q.get("to") : ""; } catch (e) {}
    const products = await stkAll("stock_products");
    const movements = await stkAll("stock_movements");
    const sales = await stkAll("stock_sales");
    const saleItems = await stkAll("stock_sale_items");
    const payments = await stkAll("stock_payments");
    const losses = await stkAll("stock_losses");
    const harvests = await stkAll("stock_harvests");
    const priceOf = {}; const nameOf = {}; for (const p of products) { priceOf[p.id] = Number(p.price || 0); nameOf[p.id] = p.name; }
    let low = 0, out = 0, stockValue = 0;
    for (const p of products) { const on = stockOnHand(movements, p.id); const st = stkStatus(on, Number(p.min_qty || 0)); if (st === "rupture") out++; else if (st === "bas") low++; if (on > 0) stockValue += on * priceOf[p.id]; }
    const validSales = sales.filter(s => s.status === "validee" && stkInPeriod(s.validated_at || s.created_at, from, to));
    const revenue = validSales.reduce((n, s) => n + Number(s.total || 0), 0);
    const paidInPeriod = payments.filter(p => stkInPeriod(p.paid_at || p.created_at, from, to)).reduce((n, p) => n + Number(p.amount || 0), 0);
    const receivables = sales.filter(s => s.status === "validee").reduce((n, s) => n + Math.max(0, Number(s.total || 0) - Number(s.paid || 0)), 0);
    const periodLosses = losses.filter(l => stkInPeriod(l.lost_at || l.created_at, from, to));
    const lossQty = periodLosses.reduce((n, l) => n + Number(l.qty || 0), 0);
    const lossValue = periodLosses.reduce((n, l) => n + Number(l.qty || 0) * (priceOf[l.product_id] || 0), 0);
    const periodHarvests = harvests.filter(h => stkInPeriod(h.harvested_at || h.created_at, from, to));
    // Produits les plus vendus (sur ventes validées de la période)
    const validIds = new Set(validSales.map(s => s.id));
    const sold = {}; for (const it of saleItems) if (validIds.has(it.sale_id)) sold[it.product_id] = (sold[it.product_id] || 0) + Number(it.qty || 0);
    const topProducts = Object.entries(sold).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, qty]) => ({ name: nameOf[id] || "—", qty: Math.round(qty * 1000) / 1000 }));
    const recent = movements.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10).map(m => ({ ...m, product_name: nameOf[m.product_id] || "—" }));
    sendJson(res, 200, {
      role: stockRole(user), source: USE_DB ? "supabase" : "local", public_enabled: STOCK_PUBLIC_ENABLED,
      metrics: {
        products: products.length, low_stock: low, out_of_stock: out,
        stock_value: Math.round(stockValue), revenue: Math.round(revenue), paid: Math.round(paidInPeriod),
        receivables: Math.round(receivables), loss_qty: Math.round(lossQty * 1000) / 1000, loss_value: Math.round(lossValue),
        sales_count: validSales.length, harvests_count: periodHarvests.length, losses_count: periodLosses.length
      },
      top_products: topProducts, recent_movements: recent, filters: { from, to }
    });
  } catch (e) { console.error("stock overview:", e.message); sendJson(res, 500, { error: "Impossible de charger le tableau de bord pour le moment." }); }
}

// ---------- Export CSV ----------
async function handleStockExport(req, res) {
  const user = await stockGuard(req, res, "export"); if (!user) return;
  if (!qualityRateLimit(req, res, "stock_export", 20)) return;
  try {
    const type = (() => { try { return new URL(req.url, "http://x").searchParams.get("type") || "products"; } catch (e) { return "products"; } })();
    const stamp = new Date().toISOString().slice(0, 10); const sep = ";"; let head = [], lines = [], fname = "";
    const products = await stkAll("stock_products"); const nameOf = {}; for (const p of products) nameOf[p.id] = p.name;
    if (type === "movements") {
      head = ["Date", "Produit", "Type", "Quantité", "Motif", "Référence", "Par"];
      const mv = (await stkAll("stock_movements")).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      lines = mv.map(m => [m.created_at, nameOf[m.product_id] || m.product_id, m.type === "in" ? "entrée" : "sortie", m.qty, m.reason, m.ref_id || "", m.created_by || ""]);
      fname = `terravive-stock-mouvements-${stamp}.csv`;
    } else if (type === "sales") {
      head = ["Référence", "Date", "Client", "Statut", "Total FCFA", "Payé FCFA", "Reste FCFA"];
      const sa = (await stkAll("stock_sales")).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      lines = sa.map(s => [s.reference, s.created_at, s.customer_name || "", s.status, Number(s.total || 0), Number(s.paid || 0), Math.max(0, Number(s.total || 0) - Number(s.paid || 0))]);
      fname = `terravive-stock-ventes-${stamp}.csv`;
    } else {
      head = ["Produit", "Catégorie", "Unité", "Stock disponible", "Seuil bas", "Prix FCFA", "Statut"];
      const movements = await stkAll("stock_movements");
      lines = products.map(p => { const on = stockOnHand(movements, p.id); return [p.name, p.category || "", p.unit, on, Number(p.min_qty || 0), Number(p.price || 0), stkStatus(on, Number(p.min_qty || 0))]; });
      fname = `terravive-stock-produits-${stamp}.csv`;
    }
    const csv = "﻿" + [head.join(sep)].concat(lines.map(r => r.map(qgCsvCell).join(sep))).join("\r\n");
    await stockLog("export_csv", user, { type });
    res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${fname}"` });
    res.end(csv);
  } catch (e) { console.error("stock export:", e.message); sendJson(res, 500, { error: "L'export n'a pas pu être généré." }); }
}

// ---------- Journal d'audit ----------
async function handleStockLogs(req, res) {
  const user = await stockGuard(req, res, "logs"); if (!user) return;
  try { const logs = (await stkAll("stock_logs")).concat(USE_DB ? (await stkAll("stock_audit_logs")) : []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 100); sendJson(res, 200, { logs }); }
  catch (e) { console.error("stock logs:", e.message); sendJson(res, 500, { error: "Journal indisponible pour le moment." }); }
}

// ---------- Vitrine publique (lecture seule, activée par STOCK_PUBLIC_ENABLED) ----------
async function handleStockPublicProducts(req, res) {
  if (!STOCK_PUBLIC_ENABLED) return sendJson(res, 404, { error: "La vitrine publique n'est pas activée." });
  try {
    const products = (await stkAll("stock_products")).filter(p => p.is_public);
    const movements = await stkAll("stock_movements");
    const producers = await stkAll("stock_producers"); const pr = {}; for (const p of producers) pr[p.id] = p;
    const rows = products.map(p => { const on = stockOnHand(movements, p.id); const prod = p.producer_id ? pr[p.producer_id] : null; return { name: p.name, category: p.category || null, unit: p.unit, price: Number(p.price || 0), image: p.image || null, available: on > 0 ? on : 0, producer: (prod && prod.consent_public) ? prod.name : null }; }).filter(r => r.available > 0);
    sendJson(res, 200, { products: rows });
  } catch (e) { console.error("stock public:", e.message); sendJson(res, 500, { error: "Catalogue indisponible." }); }
}
// Commandes publiques : préparées côté base, VOLONTAIREMENT désactivées tant que non configurées.
function handleStockPublicOrder(req, res) {
  return sendJson(res, 503, { error: "Les commandes en ligne ne sont pas encore activées. Cette fonctionnalité sera ouverte après configuration (décision commerciale et moyens de paiement)." });
}

// ---------- Routeur ----------
const server = http.createServer((req, res) => {
  const url = (req.url || "").split("?")[0];
  // Point de contrôle de santé (pour un moniteur d'uptime : garde le service éveillé et signale les pannes).
  if (req.method === "GET" && (url === "/healthz" || url === "/api/health")) return sendJson(res, 200, { ok: true, service: "terravive", time: new Date().toISOString(), uptime_s: Math.round(process.uptime()), db: USE_DB ? "supabase" : "local" });
  // ---- Terravive Stock ----
  if (req.method === "GET" && url === "/api/stock/overview") return handleStockOverview(req, res);
  if (req.method === "GET" && url === "/api/stock/products") return handleStockProducts(req, res);
  if (req.method === "POST" && url === "/api/stock/products") return handleStockProductCreate(req, res);
  if (req.method === "POST" && url === "/api/stock/products/update") return handleStockProductUpdate(req, res);
  if (req.method === "GET" && url === "/api/stock/product") return handleStockProductGet(req, res);
  if (req.method === "GET" && url === "/api/stock/producers") return handleStockProducers(req, res);
  if (req.method === "POST" && url === "/api/stock/producers") return handleStockProducerCreate(req, res);
  if (req.method === "GET" && url === "/api/stock/harvests") return handleStockHarvests(req, res);
  if (req.method === "POST" && url === "/api/stock/harvests") return handleStockHarvestCreate(req, res);
  if (req.method === "GET" && url === "/api/stock/losses") return handleStockLosses(req, res);
  if (req.method === "POST" && url === "/api/stock/losses") return handleStockLossCreate(req, res);
  if (req.method === "GET" && url === "/api/stock/sales") return handleStockSales(req, res);
  if (req.method === "GET" && url === "/api/stock/sale") return handleStockSaleGet(req, res);
  if (req.method === "POST" && url === "/api/stock/sales") return handleStockSaleCreate(req, res);
  if (req.method === "POST" && url === "/api/stock/sales/validate") return handleStockSaleValidate(req, res);
  if (req.method === "POST" && url === "/api/stock/sales/cancel") return handleStockSaleCancel(req, res);
  if (req.method === "POST" && url === "/api/stock/payments") return handleStockPaymentCreate(req, res);
  if (req.method === "GET" && url === "/api/stock/export.csv") return handleStockExport(req, res);
  if (req.method === "GET" && url === "/api/stock/logs") return handleStockLogs(req, res);
  if (req.method === "GET" && url === "/api/stock/public/products") return handleStockPublicProducts(req, res);
  if (req.method === "POST" && url === "/api/stock/public/orders") return handleStockPublicOrder(req, res);
  if (req.method === "POST" && url === "/api/auth/register") return handleRegister(req, res);
  if (req.method === "POST" && url === "/api/auth/login") return handleLogin(req, res);
  if (req.method === "POST" && url === "/api/auth/logout") return handleLogout(req, res);
  if (req.method === "GET" && url === "/api/auth/me") return handleMe(req, res);
  if (req.method === "POST" && url === "/api/plan") return handlePlan(req, res);
  if (req.method === "GET" && url === "/api/plans") return handlePlansList(req, res);
  if (req.method === "GET" && url === "/api/plan") return handlePlanGet(req, res);
  if (req.method === "GET" && url === "/api/parcels") return handleParcelsList(req, res);
  if (req.method === "POST" && url === "/api/parcels") return handleParcelSave(req, res);
  if (req.method === "POST" && url === "/api/parcels/delete") return handleParcelDelete(req, res);
  if (req.method === "GET" && url === "/api/coop/me") return handleCoopMe(req, res);
  if (req.method === "POST" && url === "/api/coop/create") return handleCoopCreate(req, res);
  if (req.method === "POST" && url === "/api/coop/join") return handleCoopJoin(req, res);
  if (req.method === "POST" && url === "/api/coop/leave") return handleCoopLeave(req, res);
  if (req.method === "GET" && url === "/api/coop/overview") return handleCoopOverview(req, res);
  if (req.method === "GET" && url.startsWith("/api/coop/member/plans")) return handleCoopMemberPlans(req, res);
  if (req.method === "GET" && url.startsWith("/api/coop/member/plan")) return handleCoopMemberPlanGet(req, res);
  if (req.method === "POST" && url === "/api/coop/member/plan") return handleCoopMemberPlanCreate(req, res);
  if (req.method === "GET" && url === "/api/coop/equipment") return handleEquipList(req, res);
  if (req.method === "POST" && url === "/api/coop/equipment") return handleEquipAdd(req, res);
  if (req.method === "POST" && url === "/api/coop/equipment/delete") return handleEquipDelete(req, res);
  if (req.method === "POST" && url === "/api/coop/equipment/reserve") return handleEquipReserve(req, res);
  if (req.method === "POST" && url === "/api/coop/equipment/reservation") return handleEquipResaUpdate(req, res);
  if (req.method === "GET" && url === "/api/coop/buy") return handleBuyList(req, res);
  if (req.method === "POST" && url === "/api/coop/buy") return handleBuyCreate(req, res);
  if (req.method === "POST" && url === "/api/coop/buy/join") return handleBuyJoin(req, res);
  if (req.method === "POST" && url === "/api/coop/buy/close") return handleBuyClose(req, res);
  if (req.method === "POST" && url === "/api/coop/buy/delete") return handleBuyDelete(req, res);
  if (req.method === "POST" && url === "/api/ingest") return handleIngest(req, res);
  if (req.method === "POST" && url === "/api/readings/clear") return handleReadingsClear(req, res);
  if (req.method === "GET" && url === "/api/station") return handleStation(req, res);
  if (req.method === "GET" && url === "/api/dashboard") return handleDashboard(req, res);
  if (req.method === "GET" && url === "/api/weather") return handleWeather(req, res);
  if (req.method === "POST" && url === "/api/arduino") return handleArduino(req, res);
  if (req.method === "GET" && url === "/api/devices") return handleDevicesList(req, res);
  if (req.method === "GET" && url === "/api/device") return handleDeviceGet(req, res);
  if (req.method === "POST" && url === "/api/chat") return handleChat(req, res);
  if (req.method === "POST" && url === "/api/diagnostic") return handleDiagnostic(req, res);
  if (req.method === "GET" && url === "/api/admin/users") return handleAdminUsers(req, res);
  if (req.method === "GET" && url === "/api/admin/questions") return handleAdminQuestions(req, res);
  if (req.method === "POST" && url === "/api/admin/animator") return handleAdminSetAnimator(req, res);
  if (req.method === "GET" && url === "/api/admin/animator-requests") return handleAdminAnimRequests(req, res);
  if (req.method === "POST" && url === "/api/admin/animator-requests/decide") return handleAdminAnimDecide(req, res);
  if (req.method === "GET" && url === "/api/animator/request") return handleAnimRequestGet(req, res);
  if (req.method === "POST" && url === "/api/animator/request") return handleAnimRequestCreate(req, res);
  if (req.method === "GET" && url === "/api/quality/overview") return handleQualityOverview(req, res);
  if (req.method === "GET" && url === "/api/quality/audit") return handleQualityAuditGet(req, res);
  if (req.method === "POST" && url === "/api/quality/audit") return handleQualityAudit(req, res);
  if (req.method === "POST" && url === "/api/quality/issue") return handleQualityIssue(req, res);
  if (req.method === "GET" && url === "/api/quality/compare") return handleQualityCompare(req, res);
  if (req.method === "GET" && url === "/api/quality/export.csv") return handleQualityExport(req, res);
  if (req.method === "GET" && url === "/api/quality/notifications") return handleQualityNotifs(req, res);
  if (req.method === "POST" && url === "/api/quality/notifications/read") return handleQualityNotifRead(req, res);
  if (req.method === "GET" && url === "/api/quality/logs") return handleQualityLogs(req, res);
  if (req.method === "POST" && url === "/api/quality/suggest") return handleQualitySuggest(req, res);
  if (req.method === "POST" && url === "/api/quality/tests") return handleQualityTests(req, res);
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
