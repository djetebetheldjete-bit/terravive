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
// Longueur max (tokens) pour la génération du plan — l'itinéraire complet est long.
const PLAN_MAX_TOKENS = parseInt(process.env.PLAN_MAX_TOKENS, 10) || 8000;
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

Tes principes, toujours : privilégier les pratiques durables — rotation et association des cultures, compost et fumure organique, paillage, gestion économe de l'eau, protection biologique (préparations naturelles, plantes répulsives, auxiliaires), préservation des sols et de la biodiversité. Tu réduis au maximum les intrants chimiques et n'en proposes qu'en dernier recours, avec prudence et dosage. Tu adaptes tes conseils au climat, à la saison et aux moyens locaux (matériaux disponibles sur place). Tu ne donnes jamais de conseil dangereux pour la santé ou l'environnement.`;

function planSystem() {
  return DURABLE_CONTEXT + `

TÂCHE : à partir des informations de la parcelle, rédige un ITINÉRAIRE TECHNIQUE DE CULTURE (ITK) COMPLET et personnalisé, en français, au format Markdown. L'ITK est la suite ORDONNÉE de toutes les opérations techniques, de la préparation de la parcelle jusqu'à l'après-récolte. Pour CHAQUE opération, précise : QUAND (période, ou stade / nombre de semaines après le semis), COMMENT (le geste concret : dose, écartement, méthode…) et POURQUOI (en une phrase simple).

Respecte EXACTEMENT ces sections (titres en ##), dans cet ordre :

## 1. Diagnostic de la parcelle
La culture visée ; la zone agro-écologique et le régime des pluies (bimodal ou monomodal) de la région, qui détermine le calendrier ; le type de sol avec ses atouts et ses risques (ex. sableux = bien drainé mais pauvre et lessivable ; argileux = retient l'eau et les éléments mais peut s'asphyxier ; limoneux = bon potentiel mais sensible à la battance) ; le pH du sol UNIQUEMENT s'il a été fourni ; le précédent cultural si connu ; et l'objectif de la personne. Déduis-en les grands choix de l'itinéraire. Si une information manque, indique clairement l'hypothèse que tu prends — et ne reproche jamais à la personne de ne pas avoir une donnée (comme le pH).

## 2. Choix de la variété et des semences
Type de variété adapté au climat local et à l'objectif (résistance aux maladies, cycle court ou long, tolérance à la chaleur ou à la sécheresse), qualité des semences (semences saines, taux de germination), et préparation éventuelle (pré-germination, traitement — en privilégiant les solutions naturelles).

## 3. Préparation du sol
Défrichage et nettoyage de la parcelle, travail du sol (labour, hersage, planage) et forme de culture (à plat, en billons, en buttes ou en planches) choisie selon le sol et le besoin de drainage. Rappelle l'intérêt d'un travail du sol limité et de la matière organique pour préserver un sol vivant, quand c'est possible.

## 4. Fumure de fond et amendement
Apports organiques avant plantation (compost, fumier bien décomposé) et leur enfouissement — ils nourrissent le sol ET tamponnent doucement le pH.
Gestion du pH : si le pH du sol est FOURNI, utilise-le — sol acide (pH inférieur à ~6) : conseille un chaulage léger (chaux agricole ou cendre de bois) pour le remonter ; sol alcalin (pH supérieur à ~7,5) : évite le chaulage et mise sur la matière organique ; pH proche de 6–7 : rien à corriger, c'est idéal. Donne les apports en FOURCHETTES.
Si le pH N'EST PAS fourni (c'est souvent le cas, et c'est NORMAL), ne bloque pas et ne l'invente pas : rappelle simplement que beaucoup de sols tropicaux sont légèrement acides, propose des moyens SIMPLES et peu coûteux de l'estimer si la personne le souhaite (plantes indicatrices, petit test maison au vinaigre et au bicarbonate, bandelettes de pH bon marché, ou une analyse de sol si elle en a la possibilité), et avance avec une approche prudente qui marche dans tous les cas : beaucoup de matière organique (elle corrige doucement l'acidité) et observation de la culture.
Donne des ordres de grandeur réalistes sous forme de FOURCHETTES, jamais de chiffres inventés précis.

## 5. Semis / plantation
Date de semis conseillée selon le régime des pluies de la région ; pépinière puis repiquage si la culture s'y prête (durée en pépinière) ; DENSITÉ et ÉCARTEMENT (distance entre les lignes et sur la ligne) ; profondeur de semis ; et un nombre indicatif de plants ou de graines pour la surface donnée.

## 6. Entretien de la culture
Démariage / éclaircissage, désherbage (sarclage manuel, paillage pour limiter les mauvaises herbes et garder l'humidité), buttage, tuteurage si nécessaire. Précise les périodes (nombre de semaines après le semis).

## 7. Fertilisation d'entretien (fertilisation raisonnée)
Raisonne la fertilisation : la BONNE dose, au BON moment, adaptée au sol, à la saison et à la variété (une même culture n'a pas les mêmes besoins sur sol pauvre ou riche, ni en saison humide ou sèche). Privilégie toujours les fumures organiques.
Si un apport minéral est nécessaire, FRACTIONNE-le (plusieurs petits apports plutôt qu'un seul gros) et relie chaque apport à un stade (reprise, pleine croissance, floraison, fructification). Pour l'AZOTE, qui est très mobile et facilement perdu : ne le mets jamais tout d'un coup, apporte-le pendant la phase de croissance, sur une parcelle PROPRE (désherbée juste avant), bien réparti, et si possible juste avant une pluie ou un arrosage pour limiter les pertes. Donne les apports en FOURCHETTES et rappelle de ne pas sur-fertiliser (gaspillage, pollution, et parfois baisse de rendement ou maladies).
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
Principaux ravageurs et maladies de cette culture dans la région, et les signes à surveiller. Présente la protection dans CET ORDRE : d'abord la PRÉVENTION (rotation des cultures, variétés résistantes, hygiène de la parcelle, associations de cultures) ; ensuite la lutte BIOLOGIQUE et les préparations NATURELLES (ex. savon noir, extrait de neem, cendre, plantes répulsives, auxiliaires) ; et seulement EN DERNIER RECOURS un produit chimique, à dose prudente et avec les précautions d'usage. Ne donne jamais de conseil dangereux pour la santé ou l'environnement.

## 10. Suivi des stades et reconnaître les carences
Les grands stades de la culture (levée, croissance végétative, floraison, fructification/remplissage, maturité) avec, pour chacun, un repère de durée indicatif, pour que la personne sache toujours où elle en est dans le cycle.
Apprends-lui aussi à LIRE les feuilles pour repérer tôt un manque et réagir : feuilles entièrement jaunes (limbe ET nervures), sur l'ensemble de la plante → manque d'AZOTE ; plante rabougrie, feuilles vert très foncé ou violacées → manque de PHOSPHORE ; jeunes feuilles jaunes mais nervures restées vertes → manque de FER ; taches ou plages jaunes par endroits sur les vieilles feuilles → manque de CALCIUM. Invite à corriger par un apport adapté (organique de préférence) et à continuer de surveiller.

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

## 14. Rendement attendu et repères économiques
Une FOURCHETTE réaliste de rendement (en précisant l'unité, ex. t/ha, ou une estimation sur la surface indiquée), et les bénéfices durables de l'approche (sol vivant, moins d'eau, moins de produits chimiques, meilleurs revenus dans la durée).

## 15. Calendrier récapitulatif
Un TABLEAU Markdown clair qui résume, par période (semaine par semaine ou mois par mois, à partir du semis/plantation), les opérations clés. Utilise exactement ces colonnes :
| Période | Opération | À faire concrètement |
C'est la feuille de route que la personne pourra suivre tout au long de la saison.

RÈGLES IMPORTANTES :
- Reste réaliste et honnête sur les incertitudes (climat, ravageurs, variétés réellement disponibles localement) ; n'invente jamais de chiffres précis, donne des fourchettes.
- Adapte TOUT aux moyens locaux (Côte d'Ivoire, matériaux et intrants disponibles sur place).
- Langage simple et accessible, sans jargon inutile ; quand tu emploies un terme technique, explique-le en quelques mots.
- Privilégie toujours les solutions durables et agroécologiques.
- Ne mets aucune introduction avant la première section ## 1.`;
}
function planUserMessage(p) {
  return `Voici ma parcelle :
- Culture souhaitée : ${p.crop}
- Région / localité : ${p.region || "non précisée"}
- Surface : ${p.area || "non précisée"}
- Type de sol : ${p.soil || "non précisé"}
- pH du sol : ${p.ph ? p.ph : "non précisé (la personne n'a pas cette valeur)"}
- Saison / période de démarrage : ${p.season || "non précisée"}
- Objectif principal : ${p.goal || "produire durablement"}
- Moyens / contraintes : ${p.notes || "aucun détail supplémentaire"}

Rédige mon itinéraire technique de culture complet.`;
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
  let p = {}; try { p = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: "Requête invalide." }); }
  const crop = String(p.crop || "").trim().slice(0, 120);
  if (!crop) return sendJson(res, 400, { error: "Indiquez au moins la culture souhaitée." });
  const clean = { crop, region: String(p.region || "").slice(0, 120), area: String(p.area || "").slice(0, 80), soil: String(p.soil || "").slice(0, 80), ph: String(p.ph || "").slice(0, 40), season: String(p.season || "").slice(0, 80), goal: String(p.goal || "").slice(0, 120), notes: String(p.notes || "").slice(0, 500) };
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
