/* Terravive — service worker (mode hors-ligne / faible connexion)
 * Stratégie :
 *  - Navigations (pages) : réseau d'abord, sinon version en cache (consultable hors-ligne).
 *  - GET /api/* (même origine) : réseau d'abord, sinon dernière réponse en cache
 *    → l'agriculteur revoit ses itinéraires, parcelles, coopérative, tableau de bord sans connexion.
 *  - Reste (scripts/CSS/icônes, y compris Leaflet via CDN) : cache d'abord.
 *  - Les requêtes POST (générer un plan, chat, enregistrer…) ne sont jamais mises en cache :
 *    hors-ligne elles échouent proprement (l'app affiche déjà un message).
 */
const VERSION = "terravive-v9";
const SHELL = [
  "/accueil", "/app", "/tableau", "/arduino", "/comprendre", "/conseiller", "/cooperative", "/diagnostic",
  "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/logo.png", "/favicon-32.png", "/pwa.js", "/mobile.css", "/mobile.js", "/anims.css", "/anims.js"
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

function networkFirst(req) {
  return fetch(req)
    .then((res) => { putInCache(req, res.clone()); return res; })
    .catch(() => caches.match(req).then((m) => m || (req.mode === "navigate" ? caches.match("/accueil") : Response.error())));
}

function cacheFirst(req) {
  return caches.match(req).then((m) => m || fetch(req).then((res) => { putInCache(req, res.clone()); return res; }).catch(() => Response.error()));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;              // POST/PUT… : on laisse passer au réseau
  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  if (req.mode === "navigate") { e.respondWith(networkFirst(req)); return; }
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) { e.respondWith(networkFirst(req)); return; }
  // Code de l'appli (JS/CSS de même origine) : réseau d'abord, pour que chaque mise à jour arrive
  // sans attendre un changement de version ; hors-ligne, on retombe sur le cache.
  if (url.origin === self.location.origin && /\.(js|css)$/.test(url.pathname)) { e.respondWith(networkFirst(req)); return; }
  e.respondWith(cacheFirst(req));
});
