"use strict";
/**
 * scenarios.js — les 10 scénarios de test du générateur d'itinéraires de Terravive.
 *
 * Chaque scénario définit :
 *  - input            : les données d'entrée (profil de parcelle) ;
 *  - promptAttendu[]   : ce qui DOIT être transmis au modèle (vérifié sur le VRAI
 *                        planUserMessage() de production) — {label, text|regex} ;
 *  - systemeAttendu[]  : ce que le VRAI planSystem() doit contenir pour ce scénario ;
 *  - comportements[]   : comportements attendus (description lisible) ;
 *  - erreurs[]         : erreurs à détecter (ce qui NE doit pas se produire) ;
 *  - itkAttendus       : objet passé à la grille automatique pour noter une réponse
 *                        simulée (fixture) ;
 *  - fixture           : nom de fichier de la réponse IA SIMULÉE (dans fixtures/),
 *                        ou null si le scénario ne grade pas de texte.
 *
 * On N'APPELLE JAMAIS le fournisseur externe : le texte est simulé par des fixtures.
 */

const MODE = {
  agro: "Agroécologie / régénératif",
  bio: "Agriculture biologique",
  conservation: "Agriculture de conservation (non-labour, couverture)",
  conventionnel: "Conventionnel raisonné",
};

const scenarios = [
  {
    id: "01_tomate_sanpedro",
    titre: "Tomate à San Pedro (petit maraîcher, agroécologie)",
    input: {
      crop: "tomate", region: "San Pedro", area: "1000 m²", soil: "sableux",
      ph: "", season: "", mode: MODE.agro, structure: "polyculture",
      goal: "vente locale", notes: "petit budget, pas de tracteur, arrosage à l'arrosoir",
    },
    promptAttendu: [
      { label: "culture transmise", text: "Culture souhaitée : tomate" },
      { label: "localité transmise", text: "Région / localité : San Pedro" },
      { label: "surface convertie 0,1 ha = 1000 m² avec consigne UTILISE", regex: /0\.1 ha = 1000 m².*UTILISE cette conversion/ },
      { label: "pH signalé non précisé (sans reproche)", text: "pH du sol : non précisé" },
      { label: "saison non précisée", text: "Saison / période de démarrage : non précisée" },
      { label: "mode agroécologie transmis", text: "Mode de conduite souhaité : " + MODE.agro },
    ],
    systemeAttendu: [
      { label: "bloc AGROÉCOLOGIE présent", text: "AGROÉCOLOGIE / RÉGÉNÉRATIF" },
    ],
    comportements: [
      "L'ITK doit traiter le pH manquant comme normal et proposer une estimation simple, sans inventer de dose de chaux.",
      "Les calculs de quantité doivent partir de 0,1 ha (pas de 1000 interprété comme ha).",
      "Le mode agroécologie doit influencer sol/fertilisation/protection.",
    ],
    erreurs: [
      "Confondre 1000 m² avec 1000 ha.",
      "Donner une dose chiffrée de chaux alors que le pH est inconnu.",
      "Inventer un prix local.",
    ],
    itkAttendus: {
      haStr: "0.1",
      exigeCalculQuantite: true,
      exiges: [
        { id: "dispo_locale", label: "phrase « Disponibilité locale à confirmer »", regex: /Disponibilité locale à confirmer/i },
      ],
      interdits: [
        { id: "chaux_dosee_sans_ph", label: "dose chiffrée de chaux en kg/ha sans pH", regex: /\d+\s*(kg|t)\s*(\/|par\s+)ha\s+de\s+chaux/i },
      ],
    },
    fixture: "01_tomate_sanpedro.md",
  },

  {
    id: "02_mais_korhogo",
    titre: "Maïs à Korhogo (Nord, pH fourni, conventionnel raisonné)",
    input: {
      crop: "maïs", region: "Korhogo", area: "2 ha", soil: "argilo-sableux",
      ph: "6.2", season: "début des pluies", mode: MODE.conventionnel,
      structure: "monoculture", goal: "rendement commercialisable", notes: "dispose d'un motoculteur",
    },
    promptAttendu: [
      { label: "culture maïs", text: "Culture souhaitée : maïs" },
      { label: "localité Korhogo", text: "Région / localité : Korhogo" },
      { label: "surface 2 ha = 20000 m²", regex: /2 ha = 20000 m².*UTILISE cette conversion/ },
      { label: "pH 6.2 transmis", text: "pH du sol : 6.2" },
      { label: "saison transmise", text: "Saison / période de démarrage : début des pluies" },
      { label: "mode conventionnel raisonné", text: "Mode de conduite souhaité : " + MODE.conventionnel },
    ],
    systemeAttendu: [
      { label: "bloc CONVENTIONNEL RAISONNÉ présent", text: "CONVENTIONNEL RAISONNÉ" },
    ],
    comportements: [
      "Le pH étant fourni (6,2 = légèrement acide), la fumure peut en tenir compte, mais la dose de chaux dépend aussi de la texture.",
      "Les totaux doivent être calculés sur 2 ha.",
      "Le mode conventionnel raisonné = intrants justifiés, pas d'usage systématique.",
    ],
    erreurs: [
      "Oublier de calculer les totaux pour 2 ha.",
      "Calculer une dose de chaux sur le seul pH, sans la texture.",
    ],
    itkAttendus: {
      haStr: "2",
      exigeCalculQuantite: true,
      exiges: [],
      interdits: [],
    },
    fixture: "02_mais_korhogo.md",
  },

  {
    id: "03_ph_sol_inconnus",
    titre: "Culture avec pH et sol inconnus (gombo)",
    input: {
      crop: "gombo", region: "Daloa", area: "500 m²", soil: "", ph: "",
      season: "", mode: MODE.agro, structure: "", goal: "autoconsommation + vente", notes: "",
    },
    promptAttendu: [
      { label: "sol non précisé", text: "Type de sol : non précisé" },
      { label: "pH non précisé (sans reproche)", text: "pH du sol : non précisé (la personne n'a pas cette valeur)" },
      { label: "surface 0,05 ha = 500 m²", regex: /0\.05 ha = 500 m²/ },
    ],
    systemeAttendu: [
      { label: "consigne : ne pas inventer, proposer une méthode simple", text: "propose une méthode SIMPLE et peu coûteuse" },
      { label: "consigne : ne jamais chiffrer une dose de chaux sur test maison", text: "NE chiffre JAMAIS une dose de chaux à partir d'un test maison" },
    ],
    comportements: [
      "Doit signaler les données manquantes (sol, pH) et proposer comment les obtenir, sans inventer.",
      "Approche prudente qui marche sans pH : matière organique + observation.",
    ],
    erreurs: [
      "Inventer un type de sol ou une valeur de pH.",
      "Donner une dose de chaux chiffrée.",
    ],
    itkAttendus: {
      haStr: "0.05",
      exigeCalculQuantite: false,
      exiges: [],
      interdits: [
        { id: "chaux_dosee_sans_ph", label: "dose chiffrée de chaux sans pH", regex: /\d+\s*(kg|t)\s*(\/|par\s+)ha\s+de\s+chaux/i },
        { id: "ph_invente", label: "valeur de pH affirmée alors qu'inconnue", regex: /pH\s*(de\s*)?(?:est|=|:)\s*\d/i },
      ],
    },
    fixture: "03_ph_sol_inconnus.md",
  },

  {
    id: "04_budget_inconnu",
    titre: "Culture avec budget / prix inconnus (piment)",
    input: {
      crop: "piment", region: "Bouaké", area: "0.25 ha", soil: "limono-sableux", ph: "",
      season: "saison des pluies", mode: MODE.agro, structure: "polyculture",
      goal: "vente marché", notes: "je ne connais pas les prix des intrants",
    },
    promptAttendu: [
      { label: "surface 0,25 ha = 2500 m²", regex: /0\.25 ha = 2500 m²/ },
      { label: "contrainte prix inconnus transmise", text: "je ne connais pas les prix" },
    ],
    systemeAttendu: [
      { label: "consigne : n'invente jamais de prix local", text: "n'invente JAMAIS de prix local" },
      { label: "consigne : tableau à compléter", text: "Construis un tableau que le producteur complétera" },
      { label: "marge ≠ bénéfice réel", text: "n'est pas le BÉNÉFICE RÉEL" },
    ],
    comportements: [
      "Le budget doit être un tableau à compléter, marqué « Estimé », sans prix inventé.",
      "Si aucun prix n'est fourni, pas de chiffre d'affaires ni de marge chiffrés.",
    ],
    erreurs: [
      "Inventer un prix unitaire ou un coût total chiffré.",
      "Présenter une marge comme un bénéfice garanti.",
    ],
    itkAttendus: {
      haStr: "0.25",
      exigeCalculQuantite: false,
      exiges: [
        { id: "budget_a_completer", label: "tableau budget avec colonne Vérifié / Estimé", regex: /Vérifié\s*\/\s*Estimé/i },
      ],
      interdits: [
        { id: "prix_fcfa", label: "prix chiffré en FCFA inventé", regex: /\b\d[\d\s. ]*\s*(FCFA|CFA|XOF)\b/i },
      ],
    },
    fixture: "04_budget_inconnu.md",
  },

  {
    id: "05_climat_indisponible",
    titre: "Données climatiques indisponibles (riz, saison non renseignée)",
    input: {
      crop: "riz pluvial", region: "Man", area: "1 ha", soil: "argileux", ph: "",
      season: "", mode: MODE.agro, structure: "monoculture", goal: "autoconsommation", notes: "",
    },
    promptAttendu: [
      { label: "saison non précisée transmise", text: "Saison / période de démarrage : non précisée" },
    ],
    systemeAttendu: [
      { label: "consigne : calendrier conditionnel si saison inconnue", text: "propose un calendrier CONDITIONNEL" },
      { label: "consigne : repères relatifs au stade si pas de date", text: "repères RELATIFS au stade" },
      { label: "consigne : ne pas présenter un calendrier général comme une prévision météo", text: "JAMAIS un calendrier agricole général comme une prévision météo" },
    ],
    comportements: [
      "Doit signaler l'absence de calendrier local et proposer un calendrier conditionnel.",
      "Doit exprimer les périodes en repères relatifs (semaines après semis) plutôt qu'en dates inventées.",
    ],
    erreurs: [
      "Inventer des dates précises de pluie.",
      "Présenter un régime climatique supposé comme une mesure locale.",
    ],
    itkAttendus: {
      haStr: "1",
      exigeCalculQuantite: false,
      exiges: [],
      interdits: [],
    },
    fixture: null,
  },

  // --- Scénarios 6 à 9 : les quatre modes de conduite ---
  {
    id: "06_mode_agroecologie",
    titre: "Mode agroécologique",
    input: { crop: "aubergine", region: "Abengourou", area: "0.3 ha", soil: "", ph: "", season: "", mode: MODE.agro, structure: "polyculture", goal: "durabilité", notes: "" },
    promptAttendu: [{ label: "mode agroécologie transmis", text: "Mode de conduite souhaité : " + MODE.agro }],
    systemeAttendu: [
      { label: "bloc AGROÉCOLOGIE / RÉGÉNÉRATIF", text: "AGROÉCOLOGIE / RÉGÉNÉRATIF" },
      { label: "le mode doit influencer réellement", text: "le mode choisi doit INFLUENCER RÉELLEMENT" },
    ],
    comportements: ["Couverture du sol, apports organiques, rotations/associations, lutte intégrée."],
    erreurs: ["Mode ignoré (recommandations identiques quel que soit le mode)."],
    itkAttendus: { exigeCalculQuantite: false, exiges: [], interdits: [] },
    fixture: null,
  },
  {
    id: "07_mode_biologique",
    titre: "Mode biologique",
    input: { crop: "concombre", region: "Agboville", area: "0.2 ha", soil: "", ph: "", season: "", mode: MODE.bio, structure: "polyculture", goal: "bio", notes: "" },
    promptAttendu: [{ label: "mode biologique transmis", text: "Mode de conduite souhaité : " + MODE.bio }],
    systemeAttendu: [
      { label: "bloc AGRICULTURE BIOLOGIQUE", text: "AGRICULTURE BIOLOGIQUE" },
      { label: "aucun intrant chimique de synthèse", text: "AUCUN intrant chimique de synthèse" },
      { label: "ne pas affirmer « autorisé en bio » sans vérification", text: "à vérifier auprès du référentiel" },
    ],
    comportements: ["Prévention, fertilité organique, méthodes autorisées ; distinguer inspiré/cahier des charges/certifié."],
    erreurs: ["Recommander un intrant chimique de synthèse.", "Affirmer qu'un intrant est « autorisé en bio » sans réserve."],
    itkAttendus: { exigeCalculQuantite: false, exiges: [], interdits: [] },
    fixture: null,
  },
  {
    id: "08_mode_conservation",
    titre: "Mode agriculture de conservation",
    input: { crop: "soja", region: "Bondoukou", area: "1.5 ha", soil: "argilo-sableux", ph: "", season: "", mode: MODE.conservation, structure: "rotation", goal: "sol vivant", notes: "" },
    promptAttendu: [{ label: "mode conservation transmis", text: "Mode de conduite souhaité : " + MODE.conservation }],
    systemeAttendu: [
      { label: "bloc AGRICULTURE DE CONSERVATION", text: "AGRICULTURE DE CONSERVATION" },
      { label: "perturbation minimale / non-labour", regex: /non-labour|perturbation minimale/i },
      { label: "ne pas imposer le semis direct sans matériel", text: "N'IMPOSE PAS le semis direct" },
    ],
    comportements: ["Trois principes (non-labour, couverture, rotation) adaptés au matériel ; transition progressive possible."],
    erreurs: ["Imposer le semis direct sans tenir compte du matériel."],
    itkAttendus: { exigeCalculQuantite: false, exiges: [], interdits: [] },
    fixture: null,
  },
  {
    id: "09_mode_conventionnel",
    titre: "Mode conventionnel raisonné",
    input: { crop: "oignon", region: "Ferkessédougou", area: "1 ha", soil: "sableux", ph: "6.5", season: "saison sèche irriguée", mode: MODE.conventionnel, structure: "monoculture", goal: "rendement", notes: "accès à l'eau" },
    promptAttendu: [{ label: "mode conventionnel transmis", text: "Mode de conduite souhaité : " + MODE.conventionnel }],
    systemeAttendu: [
      { label: "bloc CONVENTIONNEL RAISONNÉ", text: "CONVENTIONNEL RAISONNÉ" },
      { label: "intrants justifiés, pas d'usage systématique", regex: /apports d'intrants JUSTIFIÉS|n'est PAS l'usage systématique/i },
    ],
    comportements: ["Intrants justifiés et raisonnés, lutte intégrée, respect des étiquettes et délais avant récolte."],
    erreurs: ["Présenter le mode comme usage systématique/excessif de produits chimiques."],
    itkAttendus: { exigeCalculQuantite: false, exiges: [], interdits: [] },
    fixture: null,
  },

  // --- Scénario 10 : entrées invalides ou incomplètes ---
  {
    id: "10_entrees_invalides",
    titre: "Entrées invalides ou incomplètes",
    // Ce scénario n'a pas un seul input : il regroupe plusieurs sous-cas vérifiés
    // directement dans test-deterministic.js (voir sousCas ci-dessous).
    input: null,
    sousCas: [
      { label: "surface sans unité (« 500 »)", area: "500", attendu: /superficie inexploitable|NE CALCULE AUCUNE/ },
      { label: "surface non numérique (« beaucoup »)", area: "beaucoup", attendu: /superficie inexploitable|NE CALCULE AUCUNE/ },
      { label: "surface négative (« -5 ha »)", area: "-5 ha", attendu: /superficie inexploitable|NE CALCULE AUCUNE/ },
      { label: "surface nulle (« 0 m² »)", area: "0 m²", attendu: /superficie inexploitable|NE CALCULE AUCUNE/ },
      { label: "surface absente (vide)", area: "", attendu: /non précisée — NE CALCULE AUCUNE/ },
    ],
    // Contrat de la route /api/plan vérifié par inspection du source de production.
    contratSource: [
      { label: "culture obligatoire (400 si absente)", text: "Indiquez au moins la culture souhaitée." },
      { label: "authentification requise (401)", text: "Connectez-vous pour créer votre plan." },
      { label: "clé IA manquante gérée (500)", text: "Clé IA manquante" },
      { label: "limite journalière (429)", text: "beaucoup de plans aujourd'hui" },
      { label: "JSON invalide géré (400)", text: "Requête invalide." },
    ],
    comportements: [
      "Une surface invalide NE doit JAMAIS produire un calcul de quantité : le message au modèle l'interdit explicitement.",
      "Une culture absente est rejetée côté serveur (400) avant tout appel IA.",
    ],
    erreurs: [
      "Calculer une quantité à partir d'une surface invalide.",
      "Appeler l'IA sans culture.",
    ],
    fixture: null,
  },
];

module.exports = { scenarios, MODE };
