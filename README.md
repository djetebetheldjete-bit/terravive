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
4. Si vous utilisez Supabase : exécutez `schema.sql` dans le SQL Editor.

## Sécurité

- Mots de passe hachés (scrypt), sessions par jeton aléatoire (cookie `HttpOnly`, `Secure` en production).
- Les clés (API, base) restent dans les variables d'environnement, jamais dans le code.
- Limitation de débit par utilisateur sur les appels IA (protège le coût).

## Avertissement

Les conseils sont **indicatifs** et à adapter à chaque terrain. En cas de doute important
(maladie grave, usage de produits), consultez un agronome local.


## Terravive Quality Guard (administration)

Une interface de contrôle est disponible sur `/quality`. Elle réutilise la session de connexion et le contrôle administrateur existants : l'adresse de l'utilisateur connecté doit figurer dans `ADMIN_EMAILS` sur Render. Les routes d'API Quality Guard refusent les utilisateurs non administrateurs.

Fonctions incluses dans cette version :
- règles déterministes indicatives sur les itinéraires récents (sections 1–18, certains signaux de doses de chaux, prix non sourcés, formulations absolues, fréquences d'arrosage) ;
- audit Anthropic à la demande, limité à 10 audits par heure et par compte administrateur ;
- lancement de la suite automatisée existante, limité à 6 exécutions par heure ;
- historique des audits et tests.

### Activer l'historique Supabase

Dans Supabase → SQL Editor, exécuter le bloc intitulé **Historique Quality Guard** ajouté à la fin de `schema.sql` (création de `trv_quality_audits`). Si la table n'existe pas, les contrôles peuvent fonctionner mais l'historique Supabase ne pourra pas être enregistré. La clé `SUPABASE_KEY` doit être la clé serveur utilisée par l'application et rester uniquement dans les variables Render.

### Déploiement

1. Faire une sauvegarde ou créer une branche Git avant la mise à jour.
2. Ajouter les fichiers modifiés au dépôt GitHub : `server.js`, `quality.js`, `public/quality.html`, `public/quality-ui.js`, `test/test-quality.js`, `test/run.js`, `test/lib/load-server.js`, `schema.sql`, `package.json`, `README.md`.
3. Vérifier sur Render les variables `ADMIN_EMAILS`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `SUPABASE_URL` et `SUPABASE_KEY`. Ne pas mettre de secrets dans GitHub.
4. Déployer et ouvrir `/quality` après connexion avec un compte dont l'adresse est dans `ADMIN_EMAILS`.
5. Lancer la suite de tests puis effectuer un contrôle technique sur un itinéraire. Un audit IA est à lancer explicitement et peut entraîner un coût API.

**Limites connues :** les règles déterministes ne sont pas un diagnostic agronomique exhaustif ; l'audit IA est indicatif ; aucune correction automatique n'est appliquée au contenu des itinéraires dans cette version. La page statique peut être visible sans connexion, mais les données et actions sont protégées par les routes administratives.
