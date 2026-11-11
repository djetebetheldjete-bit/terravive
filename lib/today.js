"use strict";
// Terravive — écran « Aujourd'hui » : à partir du calendrier de la fiche terrain (repères du type
// « Jour 0 », « Semaines 3-4 », « 2 semaines avant semis ») et de la date de semis de la parcelle,
// retrouve ce qu'il y a à faire cette semaine et la semaine prochaine.
// Les repères liés au stade de la plante (« À la floraison ») ne peuvent pas être datés :
// ils sont rendus à part, « selon le stade ».

const NUM = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10 };

function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, " ").replace(/\s+/g, " ").trim();
}
function n(x) { return NUM[x] != null ? NUM[x] : parseInt(x, 10); }
const NB = "(\\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)";

/**
 * Convertit un repère de calendrier en plage de jours depuis le semis (jour 0).
 * @returns {{from:number,to:number}|null}
 */
function parseWhen(q) {
  const s = norm(q);
  if (!s) return null;
  let m;
  const before = /\bavant\b/.test(s);
  // « 2 semaines avant semis », « 3 à 4 semaines avant », « 10 jours avant »
  if (before && (m = s.match(new RegExp(NB + "(?:\\s*(?:a|-)\\s*" + NB + ")?\\s*(semaines?|jours?|mois)"))) ) {
    const a = n(m[1]), b = m[2] ? n(m[2]) : a, u = m[3][0] === "s" ? 7 : m[3][0] === "m" ? 30 : 1;
    const far = Math.max(a, b) * u, near = Math.min(a, b) * u;
    return { from: -far, to: u === 1 ? -near : -near + u - 1 };
  }
  if (/\bla veille\b/.test(s)) return { from: -1, to: -1 };
  if (before) return { from: -7, to: -1 };
  if (/\b(au semis|jour du semis|au repiquage|a la plantation|jour 0|j ?0\b|j ?\+ ?0\b)/.test(s)) return { from: 0, to: 0 };
  // « J+10 », « J10 », « jour 10 », « jours 10-15 », « J+10 a J+15 »
  if ((m = s.match(/\bj(?:ours?)?\s*\+?\s*(\d+)(?:\s*(?:a|-|au)\s*(?:j(?:ours?)?\s*\+?\s*)?(\d+))?/))) {
    const a = +m[1], b = m[2] != null ? +m[2] : a; return { from: Math.min(a, b), to: Math.max(a, b) };
  }
  // « semaine 3 », « semaines 3-4 », « semaines 3 a 5 », « S3 »
  if ((m = s.match(/\b(?:semaines?|s)\s*(\d+)(?:\s*(?:a|-|et)\s*(\d+))?/))) {
    const a = +m[1], b = m[2] != null ? +m[2] : a;
    return { from: (Math.min(a, b) - 1) * 7, to: Math.max(a, b) * 7 - 1 };
  }
  // « 3 semaines après semis », « 45 jours après »
  if ((m = s.match(new RegExp(NB + "(?:\\s*(?:a|-)\\s*" + NB + ")?\\s*(semaines?|jours?|mois)\\s*apres")))) {
    const a = n(m[1]), b = m[2] ? n(m[2]) : a, u = m[3][0] === "s" ? 7 : m[3][0] === "m" ? 30 : 1;
    return { from: Math.min(a, b) * u, to: Math.max(a, b) * u + (u > 1 ? u - 1 : 0) };
  }
  // « Dès 6 semaines », « à partir de 45 jours » : début daté, puis répété pendant environ 8 semaines
  if ((m = s.match(new RegExp("\\b(?:des|a partir de|a partir du)\\s*(?:la\\s*|le\\s*)?" + NB + "\\s*(semaines?|jours?|mois)\\b")))) {
    const a = n(m[1]), u = m[2][0] === "s" ? 7 : m[2][0] === "m" ? 30 : 1, from = u === 7 ? (a - 1) * 7 : a * u;
    return { from, to: from + 55 };
  }
  // « mois 2 »
  if ((m = s.match(/\bmois\s*(\d+)(?:\s*(?:a|-)\s*(\d+))?/))) {
    const a = +m[1], b = m[2] != null ? +m[2] : a; return { from: (Math.min(a, b) - 1) * 30, to: Math.max(a, b) * 30 - 1 };
  }
  return null;
}

function daysBetween(fromIso, toIso) {
  const a = Date.parse(String(fromIso).slice(0, 10) + "T12:00:00Z"), b = Date.parse(String(toIso).slice(0, 10) + "T12:00:00Z");
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * Tâches du moment.
 * @param {Array<{quand,faire,detail}>} calendar  calendrier de la fiche terrain
 * @param {string|null} sownAt  date de semis (AAAA-MM-JJ)
 * @param {string} todayIso     date du jour (AAAA-MM-JJ)
 */
function tasksFor(calendar, sownAt, todayIso) {
  const cal = Array.isArray(calendar) ? calendar : [];
  const day = sownAt ? daysBetween(sownAt, todayIso) : null;
  const out = { day, now: [], next: [], stage: [], start: [] };
  cal.forEach((c) => {
    const r = parseWhen(c && c.quand);
    const item = { quand: c.quand || "", faire: c.faire || "", detail: c.detail || "" };
    if (!r) { out.stage.push(item); return; }
    if (day == null) { if (out.start.length < 3) out.start.push(item); return; }
    if (r.from <= day && day <= r.to) out.now.push(item);
    else if (r.from > day && r.from <= day + 7) out.next.push(item);
  });
  out.stage = out.stage.slice(0, 4);
  return out;
}

/** Texte court à lire à voix haute. */
function speechText(t, parcelName) {
  const parts = [];
  if (t.day != null) parts.push(parcelName ? "Parcelle " + parcelName + "." : "", t.day >= 0 ? "Jour " + t.day + " depuis le semis." : "Semis dans " + (-t.day) + " jours.");
  if (t.now.length) parts.push("Cette semaine : " + t.now.map((x) => x.faire + (x.detail ? ", " + x.detail : "")).join(". ") + ".");
  if (t.next.length) parts.push("La semaine prochaine : " + t.next.map((x) => x.faire).join(". ") + ".");
  if (!t.now.length && !t.next.length && t.day != null) parts.push("Pas de travail prévu par la fiche cette semaine.");
  return parts.filter(Boolean).join(" ");
}

module.exports = { parseWhen, tasksFor, daysBetween, speechText };
