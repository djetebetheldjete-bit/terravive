/* Terravive — jeu d'icônes au trait (même style que le menu : 24 × 24, trait 1,8, extrémités arrondies).
   Usage : trvIcon("water") renvoie un <svg> ; dans le HTML statique, <span data-ico="water"></span> est rempli au chargement.
   Les icônes héritent de la couleur du texte (currentColor) : elles suivent les thèmes clair et sombre. */
(function () {
  var P = {
    water: '<path d="M12 3.2c-2.9 3.7-6 6.9-6 10.6a6 6 0 0 0 12 0c0-3.7-3.1-6.9-6-10.6z"/><path d="M9.2 14.6a2.9 2.9 0 0 0 2.6 2.6"/>',
    compost: '<path d="M3 20h18"/><path d="M4.5 20c.8-3.6 3.8-6 7.5-6s6.7 2.4 7.5 6"/><path d="M12 14V9.5"/><path d="M12 10.5c0-3 1.9-5 5.2-5.3-.1 3.2-2.1 5.1-5.2 5.3z"/><path d="M12 11.5c-.2-2.3-1.7-3.8-4.2-4 .1 2.4 1.7 3.8 4.2 4z"/>',
    fertilizer: '<path d="M7.2 8h9.6l1.7 12.2H5.5z"/><path d="M8.8 8l.9-3.6h4.6l.9 3.6"/><path d="M9 13.2h6"/><path d="M10 16.4h4"/>',
    treatment: '<path d="M8.5 9.5h6v10.2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z"/><path d="M10.5 9.5V6.2h4.2l1.8 1.2"/><path d="M14.7 6.2V4.4h-3.2"/><path d="M19 5.4h.01M20.4 8h.01M19 10.6h.01"/><path d="M8.5 14h6"/>',
    sowing: '<path d="M6 20.2h12"/><path d="M12 20.2v-8.4"/><path d="M12 12c0-3.6-2.6-5.9-6.4-6 0 3.6 2.6 6 6.4 6z"/><path d="M12 14.2c0-3 2.3-5 5.6-5 0 3-2.3 5-5.6 5z"/>',
    harvest: '<path d="M3.8 10.2h16.4l-1.6 9a1.2 1.2 0 0 1-1.2 1H6.6a1.2 1.2 0 0 1-1.2-1z"/><path d="M8.2 10.2l2.3-5.6"/><path d="M15.8 10.2l-2.3-5.6"/><path d="M4.6 14.6h14.8"/>',
    incident: '<path d="M10.4 4.3L2.9 17.6A1.8 1.8 0 0 0 4.5 20.3h15a1.8 1.8 0 0 0 1.6-2.7L13.6 4.3a1.8 1.8 0 0 0-3.2 0z"/><path d="M12 9.6v4.2"/><path d="M12 16.9h.01"/>',
    observation: '<path d="M2.3 12s3.6-6.2 9.7-6.2 9.7 6.2 9.7 6.2-3.6 6.2-9.7 6.2S2.3 12 2.3 12z"/><circle cx="12" cy="12" r="2.9"/>',
    chart: '<path d="M3.5 20.2h17"/><path d="M6.5 20.2v-7"/><path d="M11 20.2V5.6"/><path d="M15.5 20.2v-9.4"/><path d="M20 20.2v-4.6"/>',
    printer: '<path d="M7 8.6V3.8h10v4.8"/><path d="M7 17.2H5a1.6 1.6 0 0 1-1.6-1.6v-5.4A1.6 1.6 0 0 1 5 8.6h14a1.6 1.6 0 0 1 1.6 1.6v5.4a1.6 1.6 0 0 1-1.6 1.6h-2"/><path d="M7 13.8h10v6.4H7z"/>',
    download: '<path d="M12 3.8v11"/><path d="M7.4 10.4l4.6 4.6 4.6-4.6"/><path d="M4.6 19.8h14.8"/>',
    send: '<path d="M20.6 3.4L10.2 13.8"/><path d="M20.6 3.4l-6.6 17.2-3.8-6.8-6.8-3.8z"/>',
    speaker: '<path d="M4 9.4h3.6L12.6 5v14l-5-4.4H4z"/><path d="M16 9.2a4 4 0 0 1 0 5.6"/><path d="M18.6 6.6a7.6 7.6 0 0 1 0 10.8"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.6"/>',
    proof: '<path d="M14 3.4H7.4a1.6 1.6 0 0 0-1.6 1.6v14a1.6 1.6 0 0 0 1.6 1.6h9.2a1.6 1.6 0 0 0 1.6-1.6V7.6z"/><path d="M14 3.4v4.2h4.2"/><path d="M9.2 14l2 2 3.8-3.9"/>',
    notebook: '<path d="M6 3.4h11.4A1.6 1.6 0 0 1 19 5v14a1.6 1.6 0 0 1-1.6 1.6H6z"/><path d="M9.2 3.4v17.2"/><path d="M12.4 8.2h3.6"/><path d="M12.4 11.8h3.6"/><path d="M4 7h4M4 12h4M4 17h4"/>',
    pencil: '<path d="M4 20l1-4.2L15.6 5.2a1.9 1.9 0 0 1 2.7 0l.5.5a1.9 1.9 0 0 1 0 2.7L8.2 19z"/><path d="M14 6.8l3.2 3.2"/>',
    close: '<path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/>',
    fiche: '<path d="M9 3.6h6v3H9z"/><path d="M15 5.1h2.4A1.6 1.6 0 0 1 19 6.7v12.7a1.6 1.6 0 0 1-1.6 1.6H6.6A1.6 1.6 0 0 1 5 19.4V6.7a1.6 1.6 0 0 1 1.6-1.6H9"/><path d="M8.6 11.2h6.8"/><path d="M8.6 14.6h6.8"/><path d="M8.6 18h4"/>',
    phone: '<rect x="6.6" y="2.8" width="10.8" height="18.4" rx="2.2"/><path d="M10.6 17.8h2.8"/>',
    tank: '<ellipse cx="12" cy="5.8" rx="6.2" ry="2.2"/><path d="M5.8 5.8v12.4c0 1.2 2.8 2.2 6.2 2.2s6.2-1 6.2-2.2V5.8"/><path d="M5.8 13c0 1.2 2.8 2.2 6.2 2.2s6.2-1 6.2-2.2"/>',
    leaf: '<path d="M5 19c0-8.4 5.3-13.6 14-14-.4 8.7-5.6 14-14 14z"/><path d="M5 19l7.6-7.6"/>',
    rain: '<path d="M7.4 15.6a4.4 4.4 0 0 1-.6-8.8 5.6 5.6 0 0 1 10.8 1.5 3.7 3.7 0 0 1-.5 7.3"/><path d="M9 18.4l-.8 2"/><path d="M12.6 17.4l-.8 2.4"/><path d="M16.2 18.4l-.8 2"/>',
    loss: '<path d="M3.8 10.2h16.4l-1.6 9a1.2 1.2 0 0 1-1.2 1H6.6a1.2 1.2 0 0 1-1.2-1z"/><path d="M8.2 10.2l2.3-5.6"/><path d="M15.8 10.2l-2.3-5.6"/><path d="M9.6 13.6l4.8 4.4"/><path d="M14.4 13.6l-4.8 4.4"/>',
    scale: '<path d="M12 4v16"/><path d="M7 20h10"/><path d="M5 7h14"/><path d="M5 7l-2.6 6a2.6 2.6 0 0 0 5.2 0z"/><path d="M19 7l-2.6 6a2.6 2.6 0 0 0 5.2 0z"/>',
    check: '<path d="M5 12.6l4.2 4.2L19 7"/>'
  };
  function trvIcon(name, extraClass) {
    var p = P[name]; if (!p) return "";
    return '<svg class="ico' + (extraClass ? " " + extraClass : "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + p + "</svg>";
  }
  window.trvIcon = trvIcon;
  window.TRV_ICONS = Object.keys(P);
  function fill(root) { (root || document).querySelectorAll("[data-ico]").forEach(function (el) { if (!el.firstChild) el.innerHTML = trvIcon(el.getAttribute("data-ico")); }); }
  window.trvIconsFill = fill;
  var css = document.createElement("style");
  css.textContent = ".ico{width:1.15em;height:1.15em;vertical-align:-.2em;flex:none;display:inline-block}" +
    ".btn .ico,button .ico{margin-right:.4em}h2 .ico,.ct .ico{width:1.05em;height:1.05em;margin-right:.35em;color:var(--leaf,#2e7d4f)}";
  (document.head || document.documentElement).appendChild(css);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { fill(); }); else fill();
})();
