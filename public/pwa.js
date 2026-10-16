/* Terravive — PWA : enregistrement du service worker, bouton « Installer », indicateur hors-ligne. */
(function () {
  // 1) Enregistrement du service worker (hors-ligne).
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }

  // 2) Bouton « Installer l'appli » (quand le navigateur le propose).
  var deferred = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    showInstallButton();
  });
  function showInstallButton() {
    if (document.getElementById("trv-install")) return;
    var b = document.createElement("button");
    b.id = "trv-install";
    b.type = "button";
    b.textContent = "⤓ Installer l'appli";
    b.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:99999;background:#2E7D46;color:#fff;border:none;border-radius:999px;padding:11px 16px;font:600 14px system-ui,Segoe UI,Arial,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.28);cursor:pointer;";
    b.addEventListener("click", function () {
      if (!deferred) { b.remove(); return; }
      deferred.prompt();
      if (deferred.userChoice) { try { deferred.userChoice.finally(function () { deferred = null; b.remove(); }); } catch (e) { deferred = null; b.remove(); } }
      else { deferred = null; b.remove(); }
    });
    document.body.appendChild(b);
  }
  window.addEventListener("appinstalled", function () {
    var b = document.getElementById("trv-install"); if (b) b.remove();
  });

  // 3) Indicateur « hors-ligne » discret.
  function offlineBadge(show) {
    var id = "trv-offline";
    var el = document.getElementById(id);
    if (show) {
      if (el) return;
      el = document.createElement("div");
      el.id = id;
      el.textContent = "Hors-ligne — vous consultez les données enregistrées.";
      el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:99998;background:#C58A2A;color:#fff;border-radius:999px;padding:8px 15px;font:600 13px system-ui,Segoe UI,Arial,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.25);";
      document.body.appendChild(el);
    } else if (el) { el.remove(); }
  }
  window.addEventListener("offline", function () { offlineBadge(true); });
  window.addEventListener("online", function () { offlineBadge(false); });
  if (navigator.onLine === false) offlineBadge(true);
})();
