# Journal des versions — Terravive

## v8.15 — 21 novembre 2026 : espace planteur vivant
- **Paysage en fond** : collines, pousses qui se balancent au vent, nuages qui passent ; le soleil suit l'heure réelle (bas le matin, haut à midi, orangé le soir, lune la nuit). Très pâle, derrière le contenu.
- **Bandeau d'accueil** (même vert et même colline que la connexion) : « Bonjour », la date, et la météo réelle de la première parcelle (Open-Meteo, à sa position), avec une icône animée (rayons qui tournent, gouttes qui tombent). Sur ordinateur : prévisions des 3 prochains jours. Sans parcelle, pas de météo plutôt qu'une météo inventée.
- **Résumé chiffré** : parcelles, choses à faire cette semaine, travaux notés en 7 jours — les nombres défilent à l'arrivée.
- **Premier pas** (compte sans parcelle) : une graine tombe, la pousse sort et se balance ; 3 étapes et le bouton « Dessiner ma première parcelle ».
- **Aujourd'hui** : bandeau de la parcelle avec « Jour N depuis le semis » et une barre « Fait aujourd'hui » qui se remplit à chaque « C'est fait ». **Votre travail** : chronologie dont la ligne se trace. **Profil** : les lignes arrivent une à une.
- **Ordinateur** : bandeau pleine largeur et deux colonnes (parcelles et résumé ; animateur et prévisions) au lieu d'une colonne étroite au milieu.
- Tout en SVG et CSS (transform, opacity) ; rien ne bouge avec « réduire les animations ». Service worker v33.

## v8.14 — 21 novembre 2026 : parcours planteur animé (connexion → espace planteur)
- **Nouvelle page `/connexion`** pour les planteurs : téléphone + code PIN, connexion et création d'espace sur la même page (onglets). Le bouton « Se connecter » de l'accueil y mène ; un lien garde la connexion par e-mail pour les animateurs, clients et administrateurs.
- **Ouverture** (une fois par session) : sur fond vert, la pousse du logo se dessine trait par trait, le nom apparaît, puis le bandeau vert remonte et sa courbe — une colline — découvre le formulaire, dont les champs arrivent un à un.
- **Validation** : le bouton se rétracte en pilule de chargement pendant la vérification. Erreur : le formulaire tremble brièvement et le message s'affiche. Succès : la pilule s'ouvre en cercle vert qui couvre l'écran, et l'espace planteur s'ouvre sur le même vert, qui remonte à son tour.
- **Espace planteur** : les parcelles puis les tâches arrivent une à une, court fondu entre les écrans, la coche se dessine quand on touche « C'est fait ». Un planteur déconnecté est renvoyé vers `/connexion`.
- Mouvements de 0,2 à 0,7 s, uniquement transform / opacity (fluides sur téléphone modeste) ; rien ne bouge avec « réduire les animations ». 1 test de bout en bout ajouté. Service worker v32.

## v8.13 — 21 novembre 2026 : animations plus courtes, plus nettes, plus sobres
Revue des animations selon le guide « Animations on the Web » (Emil Kowalski) :
- **Une seule apparition par bloc.** Trois moteurs (anim.js, anims.js, mobile.js) faisaient apparaître les mêmes cartes en même temps ; seul anim.js le fait maintenant. anims.js garde les compteurs et le tracé des graphiques.
- **Durées raccourcies** : apparition 620-700 ms → 360 ms (déplacement 18-22 px → 8 px), fenêtres 420 ms → 220 ms, compteurs 1,1-1,5 s → 0,7 s, menu du téléphone 340 ms → 280 ms, onde des boutons 600 ms → 450 ms. Courbes « ease-out » pour ce qui entre, « ease-in-out » pour ce qui bouge déjà.
- **Survol** : seules les cartes cliquables se soulèvent (2 px). Les cartes de formulaire et d'information ne bougent plus, les boutons ne « sautent » plus au survol (simple changement de teinte, pression conservée). Aucun effet de survol sur écran tactile.
- **Compteurs** : lors du rafraîchissement automatique (toutes les 60 s), le chiffre passe de l'ancienne valeur à la nouvelle au lieu de repartir de zéro.
- **« Réduire les animations »** (réglage du téléphone ou de l'ordinateur) coupe désormais tout mouvement sur toutes les pages, y compris les boucles.
- Page Distribution : retour visuel à la pression et court fondu quand le panneau de détail change. Service worker v31.

## v8.12 — 21 novembre 2026 : Distribution, de la parcelle au client (projet ASTRIDE)
- **Nouvelle page `/distribution`** (lien « Distribution » dans le menu du tableau de bord, pour les mêmes acteurs que le Stock : administrateur, animateurs, cultivateurs certifiés, lecteurs désignés). Elle suit chaque récolte de la parcelle jusqu'au client, à l'échelle de la coopérative.
- **La carte** (sur le modèle de la carte ASTRIDE) : parcelles des membres à leur vraie position, colorées par état satellite ou par NDVI ; centres de groupage ; points de vente ; collecte (parcelle → centre) et livraisons (centre → client, épaisseur selon les kg, pointillés pour « en route »). Couches activables, filtres par état et par centre, détail au toucher, flux reliés mis en avant. Thèmes nature, clair, sombre et terre ; adaptée au téléphone.
- **Les lots** : annonce de récolte (parcelle, produit, kg, date, centre) → réception au centre (poids pesé, qualité A/B/C, heure de récolte) → départ en tournée (point de vente, véhicule) → livraison (kg acceptés). Code de lot L-0001… La perte (reçu − accepté) et le délai récolte → livraison sont calculés par le serveur ; les étapes ne peuvent pas être sautées ni datées dans le futur.
- **Indicateurs du pilote** : récolte annoncée, parcelles à surveiller, taux de pertes (cible < 15 %), livrés en moins de 48 h (cible 80 %), écart entre prévision et récolte (cible < 15 %), stock et remplissage de chaque centre. Vides tant qu'il n'y a rien à mesurer : **aucune donnée d'exemple**.
- **Analyse satellite gardée par parcelle** : quand le planteur lance une analyse NDVI sur une parcelle enregistrée, la dernière mesure est conservée (`POST /api/parcels/ndvi`) et sert à l'état « OK / Surveillance / Alerte » sur la carte.
- **Base Supabase : à exécuter une fois** le bloc « v8.12 » à la fin de `schema.sql` (tables `trv_parcel_ndvi`, `trv_dist_sites`, `trv_dist_lots`).
- Logique dans `lib/distribution.js` (8 tests unitaires) ; 6 tests de bout en bout (accès, parcelles réelles, sites, parcours complet d'un lot, suppressions interdites, cloisonnement entre coopératives). Service worker v30.

## v8.11 — 21 novembre 2026 : rattachement à l'animateur une seule fois
- **Le planteur est rattaché à un animateur une seule fois** : dès l'inscription (téléphone ou e-mail). S'il n'existe encore aucun animateur, il est rattaché dès qu'un animateur rejoint Terravive (comme l'annonce la vue planteur). Ensuite, plus jamais d'office : avant, un planteur qui quittait sa coopérative y était remis à sa prochaine visite, il ne pouvait donc pas vraiment la quitter. Il peut toujours en rejoindre une avec un code.
- Un compte administrateur n'est plus rattaché comme simple membre, même connecté sans le code administrateur.
- **Base Supabase : à exécuter une fois** dans le SQL Editor :
  `alter table trv_users add column if not exists coop_auto_done boolean default false;`
  (déjà inclus dans `schema.sql`). Sans cette colonne, l'application fonctionne mais garde l'ancien comportement et l'écrit dans les journaux.
- 1 test de bout en bout ajouté (83 réussis).

## v8.10 — 21 novembre 2026 : connexion planteur sécurisée, dépôt remis au propre
Rattrapage des nouveautés livrées depuis la v8.9, puis corrections :
- **Déjà en ligne, désormais documenté** : connexion des planteurs par **numéro de téléphone + code PIN** (4 à 8 chiffres, sans e-mail) ; **rattachement automatique** d'un planteur au premier animateur inscrit de sa région (carte « Votre animateur technique » dans `/planteur`) ; **visite guidée** et mini-démos (`help.js`), animations partagées (`anim.js`) ; page **Tutoriels vidéo** (`/formation`) ; bouton « Écouter » par tâche dans la vue planteur.
- **Sécurité — numéro d'un planteur « réservable »** : on pouvait s'inscrire par e-mail avec l'adresse interne `<numéro>@planteur.terravive` et empêcher le vrai planteur de créer son compte. Ce domaine est maintenant refusé à l'inscription et à la connexion par e-mail (qui permettait aussi de contourner les compteurs du numéro).
- **Sécurité — code PIN** : un PIN de 4 chiffres n'a que 10 000 possibilités ; en plus de la limite de 10 essais par 10 minutes, un numéro est bloqué pour la journée après 20 codes erronés en 24 h. Un numéro vide ou invalide est refusé (400) à la connexion.
- **Mémoire du serveur** : les compteurs anti-abus (par adresse IP, e-mail, numéro) étaient gardés indéfiniment ; ils sont nettoyés toutes les 10 minutes.
- **Coopérative** : le rattachement automatique ne lit plus toute la table des comptes, seulement les animateurs ; l'adresse interne d'un animateur planteur n'est plus montrée comme e-mail de contact.
- **Dépôt** : suppression du dossier `fichiers-modifies/` (copies **plus anciennes** que le code en place — les recopier aurait effacé la connexion par téléphone), du doublon `.env - Copie.example` et de l'ancien `accueil.html` à la racine (seul `public/accueil.html` est servi). Captures d'écran rangées dans `docs/captures/`.
- 4 tests de bout en bout ajoutés (inscription et connexion du planteur, domaine réservé, blocage du PIN) : 82 tests réussis.

## v8.9 — 17 novembre 2026 : vue planteur (interface simplifiée du cultivateur)
- **Nouvelle page `/planteur`** : une interface dédiée au planteur / cultivateur, séparée de l'espace technique complet. Pensée pour le téléphone et la lecture rapide sur le terrain : grandes cartes, ton « vous », un seul geste par tâche.
- **Vos parcelles** : la liste des parcelles du cultivateur (plusieurs parcelles gérées), chacune avec sa culture et un repère clair — « 2 choses à faire », « À jour », ou « Culture à renseigner ».
- **Aujourd'hui, par parcelle** : les tâches de la semaine sont les **vraies** tâches calculées par le moteur existant (`lib/today.js`) à partir du calendrier de la fiche de culture et de la date de semis — rien n'est inventé. Les tâches de la semaine prochaine sont rappelées en dessous.
- **« C'est fait »** enregistre une observation réelle dans le carnet de champ (`POST /api/fieldlog`, type `observation`). **« Écouter »** lit les tâches à voix haute (voix existante `voice.js`). **« Signaler un problème »** ouvre le diagnostic photo. **« Voir votre fiche »** ouvre le plan de culture.
- **Votre travail** : relit les dernières entrées du carnet de la parcelle (`GET /api/fieldlog`). **Profil** : accès à la coopérative, à l'espace complet, et déconnexion.
- 100 % conforme au système Terravive : mêmes couleurs et thèmes (nature, clair, sombre, terre), même logo, mêmes icônes (trait 1,8, arrondi), même ton. Aucune donnée fictive, aucune fausse messagerie. Réutilise l'authentification existante ; page fermée aux comptes « client » (redirigés vers la boutique), comme les autres espaces techniques.
- Lien « Vue planteur » ajouté dans les raccourcis du tableau de bord. 2 tests de bout en bout ajoutés (page servie au cultivateur, branchée sur les vraies API ; fermée au client). Service worker v29.

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
