/* Terravive — couche ANIMATIONS (sobre). Apparition au défilement, compteurs qui montent,
 * tracé des graphiques, survols. Fonctionne sur ordinateur et téléphone. Aucune dépendance.
 * Ne touche jamais au texte des valeurs autrement que par l'animation (relit la cible). */
(function () {
  "use strict";
  if (window.__tvAnims) return; window.__tvAnims = true;
  var REDUCED = false;
  try { REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  var path = (location.pathname || "/").replace(/\.html$/, "").replace(/\/+$/, "") || "/";
  var LANDING = (path === "/" || path === "/accueil");

  /* ---------- utilitaires nombres ---------- */
  // Décompose "28.2°C", "66 %", "1 250 000 F CFA", "0 kg" en {pre, num, dec, post}
  function parseNum(txt) {
    var s = String(txt);
    var m = s.match(/^([^0-9-]*)(-?[0-9][0-9  .,]*?)([^0-9]*)$/);
    if (!m) return null;
    var raw = m[2];
    // retire les séparateurs de milliers (espaces, espaces fines, point si suivi de 3 chiffres)
    var norm = raw.replace(/[\s  ]/g, "");
    // dernier séparateur décimal : une virgule, ou un point non suivi de exactement 3 chiffres groupés
    var dec = 0, val;
    if (/,/.test(norm)) { var parts = norm.split(","); dec = (parts[1] || "").length; val = parseFloat(norm.replace(/\./g, "").replace(",", ".")); }
    else if (/\.\d{1,2}$/.test(norm) && !/\.\d{3}$/.test(norm)) { dec = norm.split(".")[1].length; val = parseFloat(norm); }
    else { val = parseFloat(norm.replace(/\./g, "")); }
    if (!isFinite(val)) return null;
    return { pre: m[1], val: val, dec: dec, post: m[3] };
  }
  function fmt(n, dec) {
    try { return n.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
    catch (e) { return dec ? n.toFixed(dec) : String(Math.round(n)); }
  }
  // Chaque animation porte un jeton : une nouvelle valeur écrite par l'appli annule l'animation
  // en cours. Le texte écrit par l'animation elle-même est mémorisé (__tvShown) pour que
  // l'observateur de changements ne la prenne pas pour une nouvelle valeur (sinon chaque
  // image relançait une animation depuis 0 et le compteur restait bloqué à « 0 % »).
  function writeOwn(el, txt) { el.__tvShown = txt; el.textContent = txt; }
  function countUp(el) {
    if (el.__tvRun) return;
    var info = parseNum(el.textContent); if (!info || info.val === 0 && !/\d/.test(el.textContent)) { return; }
    // nombres trop grands ou identiques : pas d'animation
    if (Math.abs(info.val) > 1e12) return;
    if (el.__tvLast === info.val) { el.__tvShown = el.textContent; return; }
    // Première apparition : on part de 0. Mise à jour (rafraîchissement toutes les 60 s) :
    // on part de l'ancienne valeur, pour ne pas refaire défiler tout le compteur à chaque fois.
    var prev = (typeof el.__tvLast === "number") ? el.__tvLast : 0;
    el.__tvLast = info.val; el.__tvRun = true;
    var tok = (el.__tvTok || 0) + 1; el.__tvTok = tok;
    var finalTxt = el.textContent;
    el.classList.add("tv-count");
    if (REDUCED) { el.__tvShown = finalTxt; el.__tvRun = false; return; }
    var from = prev, to = info.val, dur = prev ? 400 : 700, t0 = null;
    function step(ts) {
      if (el.__tvTok !== tok) return;              // une valeur plus récente a pris la main
      if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      var cur = from + (to - from) * e;
      if (p < 1) { writeOwn(el, info.pre + fmt(cur, info.dec) + info.post); requestAnimationFrame(step); }
      else { writeOwn(el, finalTxt); el.__tvRun = false; }
    }
    requestAnimationFrame(step);
  }
  // Appelé quand le texte d'un compteur change : on ignore nos propres écritures.
  function onCountChanged(c) {
    if (c.textContent === c.__tvShown) return;
    c.__tvRun = false; c.__tvTok = (c.__tvTok || 0) + 1;
    if (isCountable(c)) countUp(c); else c.__tvShown = c.textContent;
  }

  var COUNT_SEL = ".tile .val, .metric, #liveRow .val, .kpi .v, .tv-num";
  function isCountable(el) {
    var t = el.textContent.trim();
    if (!t || t === "—" || t === "…") return false;
    return /\d/.test(t) && parseNum(t) != null;
  }

  /* ---------- apparition au défilement ---------- */
  var io = null;
  function reveal(scope) {
    scope = scope || document;
    var sel = ".card, .tile, section > h2, .band, .panel, .heroart, .sugwrap, .table-wrap, .chartwrap, .pillars, .grid > *";
    var items = [].slice.call(scope.querySelectorAll(sel)).filter(function (e) {
      if (e.__tvSeen) return false; if (e.closest(".top, .side, .sidebar, .m-nav, .m-sheet, .hero")) return false;
      return true;
    });
    if (!items.length) return;
    if (REDUCED || !("IntersectionObserver" in window)) { items.forEach(function (e) { e.__tvSeen = 1; if (e.matches(COUNT_SEL) || e.querySelector) revealCounts(e); }); return; }
    if (!io) io = new IntersectionObserver(function (es) {
      es.forEach(function (en) { if (!en.isIntersecting) return; var e = en.target; io.unobserve(e); revealCounts(e); drawCharts(e); });
    }, { threshold: .12, rootMargin: "0px 0px -40px 0px" });
    // groupe par rangée pour un léger décalage
    // Ne masque rien (l'apparition est faite par anim.js) : sert seulement à lancer
    // les compteurs et le tracé des graphiques quand le bloc devient visible.
    items.forEach(function (e) { e.__tvSeen = 1; io.observe(e); });
  }
  function revealCounts(scope) {
    var els = scope.matches && scope.matches(COUNT_SEL) ? [scope] : [];
    if (scope.querySelectorAll) els = els.concat([].slice.call(scope.querySelectorAll(COUNT_SEL)));
    els.forEach(function (el) { if (isCountable(el)) countUp(el); });
  }

  /* ---------- graphiques : tracé progressif ---------- */
  function drawCharts(scope) {
    if (REDUCED) return;
    var wraps = scope.matches && scope.matches(".chartwrap") ? [scope] : [].slice.call((scope.querySelectorAll ? scope : document).querySelectorAll ? scope.querySelectorAll(".chartwrap") : []);
    wraps.forEach(function (w) {
      if (w.__tvDrawn) return; w.__tvDrawn = 1;
      [].slice.call(w.querySelectorAll("path, polyline, line")).forEach(function (p) {
        if (p.classList.contains("grid-line") || p.getAttribute("fill") && p.getAttribute("fill") !== "none") return;
        var len = 0; try { len = p.getTotalLength ? p.getTotalLength() : 0; } catch (e) {}
        if (len > 4 && len < 20000) { p.style.setProperty("--tv-len", Math.ceil(len)); p.classList.add("tv-draw"); }
      });
      [].slice.call(w.querySelectorAll("circle, rect.bar, .dot, text")).forEach(function (n) { n.classList.add("tv-fade-in"); });
    });
  }

  /* ---------- observation des contenus injectés par l'appli ---------- */

  /* ---------- repli des grandes sections (page tableau de bord) ---------- */
  var FOLD_TITLES = [
    "Espace formateur", "Propriétaire — animateurs", "Devenir cultivateur certifié",
    "Humidité du sol — tendance", "Dernières mesures de la parcelle",
    "Indice de durabilité", "Ma station connectée"
  ];
  function foldKey(t) { return "tv-fold:" + t.slice(0, 44); }
  function directH2(card) { for (var i = 0; i < card.children.length; i++) { var c = card.children[i]; if (c.tagName === "H2" && c.classList.contains("ct")) return c; } return null; }
  function setupFold() {
    if (path !== "/tableau") return;
    var scope = document.querySelector(".main") || document;
    [].slice.call(scope.querySelectorAll(".card")).forEach(function (card) {
      if (card.__tvFold) return;
      var h = directH2(card); if (!h) return;
      var title = h.textContent.trim();
      if (!FOLD_TITLES.some(function (x) { return title.indexOf(x) >= 0; })) return;
      card.__tvFold = 1; card.classList.add("fold");
      var inner = document.createElement("div"); inner.className = "fold-inner";
      var body = document.createElement("div"); body.className = "fold-body"; body.appendChild(inner);
      var n = h.nextSibling; while (n) { var nx = n.nextSibling; inner.appendChild(n); n = nx; }
      card.appendChild(body);
      // enveloppe le titre pour un alignement constant (titre à gauche, flèche à droite)
      var ti = document.createElement("span"); ti.className = "fold-ti";
      var tn = h.firstChild; while (tn) { var tnx = tn.nextSibling; ti.appendChild(tn); tn = tnx; }
      h.appendChild(ti);
      var ar = document.createElement("span"); ar.className = "fold-ar"; ar.setAttribute("aria-hidden", "true");
      ar.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>'; h.appendChild(ar);
      h.setAttribute("role", "button"); h.setAttribute("tabindex", "0");
      var open = false; try { open = localStorage.getItem(foldKey(title)) === "1"; } catch (e) {}
      card.classList.toggle("open", open); h.setAttribute("aria-expanded", open ? "true" : "false");
      function toggle() {
        open = !open; card.classList.toggle("open", open); h.setAttribute("aria-expanded", open ? "true" : "false");
        try { localStorage.setItem(foldKey(title), open ? "1" : "0"); } catch (e) {}
        if (open) { revealCounts(card); drawCharts(card); }
      }
      h.addEventListener("click", toggle);
      h.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    });
  }

  function scan() { reveal(document); revealCounts(document); setupFold(); }
  var pending = null;
  function schedule() { clearTimeout(pending); pending = setTimeout(scan, 90); }

  function start() {
    if (LANDING) document.body.classList.add("tv-hero-anim");
    scan();
    // l'appli Terravive réécrit souvent les valeurs (tableau toutes les 60 s, stock, conseiller) :
    // on ré-anime les compteurs quand leur texte change, et on révèle les nouveaux blocs.
    var root = document.querySelector("main, .main, body") || document.body;
    var mo = new MutationObserver(function (muts) {
      var touchedCounts = false;
      for (var i = 0; i < muts.length; i++) {
        var t = muts[i].target;
        if (t && t.nodeType === 1 && t.matches && t.matches(COUNT_SEL)) { touchedCounts = true; onCountChanged(t); }
        else if (t && t.parentElement && t.parentElement.matches && t.parentElement.matches(COUNT_SEL)) { onCountChanged(t.parentElement); }
      }
      if (!touchedCounts) schedule(); else schedule();
    });
    try { mo.observe(root, { childList: true, subtree: true, characterData: true }); } catch (e) {}
    // deuxième passe après le premier chargement de données
    setTimeout(scan, 700); setTimeout(scan, 1800);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
