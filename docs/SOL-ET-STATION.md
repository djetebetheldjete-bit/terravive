# Sol, racines et station connectée — guide (Terravive v7)

## 1. Mise en service (une fois)

1. **Base Supabase** : dans le SQL Editor, exécutez le bloc `trv_parcel_soil` de `schema.sql`.
   Sans cette table, les parcelles fonctionnent toujours ; seul l'enregistrement de la fiche sol échoue
   (message explicite). En stockage local (`data/store.json`), rien à faire.
2. **Cartes de sol iSDAsoil (recommandé)** : créez un compte gratuit sur
   https://www.isda-africa.com/api/registration, puis renseignez `ISDA_USERNAME` et `ISDA_PASSWORD`
   (Render → Environment). Données sous licence CC BY 4.0 : citer « iSDAsoil » (c'est affiché dans la fiche).
   Sans compte, Terravive utilise **SoilGrids** (ISRIC, 250 m), dont l'API « bêta » est parfois en pause :
   la fiche le signale et propose la correction par test de terrain.
3. Vérifiez : `npm test` (31 tests, sans réseau).

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

Limites : 20 estimations de sol par utilisateur et par jour ; 4 appels par minute vers les services de cartes
(respect de l'usage raisonnable de SoilGrids).
