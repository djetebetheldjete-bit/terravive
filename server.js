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
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".ico": "image/x-icon", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json; charset=utf-8", ".json": "application/json; charset=utf-8" };
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

function qualityAnalyzePlan(plan) {
  const content = String((plan && (plan.content || plan.notes)) || "");
  const headings = (content.match(/^#{1,3}\s*(?:\d{1,2}\s*[\.\-:)]|section\s+\d{1,2})/gim) || []).length;
  const alerts = [];
  if (!content.trim()) alerts.push({ severity: "high", message: "Cet itinéraire est vide : il n'y a aucun texte à contrôler." });
  if (content.trim() && headings < 18) alerts.push({ severity: "medium", message: `Vous ne retrouvez que ${headings} section(s) numérotée(s) : vérifiez que les 18 sections de l'itinéraire sont bien présentes.` });
  if (/chaulage|chaux/i.test(content) && QG_PH_UNKNOWN.test(content) && QG_LIME_DOSE.test(content)) {
    alerts.push({ severity: "high", message: "Une dose de chaux est chiffrée alors que le pH du sol n'est pas connu : à vérifier avant de conseiller un chaulage." });
  }
  if (/\b(?:garanti|sans aucun risque|sans danger|efficacité garantie)\b/i.test(content)) alerts.push({ severity: "medium", message: "Formulation trop catégorique (« garanti », « sans risque »…) : pensez à rappeler l'incertitude et les précautions d'usage." });
  // Prix chiffré en FCFA : les prix doivent venir du producteur, pas du modèle.
  if (QG_FCFA_AMOUNT.test(content)) alerts.push({ severity: "medium", message: "Un montant en F CFA est chiffré dans l'itinéraire : vérifiez qu'il n'est pas inventé — les prix doivent venir du producteur." });
  // Marge mentionnée sans la distinction « marge ≠ bénéfice réel ».
  if (/\bmarge\b/i.test(content) && !/n['’]est pas\s+(?:le\s+|un\s+)?b[ée]n[ée]fice/i.test(content)) {
    alerts.push({ severity: "low", message: "La « marge » est mentionnée sans rappeler qu'elle n'est pas le bénéfice réel du producteur : à vérifier." });
  }
  // Rendement chiffré (t/ha) sans cadrage prudent (scénarios / indicatif).
  if (/rendement/i.test(content) && /(?:\bt\s*\/\s*ha\b|tonnes?\b)/i.test(content) && !/(prudent|sc[ée]nario|indicatif|repère|ordre de grandeur)/i.test(content)) {
    alerts.push({ severity: "low", message: "Un rendement chiffré (t/ha) apparaît sans cadrage prudent (scénario, ordre de grandeur, valeur indicative) : à vérifier." });
  }
  if (/\b(?:prix|coût|FCFA|XOF)\b/i.test(content) && /(?:à compléter|à vérifier localement|non vérifié)/i.test(content)) {
    // Cette combinaison peut être légitime : avertissement seulement, jamais une erreur bloquante.
    alerts.push({ severity: "low", message: "Des estimations économiques sont marquées « à compléter / à vérifier localement » : pensez à les confirmer avec le producteur." });
  }
  return { headings, alerts, status: alerts.some(a => a.severity === "high") ? "error" : alerts.length ? "warn" : "ok" };
}
async function qualityListPlans() {
  if (USE_DB) return (await sb("/trv_plans?select=id,title,crop,region,content,notes,created_at&order=created_at.desc&limit=50")) || [];
  return Object.values(loadStore().plans || {}).sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||""))).slice(0,50);
}
async function qualityListAudits() {
  if (USE_DB) {
    try {
      const rows = (await sb("/trv_quality_audits?select=id,plan_id,title,status,alert_count,alerts,created_at,kind&order=created_at.desc&limit=100")) || [];
      // Les enregistrements de banc de tests ne sont pas des audits d'itinéraires.
      return rows.filter((row) => row.kind !== "tests").slice(0, 50);
    }
    catch (e) { console.warn("Quality Guard history unavailable:", e.message); return []; }
  }
  const st = loadStore(); return (st.qualityAudits || []).slice().reverse().slice(0,50);
}
async function handleQualityOverview(req,res) {
  const user = await currentUser(req);
  if (!user) return sendJson(res,401,{error:"Non connecté."});
  if (!isAdmin(user)) return sendJson(res,403,{error:"Réservé à l'administrateur."});
  try {
    const plans = await qualityListPlans();
    const audits = await qualityListAudits();
    sendJson(res,200,{user:{name:user.name||"administrateur",email:user.email},source:USE_DB?"supabase":"local",plans:plans.map(p=>{const q=qualityAnalyzePlan(p);return {id:p.id,title:p.title,crop:p.crop,region:p.region,created_at:p.created_at,sections:q.headings,status:q.status};}),audits});
  } catch(e) { sendJson(res,500,{error:"Impossible de charger vos données pour le moment. Réessayez dans un instant."}); }
}
async function handleQualityAudit(req,res) {
  const user = await currentUser(req);
  if (!user) return sendJson(res,401,{error:"Non connecté."});
  if (!isAdmin(user)) return sendJson(res,403,{error:"Réservé à l'administrateur."});
  try {
    const body = JSON.parse(await readBody(req) || "{}");
    if (!body.id || typeof body.id !== "string") return sendJson(res,400,{error:"Aucun itinéraire sélectionné."});
    let plan = null;
    if (USE_DB) { const rows = await sb(`/trv_plans?id=eq.${encodeURIComponent(body.id)}&select=id,title,crop,region,content,notes,created_at&limit=1`); plan = rows && rows[0]; }
    else plan = (loadStore().plans || {})[body.id] || null;
    if (!plan) return sendJson(res,404,{error:"Itinéraire introuvable."});
    const q = qualityAnalyzePlan(plan);
    const audit = {id:crypto.randomBytes(12).toString("hex"),plan_id:plan.id,title:plan.title||plan.crop||"Itinéraire",status:q.status,alert_count:q.alerts.length,alerts:q.alerts,created_at:new Date().toISOString(),created_by:user.email};
    let saved = true;
    let saveWarning = null;
    if (USE_DB) {
      try {
        await sb("/trv_quality_audits",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify([{
          id:audit.id,
          plan_id:audit.plan_id,
          title:audit.title,
          status:audit.status,
          alert_count:audit.alert_count,
          alerts:audit.alerts,
          created_at:audit.created_at,
          created_by:audit.created_by,
          // Compatibilité avec l'ancien schéma Supabase encore présent en production.
          kind:"audit",
          plan_title:audit.title,
          issues:audit.alerts
        }])});
      } catch (dbError) {
        // Le contrôle du contenu reste utile même si l'historique Supabase n'est pas encore configuré.
        saved = false;
        saveWarning = "Contrôle effectué, mais l'historique n'a pas pu être enregistré dans Supabase. Vérifiez la table trv_quality_audits et ses permissions. Détail technique : " + dbError.message;
        console.error("Quality Guard audit history save failed:", dbError.message);
      }
    } else {
      try {
        const st=loadStore(); if(!Array.isArray(st.qualityAudits))st.qualityAudits=[];st.qualityAudits.push(audit);if(st.qualityAudits.length>500)st.qualityAudits=st.qualityAudits.slice(-500);saveStore(st);
      } catch (localError) { saved = false; saveWarning = "Contrôle effectué, mais l'historique local n'a pas pu être enregistré."; }
    }
    sendJson(res,200,{ok:true,status:q.status,alerts:q.alerts,sections:q.headings,auditId:audit.id,saved,warning:saveWarning});
  } catch(e) { console.error("Quality audit:",e.message);sendJson(res,500,{error:"Le contrôle n'a pas pu aboutir. Réessayez dans un instant ; en cas de besoin, le détail technique est dans les journaux Render."}); }
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
    {name:"Contenu vide détecté",fn:()=>qualityAnalyzePlan({content:""}).alerts.some(a=>a.severity==="high")},
    {name:"18 sections numérotées détectées",fn:()=>qualityAnalyzePlan(sampleGood).headings===18},
    {name:"Sections manquantes signalées",fn:()=>qualityAnalyzePlan(sampleMissing).alerts.some(a=>/18 sections/.test(a.message))},
    {name:"Absence de dose de chaux avec pH inconnu",fn:()=>!qualityAnalyzePlan(sampleUnknownPh).alerts.some(a=>/dose de chaux est chiffrée/.test(a.message))},
    {name:"Dose de chaux chiffrée + pH non précisé signalée",fn:()=>qualityAnalyzePlan(sampleLimeNoPh).alerts.some(a=>a.severity==="high"&&/dose de chaux est chiffrée/.test(a.message))},
    {name:"Montant chiffré en F CFA signalé",fn:()=>qualityAnalyzePlan({content:"Coût estimé : 125 000 FCFA par hectare."}).alerts.some(a=>/F ?CFA/.test(a.message))},
    {name:"Marge sans distinction bénéfice signalée",fn:()=>qualityAnalyzePlan({content:"La marge attendue est intéressante pour le producteur."}).alerts.some(a=>/marge/i.test(a.message))},
    {name:"Marge avec distinction bénéfice non signalée",fn:()=>!qualityAnalyzePlan({content:"La marge n'est pas le bénéfice réel ; elle ignore le travail familial."}).alerts.some(a=>/b[ée]n[ée]fice réel du producteur/.test(a.message))},
    {name:"Rendement t/ha sans cadrage prudent signalé",fn:()=>qualityAnalyzePlan({content:"Le rendement visé est de 25 t/ha."}).alerts.some(a=>/rendement chiffré/i.test(a.message))},
    {name:"Rendement t/ha avec cadrage prudent non signalé",fn:()=>!qualityAnalyzePlan({content:"Scénario prudent : rendement indicatif de 25 t/ha, à confirmer localement."}).alerts.some(a=>/rendement chiffré/i.test(a.message))},
    {name:"Formulations absolues signalées",fn:()=>qualityAnalyzePlan({content:"Cette solution est garantie sans aucun risque."}).alerts.some(a=>/trop catégorique/.test(a.message))}
  ];
  const results=cases.map(c=>{try{const ok=!!c.fn();return{name:c.name,ok,detail:ok?"Conforme à ce qui est attendu":"Résultat inattendu, à revoir"};}catch(e){return{name:c.name,ok:false,detail:e.message};}});
  sendJson(res,200,{total:results.length,passed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results});
}

// ---------- Routeur ----------
const server = http.createServer((req, res) => {
  const url = (req.url || "").split("?")[0];
  // Point de contrôle de santé (pour un moniteur d'uptime : garde le service éveillé et signale les pannes).
  if (req.method === "GET" && (url === "/healthz" || url === "/api/health")) return sendJson(res, 200, { ok: true, service: "terravive", time: new Date().toISOString(), uptime_s: Math.round(process.uptime()), db: USE_DB ? "supabase" : "local" });
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
  if (req.method === "POST" && url === "/api/quality/audit") return handleQualityAudit(req, res);
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
