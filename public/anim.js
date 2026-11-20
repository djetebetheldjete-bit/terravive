/* Terravive — moteur d'animations partagé. Chargé sur toutes les pages via <script src="/anim.js" defer>.
   Objectifs : vivant, adapté à l'agriculture (feuilles, pousses), léger et sûr.
   - N'ajoute "anim" à <html> (qui active le masquage pour l'apparition) que si les animations sont permises.
   - Un filet de sécurité révèle tout après 2,5 s au cas où l'observateur raterait un élément. */
(function () {
  "use strict";
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var lowMem = (navigator.deviceMemory && navigator.deviceMemory <= 2);
  var root = document.documentElement;

  function ready(fn) { if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  function all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  if (reduce) {
    // Animations réduites : on garde seulement le menu flottant (navigation utile), sans effets.
    ready(function () { try { initFab(); } catch (e) {} });
    return;
  }
  root.classList.add("anim");

  ready(function () {
    try { initReveal(); } catch (e) {}
    try { initRipple(); } catch (e) {}
    try { initCountUp(); } catch (e) {}
    try { initAmbient(); } catch (e) {}
    try { initFab(); } catch (e) {}
  });

  /* ---------- Apparition au défilement ---------- */
  function initReveal() {
    var sel = "[data-reveal], .hero, .heroart, .heroX, .card, .pcard, .planrow, .fsec, .doc, .sec, .panel, .tile, .kpi, .statcard";
    var els = all(sel).filter(function (el) {
      return !el.closest("[data-no-reveal]") && !el.classList.contains("reveal");
    });
    els.forEach(function (el) { el.classList.add("reveal"); });

    // délai échelonné entre frères
    var groups = new Map();
    els.forEach(function (el) {
      var p = el.parentElement; if (!p) return;
      var arr = groups.get(p) || []; arr.push(el); groups.set(p, arr);
    });
    groups.forEach(function (arr) {
      arr.forEach(function (el, i) { el.style.animationDelay = Math.min(i * 65, 420) + "ms"; });
    });

    if (!("IntersectionObserver" in window)) { els.forEach(function (el) { el.classList.add("in"); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -6% 0px" });
    els.forEach(function (el) { io.observe(el); });

    // Filet de sécurité : tout révéler après 2,5 s (jamais de contenu caché).
    setTimeout(function () { all(".reveal").forEach(function (el) { el.classList.add("in"); }); }, 2500);
  }

  /* ---------- Onde au clic sur les boutons principaux ---------- */
  function initRipple() {
    var sel = ".btn.primary, .btn.gold, .btn.sun, .btn.lg, .pcard, .seg";
    all(sel).forEach(function (b) { b.classList.add("trv-rip"); });
    document.addEventListener("pointerdown", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".trv-rip") : null;
      if (!b) return;
      var r = b.getBoundingClientRect();
      var d = Math.max(r.width, r.height);
      var s = document.createElement("span"); s.className = "trv-ripple";
      s.style.width = s.style.height = d + "px";
      s.style.left = (e.clientX - r.left - d / 2) + "px";
      s.style.top = (e.clientY - r.top - d / 2) + "px";
      b.appendChild(s);
      setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 650);
    }, { passive: true });
  }

  /* ---------- Compteurs qui montent ---------- */
  function initCountUp() {
    var els = all("[data-count]");
    // Auto : petites tuiles de chiffres éventuelles.
    all(".kpi .num, .statcard .num, .tile .num, [data-countauto]").forEach(function (el) {
      if (!el.hasAttribute("data-count") && /^\s*[\d  .,]+\s*$/.test(el.textContent)) els.push(el);
    });
    if (!els.length) return;
    function run(el) {
      var raw = el.getAttribute("data-count") || el.textContent;
      var num = parseFloat(String(raw).replace(/[^\d.,-]/g, "").replace(/\s/g, "").replace(",", "."));
      if (!isFinite(num)) return;
      var suffix = el.getAttribute("data-suffix") || "";
      var dur = 1100, t0 = performance.now(), dec = (String(num).split(".")[1] || "").length;
      el.classList.add("trv-count");
      function tick(t) {
        var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        var v = num * e;
        el.textContent = (dec ? v.toFixed(dec) : Math.round(v).toLocaleString("fr-FR")) + suffix;
        if (k < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }
    if (!("IntersectionObserver" in window)) { els.forEach(run); return; }
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) { if (en.isIntersecting) { run(en.target); io.unobserve(en.target); } });
    }, { threshold: 0.4 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Ambiance : feuilles qui flottent (canvas) ---------- */
  function initAmbient() {
    all("[data-ambient]").forEach(function (host) { makeAmbient(host); });
  }
  function makeAmbient(host) {
    var cs = getComputedStyle(host);
    if (cs.position === "static") host.style.position = "relative";
    var cv = document.createElement("canvas"); cv.className = "trv-ambient";
    host.insertBefore(cv, host.firstChild);
    var ctx = cv.getContext("2d");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 0, H = 0, raf = 0, running = true;
    var N = lowMem ? 7 : 14;
    var tint = host.getAttribute("data-ambient-tint") || "rgba(120,200,140,";
    var leaves = [];
    function resize() {
      var nw = host.clientWidth, nh = host.clientHeight;
      if (nw === W && nh === H) return;
      var was0 = (W === 0 || H === 0);
      W = nw; H = nh;
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (was0 && W > 0 && leaves.length) leaves.forEach(function (l) { reset(l, false); }); // ré-étaler quand on devient visible
    }
    function reset(l, top) {
      l.x = Math.random() * W; l.y = top ? -20 - Math.random() * H : Math.random() * H;
      l.s = 6 + Math.random() * 10; l.vy = 8 + Math.random() * 16; l.vx = (Math.random() - .5) * 10;
      l.rot = Math.random() * Math.PI * 2; l.vr = (Math.random() - .5) * 1.2; l.a = .25 + Math.random() * .4;
    }
    for (var i = 0; i < N; i++) { var l = {}; reset(l, false); leaves.push(l); }
    function leaf(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(0, -s * .5);
      ctx.quadraticCurveTo(s * .5, 0, 0, s * .5);
      ctx.quadraticCurveTo(-s * .5, 0, 0, -s * .5);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -s * .45); ctx.lineTo(0, s * .45);
      ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = .8; ctx.stroke();
    }
    var last = performance.now();
    function frame(t) {
      if (!running) return;
      var dt = Math.min(0.05, (t - last) / 1000); last = t;
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < leaves.length; i++) {
        var l = leaves[i];
        l.y += l.vy * dt; l.x += l.vx * dt + Math.sin(t / 900 + i) * 6 * dt; l.rot += l.vr * dt;
        if (l.y > H + 24) reset(l, true);
        ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.rot);
        ctx.fillStyle = tint + l.a + ")"; leaf(ctx, l.s); ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    }
    resize(); raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    if ("ResizeObserver" in window) { try { new ResizeObserver(resize).observe(host); } catch (e) {} }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
    });
  }

  /* ---------- Bouton d'action flottant (menu de raccourcis) ---------- */
  function initFab() {
    if (root.hasAttribute("data-no-fab") || (document.body && document.body.hasAttribute("data-no-fab"))) return;
    if (document.querySelector(".trv-fab-wrap")) return;
    function svg(p, w) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (w || "1.8") + '" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>"; }
    var actions = [
      { label: "Nouveau plan", href: "/app", color: "#2E7D46", icon: '<path d="M4 19.5V6a2 2 0 0 1 2-2h11l3 3v12.5"/><path d="M8 8h7M8 12h9M8 16h5"/>' },
      { label: "Conseiller IA", href: "/conseiller", color: "#147C8C", icon: '<path d="M20 4H4a1.6 1.6 0 0 0-1.6 1.6v9.2A1.6 1.6 0 0 0 4 16.4h3.2L12 20.4l4.8-4H20a1.6 1.6 0 0 0 1.6-1.6V5.6A1.6 1.6 0 0 0 20 4z"/>' },
      { label: "Diagnostic photo", href: "/diagnostic", color: "#D98A1F", icon: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/>' }
    ];
    var wrap = document.createElement("div"); wrap.className = "trv-fab-wrap";
    var acts = document.createElement("div"); acts.className = "trv-fab-actions";
    actions.forEach(function (a) {
      var el = document.createElement("a"); el.className = "trv-fab-chip"; el.href = a.href;
      el.innerHTML = '<span class="ci" style="background:' + a.color + '">' + svg(a.icon) + "</span>" + a.label;
      acts.appendChild(el);
    });
    var btn = document.createElement("button"); btn.className = "trv-fab"; btn.type = "button";
    btn.setAttribute("aria-label", "Raccourcis"); btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = svg('<path d="M12 5v14M5 12h14"/>', "2.4");
    wrap.appendChild(acts); wrap.appendChild(btn);
    document.body.appendChild(wrap);

    // Remonter le bouton au-dessus d'une barre fixe en bas (ex. barre du planteur).
    function place() {
      var pad = 22;
      all(".nav, .tabbar, nav").forEach(function (n) {
        var cs = getComputedStyle(n);
        if (cs.position !== "fixed" || cs.display === "none") return;
        var r = n.getBoundingClientRect();
        if (r.bottom >= window.innerHeight - 2 && r.width > window.innerWidth * 0.6) pad = Math.max(pad, (window.innerHeight - r.top) + 14);
      });
      wrap.style.bottom = pad + "px";
    }
    place(); window.addEventListener("resize", place);

    var open = false;
    function set(o) { open = o; wrap.classList.toggle("open", o); btn.setAttribute("aria-expanded", o ? "true" : "false"); }
    btn.addEventListener("click", function (e) { e.stopPropagation(); set(!open); });
    document.addEventListener("click", function (e) { if (open && !wrap.contains(e.target)) set(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && open) set(false); });
  }
})();
