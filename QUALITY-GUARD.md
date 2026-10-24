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

## Correction v0.6.1 — détection du pH + 3 contrôles supplémentaires

### Le bug corrigé (pH)
La détection « dose de chaux chiffrée alors que le pH est inconnu » utilisait l’expression `/pH\s*(?:inconnu|non précisé|non mesuré)/i`. Elle **ne reconnaissait pas** les formulations réelles produites par Terravive, parce qu’un mot ou un signe s’intercale entre « pH » et l’état :
- « pH **:** non précisé » (deux-points)
- « Le pH **est** inconnu » (verbe « est »)
- « pH **du sol** non mesuré »

Conséquence : une dose de chaux pouvait être chiffrée sans que l’alerte se déclenche. La détection est désormais portée par `QG_PH_UNKNOWN`, qui tolère deux-points, « est », « du sol », et les variantes *inconnu / non précisé / non mesuré / non connu / non fourni*. L’alerte ne se déclenche que si une **dose chiffrée** de chaux est aussi présente (`QG_LIME_DOSE` : nombre + unité kg/g/t à proximité de « chaux » ou « chaulage »), pour éviter les faux positifs sur « ne pas chauler sans mesure ».

### Trois contrôles déterministes ajoutés
- **Montant en FCFA (medium)** : un montant chiffré en F CFA / FCFA / XOF est signalé — rappel que les prix doivent être saisis par le producteur et non inventés par le modèle.
- **Marge ≠ bénéfice (low)** : si « marge » apparaît sans la mention « n’est pas le bénéfice réel », l’audit le signale.
- **Rendement chiffré (low)** : un rendement en t/ha sans cadrage prudent (scénario / indicatif / ordre de grandeur) est signalé.

Ces contrôles restent **déterministes** (aucun appel à Anthropic), ne corrigent rien automatiquement et ne font qu’attirer l’attention de l’administrateur. Les cinq auto-tests d’origine sont conservés ; six cas ont été ajoutés (dont une **preuve positive** du bug pH : « pH : non précisé » + « 800 kg de chaux » → alerte haute). Les auto-tests passent 11/11 et la suite QA Terravive reste à 33 tests / 176 vérifications. Aucune autre partie du serveur n’a été modifiée.
