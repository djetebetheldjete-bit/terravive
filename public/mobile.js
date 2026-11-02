/* Terravive — couche MOBILE : barre basse, feuille « Plus », barre supérieure compacte,
 * tableaux en cartes, retour d'état. Active uniquement sur écran ≤ 860 px. Aucune dépendance. */
(function () {
  "use strict";
  if (window.__trvMobile) return; window.__trvMobile = true;
  var mq = window.matchMedia("(max-width: 860px)");
  var path = (location.pathname || "/").replace(/\.html$/, "").replace(/\/+$/, "") || "/";
  var LANDING = (path === "/" || path === "/accueil");
  var SHOP = (path === "/boutique");
  var STOCK = (path === "/stock"), QUALITY = (path === "/quality");
  var els = {}, me = null, meLoaded = false, built = false, lastY = 0, mo = null;

  var I = { // icônes (même trait que le reste de l'appli)
    tableau: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    plan: '<path d="M4 19.5V6a2 2 0 0 1 2-2h11l3 3v12.5"/><path d="M8 8h7M8 12h9M8 16h5"/>',
    conseil: '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.6 8.6 0 0 1-3.9-.9L3 20l1.4-4.1A8.4 8.4 0 0 1 3.5 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/>',
    photo: '<path d="M3 8.5A2 2 0 0 1 5 6.5h1.5l1-1.6h5l1 1.6H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12.5" cy="13" r="3.4"/>',
    plus: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    coop: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M15 19a4.5 4.5 0 0 1 6 0"/>',
    livre: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 5.5V20.5"/><path d="M8 7h8M8 11h6"/>',
    chip: '<rect x="4" y="8" width="16" height="9" rx="2"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/><path d="M2 12h2M20 12h2"/>',
    stock: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
    shield: '<path d="M12 3 20 6v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/><path d="m8.5 12 2.2 2.2 4.8-4.8"/>',
    shop: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
  };
  function svg(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (I[n] || n) + "</svg>"; }
  var TITLES = { "/tableau": "Tableau de bord", "/app": "Itinéraire de culture", "/conseiller": "Conseiller", "/diagnostic": "Diagnostic photo", "/cooperative": "Coopérative", "/comprendre": "Comprendre", "/arduino": "Automatisation", "/stock": "Stock", "/quality": "Quality Guard" };
  var GLOBAL = [
    { href: "/tableau", lb: "Tableau", ic: "tableau" }, { href: "/app", lb: "Itinéraire", ic: "plan" },
    { href: "/conseiller", lb: "Conseiller", ic: "conseil" }, { href: "/diagnostic", lb: "Diagnostic", ic: "photo" }
  ];
  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function theme() { try { return localStorage.getItem("trv-theme") || "nature"; } catch (e) { return "nature"; } }

  /* ---------- identité (pour « Plus » : rôles, compte) ---------- */
  function loadMe(cb) {
    if (meLoaded) return cb && cb();
    fetch("/api/auth/me", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (j) { me = (j && j.user) || null; })
      .catch(function () { me = null; }).then(function () { meLoaded = true; if (built) refreshSheet(); cb && cb(); });
  }

  /* ---------- barre supérieure compacte ---------- */
  function topbar() {
    var top = document.querySelector(".top, .side, .sidebar"); if (!top) return;
    var t = TITLES[path];
    if (t && !top.querySelector(".m-title") && !top.classList.contains("sidebar") && !top.classList.contains("side")) {
      var brand = top.querySelector(".brand");
      var span = h("span", "m-title"); span.textContent = t;
      if (brand && brand.parentNode) brand.parentNode.insertBefore(span, brand.nextSibling); else top.appendChild(span);
    }
    top.classList.add("m-flat");
  }

  /* ---------- barre basse ---------- */
  function item(o) {
    var el = o.href ? h("a", "m-item") : h("button", "m-item"); if (o.href) el.href = o.href; else el.type = "button";
    el.innerHTML = '<span class="m-ic">' + (o.svgHtml || svg(o.ic)) + '</span><span class="m-lb">' + o.lb + "</span>";
    if (o.current) el.setAttribute("aria-current", "page");
    return el;
  }
  function buildBar() {
    var nav = h("nav", "m-nav"); nav.setAttribute("aria-label", "Navigation principale");
    var stockNavs = STOCK ? [].slice.call(document.querySelectorAll(".sidebar .nav[data-view]")) : [];
    if (STOCK && stockNavs.length) {
      var main = stockNavs.filter(function (b) { return b.style.display !== "none" && ["dash", "products", "harvests", "sales"].indexOf(b.getAttribute("data-view")) >= 0; });
      var labels = { dash: "Accueil", products: "Produits", harvests: "Récoltes", sales: "Ventes" };
      main.forEach(function (b) {
        var v = b.getAttribute("data-view"); var s = b.querySelector("svg");
        var it = item({ lb: labels[v] || b.textContent.trim(), svgHtml: s ? s.outerHTML : svg("stock"), current: b.classList.contains("active") });
        it.setAttribute("data-v", v); it.addEventListener("click", function () { b.click(); closeSheet(); syncStock(); window.scrollTo({ top: 0, behavior: "smooth" }); });
        nav.appendChild(it);
      });
    } else if (QUALITY) {
      return null;
    } else {
      GLOBAL.forEach(function (g) { nav.appendChild(item({ href: g.href, lb: g.lb, ic: g.ic, current: path === g.href })); });
    }
    var more = item({ lb: "Plus", ic: "plus", current: !STOCK && GLOBAL.every(function (g) { return g.href !== path; }) });
    more.setAttribute("aria-haspopup", "dialog"); more.addEventListener("click", openSheet); more.id = "m-more";
    nav.appendChild(more);
    return nav;
  }
  function syncStock() {
    if (!STOCK || !els.nav) return;
    var act = document.querySelector(".sidebar .nav.active[data-view]"); var v = act && act.getAttribute("data-view");
    [].forEach.call(els.nav.querySelectorAll(".m-item[data-v]"), function (it) { it.toggleAttribute("aria-current", it.getAttribute("data-v") === v); if (it.getAttribute("data-v") === v) it.setAttribute("aria-current", "page"); });
    var more = $id("m-more"); if (more) { var inMain = els.nav.querySelector('.m-item[data-v="' + v + '"]'); if (!inMain && v) more.setAttribute("aria-current", "page"); else more.removeAttribute("aria-current"); }
  }
  function $id(i) { return document.getElementById(i); }

  /* ---------- feuille « Plus » ---------- */
  function tile(href, ic, lb, i) { var a = h("a", "m-tile", svg(ic) + "<span>" + lb + "</span>"); a.href = href; a.style.setProperty("--i", i); return a; }
  function refreshSheet() {
    if (!els.sheet) return; var s = els.sheet; s.innerHTML = ""; s.appendChild(h("div", "m-grip"));
    var drag = h("div"); s.appendChild(drag);
    if (STOCK) {
      s.appendChild(h("h3", "", "Stock"));
      var l = h("div", "m-list");
      [].slice.call(document.querySelectorAll(".sidebar .nav[data-view]")).filter(function (b) { return b.style.display !== "none" && ["losses", "producers", "journal"].indexOf(b.getAttribute("data-view")) >= 0; }).forEach(function (b) {
        var ic = b.querySelector("svg"); var btn = h("button", "m-btn", (ic ? ic.outerHTML : "") + "<span>" + b.textContent.trim() + "</span>");
        btn.type = "button"; btn.addEventListener("click", function () { closeSheet(); b.click(); syncStock(); window.scrollTo({ top: 0, behavior: "smooth" }); }); l.appendChild(btn);
      });
      s.appendChild(l);
    }
    s.appendChild(h("h3", "", "Explorer"));
    var g = h("div", "m-tiles"), i = 0;
    if (STOCK) g.appendChild(tile("/tableau", "home", "Terravive", i++));
    if (!STOCK || true) {
      [["/cooperative", "coop", "Coopérative"], ["/comprendre", "livre", "Comprendre"], ["/arduino", "chip", "Capteurs"]].forEach(function (x) { if (path !== x[0]) g.appendChild(tile(x[0], x[1], x[2], i++)); });
      if (!STOCK) { g.appendChild(tile("/boutique", "shop", "Boutique", i++)); }
      if (me && (me.isAdmin || me.animator || me.certified) && !STOCK) g.appendChild(tile("/stock", "stock", "Stock", i++));
      if (me && me.isAdmin && !QUALITY) g.appendChild(tile("/quality", "shield", "Qualité", i++));
    }
    s.appendChild(g);
    s.appendChild(h("h3", "", "Mon compte"));
    if (me) {
      var a = h("div", "m-acct", '<span class="m-av">' + String((me.name || me.email || "?")).trim().charAt(0).toUpperCase() + '</span><div><b>' + esc(me.name || me.email || "") + "</b><small>" + (me.isAdmin ? "Administrateur" : me.animator ? "Animateur" : me.certified ? "Cultivateur certifié" : "Cultivateur") + "</small></div>");
      s.appendChild(a);
    } else {
      s.appendChild(h("div", "m-acct", '<span class="m-av">' + svg("user").replace("<svg", '<svg style="width:22px;height:22px;stroke:#fff;fill:none;stroke-width:1.8"') + '</span><div><b>Visiteur</b><small>Connectez-vous pour enregistrer vos plans</small></div>'));
    }
    var row = h("div", "m-row");
    var sel = h("select", "", '<option value="nature">Thème · Nature</option><option value="clair">Thème · Clair</option><option value="sombre">Thème · Sombre</option><option value="terre">Thème · Terre</option>');
    sel.setAttribute("aria-label", "Thème"); sel.value = theme();
    sel.addEventListener("change", function () { applyTheme(sel.value); });
    row.appendChild(sel);
    if (me) { var lo = h("button", "m-btn danger", svg("out").replace("<svg", '<svg style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8"') + "Quitter"); lo.type = "button"; lo.addEventListener("click", function () { lo.disabled = true; lo.textContent = "Déconnexion…"; fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(function () {}).then(function () { location.href = "/"; }); }); row.appendChild(lo); }
    else { var li = h("a", "m-btn primary", "Se connecter"); li.href = "/app"; row.appendChild(li); }
    s.appendChild(row);
    bindDrag();
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function applyTheme(t) {
    try { localStorage.setItem("trv-theme", t); } catch (e) {}
    document.documentElement.setAttribute("data-theme", t);
    var orig = document.getElementById("themeSel") || document.querySelector("select.theme, select.themeSel, select.sel");
    if (orig && orig.value !== t) { orig.value = t; try { orig.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {} }
  }
  var prevFocus = null;
  function openSheet() {
    if (!els.sheet) return; prevFocus = document.activeElement; loadMe(); refreshSheet();
    els.backdrop.classList.add("on"); void els.sheet.offsetWidth; els.sheet.classList.add("on"); els.sheet.style.transform = ""; document.body.classList.add("m-sheet-open");
    els.sheet.setAttribute("aria-hidden", "false");
    var f = els.sheet.querySelector("a,button,select"); if (f) setTimeout(function () { try { f.focus({ preventScroll: true }); } catch (e) {} }, 60);
  }
  function closeSheet() {
    if (!els.sheet || !els.sheet.classList.contains("on")) return;
    els.sheet.classList.remove("on"); els.backdrop.classList.remove("on"); document.body.classList.remove("m-sheet-open"); els.sheet.style.transform = "";
    els.sheet.setAttribute("aria-hidden", "true"); if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch (e) {}
  }
  function bindDrag() { // glisser vers le bas pour fermer
    var g = els.sheet.querySelector(".m-grip"); if (!g) return; var y0 = null, dy = 0;
    g.addEventListener("touchstart", function (e) { y0 = e.touches[0].clientY; dy = 0; els.sheet.classList.add("m-drag"); }, { passive: true });
    g.addEventListener("touchmove", function (e) { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); els.sheet.style.transform = "translateY(" + dy + "px)"; }, { passive: true });
    g.addEventListener("touchend", function () { els.sheet.classList.remove("m-drag"); if (dy > 90) closeSheet(); else els.sheet.style.transform = ""; y0 = null; });
  }

  /* ---------- appel à l'action collant (accueil publique) ---------- */
  function buildCta() {
    var c = h("div", "m-cta"); c.setAttribute("role", "region"); c.setAttribute("aria-label", "Commencer");
    c.innerHTML = '<a href="/app">Se connecter</a><a class="primary" href="/app">Créer mon plan</a>';
    return c;
  }

  /* ---------- tableaux → cartes ---------- */
  function cardify() {
    [].forEach.call(document.querySelectorAll("table"), function (t) {
      if (t.classList.contains("m-skip")) return;
      var heads = [].map.call(t.querySelectorAll("thead th"), function (th) { return th.textContent.trim(); });
      if (heads.length < 3) return; t.classList.add("m-cards");
      [].forEach.call(t.querySelectorAll("tbody tr"), function (tr) {
        [].forEach.call(tr.children, function (td, i) { if (td.tagName === "TD" && td.getAttribute("data-label") == null) td.setAttribute("data-label", td.colSpan > 1 ? "" : (heads[i] || "")); });
      });
    });
  }

  /* ---------- révélation douce au défilement (accueil) ---------- */
  function revealAll() {
    var sel = LANDING ? ".step, .card, .panel, .feat, .grid > *, section, .foot, .how > *" : "";
    if (!sel || !("IntersectionObserver" in window)) return;
    var items = [].slice.call(document.querySelectorAll(sel)).filter(function (e) { return !e.closest(".top") && !e.classList.contains("hero"); });
    var io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("m-in"); io.unobserve(en.target); } }); }, { threshold: .12, rootMargin: "0px 0px -30px 0px" });
    items.forEach(function (e, i) { e.classList.add("m-reveal"); e.style.setProperty("--i", String(i % 4)); io.observe(e); });
  }

  /* ---------- comportements : ombre au défilement, barre qui se range, clavier ---------- */
  function onScroll() {
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    var top = document.querySelector(".top, .side, .sidebar"); if (top) top.classList.toggle("m-scrolled", y > 6);
    var dy = y - lastY; lastY = y;
    var atEnd = (window.innerHeight + y) >= (document.documentElement.scrollHeight - 40);
    if (Math.abs(dy) > 6) document.body.classList.toggle("m-hide-nav", dy > 0 && y > 140 && !atEnd);
  }
  function onFocusIn(e) { if (e.target.matches && e.target.matches("input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select")) document.body.classList.add("m-kb"); }
  function onFocusOut() { setTimeout(function () { var a = document.activeElement; if (!a || !(a.matches && a.matches("input:not([type=checkbox]):not([type=radio]), textarea, select"))) document.body.classList.remove("m-kb"); }, 120); }
  function onKey(e) { if (e.key === "Escape") closeSheet(); }

  /* ---------- montage / démontage ---------- */
  function build() {
    if (built) return; built = true; document.body.classList.add("m-on");
    if (QUALITY) document.body.classList.add("m-quality");
    topbar();
    if (LANDING) { els.cta = buildCta(); document.body.appendChild(els.cta); document.body.classList.add("m-cta-on", "m-nobar"); revealAll(); }
    else if (SHOP) { document.body.classList.add("m-nobar"); }
    else {
      els.nav = buildBar();
      if (els.nav) {
        els.backdrop = h("div", "m-backdrop"); els.backdrop.addEventListener("click", closeSheet);
        els.sheet = h("div", "m-sheet"); els.sheet.setAttribute("role", "dialog"); els.sheet.setAttribute("aria-modal", "true"); els.sheet.setAttribute("aria-label", "Plus d'options"); els.sheet.setAttribute("aria-hidden", "true");
        document.body.appendChild(els.nav); document.body.appendChild(els.backdrop); document.body.appendChild(els.sheet);
        refreshSheet();
        if (STOCK) { var sb = document.querySelector(".sidebar"); if (sb) { mo = new MutationObserver(syncStock); mo.observe(sb, { attributes: true, subtree: true, attributeFilter: ["class", "style"] }); } }
      } else document.body.classList.add("m-nobar");
    }
    cardify(); var main = document.querySelector("main, .main") || document.body;
    var t = null; var mo2 = new MutationObserver(function () { clearTimeout(t); t = setTimeout(cardify, 80); }); mo2.observe(main, { childList: true, subtree: true });
    window.addEventListener("scroll", onScroll, { passive: true }); document.addEventListener("focusin", onFocusIn); document.addEventListener("focusout", onFocusOut); document.addEventListener("keydown", onKey);
    loadMe(function () {
      if (me && me.profile === "client" && els.nav) { els.nav.style.display = "none"; document.body.classList.add("m-nobar"); }
      /* accueil : une personne déjà connectée voit « Mon tableau de bord », pas « Se connecter » */
      if (me && els.cta) els.cta.innerHTML = '<a href="/app">Nouveau plan</a><a class="primary" href="/tableau">Mon tableau de bord</a>';
    });
  }
  function destroy() {
    if (!built) return; built = false; document.body.classList.remove("m-on", "m-cta-on", "m-nobar", "m-hide-nav", "m-kb", "m-quality", "m-sheet-open");
    ["nav", "backdrop", "sheet", "cta"].forEach(function (k) { if (els[k] && els[k].parentNode) els[k].parentNode.removeChild(els[k]); els[k] = null; });
    window.removeEventListener("scroll", onScroll); document.removeEventListener("focusin", onFocusIn); document.removeEventListener("focusout", onFocusOut); document.removeEventListener("keydown", onKey);
    if (mo) mo.disconnect();
  }
  function sync() { if (mq.matches) build(); else destroy(); }
  function start() { sync(); if (mq.addEventListener) mq.addEventListener("change", sync); else if (mq.addListener) mq.addListener(sync); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
