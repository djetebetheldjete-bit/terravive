# Terravive — Feuille de route & vision

> Ce document garde la mémoire du projet : ce qui est **fait**, ce qu'on **construit maintenant** (faisable par logiciel seul), et ce qu'on **ajoutera plus tard** quand on aura les équipements, les données ou les partenariats nécessaires. Rien ne se perd : chaque idée mise de côté est notée ici avec *ce qui manque pour l'activer*.

_Dernière mise à jour : 6 novembre 2026 (v8.0)._

---

## 1. Déjà en place (fait et validé)

- **Compte cultivateur** (inscription / connexion, données privées).
- **Itinéraire technique de culture (ITK)** généré par l'IA, personnalisé (culture, sol, saison, mode, structure) et réutilisé par secteur pour économiser le coût d'IA.
- **Analyse satellite (Vertea)** : NDVI (santé de la végétation), ET0 (besoin en eau), pluie — robuste même sur petites parcelles et zones côtières, avec masque nuages.
- **Indice de durabilité multicritère** (environnement, économie, social) + **mini-bilan carbone** + mini-cours « Comprendre ».
- **Conseiller agricole par chat** (questions fréquentes + suggestions dynamiques selon culture/saison/NDVI) + **journal des questions** côté formateur.
- **Parcelles enregistrées** (on sauvegarde la limite de la zone et les informations).
- **Espace Coopérative** + **Kit de l'animateur** (l'animateur gère les itinéraires de ses membres, même sans téléphone, et imprime une « fiche à remettre »).
- **Mode hors-ligne installable (PWA)** : l'app s'installe sur le téléphone et fonctionne en faible connexion.
- **Voix** : lecture à voix haute et dictée (fiable en français).
- **Diagnostic des maladies par photo** : le cultivateur photographie une plante, l'IA propose une cause probable et des solutions durables.
- **Sol & racines (v7)** : nature du sol estimée par satellite (iSDAsoil 30 m, repli SoilGrids), profondeur du sol, fertilité estimée (pH, carbone, N, P, K), profondeur racinaire utile selon la culture et son stade, dose et fréquence d'arrosage (FAO-56 + ET0 Open-Meteo), profondeur du capteur et seuil d'arrosage. Correction par test de terrain (bocal, fosse). Données transmises à l'IA pour un itinéraire adapté au sol.
- **Test côte à côte (v8.2)** : parcelle Terravive associée à sa parcelle témoin, comparaison face à face avec verdicts ; pluie et récolte invendable dans le carnet.
- **Carnet par saison et bilan d'impact (v8.0)** : saisons / campagnes, type d'intrant, incidents ; comparaison « avant / maintenant » avec une référence saisie (déclarée) ou la saison précédente (mesurée) ; eau économisée, engrais évité, rendement, kg récoltés par m³ d'eau ; carbone apporté par le compost (calcul à hypothèses écrites) ; export PDF et CSV par parcelle ; bilan agrégé de la coopérative pour un bailleur (animateur). L'indice de durabilité est pré-rempli d'après le carnet.
- **Provenance des chiffres et fiche de preuve (v8.0)** : chaque chiffre du bilan porte son niveau (Mesuré, Déclaré, Estimé satellite, Estimé (calcul), Hypothèse) ; fiche imprimable listant chiffres, sources, hypothèses et données manquantes, avec cases de validation pour un agronome.
- **Outillage du premier test terrain (v8.0)** : saisie manuelle de la station (valeur d'un appareil ou test au toucher, signalé approximatif) qui déclenche les mêmes alertes ; fiche de collecte terrain imprimable (interventions, récoltes, retour du cultivateur) à reporter dans le carnet.
- **Alertes partageables (v8.0)** : « arroser » et « cuve presque vide » envoyées sur WhatsApp en un clic, ou lues à voix haute par l'animateur pour les cultivateurs sans smartphone.
- **Coopérative : matériel partagé et achats groupés** : registre du matériel avec demandes de réservation (acceptée / refusée / terminée) ; achats groupés avec collecte des besoins et total par article. Vérifiés par test en v8.0.
- **Fiche pratique terrain (v7.9)** : version courte et imprimable de chaque itinéraire (calendrier à cocher, quantités, signes à surveiller, matériel, sécurité), chiffres de la parcelle ajoutés, envoi WhatsApp.
- **Fertilisation, partage et carnet (v7.8)** : plan de compost et de correction du sol calculé pour la parcelle (dose, total, brouettes, pH, N-P-K), envoi du conseil au producteur par WhatsApp (sans API), carnet de champ avec totaux et export CSV pour mesurer l'impact.
- **Station ESP32 prête à brancher (v7)** : programme généré par le serveur (clé, adresse, seuil de la parcelle), humidité du sol + air (DHT22) + niveau de cuve (JSN-SR04T), HTTPS, reprise Wi-Fi, nouvelles tentatives si le serveur dort ; vérifié par compilation (ESP32, cœur Arduino 3.0.7). Alertes « arroser » et « cuve presque vide » dans le tableau de bord.

---

## 2. Réalisable maintenant (logiciel seul) — en cours

Ces éléments ne demandent **aucun équipement** : juste du développement. On les fait dans l'ordre.

### 2.1 Modèle économique — prochaine construction
- Abonnement coopérative, marge sur achats groupés, rapport d'impact pour bailleurs (s'appuie sur le bilan v8.0).
- Juste la structure de données et un écran de synthèse ; **pas de paiement en ligne** tant que le mobile money n'est pas intégré (§3).

### 2.2 Débouchés / « vendre ensemble » — REPORTÉ (voir §3)
- Décision : reporté, car même la version « fourchettes de prix saisies à la main » n'a de valeur que reliée à de vraies informations de marché (acheteurs, prix). On le reprendra quand on aura une source de données ou des contacts d'acheteurs.

### 2.3 Consolidation — FAIT ✅
- **Point de contrôle de santé** `/healthz` ajouté : à brancher sur un moniteur gratuit (UptimeRobot) pour prévenir les pannes et éviter la mise en veille du serveur Render gratuit.
- Coût d'IA déjà maîtrisé par des limites par personne et par jour.
- **Guide de test terrain** produit (PDF imprimable, avec fiche de retour par cultivateur) : `Terravive-Guide-Test-Terrain.pdf`.

---

## 3. À activer plus tard (nécessite équipement, données ou partenariats)

> **Important : on garde ces fonctions en objectif.** Le code et l'interface sont pensés pour les accueillir ; dès qu'on a le moyen correspondant, on les active et on actualise Terravive.

| Fonction visée | Ce qu'elle apporterait | Ce qui manque pour l'activer |
|---|---|---|
| **Capteurs réels au champ (ESP32 / Arduino)** : humidité du sol, température, niveau de cuve en direct | Arrosage au bon moment, alertes précises, données propres à la parcelle | **Point d'extension prêt (v8.0)** : chaque mesure porte son origine (`source` : capteur, manuel, toucher) ; un pluviomètre ou une sonde pourra ajouter sa propre origine sans changer les écrans. **Matériel seulement** : ESP32 + sonde capacitive (+ DHT22, JSN-SR04T) + boîtier étanche + alimentation + petit forfait data. Le logiciel est prêt (v7) : premier test terrain à faire. Ensuite : pluviomètre à auget, alertes par SMS. |
| **Sentinel-1 (radar) — humidité de surface sous les nuages** | Suivi de l'humidité même en saison des pluies, quand l'optique (Sentinel-2) est aveugle | **Développement côté Vertea** (Google Earth Engine) + calibration avec les mesures des stations ESP32. |
| **Sentinel-3 — température de surface régionale** | Alertes chaleur et tendances de végétation à l'échelle d'un secteur / d'une coopérative (300 m – 1 km : trop grossier pour une parcelle) | **Développement côté Vertea** ; priorité basse. |
| **Drones** : cartographie fine, repérage des zones faibles, pulvérisation ciblée | Diagnostic à grande échelle, économie d'intrants | **Équipement** (drone + caméra) et autorisation de vol. L'analyse satellite couvre déjà une partie du besoin en attendant. |
| **Prix de marché en direct** | Savoir où et à combien vendre, automatiquement | **Source de données fiable** : partenariat avec un marché/observatoire des prix, ou une API. Sans ça, on reste sur des fourchettes saisies à la main (§2.2). |
| **SMS / USSD** pour les cultivateurs **sans smartphone** | Toucher ceux qui n'ont qu'un téléphone simple, directement | **Passerelle SMS** (opérateur local ou service type Twilio) = abonnement payant. En attendant, le **relais humain** (l'animateur) joue ce rôle. |
| **Voix en langues locales** (dioula, baoulé…) de vraie qualité | Accessibilité pour les non-lecteurs | **Moteurs vocaux** pour ces langues (inexistants sur les téléphones aujourd'hui). En attendant : voix française fiable + relais humain. |
| **Débouchés / prix de marché en direct** | Savoir où et à combien vendre ; regrouper l'offre | **Source de données fiable** (observatoire des prix, API) ou des **contacts d'acheteurs**. La coopérative + les cultures agrégées posent déjà la base. |
| **Financement / microcrédit intégré** | Accès au crédit via la coopérative | **Partenariat** avec une institution de microfinance + cadre réglementaire. La coopérative pose déjà la base (groupe, confiance). |
| **Paiement / cotisations en ligne** (mobile money) | Gérer les achats groupés et cotisations | **Intégration mobile money** (Orange/MTN/Moov) + conformité. |

---

## 4. Principe de mise à jour

1. On construit d'abord tout le **réalisable logiciel** (§2).
2. Chaque fonction de §3 reste **notée ici** avec ce qui lui manque.
3. Dès qu'un moyen est disponible (matériel, données, partenariat), on **déplace la ligne de §3 vers §2**, on développe, et on actualise Terravive.
4. Ce document est la **source unique** de ce qui reste à faire — on le tient à jour à chaque étape.
