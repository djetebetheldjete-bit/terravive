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
  function countUp(el) {
    if (el.__tvRun) return;
    var info = parseNum(el.textContent); if (!info || info.val === 0 && !/\d/.test(el.textContent)) { return; }
    // nombres trop grands ou identiques : pas d'animation
    if (Math.abs(info.val) > 1e12) return;
    if (el.__tvLast === info.val) return;
    el.__tvLast = info.val; el.__tvRun = true;
    el.classList.add("tv-count");
    if (REDUCED) { el.__tvRun = false; return; }
    var from = 0, to = info.val, dur = Math.min(1500, 500 + Math.abs(to) * 2), t0 = null;
    function step(ts) {
      if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      var cur = from + (to - from) * e;
      el.textContent = info.pre + fmt(cur, info.dec) + info.post;
      if (p < 1) requestAnimationFrame(step); else { el.textContent = info.pre + fmt(to, info.dec) + info.post; el.__tvRun = false; }
    }
    requestAnimationFrame(step);
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
      es.forEach(function (en) { if (!en.isIntersecting) return; var e = en.target; io.unobserve(e); e.classList.add("tv-in"); revealCounts(e); drawCharts(e); });
    }, { threshold: .12, rootMargin: "0px 0px -40px 0px" });
    // groupe par rangée pour un léger décalage
    items.forEach(function (e, i) {
      e.__tvSeen = 1; e.classList.add("tv-reveal");
      var sibIndex = 0, p = e.previousElementSibling; while (p) { sibIndex++; p = p.previousElementSibling; }
      e.style.setProperty("--tv-d", (Math.min(sibIndex, 4) * 70) + "ms");
      io.observe(e);
    });
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
  function scan() { reveal(document); revealCounts(document); }
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
        if (t && t.nodeType === 1 && t.matches && t.matches(COUNT_SEL)) { touchedCounts = true; t.__tvRun = false; if (isCountable(t)) countUp(t); }
        else if (t && t.parentElement && t.parentElement.matches && t.parentElement.matches(COUNT_SEL)) { var c = t.parentElement; c.__tvRun = false; if (isCountable(c)) countUp(c); }
      }
      if (!touchedCounts) schedule(); else schedule();
    });
    try { mo.observe(root, { childList: true, subtree: true, characterData: true }); } catch (e) {}
    // deuxième passe après le premier chargement de données
    setTimeout(scan, 700); setTimeout(scan, 1800);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
