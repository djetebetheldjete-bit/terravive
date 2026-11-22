/* Terravive — service worker (mode hors-ligne / faible connexion)
 * Stratégie :
 *  - Navigations (pages) : réseau d'abord, sinon version en cache (consultable hors-ligne).
 *  - GET /api/* (même origine) : réseau d'abord, sinon dernière réponse en cache
 *    → l'agriculteur revoit ses itinéraires, parcelles, coopérative, tableau de bord sans connexion.
 *  - Reste (scripts/CSS/icônes, y compris Leaflet via CDN) : cache d'abord.
 *  - Les requêtes POST (générer un plan, chat, enregistrer…) ne sont jamais mises en cache :
 *    hors-ligne elles échouent proprement (l'app affiche déjà un message).
 */
const VERSION = "terravive-v35";
const SHELL = [
  "/accueil", "/app", "/connexion", "/tableau", "/planteur", "/arduino", "/comprendre", "/conseiller", "/cooperative", "/diagnostic", "/distribution",
  "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/logo.png", "/favicon-32.png", "/pwa.js", "/mobile.css", "/mobile.js", "/anims.css", "/anims.js", "/icons.js", "/residus.js", "/voice.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

function putInCache(req, res) {
  if (!res) return;
  // On met en cache les réponses OK (200) et les réponses CDN opaques (type "opaque").
  if (res.status === 200 || res.type === "opaque") {
    try { caches.open(VERSION).then((c) => c.put(req, res)); } catch (e) {}
  }
}

// Réseau d'abord. Avec waitMs : si le réseau ne répond pas dans ce délai (connexion faible, serveur
// qui se réveille) et qu'une version existe en cache, on l'affiche tout de suite ; la réponse du
// réseau, quand elle arrive, met le cache à jour pour la prochaine fois.
function networkFirst(req, waitMs) {
  const net = fetch(req).then((res) => { putInCache(req, res.clone()); return res; });
  const fallback = () => caches.match(req).then((m) => m || (req.mode === "navigate" ? caches.match("/accueil") : null)).then((m) => m || Response.error());
  if (!waitMs) return net.catch(fallback);
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { caches.match(req).then((m) => { if (m && !done) { done = true; resolve(m); } }); }, waitMs);
    net.then((res) => { clearTimeout(t); if (!done) { done = true; resolve(res); } },
             () => { clearTimeout(t); if (!done) { done = true; resolve(fallback()); } });
  });
}

function cacheFirst(req) {
  return caches.match(req).then((m) => m || fetch(req).then((res) => { putInCache(req, res.clone()); return res; }).catch(() => Response.error()));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;              // POST/PUT… : on laisse passer au réseau
  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  // Vidéos : jamais interceptées ni mises en cache (lecture par morceaux « Range », exigée par Safari/iPhone).
  if (url.origin === self.location.origin && (url.pathname.startsWith("/media/") || /\.(mp4|webm|vtt)$/.test(url.pathname))) return;
  if (req.mode === "navigate") { e.respondWith(networkFirst(req, 6000)); return; }
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) { e.respondWith(networkFirst(req, 10000)); return; }
  // Code de l'appli (JS/CSS de même origine) : réseau d'abord, pour que chaque mise à jour arrive
  // sans attendre un changement de version ; hors-ligne, on retombe sur le cache.
  if (url.origin === self.location.origin && /\.(js|css)$/.test(url.pathname)) { e.respondWith(networkFirst(req)); return; }
  e.respondWith(cacheFirst(req));
});
