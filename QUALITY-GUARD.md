# Terravive Quality Guard — intégration sur la base du ZIP fourni

Cette version ajoute une page `/quality` en reprenant les couleurs, variables CSS, la police Georgia pour les titres et le logo du `public/tableau.html` de cette archive.

## Fonctions implémentées
- Page d'administration `/quality`, cohérente visuellement avec le tableau de bord Terravive.
- Accès aux données limité à la session Terravive dont l'adresse figure dans `ADMIN_EMAILS`.
- Chargement des 50 itinéraires les plus récents (Supabase ou stockage local).
- Contrôles déterministes de contenu et enregistrement des audits.
- Cinq tests déterministes accessibles depuis l'interface.
- Historique des audits dans Supabase ou stockage local.

## Limites
- L'audit actuel est déterministe : il n'appelle pas Anthropic et ne constitue pas un diagnostic agronomique complet.
- Aucun itinéraire n'est corrigé automatiquement.
- La détection de titres/sections est heuristique ; le résultat « 18/18 » doit être vérifié sur les formats réels.
- Les routes API sont protégées par la session et `ADMIN_EMAILS`. L'interface ne remplace pas une validation agronomique.
- Les tests exécutés localement ne prouvent pas que Render et Supabase sont configurés correctement.

## Déploiement
1. Sauvegarder le dépôt GitHub actuel.
2. Fusionner les fichiers de cette archive avec le dépôt existant (ne pas remplacer les variables/secrets).
3. Exécuter le bloc `trv_quality_audits` du `schema.sql` dans Supabase SQL Editor.
4. Vérifier sur Render : `ADMIN_EMAILS` contient l'adresse administrateur déjà utilisée, et `SUPABASE_URL` / `SUPABASE_KEY` sont configurés.
5. Déployer puis ouvrir `/quality` dans le même navigateur où l'administrateur est connecté à Terravive.
6. Si la session est refusée, reconnecter le compte dans Terravive, puis recharger Quality Guard.

## Vérifications locales
`node --check server.js` vérifie la syntaxe du serveur. Aucun appel Anthropic n'est effectué par les tests du Quality Guard.


## Correction v0.6 — exécution du contrôle et historique

Le contrôle d’un itinéraire renvoie désormais son résultat même si l’enregistrement de l’historique Supabase échoue. Dans ce cas, l’interface affiche un avertissement clair et le contrôle n’est pas présenté comme enregistré. Pour conserver l’historique, exécuter le bloc SQL de création de `trv_quality_audits` et vérifier les permissions Supabase. La typographie suit les règles du tableau de bord Terravive : Segoe UI pour le texte et Georgia pour les titres.
