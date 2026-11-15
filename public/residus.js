/* Terravive — valoriser ses résidus agricoles.
 *
 * Un seul fichier pour le navigateur (window.TRV_RESIDUS) et pour le serveur (require) :
 * le guide de choix, les voies de valorisation et le test de germination du compost.
 *
 * D'où viennent les contenus :
 *  - Le guide (familles de résidus, vitesse de décomposition, voies adaptées, précautions) reformule
 *    le cours « Typologie et caractérisation des déchets agricoles » du Prof. Karamoko Ouattara
 *    (Master 1, UE Gestion des déchets agricoles, UFR-ARHAI, Université de San-Pédro).
 *    Le cours classe et oriente ; il ne donne ni dose ni quantité, donc ce fichier non plus.
 *  - Le seul chiffre est le repère de lecture du test de germination (80 % et 50 % de la levée du
 *    témoin), publié par deux services de vulgarisation agricole cités dans GERMINATION.sources.
 *  - Les quantités affichées dans Terravive viennent du carnet de champ (mesurées par le producteur).
 */
(function (root) {
  "use strict";

  var SOURCE = "Repères généraux reformulés à partir du cours « Typologie et caractérisation des déchets agricoles » (Prof. Karamoko Ouattara, Master 1, UFR-ARHAI, Université de San-Pédro). À adapter avec votre conseiller agricole.";

  // Voies de valorisation. « done » : la tournure utilisée dans le carnet et le bilan.
  var ROUTES = {
    compost: { label: "Compost", done: "mis au compost" },
    paillis: { label: "Paillis", done: "utilisés en paillis" },
    biochar: { label: "Biochar", done: "transformés en biochar" },
    aliment: { label: "Alimentation animale", done: "donnés aux animaux" },
    biogaz: { label: "Biogaz", done: "méthanisés (biogaz)" },
    autre: { label: "Autre usage", done: "valorisés autrement" }
  };

  // Familles du cours : végétaux, animaux, industries agroalimentaires.
  var FAMILIES = {
    vegetal: "Résidu végétal",
    animal: "Résidu animal",
    transfo: "Résidu de transformation"
  };

  /* Chaque résidu : ce qu'il est (nature), les voies conseillées dans l'ordre, comment faire, et
     les précautions. Aucune dose : le guide dit quoi faire, le carnet dit combien. */
  var RESIDUES = [
    {
      id: "tiges", label: "Tiges de maïs, mil, sorgho", family: "vegetal",
      nature: "Résidu dur et fibreux : il se décompose lentement.",
      routes: ["paillis", "compost"],
      how: {
        paillis: "Couchez les tiges entre les lignes : elles couvrent le sol longtemps, justement parce qu'elles se décomposent lentement.",
        compost: "Coupez-les en petits morceaux avant de les mettre au tas : plus les morceaux sont petits, plus la décomposition est rapide. Mélangez-les à des matières riches en azote (fumier, fientes, feuilles vertes)."
      },
      care: []
    },
    {
      id: "paille_riz", label: "Paille de riz", family: "vegetal",
      nature: "Résidu riche en lignine : décomposition lente, mais bonne matière pour le biochar.",
      routes: ["paillis", "biochar", "compost"],
      how: {
        paillis: "Étalez la paille au pied des cultures : elle protège le sol et dure longtemps.",
        biochar: "La paille de riz est une bonne matière pour produire du biochar, si un four adapté est disponible (souvent à l'échelle du groupement).",
        compost: "Seule, elle se décompose lentement : hachez-la et mélangez-la à du fumier ou à des résidus verts."
      },
      care: []
    },
    {
      id: "feuilles", label: "Feuilles, fanes, herbes (résidus tendres)", family: "vegetal",
      nature: "Résidu tendre, riche en cellulose : il se composte bien.",
      routes: ["compost", "paillis"],
      how: {
        compost: "C'est la matière la plus simple à composter. Alternez-la avec des matières plus sèches et plus dures pour que le tas reste aéré.",
        paillis: "En couche fine au pied des plants. Elle disparaît vite : renouvelez-la."
      },
      care: []
    },
    {
      id: "cacao_cafe", label: "Cabosses et cosses de cacao, coques de café", family: "vegetal",
      nature: "Résidu riche en matière organique. Il peut porter des résidus de pesticides.",
      routes: ["compost", "biochar"],
      how: {
        compost: "En Côte d'Ivoire, les résidus de cacao et de café sont valorisés en compost. Cassez les cabosses et mélangez-les à d'autres matières.",
        biochar: "Ils servent aussi à produire du biochar, si un four adapté est disponible."
      },
      care: ["Si le verger a été traité, ces résidus peuvent contenir des restes de pesticides : ne les donnez pas aux animaux et demandez conseil avant d'utiliser le compost sur des légumes."]
    },
    {
      id: "branches", label: "Branches, bois de taille, écorces", family: "vegetal",
      nature: "Résidu très dur, riche en lignine : c'est le plus lent à se décomposer.",
      routes: ["paillis", "biochar", "compost"],
      how: {
        paillis: "Broyées ou coupées menu, elles font un paillis durable au pied des arbres.",
        biochar: "Le bois de taille convient au biochar, si un four adapté est disponible.",
        compost: "Seulement en petits morceaux et en petite proportion : entières, elles restent longtemps dans le tas. Elles aident toutefois à l'aérer."
      },
      care: []
    },
    {
      id: "fumier", label: "Fumier, fientes de volaille, lisier", family: "animal",
      nature: "Résidu très humide, riche en azote. Il peut porter des germes.",
      routes: ["compost", "biogaz"],
      how: {
        compost: "Mélangez-le à des résidus secs (paille, tiges coupées) : il apporte l'azote, les résidus secs apportent le carbone et l'aération.",
        biogaz: "La méthanisation convient aux exploitations qui en ont un volume important ; elle demande un investissement et un suivi technique, souvent à l'échelle d'une coopérative."
      },
      care: ["Ne l'épandez pas frais sur les cultures : compostez-le d'abord, à cause des germes qu'il peut porter.", "Stockez-le loin des puits et des cours d'eau : le ruissellement pollue l'eau."]
    },
    {
      id: "transfo", label: "Pulpes, épluchures, résidus de transformation", family: "transfo",
      nature: "Résidu riche en matière organique et en nutriments, souvent humide ; sa qualité varie selon la transformation.",
      routes: ["aliment", "compost", "biogaz"],
      how: {
        aliment: "Les résidus sains et frais peuvent nourrir les animaux.",
        compost: "Ils sont humides : mélangez-les à des matières sèches pour éviter les mauvaises odeurs et les jus.",
        biogaz: "En grand volume, ils conviennent à la méthanisation (coopérative, unité de transformation)."
      },
      care: ["Ne donnez aux animaux que des résidus sains, sans produit chimique.", "Ne les laissez pas en tas à l'air libre : ils sentent vite et attirent les nuisibles."]
    },
    {
      id: "autre", label: "Autre résidu", family: null,
      nature: "Regardez s'il est tendre ou dur, sec ou humide : c'est ce qui décide de la voie.",
      routes: ["compost", "paillis", "autre"],
      how: {
        compost: "Tendre et humide : il se composte bien, mélangé à des matières sèches.",
        paillis: "Dur et sec : il se décompose lentement et fait un bon paillis."
      },
      care: []
    }
  ];

  // Règles valables pour tous les résidus (cours, séances 2, 3 et 6).
  var RULES = [
    "Triez à la source : gardez les résidus organiques à part. Pas de plastique ni d'emballage de produit chimique dans le tas.",
    "Mélangez des matières sèches et dures (riches en carbone) avec des matières vertes ou du fumier (riches en azote) : c'est l'équilibre carbone / azote qui fait un bon compost.",
    "Gardez le tas humide sans le détremper : trop d'eau donne de mauvaises odeurs et des jus qui polluent.",
    "Aérez le tas : des morceaux de tailles variées laissent passer l'air, et le retourner relance la décomposition.",
    "Un tas mal conduit attire les nuisibles : couvrez les matières fraîches et tenez-le à l'écart des habitations et des points d'eau.",
    "Résidus d'une culture traitée récemment avec un pesticide : ne les donnez pas aux animaux."
  ];

  /* ---------- Test de germination : le compost est-il mûr ? ---------- */
  var GERMINATION = {
    title: "Test de germination : mon compost est-il mûr ?",
    why: "Un compost pas assez mûr peut freiner la levée et la croissance des plantes. Ce test le vérifie sans laboratoire.",
    steps: [
      "Préparez deux récipients identiques : l'un rempli de votre compost humide, l'autre (le témoin) de votre terre habituelle ou de papier humide.",
      "Semez le même nombre de graines dans chacun, par exemple 20. Choisissez des graines qui lèvent vite : radis, concombre.",
      "Gardez les deux au même endroit, à l'ombre, toujours humides.",
      "Après environ 7 jours, comptez les graines levées dans chaque récipient et notez-les ici."
    ],
    ok_pct: 80,   // à partir de 80 % de la levée du témoin : satisfaisant
    low_pct: 50,  // en dessous de 50 % : poursuivre le compostage
    sources: [
      { name: "UF/IFAS Extension (Université de Floride) — Compost Maturity Test", url: "https://sfyl.ifas.ufl.edu/sarasota/natural-resources/waste-reduction/composting/what-is-composting/when-is-compost-ready/compost-maturity-test/" },
      { name: "UC ANR Cooperative Extension (Université de Californie) — Testing compost maturity using a cucumber germination index", url: "https://ucanr.edu/county/santa-clara-county-cooperative-extension/document/testing-compost-maturity-using-cucumber" }
    ],
    note: "Repère général publié par ces deux services de vulgarisation. Leurs protocoles sont plus précis (extrait de compost, mesure des racines) : ce test simplifié donne une indication, pas une analyse."
  };

  function intIn(v) {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    var n = Number(String(v).replace(",", "."));
    return isFinite(n) && Math.floor(n) === n ? n : NaN;
  }
  function r1(x) { return Math.round(x * 10) / 10; }

  /**
   * Lit un test de germination.
   * @param {object} g { sown, up, ref_sown, ref_up, days } (graines semées / levées sur le compost et sur le témoin)
   * @returns {object} { error } ou { pct, kind, level, verdict, summary, warnings }
   *   pct  : levée sur le compost en % de la levée du témoin (ou % de levée sur le compost s'il n'y a pas de témoin)
   *   level: "ok" | "moyen" | "faible" | "indetermine"
   */
  function germinationResult(g) {
    g = g || {};
    var sown = intIn(g.sown), up = intIn(g.up), rs = intIn(g.ref_sown), ru = intIn(g.ref_up), days = intIn(g.days);
    if (sown === null || up === null) return { error: "Indiquez le nombre de graines semées et levées sur le compost." };
    if (isNaN(sown) || isNaN(up) || sown < 1 || sown > 500 || up < 0) return { error: "Nombre de graines invalide (nombres entiers, de 1 à 500 graines semées)." };
    if (up > sown) return { error: "Il ne peut pas y avoir plus de graines levées que de graines semées." };
    var hasRef = rs !== null || ru !== null;
    if (hasRef) {
      if (rs === null || ru === null) return { error: "Pour le témoin, indiquez les graines semées et les graines levées." };
      if (isNaN(rs) || isNaN(ru) || rs < 1 || rs > 500 || ru < 0) return { error: "Nombre de graines du témoin invalide (nombres entiers, de 1 à 500 graines semées)." };
      if (ru > rs) return { error: "Témoin : il ne peut pas y avoir plus de graines levées que de graines semées." };
    }
    if (days !== null && (isNaN(days) || days < 1 || days > 60)) return { error: "Nombre de jours invalide (de 1 à 60)." };

    var rate = up / sown * 100;
    var summary = "compost " + up + "/" + sown + " levées";
    if (hasRef) summary += " · témoin " + ru + "/" + rs;
    if (days) summary += " · après " + days + " jour" + (days > 1 ? "s" : "");
    var warnings = [];
    if (sown < 10 || (hasRef && rs < 10)) warnings.push("Peu de graines : le résultat est peu sûr. Refaites le test avec une vingtaine de graines de chaque côté.");

    if (!hasRef) {
      return { pct: r1(rate), kind: "absolu", level: "indetermine", summary: summary, warnings: warnings,
        verdict: "Sans témoin, on ne peut pas conclure : " + r1(rate).toString().replace(".", ",") + " % des graines ont levé sur le compost, mais on ne sait pas combien auraient levé sans lui. Refaites le test avec un témoin." };
    }
    if (ru === 0) {
      return { pct: null, kind: "relatif", level: "indetermine", summary: summary, warnings: warnings,
        verdict: "Aucune graine n'a levé sur le témoin : les graines ou les conditions sont en cause, pas le compost. Refaites le test avec d'autres graines." };
    }
    var refRate = ru / rs * 100, pct = r1(rate / refRate * 100);
    if (refRate < 50) warnings.push("Moins d'une graine sur deux a levé sur le témoin : les graines sont peut-être mauvaises. Refaites le test avec d'autres graines pour confirmer.");
    var level, verdict, p = String(pct).replace(".", ",");
    if (pct >= GERMINATION.ok_pct) { level = "ok"; verdict = "La levée sur le compost atteint " + p + " % de celle du témoin : le compost ne freine pas la germination dans ce test."; }
    else if (pct >= GERMINATION.low_pct) { level = "moyen"; verdict = "La levée sur le compost n'atteint que " + p + " % de celle du témoin : laissez le compost mûrir encore, puis refaites le test."; }
    else { level = "faible"; verdict = "La levée sur le compost n'atteint que " + p + " % de celle du témoin : le compost n'est pas mûr. Poursuivez le compostage avant de l'utiliser."; }
    return { pct: pct, kind: "relatif", level: level, verdict: verdict, summary: summary, warnings: warnings };
  }

  function residueById(id) { for (var i = 0; i < RESIDUES.length; i++) if (RESIDUES[i].id === id) return RESIDUES[i]; return null; }
  /** Retrouve une voie à partir de sa clé (« compost ») ou de son libellé (« Compost »). */
  function routeKey(v) {
    var s = String(v == null ? "" : v).trim().toLowerCase();
    if (!s) return null;
    if (Object.prototype.hasOwnProperty.call(ROUTES, s)) return s;
    for (var k in ROUTES) if (Object.prototype.hasOwnProperty.call(ROUTES, k) && ROUTES[k].label.toLowerCase() === s) return k;
    return null;
  }

  var api = { SOURCE: SOURCE, ROUTES: ROUTES, FAMILIES: FAMILIES, RESIDUES: RESIDUES, RULES: RULES, GERMINATION: GERMINATION, germinationResult: germinationResult, residueById: residueById, routeKey: routeKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TRV_RESIDUS = api;
})(typeof window !== "undefined" ? window : this);
