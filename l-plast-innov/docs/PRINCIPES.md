# Principes de vérité des données — L-PLAST-INNOV

Ces principes sont **non négociables** : ils protègent la crédibilité du projet
et évitent de prendre des décisions de terrain sur des bases fausses.

## 1. Données réelles vs données simulées

- Toute donnée issue du mode simulation porte `is_simulated = true`.
- Les zones et caméras de démonstration portent la mention `[DEMO]`.
- Les réponses de l'API conservent ce drapeau : une interface ne doit jamais
  afficher une donnée simulée comme une observation réelle.

## 2. Les trois indicateurs de comptage ne sont jamais confondus

| Indicateur | Définition | Source |
|---|---|---|
| **Présents** | déchets uniques actuellement sur la plage (non retirés) | `WasteObject` non `REMOVED` |
| **Nouveaux (période)** | déchets uniques dont la 1ʳᵉ détection tombe dans la période | `WasteObject.first_seen_at` |
| **Détections (période)** | nombre d'événements de détection (un déchet peut compter plusieurs fois) | `Detection.detected_at` |

Les seuils et alertes se calculent **uniquement** sur les déchets *présents* uniques.

## 3. Pas de double comptage

- Chaque déchet unique = un `WasteObject` avec un `track_uid` stable.
- Idempotence réseau : un `event_uid` déjà reçu est ignoré.
- Le `track_uid` du tracker CamSCA fait autorité ; l'appariement par proximité
  n'est qu'un repli quand aucun `track_uid` n'est fourni.

## 4. Un déchet disparu n'est pas un déchet retiré

- Disparaître d'une image → statut `NOT_VISIBLE` (toujours compté présent).
- Seul un **nettoyage vérifié** fait passer un déchet à `REMOVED`.
- La caméra ne déclare jamais une zone propre toute seule.

## 5. Les alertes se déclenchent au franchissement d'un seuil

- Pas une alerte par détection : une seule alerte ouverte par niveau et par zone.
- Clôture après vérification du nettoyage, avec conservation de l'historique.

## 6. Géolocalisation honnête

- La position GPS d'une caméra fixe ≠ position d'un objet dans son champ.
- Position précise = via **calibration** (homographie image→sol).
- À défaut (prototype) : centre de zone, marqué `approximate = true`.

## 7. IA honnête

- Aucun modèle n'est présenté comme entraîné sur Balmer tant qu'aucune base
  d'images annotées de Balmer n'existe.
- Le modèle générique par défaut classe tout en `unidentified`.

## 8. Vie privée

- Géolocalisation des visiteurs **facultative** et soumise au consentement.
- La position personnelle des utilisateurs n'est jamais diffusée publiquement.
- Collecte de données personnelles limitée au nécessaire.

## 9. Statistiques honnêtes

- Calculées à partir des données enregistrées, jamais inventées.
- Journées statistiques alignées sur le fuseau **Africa/Abidjan**.

## 10. GPR (radar de sol) — phase avancée

- Non intégré physiquement : aucune donnée GPR n'est simulée comme réelle.
- Toute anomalie souterraine n'est pas du plastique (humidité, salinité, sable).
- Module indépendant prévu, à corréler avec les observations visuelles.
