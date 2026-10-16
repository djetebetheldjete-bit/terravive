/* Terravive — voix : lecture à voix haute (TTS) et dictée (reconnaissance vocale).
 * La voix fonctionne de façon fiable en FRANÇAIS (moteurs du téléphone).
 * Les langues locales (dioula, baoulé…) n'ont pas de moteur vocal sur les téléphones :
 * la lecture d'un texte en langue locale est donc approximative, et la dictée se fait en français.
 */
(function () {
  var synth = window.speechSynthesis || null;
  var current = null;

  function pickVoice(lang) {
    if (!synth) return null;
    var vs = synth.getVoices() || [];
    lang = (lang || "fr").toLowerCase();
    // Cherche une voix française (ou la langue demandée si disponible), sinon la 1re dispo.
    var pref = vs.find(function (v) { return v.lang && v.lang.toLowerCase().indexOf(lang) === 0; });
    if (!pref) pref = vs.find(function (v) { return v.lang && v.lang.toLowerCase().indexOf("fr") === 0; });
    return pref || vs[0] || null;
  }

  window.trvCanSpeak = function () { return !!synth; };
  window.trvCanListen = function () { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); };

  // Lecture à voix haute. onEnd() appelé à la fin ou à l'arrêt.
  window.trvSpeak = function (text, onEnd, lang) {
    if (!synth) { if (onEnd) onEnd(); return false; }
    try { synth.cancel(); } catch (e) {}
    var clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) { if (onEnd) onEnd(); return false; }
    var u = new SpeechSynthesisUtterance(clean);
    var v = pickVoice(lang || "fr"); if (v) u.voice = v;
    u.lang = (v && v.lang) || "fr-FR";
    u.rate = 0.98; u.pitch = 1;
    u.onend = function () { current = null; if (onEnd) onEnd(); };
    u.onerror = function () { current = null; if (onEnd) onEnd(); };
    current = u;
    try { synth.speak(u); return true; } catch (e) { if (onEnd) onEnd(); return false; }
  };
  window.trvStop = function () { if (synth) { try { synth.cancel(); } catch (e) {} } current = null; };
  window.trvSpeaking = function () { return !!(synth && synth.speaking); };

  // Dictée. onResult(texte), onEnd(). Renvoie l'objet recognition (ou null).
  window.trvListen = function (onResult, onEnd, lang) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { if (onEnd) onEnd(); return null; }
    var rec = new SR();
    rec.lang = lang || "fr-FR";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = function (ev) { try { var t = ev.results[0][0].transcript; if (onResult) onResult(t); } catch (e) {} };
    rec.onerror = function () {};
    rec.onend = function () { if (onEnd) onEnd(); };
    try { rec.start(); } catch (e) { if (onEnd) onEnd(); return null; }
    return rec;
  };

  // Certaines plateformes chargent les voix de façon asynchrone.
  if (synth && typeof synth.onvoiceschanged !== "undefined") { synth.onvoiceschanged = function () {}; }
})();
