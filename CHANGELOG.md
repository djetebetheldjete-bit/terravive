# Journal des versions — Terravive

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
