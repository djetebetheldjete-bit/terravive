# Sol, racines et station connectée — guide (Terravive v7, complété jusqu'en v8.0)

## 1. Mise en service (une fois)

1. **Base Supabase** : dans le SQL Editor, exécutez le bloc `trv_parcel_soil` de `schema.sql`.
   Sans cette table, les parcelles fonctionnent toujours ; seul l'enregistrement de la fiche sol échoue
   (message explicite). En stockage local (`data/store.json`), rien à faire.
2. **Cartes de sol iSDAsoil (recommandé)** : créez un compte gratuit sur
   https://www.isda-africa.com/api/registration, puis renseignez `ISDA_USERNAME` et `ISDA_PASSWORD`
   (Render → Environment). Données sous licence CC BY 4.0 : citer « iSDAsoil » (c'est affiché dans la fiche).
   Sans compte, Terravive utilise **SoilGrids** (ISRIC, 250 m), dont l'API « bêta » est parfois en pause :
   la fiche le signale et propose la correction par test de terrain.
3. **v7.8 — carnet de champ** : exécutez aussi le bloc `trv_field_log` de `schema.sql`.
4. **v7.9 — fiche terrain** : exécutez `alter table trv_plans add column if not exists fiche text;`
   (sans cette colonne, la fiche fonctionne mais est regénérée après chaque redémarrage du serveur).
5. **v8.0 — bilan d'impact, station manuelle** : exécutez les lignes « v8.0 » de `schema.sql` (colonnes `season`, `product`, `source`, `note` et table `trv_parcel_ref`). Sans elles, le carnet et la saisie manuelle fonctionnent mais sans saison, produit ni origine (message d'avertissement), et la référence « avant » ne s'enregistre pas.
6. Vérifiez : `npm test` (54 tests, sans réseau) et `node test-stock.js`.

## 2. Ce que calcule la fiche « Sol & racines »

| Donnée | Source | Fiabilité |
|---|---|---|
| Texture (sable/limon/argile) | iSDAsoil (0–20 cm) ou SoilGrids (0–30 cm) | Estimation — à confirmer par le test du bocal |
| Profondeur du sol (roche, cuirasse) | iSDAsoil « bedrock depth » (0–200 cm ; 200 = « 200 ou plus ») | Estimation — à confirmer par un trou / une barre à mine |
| pH, carbone, N, P, K, cailloux | iSDAsoil (SoilGrids : pas de P/K) | Orientation — une analyse de labo reste nécessaire avant une fertilisation coûteuse |
| Profondeur racinaire | Tables FAO-56 (n° 56) × stade (jours depuis le semis), limitée par la profondeur du sol | Indicatif ; certaines cultures (gombo, igname, taro, gingembre, anacarde, mangue, papaye, niébé) sont signalées « hors FAO-56 » |
| Dose et fréquence d'arrosage | Réserve utile (FAO-56, tableau 19) × profondeur utile, p ajusté à ETc, ET0 Open-Meteo (3 jours) | Ordre de grandeur ; toujours vérifier la pluie récente et l'état du sol |
| Profondeur du capteur | ≈ 40 % de la profondeur utile (10–45 cm) ; 2ᵉ sonde à ≈ 80 % si racines ≥ 60 cm | Règle pratique |
| Seuil d'arrosage | (1 − p) × 100 % de l'humidité « utile » du capteur | Point de départ à ajuster en observant les plantes |

La **correction de terrain l'emporte toujours** sur l'estimation satellite.

## 3. La station ESP32

**Matériel** (environ, disponibilité locale à vérifier) : ESP32 DevKit, sonde d'humidité **capacitive** v1.2+,
DHT22 (facultatif), capteur à ultrasons **étanche** JSN-SR04T + résistances 1 kΩ et 2 kΩ (facultatif, pour la cuve),
boîtier étanche, alimentation 5 V (ou petit panneau solaire + batterie), Wi-Fi (box 4G ou partage de connexion).

1. Tableau de bord → « Ma station connectée » → **Programme ESP32** (ou, dans la fiche d'une parcelle,
   « Programme ESP32 réglé pour cette parcelle » : seuil et profondeur de sonde de cette parcelle).
2. Logiciel Arduino : installez le support « esp32 by Espressif Systems », choisissez « ESP32 Dev Module ».
3. Renseignez le Wi-Fi ; activez `AVEC_DHT` / `AVEC_CUVE` selon les capteurs branchés
   (DHT : installez la bibliothèque « DHT sensor library » d'Adafruit).
4. **Calibrage** : `MODE_CALIBRAGE 1`, lisez la valeur en terre sèche (`VAL_SEC`) puis 1 à 2 jours après un fort
   arrosage (`VAL_MOUILLE`), reportez, remettez `0`, téléversez.
5. Le Moniteur série (115200) doit afficher `-> HTTP 200`. Les mesures apparaissent dans « Dernières mesures »,
   avec l'alerte « arroser » (sous le seuil) et « cuve presque vide » (< 15 %).

Notes techniques :
- HTTPS : la connexion est **chiffrée** mais le certificat n'est pas vérifié (`setInsecure`), pour rester simple
  à installer. La clé de station ne donne accès qu'à l'envoi de mesures pour ce compte.
- Le serveur gratuit Render peut dormir : le programme réessaie 3 fois (20 s d'intervalle).
  Le moniteur UptimeRobot sur `/healthz` évite la mise en veille.
- Le serveur accepte au plus 300 mesures par heure et par station (un envoi toutes les 10 min suffit).
- Programme vérifié par compilation avec arduino-cli, cœur ESP32 3.0.7 (4 configurations : de base, HTTP local,
  avec DHT et cuve, mode calibrage).

## 4. API ajoutées

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/parcels/soil?id=` | Fiche sol de la parcelle (recalculée à la date du jour) |
| POST | `/api/parcels/soil` | `{id, crop?, sown_at?, refresh?}` : estime le sol (1ʳᵉ fois ou `refresh`) et calcule la fiche |
| POST | `/api/parcels/soil/manual` | `{id, texture, depth_cm, stones}` : correction de terrain (vide = effacer) |
| GET | `/api/station/sketch[?parcel=]` | Programme ESP32 pré-rempli |
| POST | `/api/plan` | nouveau champ facultatif `parcel_id` : itinéraire adapté au sol de la parcelle |
| GET | `/api/fieldlog?parcel=` | Carnet de champ de la parcelle + totaux (v7.8) |
| POST | `/api/fieldlog` | `{parcel_id, date, kind, qty?, note?}` : ajoute une entrée (v7.8) |
| DELETE | `/api/fieldlog?id=` | Supprime une entrée (seulement les siennes) (v7.8) |
| POST | `/api/plan/fiche` | `{id, parcel_id?, refresh?}` : fiche pratique terrain de l'itinéraire (v7.9) |
| GET | `/api/impact?parcel=` | Bilan d'impact de la parcelle (saisons, comparaisons, économies, carbone, données manquantes) (v8.0) |
| GET | `/api/impact/csv?parcel=` | Bilan en tableur CSV (v8.0) |
| POST | `/api/impact/ref` | `{parcel_id, label?, water_l?, compost_kg?, chem_kg?, yield_kg?}` : référence « avant » ; tout vide = effacer (v8.0) |
| GET | `/api/impact/summary` | Saison en cours, toutes parcelles : pré-remplissage de l'indice de durabilité (v8.0) |
| GET | `/api/coop/impact` | Bilan agrégé de la coopérative — animateur seulement (v8.0) |
| POST | `/api/station/manual` | `{soil? ou soil_touch?, temp?, hum?, level?, note?}` : mesure saisie à la main (v8.0) |

Limites : 20 estimations de sol par utilisateur et par jour ; 4 appels par minute vers les services de cartes
(respect de l'usage raisonnable de SoilGrids).


## 5. Nouveautés v7.8 — fertilisation, partage WhatsApp, carnet de champ

**Plan de fertilisation organique** (`lib/fertil.js`, affiché dans la fiche « Sol & racines ») :
- **Compost mûr** selon le groupe de culture (repères de vulgarisation) : maraîchage 15–30 t/ha,
  tubercules 10–20 t/ha, céréales et légumineuses 5–10 t/ha, pérennes 5–10 kg par pied et par an.
  La fourchette est ajustée au carbone organique estimé : sol pauvre (< 6 g/kg) → moitié haute ;
  moyen (6–12) → moitié basse ; bien pourvu (≥ 12) → dose d'entretien.
- **Quantités pour la parcelle** : surface calculée à partir du dessin (rectangle ou polygone),
  total en kg, nombre de brouettes (≈ 50 kg), matières brutes à composter (≈ 3 kg pour 1 kg de compost).
- **pH** : < 5,0 → chaux ou dolomie 1–2 t/ha ; 5,0–5,5 → 0,5–1 t/ha (à confirmer par analyse) ;
  alternative locale : cendre de bois 100–200 g/m². Pas de chaulage pour l'ananas. Sol alcalin : ni chaux ni cendre.
- **N, P, K faibles** : sources organiques locales (fientes, phosphate naturel, cendre, cabosses de cacao
  compostées, tiges de bananier). Légumineuses : pas d'engrais azoté.
- **Aucune dose d'engrais minéral n'est calculée** : elle reste dans l'itinéraire technique. Le repère de
  compost est transmis à l'IA pour que l'itinéraire reste cohérent.

**Envoyer sur WhatsApp** : message court (arrosage, seuil du capteur, compost, acidité, éléments faibles),
ouvert dans WhatsApp par un lien `wa.me` ; l'utilisateur choisit le contact et envoie lui-même.
Aucune API, aucun compte, aucun envoi automatique. Le numéro saisi reste dans le navigateur.

**Carnet de champ** (tableau de bord) : arrosage (L), compost (kg), engrais chimique (kg), traitement (L),
semis, récolte (kg), observation. Totaux par parcelle, ramenés à la surface (L/m², kg/m², t/ha),
export tableur CSV (séparateur « ; », compatible Excel en français). Sert de preuve d'impact pour un
pilote terrain et de base de traçabilité.

## 6. Nouveauté v7.9 — fiche pratique terrain

Dès qu'un itinéraire technique s'affiche, Terravive prépare sa **fiche pratique terrain** (`lib/fiche.js`) :
l'essentiel en 5 points, le calendrier des travaux à cocher, les quantités, l'arrosage, ce qu'il faut
surveiller (signe → action), la sécurité, la récolte, le matériel à préparer et ce qu'il faut noter dans
le carnet de champ.

- **Source unique : l'itinéraire.** L'IA reformule l'ITK dans un format JSON fixe, avec l'interdiction
  d'inventer des doses, des produits ou des dates. Le serveur vérifie et nettoie la réponse (listes
  plafonnées, textes tronqués, émojis retirés) et refait un essai si elle est illisible.
- **Chiffres de la parcelle** : si une parcelle est choisie dans le formulaire, un encadré ajoute les valeurs
  calculées par l'application (surface, arrosage, capteur, compost, chaux), sans passer par l'IA.
- **Coût maîtrisé** : la fiche est générée une seule fois par itinéraire, puis gardée (colonne
  `trv_plans.fiche`, sinon mémoire du serveur). Limite : 30 fiches par compte et par jour.
- **Sur le terrain** : cases cochées gardées sur le téléphone, impression A4 en noir et blanc avec cases
  et zone « Mes notes », envoi WhatsApp (version texte courte), copie.
- **Accès** : la fiche d'un itinéraire n'est donnée qu'à son auteur, ou pour l'itinéraire partagé du secteur.

## 7. Nouveautés v8.0 — bilan d'impact, preuve, test terrain, alertes

- **Carnet par saison** : chaque entrée a une saison (par défaut d'après la date : grande saison mars–juillet,
  petite saison août–novembre, saison sèche décembre–février ; libre, ex. « Campagne tomate 2026 »), un produit
  pour les intrants, et un nouveau type « Incident ».
- **Bilan d'impact** (`lib/impact.js`) : totaux par saison ramenés à la surface ; comparaison avec la référence
  « avant » saisie (Déclaré) ou, à défaut, la saison précédente (Mesuré) ; eau économisée et engrais évité
  (écart × surface, Estimé (calcul)) ; kg récoltés par m³ d'eau d'arrosage (pluie non comptée).
- **Coopérative** : l'animateur voit la saison en cours de chaque parcelle suivie de ses membres, avec totaux,
  CSV et version imprimable pour un bailleur. Les membres voient seulement leurs propres données.
- **Station manuelle** : valeur d'un appareil (Déclaré) ou test au toucher (sec ≈ 15 %, frais ≈ 40 %,
  humide ≈ 65 %, détrempé ≈ 90 % : Hypothèse). Le tableau de bord garde la dernière valeur connue de chaque grandeur.
- **Alertes** « arroser » et « cuve presque vide » : bouton WhatsApp et lecture à voix haute (voix du téléphone).
