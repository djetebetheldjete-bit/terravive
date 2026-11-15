# Journal des versions — Terravive

## v8.8 — 15 novembre 2026 : valoriser ses résidus, test de germination du compost
- **Guide « Valoriser mes résidus »** (tableau de bord, au-dessus du carnet) : le producteur choisit ce qu'il a (tiges, paille de riz, feuilles, cabosses de cacao, branches, fumier, résidus de transformation) et lit quoi en faire (compost, paillis, biochar, alimentation animale, biogaz), comment, et avec quelles précautions. Un bouton prépare la saisie dans le carnet. Contenu reformulé à partir du cours « Typologie et caractérisation des déchets agricoles » du Prof. Karamoko Ouattara (Master 1, UFR-ARHAI, Université de San-Pédro), source affichée. Le cours ne donne aucune dose : le guide non plus, et un test automatique vérifie qu'il ne contient aucun chiffre.
- **Carnet de champ : « Résidus valorisés »** : résidu, ce qu'on en a fait, quantité en kg ou en brouettes, sacs, seaux, bottes. Aucun poids par défaut pour ces mesures : le producteur pèse une fois, et le poids est gardé pour chaque résidu. Le conseil du guide s'affiche pendant la saisie.
- **Bilan d'impact** : kilos de résidus valorisés de la saison, par voie, étiquetés « Mesuré ». Quand la fiche sol existe, le bilan compare ce qui a déjà été mis au compost aux matières à réunir (« Estimé (calcul) »). Repris dans la fiche de preuve, le message WhatsApp, le tableur, le résumé du compte et le bilan de la coopérative (total et colonne par parcelle).
- **Test de germination du compost** : nouvelle saisie du carnet (graines semées et levées sur le compost et sur un témoin). Le serveur calcule la levée en % de celle du témoin ; sans témoin valable, aucune conclusion n'est tirée. Lecture par un repère publié, étiqueté « Repère général » et sourcé (UF/IFAS Extension et UC ANR Cooperative Extension) : 80 % et plus, satisfaisant ; moins de 50 %, poursuivre le compostage. Mode d'emploi du test dans le guide.
- Fiche sol : lien vers le guide sous « Matières à composter ». Fiche de collecte papier : code V pour les résidus valorisés. Saisie de l'animateur pour un membre : « Résidus valorisés » disponible.
- Contenus partagés entre le navigateur et le serveur dans `public/residus.js` (chargé côté serveur par `lib/residus.js`). Aucun changement de base (la colonne `kind` accepte déjà les nouveaux types). 6 tests unitaires et 6 tests de bout en bout ajoutés. Service worker v28.

## v8.7 — 14 novembre 2026 : statut de relecture des plans de culture
- **Chaque plan affiche son statut** : « Proposé par l'IA, non relu par un agronome » (par défaut, avec le rappel de faire confirmer variétés, dates et doses) ou « Relu par [nom et qualité] le [date] ». Le statut figure aussi sur la fiche terrain imprimée et dans le message WhatsApp.
- **Enregistrer une relecture** : réservé aux administrateurs et aux auditeurs Quality Guard, depuis la page du plan (nom et qualité de l'agronome obligatoires, remarque facultative ; la relecture peut être retirée). Routes `GET` et `POST /api/plan/review`. Rangement dans `trv_quality_audits` (ligne `kind = "review"`), sans changement de base.
- Service worker v27.

## v8.6 — 14 novembre 2026 : robustesse, accessibilité, tests automatiques
- **Serveur plus robuste** : une adresse ou un cookie mal formé ne peut plus arrêter le serveur (réponse 400, le service continue). Toute erreur imprévue d'une requête renvoie une réponse au lieu de couper le service.
- **Anti-force brute** : 10 essais de connexion par compte et 30 par connexion sur 10 minutes, 10 créations de compte par heure et par connexion (réponse 429 au-delà).
- **En-têtes de sécurité** : `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, et `Strict-Transport-Security` en production.
- **Interface** : en-tête des pages Plan de culture et Automatisation remis au propre (le sélecteur de thème ne s'étire plus, les boutons tiennent sur une ligne) ; pastilles de thème rondes sur téléphone.
- **Accessibilité** : chaque champ de formulaire a un nom lisible par les lecteurs d'écran (plan, stock, automatisation, tableau de bord, conseiller, diagnostic) ; un seul titre principal par page.
- **Tests automatiques** : `npm test` lance toutes les suites, dont 65 nouveaux tests de bout en bout (`test/test-http.js` : pages, sécurité, comptes, rôles cultivateur / client / administrateur, limites anti-abus) sur un serveur local à données jetables — jamais la base de production. Lancement automatique à chaque envoi sur GitHub (`.github/workflows/tests.yml`).
- Dossier de données local configurable (`DATA_DIR`), ajout d'un `.gitignore`. Service worker v26.
## v8.5.1 — 14 novembre 2026
- **Plan de culture et fiche terrain plus rapides** : mesure en ligne, le modèle réfléchissait 79 s avant d'écrire la première ligne. Le plan (effort « medium ») et la fiche (effort « low ») sont maintenant rédigés sans réflexion préalable (`thinking: between_tools`). Si l'API refuse ces réglages, la requête repart sans eux. Variables facultatives : `PLAN_EFFORT`, `PLAN_THINKING=adaptive`.

## v8.5 — 14 novembre 2026
- **Le plan de culture s'écrit sous les yeux du producteur** : le texte s'affiche à mesure que l'IA le rédige (premières lignes en quelques secondes), au lieu d'un écran d'attente de plusieurs minutes. Le plan complet est enregistré à la fin, même si le téléphone perd la connexion entre-temps. `POST /api/plan` accepte `stream: true` (réponse en lignes JSON : `start`, `delta`, `done` ou `error`). Service worker v25.

## v8.4.1 — 14 novembre 2026
- **Fiche terrain plus robuste** (trouvé par un test réel en ligne) : la réponse de l'IA pouvait être coupée avant la fin et la fiche échouait (« La fiche n'a pas pu être lue »). La longueur autorisée est doublée, une réponse coupée est refermée en gardant tout ce qui est complet, et chaque échec est écrit dans les journaux.

## v8.4 — 14 novembre 2026
- **Carnet d'un membre tenu par l'animateur** (membre sans téléphone) : dans la page Coopérative, la fiche d'un membre a un volet « Carnet de champ du membre ». L'animateur choisit la parcelle, le type, la quantité, la date ; la saisie va dans le carnet du membre avec la mention « Saisi par l'animateur ». Routes `GET` et `POST /api/coop/member/fieldlog`, réservées à l'animateur de la coopérative du membre.
- **Modèle d'IA** : `claude-sonnet-5-5` par défaut (au lieu de `claude-sonnet-5`), avec retour automatique sur l'ancien modèle si l'API refuse le nouveau. La variable `ANTHROPIC_MODEL` garde la priorité.
- **Base** : `search_path` fixé sur la fonction `trv_stock_validate_sale` (avertissement de sécurité Supabase).
- Service worker v24.

## v8.3.1 — 14 novembre 2026 : fiabilité sur réseau faible
- **Aucun doublon dans le carnet** : chaque saisie porte un identifiant créé par le téléphone ; si elle est renvoyée (réseau coupé au mauvais moment, file d'attente), le serveur ne la garde qu'une fois.
- **Plus d'attente sans fin** : si l'enregistrement ne répond pas en 15 s, la saisie passe « en attente » et repart toute seule.
- **Ouverture plus rapide sur réseau lent** : si le réseau ne répond pas (6 s pour une page, 10 s pour les données) et qu'une version est déjà sur le téléphone, elle s'affiche tout de suite ; la version à jour est récupérée en arrière-plan.
- Service worker v23.

## v8.3 — 11 novembre 2026 : une application plus facile à utiliser
- **Écran « Aujourd'hui »** en haut du tableau de bord : la culture et le jour depuis le semis, les tâches de cette semaine et de la suivante (tirées du calendrier de la fiche terrain), les alertes de la station, un gros bouton « Noter ce que j'ai fait » et un bouton « Écouter ». Nouvelle route `GET /api/today?parcel=` et module `lib/today.js`.
- **Mesures du terrain dans le carnet** : arrosoirs, seaux, bidons, fûts, pulvérisateurs, brouettes, sacs, cageots, paniers. La quantité est convertie en litres ou en kilos ; la taille de chaque contenant se règle une fois (gardée sur le téléphone) ; la note garde la trace (« 12 arrosoirs de 10 L »).
- **Carnet hors ligne** : sans réseau (ou serveur en réveil), la saisie est gardée sur le téléphone, affichée « en attente », puis envoyée automatiquement au retour du réseau.
- **Mode simple / mode complet** : le producteur voit l'essentiel (Aujourd'hui, carte, carnet, alertes) ; l'animateur garde tout (CSV, durabilité, programme ESP32, saison). Bouton en haut du tableau de bord.
- **Écouter la fiche terrain** ; **« Plan de culture »** à la place d'« itinéraire technique » dans les boutons et titres ; ouverture d'un plan par lien (`/app?plan=`) ; boutons et champs plus grands sur téléphone.
- Service worker v22.

## v8.2.3 — 11 novembre 2026
- **Du sol à l'itinéraire** : en choisissant une parcelle enregistrée dans le formulaire de l'itinéraire technique, la **surface** se remplit aussi automatiquement (m² ou ha, d'après le dessin sur la carte), en plus de la texture et du pH. Le bouton « Itinéraire adapté à ce sol » de la fiche Sol & racines est toujours affiché, même sans culture choisie. Service worker v21.

## v8.2.2 — 11 novembre 2026
- **Bilan d'impact plus clair** : sans parcelle témoin ni référence, le bilan n'affiche plus « Données manquantes ». Une note « Facultatif » explique comment mesurer les économies (témoin, référence de mémoire ou saison suivante). Les volets « Test côte à côte » et « Référence avant » sont repliés et marqués facultatifs. « Données manquantes » devient « À compléter », réservé aux vrais manques (surface, récolte, arrosage).
- Service worker v20.

## v8.2.1 — 6 novembre 2026
- **Carte satellite** : au zoom maximal, Esri n'a pas toujours d'image (zoom 19 absent dans une grande partie de la Côte d'Ivoire, qui affichait « Map data not yet available »). Les images du zoom 18 sont désormais agrandies au-delà, au lieu d'afficher un fond gris ; même chose pour la couche NDVI.
- Service worker v19.

## v8.2 — 6 novembre 2026
- **Test côte à côte** : une parcelle conduite avec Terravive peut être associée à sa parcelle témoin. Le bilan d'impact affiche les deux face à face (eau d'arrosage, eau totale reçue, engrais chimique, compost, récolte vendable, rendement, litres d'eau par kg vendable, incidents), avec l'écart en %, le sens « plus bas / plus haut » et un verdict par ligne. Alertes si les saisons, la pluie ou les surfaces ne concordent pas. Inclus dans l'impression, le CSV, WhatsApp et la fiche de preuve.
- **Carnet** : nouveaux types « Pluie » (mm au pluviomètre ; 1 mm = 1 L/m²) et « Récolte invendable » (kg) ; le bilan calcule l'eau totale reçue et la récolte vendable.
- Migration : table `trv_parcel_pair` (sans elle, tout fonctionne sauf l'enregistrement du témoin, avec un message clair).
- Service worker v18.

## v8.1 — 6 novembre 2026
- Interface sans émojis : jeu d'icônes au trait (`public/icons.js`, même style que le menu), qui suit les thèmes clair et sombre.
- Carnet de champ : sélecteur d'intervention à boutons (icône, nom, unité attendue), utilisable au clavier (flèches) et lu correctement par les lecteurs d'écran.
- Messages WhatsApp (conseil sol, alertes, bilan, fiche terrain) sans émojis.
- Bouton WhatsApp sobre (vert Terravive), dates du bilan au format français.
- Service worker v17 (met en cache `icons.js` et `voice.js`).

## v8.0 — 6 novembre 2026
**Ajouts**
- A1 — Carnet par saison (saison/campagne, produit, incident) et **bilan d'impact** par parcelle : comparaison avant/maintenant (référence saisie ou saison précédente), eau économisée, engrais évité, rendement, productivité de l'eau, carbone apporté par le compost ; export PDF et CSV ; **bilan agrégé de la coopérative** (animateur) ; indice de durabilité pré-rempli d'après le carnet.
- A2 — **Provenance de chaque chiffre** (Mesuré, Déclaré, Estimé satellite, Estimé (calcul), Hypothèse) et **fiche de preuve** imprimable à faire valider par un agronome.
- A4 — **Saisie manuelle de la station** (appareil ou test au toucher) et **fiche de collecte terrain** imprimable.
- A3 — Alertes « arroser » / « cuve presque vide » **partageables sur WhatsApp** et **lisibles à voix haute**.
- B1/B2 — Matériel partagé et achats groupés : déjà présents, vérifiés par test ; feuille de route mise à jour.

**Fichiers** : `lib/impact.js` (nouveau), `server.js`, `public/tableau.html`, `public/cooperative.html`, `schema.sql`, `public/sw.js` (v16), `test-sol.js`, docs.

**Migrations (idempotentes)** : `trv_field_log.season`, `trv_field_log.product`, `trv_readings.source`, `trv_readings.note`, table `trv_parcel_ref`.

**Compatibilité** : sans migration, le carnet et la saisie manuelle s'enregistrent quand même (sans saison, produit ni origine) avec un avertissement ; le reste de l'application est inchangé.

## v7.9 — 6 novembre 2026
- Fiche pratique terrain générée avec l'itinéraire (calendrier à cocher, quantités, surveillance, sécurité, matériel), impression A4, WhatsApp. Colonne `trv_plans.fiche`.

## v7.8 — 6 novembre 2026
- Plan de fertilisation organique (compost, chaux, N-P-K) calculé pour la parcelle ; envoi du conseil sur WhatsApp ; carnet de champ (table `trv_field_log`).

## v7.7 et avant
- Voir `FEUILLE-DE-ROUTE.md` (section « Déjà en place »).
