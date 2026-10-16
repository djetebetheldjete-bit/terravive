# Terravive — Feuille de route & vision

> Ce document garde la mémoire du projet : ce qui est **fait**, ce qu'on **construit maintenant** (faisable par logiciel seul), et ce qu'on **ajoutera plus tard** quand on aura les équipements, les données ou les partenariats nécessaires. Rien ne se perd : chaque idée mise de côté est notée ici avec *ce qui manque pour l'activer*.

_Dernière mise à jour : 16 octobre 2026._

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

---

## 2. Réalisable maintenant (logiciel seul) — en cours

Ces éléments ne demandent **aucun équipement** : juste du développement. On les fait dans l'ordre.

### 2.1 Approfondir la coopérative — matériel partagé + achats groupés
- **Matériel partagé** : un registre du matériel de la coopérative (tracteur, pulvérisateur, motopompe…) que les membres peuvent réserver/emprunter entre eux.
- **Achats groupés** : regrouper les besoins en intrants (semences, engrais, etc.) pour peser dans la négociation et acheter moins cher.
- *Faisable intégralement en logiciel.* **→ Prochaine construction.**

### 2.2 Débouchés / « vendre ensemble » (version réaliste)
- **Faisable maintenant** : un tableau où les membres déclarent ce qu'ils ont à vendre (culture, quantité, période), et où l'animateur note des **fourchettes de prix indicatives** saisies à la main. Objectif : regrouper l'offre et vendre ensemble.
- **Ce qui est reporté** (voir §3) : les **prix de marché en direct et automatiques** — ils demandent une source de données fiable.

### 2.3 Consolidation (au fil de l'eau)
- Fiabilité : quota Earth Engine, maîtrise du coût d'IA (limites par utilisateur déjà en place), réveil du serveur Render (offre gratuite qui s'endort).
- **Guide de test terrain** pour un animateur (comment faire tester l'app à de vrais cultivateurs et remonter les retours).

---

## 3. À activer plus tard (nécessite équipement, données ou partenariats)

> **Important : on garde ces fonctions en objectif.** Le code et l'interface sont pensés pour les accueillir ; dès qu'on a le moyen correspondant, on les active et on actualise Terravive.

| Fonction visée | Ce qu'elle apporterait | Ce qui manque pour l'activer |
|---|---|---|
| **Capteurs réels au champ (ESP32 / Arduino)** : humidité du sol, température, pluviométrie en direct | Arrosage au bon moment, alertes précises, données propres à la parcelle | **Matériel** : cartes ESP32/capteurs + un petit forfait data. (La page « Automatisation » existe déjà en simulation ; il restera à brancher les vraies mesures via `/api/ingest`.) |
| **Drones** : cartographie fine, repérage des zones faibles, pulvérisation ciblée | Diagnostic à grande échelle, économie d'intrants | **Équipement** (drone + caméra) et autorisation de vol. L'analyse satellite couvre déjà une partie du besoin en attendant. |
| **Prix de marché en direct** | Savoir où et à combien vendre, automatiquement | **Source de données fiable** : partenariat avec un marché/observatoire des prix, ou une API. Sans ça, on reste sur des fourchettes saisies à la main (§2.2). |
| **SMS / USSD** pour les cultivateurs **sans smartphone** | Toucher ceux qui n'ont qu'un téléphone simple, directement | **Passerelle SMS** (opérateur local ou service type Twilio) = abonnement payant. En attendant, le **relais humain** (l'animateur) joue ce rôle. |
| **Voix en langues locales** (dioula, baoulé…) de vraie qualité | Accessibilité pour les non-lecteurs | **Moteurs vocaux** pour ces langues (inexistants sur les téléphones aujourd'hui). En attendant : voix française fiable + relais humain. |
| **Financement / microcrédit intégré** | Accès au crédit via la coopérative | **Partenariat** avec une institution de microfinance + cadre réglementaire. La coopérative pose déjà la base (groupe, confiance). |
| **Paiement / cotisations en ligne** (mobile money) | Gérer les achats groupés et cotisations | **Intégration mobile money** (Orange/MTN/Moov) + conformité. |

---

## 4. Principe de mise à jour

1. On construit d'abord tout le **réalisable logiciel** (§2).
2. Chaque fonction de §3 reste **notée ici** avec ce qui lui manque.
3. Dès qu'un moyen est disponible (matériel, données, partenariat), on **déplace la ligne de §3 vers §2**, on développe, et on actualise Terravive.
4. Ce document est la **source unique** de ce qui reste à faire — on le tient à jour à chaque étape.
