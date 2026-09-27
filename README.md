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
