/* Terravive — onboarding : visite guidée (coach marks) + mini-démos animées.
   Piloté par attributs : [data-tour="1"] data-tour-title data-tour-text sur les éléments ;
   [data-help="sujet"] pour un bouton qui ouvre une mini-démo. Léger, hors-ligne. */
(function () {
  "use strict";
  function all(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function ready(fn) { if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function pageKey() { return "trv-tour-" + location.pathname.replace(/[^a-z]/gi, "") ; }

  /* ================= VISITE GUIDÉE ================= */
  var ov, hole, ring, tip, steps = [], idx = 0;
  function layout() {
    var el = steps[idx]; if (!el) return;
    var r = el.getBoundingClientRect();
    var pad = 8;
    hole.style.left = (r.left - pad) + "px"; hole.style.top = (r.top - pad) + "px";
    hole.style.width = (r.width + pad * 2) + "px"; hole.style.height = (r.height + pad * 2) + "px";
    ring.style.left = hole.style.left; ring.style.top = hole.style.top; ring.style.width = hole.style.width; ring.style.height = hole.style.height;
    // bulle : sous la cible si place, sinon au-dessus
    var tw = Math.min(300, window.innerWidth - 32), th = tip.offsetHeight || 150;
    var below = r.bottom + 14 + th < window.innerHeight;
    var top = below ? r.bottom + 14 : r.top - th - 14;
    var left = Math.min(Math.max(12, r.left + r.width / 2 - tw / 2), window.innerWidth - tw - 12);
    tip.style.width = tw + "px"; tip.style.left = left + "px"; tip.style.top = Math.max(12, top) + "px";
    var ar = tip.querySelector(".arrow");
    ar.style.left = Math.min(Math.max(16, r.left + r.width / 2 - left - 7), tw - 28) + "px";
    ar.style.top = below ? "-7px" : (th - 7) + "px";
  }
  function render() {
    var el = steps[idx]; if (!el) return;
    try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {}
    var title = el.getAttribute("data-tour-title") || "";
    var text = el.getAttribute("data-tour-text") || "";
    var last = idx === steps.length - 1;
    tip.querySelector("h4").textContent = title;
    tip.querySelector("p").textContent = text;
    tip.querySelector(".dots").innerHTML = steps.map(function (_, i) { return '<i class="' + (i === idx ? "on" : "") + '"></i>'; }).join("");
    tip.querySelector(".acts").innerHTML =
      (idx > 0 ? '<button class="trv-btn" data-prev>Précédent</button>' : '') +
      '<button class="trv-btn pri" data-next>' + (last ? "Terminé" : "Suivant") + "</button>";
    tip.querySelector("[data-next]").onclick = function () { last ? end(true) : (idx++, render()); };
    var pv = tip.querySelector("[data-prev]"); if (pv) pv.onclick = function () { idx--; render(); };
    setTimeout(layout, 60);
  }
  function end(done) {
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    ov = null; window.removeEventListener("resize", layout); window.removeEventListener("scroll", layout, true);
    if (done) store(pageKey(), "1");
  }
  function start(force) {
    steps = all("[data-tour]").sort(function (a, b) { return (+a.getAttribute("data-tour")) - (+b.getAttribute("data-tour")); });
    if (!steps.length) return;
    if (!force && store(pageKey())) return;
    idx = 0;
    ov = document.createElement("div"); ov.className = "trv-tour";
    ov.innerHTML = '<div class="trv-tour-block"></div><div class="trv-tour-hole"></div><div class="trv-tour-ring"></div>' +
      '<div class="trv-tip"><span class="arrow"></span><h4></h4><p></p>' +
      '<div class="trv-tip-row"><span class="dots"></span><button class="trv-skip">Passer</button></div>' +
      '<div class="acts" style="margin-top:10px;justify-content:flex-end"></div></div>';
    document.body.appendChild(ov);
    hole = ov.querySelector(".trv-tour-hole"); ring = ov.querySelector(".trv-tour-ring"); tip = ov.querySelector(".trv-tip");
    ov.querySelector(".trv-skip").onclick = function () { end(true); };
    ov.querySelector(".trv-tour-block").onclick = function () {}; // bloque les clics derrière
    window.addEventListener("resize", layout); window.addEventListener("scroll", layout, true);
    render();
  }
  window.trvTour = { start: function () { start(true); } };

  /* ================= MINI-DÉMOS ================= */
  var FINGER = '<svg class="hs-finger" viewBox="0 0 24 24" fill="#2b3a30"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11h.5V7a1.5 1.5 0 0 1 3 0v4.2h.5V8.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.6a5 5 0 0 1-4-2l-2.2-3a1.6 1.6 0 0 1 2.5-2l1.3 1.4V6.5a1.5 1.5 0 0 1 3 0V11z"/></svg>';
  var DEMOS = {
    "tache-faite": {
      title: "Marquer une tâche terminée",
      text: "Quand vous avez fini une tâche, appuyez sur « C'est fait ». C'est enregistré dans votre carnet de champ.",
      scene: '<div class="hs-card"><div class="t">Arroser au pied</div><div class="s">Tôt le matin</div>' +
        '<div class="hs-btn" id="hsB">C\'est fait</div></div>' +
        '<span class="hs-pulse" style="left:150px;top:150px;width:40px;height:40px;margin:-20px"></span>' +
        FINGER.replace("hs-finger", "hs-finger")
    },
    "signaler": {
      title: "Signaler un problème",
      text: "Un souci sur votre culture ? Prenez une photo : l'IA vous aide à reconnaître le problème et propose une solution.",
      scene: '<div class="hs-card"><div class="t">Signaler un problème</div><div class="s">Prendre une photo de la plante</div>' +
        '<div class="hs-btn" style="background:#D98A1F">Ouvrir l\'appareil photo</div></div>' +
        '<span class="hs-pulse" style="left:150px;top:150px;width:40px;height:40px;margin:-20px"></span>' + FINGER
    },
    "ecouter": {
      title: "Écouter à voix haute",
      text: "Vous préférez écouter ? Appuyez sur « Écouter » : la tâche est lue à voix haute, en français.",
      scene: '<div class="hs-card"><div class="t">Arroser au pied</div><div class="s">Tôt le matin</div>' +
        '<div class="hs-btn" style="background:#147C8C">Écouter</div></div>' +
        '<span class="hs-pulse" style="left:150px;top:150px;width:40px;height:40px;margin:-20px"></span>' + FINGER
    }
  };
  var hbg;
  function showHelp(topic) {
    var d = DEMOS[topic]; if (!d) return;
    if (!hbg) {
      hbg = document.createElement("div"); hbg.className = "trv-help-bg";
      hbg.innerHTML = '<div class="trv-help"><button class="trv-help-x" aria-label="Fermer">✕</button>' +
        '<div class="trv-help-stage"></div><div class="trv-help-cap"><h4></h4><p></p></div></div>';
      document.body.appendChild(hbg);
      hbg.querySelector(".trv-help-x").onclick = function () { hbg.classList.remove("show"); };
      hbg.onclick = function (e) { if (e.target === hbg) hbg.classList.remove("show"); };
    }
    hbg.querySelector(".trv-help-stage").innerHTML = d.scene;
    // place le doigt sur le bouton de la scène
    var f = hbg.querySelector(".hs-finger"); if (f) { f.style.left = "150px"; f.style.top = "128px"; }
    hbg.querySelector("h4").textContent = d.title;
    hbg.querySelector("p").textContent = d.text;
    hbg.classList.add("show");
  }
  window.trvHelp = { show: showHelp };

  // Boutons [data-help="sujet"]
  ready(function () {
    all("[data-help]").forEach(function (el) {
      el.addEventListener("click", function (e) { e.preventDefault(); showHelp(el.getAttribute("data-help")); });
    });
    // Démarrage auto de la visite (une seule fois), après un court délai.
    setTimeout(function () { start(false); }, 650);
  });
})();
