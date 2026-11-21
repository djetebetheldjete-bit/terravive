# 🌱 Terravive

**L'agriculture durable accompagnée par l'intelligence artificielle.**

Un agriculteur décrit sa parcelle, et l'IA bâtit avec lui un **plan de culture durable** personnalisé
(calendrier des tâches, fertilisation naturelle, gestion de l'eau, protection biologique, biodiversité),
puis reste disponible comme **conseiller** tout au long de la saison.

Même principe que la plateforme Bâtisseur, appliqué à l'agriculture et au développement durable.

---

## Ce que ça fait

- **Plan de culture durable** généré par l'IA à partir de la parcelle (culture, région, sol, saison, objectif).
- **Conseiller agronome** : diagnostic de problèmes (feuilles jaunes, insectes…), arrosage, fertilisation naturelle.
- **Comptes** : chaque agriculteur retrouve et imprime ses plans.
- **Espace admin** : liste des inscrits et nombre de plans.
- **Zéro dépendance** : Node.js 18+ (http, fs, crypto). Stockage Supabase **ou** fichiers locaux.

## Sol, racines et station connectée (v7)

- **Sol & racines** (tableau de bord → une parcelle enregistrée → « Sol & racines ») : nature du sol estimée
  par carte satellitaire (**iSDAsoil 30 m**, repli **SoilGrids 250 m**), profondeur du sol, fertilité estimée,
  profondeur **utile** des racines selon la culture et son stade, **dose et fréquence d'arrosage** (méthode FAO-56,
  ET0 Open-Meteo), **profondeur du capteur** et **seuil d'arrosage**. Correction possible par un test de terrain
  (test du bocal, profondeur observée), qui l'emporte toujours sur l'estimation.
- **Itinéraire adapté au sol** : dans le formulaire, choisissez une parcelle enregistrée ; ses données de sol sont transmises à l'IA.
- **Station ESP32** : programme généré par le serveur (`/api/station/sketch`), pré-rempli avec la clé, l'adresse
  et le seuil de la parcelle ; humidité du sol + DHT22 (air) + niveau de cuve (JSN-SR04T), HTTPS, nouvelles tentatives.
  Alerte d'arrosage et de cuve vide dans « Dernières mesures ».
- Guide complet : [`docs/SOL-ET-STATION.md`](docs/SOL-ET-STATION.md). Tests : `npm test`.

## Distribution : de la parcelle au client (v8.12, projet ASTRIDE)

- Page **`/distribution`** pour les animateurs (et rôles du Stock) : carte des parcelles de la coopérative,
  des centres de groupage et des points de vente, avec les flux de collecte et de livraison.
- Chaque récolte devient un **lot** : annoncé → reçu au centre → en route → livré. Pertes, délais et
  écart de prévision sont calculés à partir des saisies, jamais inventés.
- Supabase : exécutez le bloc « v8.12 » à la fin de `schema.sql`.

## Installation locale

```bash
cp .env.example .env      # puis renseignez ANTHROPIC_API_KEY et ADMIN_EMAILS
node server.js            # http://localhost:3000
```

Sans base de données, les comptes et plans sont stockés dans `data/store.json` (repli local automatique).

## Déploiement sur Render

1. Poussez ce dossier sur GitHub.
2. Sur Render : « New + » → « Web Service » → sélectionnez le dépôt (Render lit `render.yaml`).
3. Renseignez `ANTHROPIC_API_KEY` et `ADMIN_EMAILS` (et, en option, `SUPABASE_URL` + `SUPABASE_KEY`).
4. Si vous utilisez Supabase : exécutez `schema.sql` dans le SQL Editor (sur une base existante, le bloc
   `trv_parcel_soil` suffit pour la v7).
5. Facultatif mais recommandé : `ISDA_USERNAME` + `ISDA_PASSWORD` (compte gratuit iSDAsoil) pour les cartes de sol à 30 m.

## Sécurité

- Mots de passe hachés (scrypt), sessions par jeton aléatoire (cookie `HttpOnly`, `Secure` en production).
- Les clés (API, base) restent dans les variables d'environnement, jamais dans le code.
- Limitation de débit par utilisateur sur les appels IA (protège le coût).

## Avertissement

Les conseils sont **indicatifs** et à adapter à chaque terrain. En cas de doute important
(maladie grave, usage de produits), consultez un agronome local.
