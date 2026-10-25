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

## v0.6.2 — ton d’écriture aligné sur Terravive

Les textes lus par l’utilisateur ont été réécrits dans le **ton du Terravive principal** : « vous » direct, concret et rassurant, plutôt que le vocabulaire technique d’audit. Rien n’a changé dans la logique de détection ni dans les garde-fous — seules les formulations évoluent.

- **Messages d’alerte** : par exemple « Dose de chaux potentiellement chiffrée alors que le pH est inconnu : vérifier manuellement. » devient « Une dose de chaux est chiffrée alors que le pH du sol n’est pas connu : à vérifier avant de conseiller un chaulage. »
- **Page `/quality`** : titres, boutons et avertissements reformulés (« Lancer les vérifications », « Vos itinéraires récents », « Banc de vérifications », « Rien à signaler / À examiner / À vérifier »…), dans l’esprit de « Décrivez votre parcelle » ou « Branchez votre station » du tableau de bord.
- Les cinq statuts techniques inchangés côté contrat (`ok` / `warn` / `error`, `Non connecté.`, rôle administrateur) : seules les phrases visibles changent. Auto-tests 11/11, suite QA 33/176 toujours au vert.

## v0.6.3 — vraies icônes dans la page `/quality`

Les pictogrammes du menu latéral étaient de simples caractères Unicode (▦ ◉ ✓ ◷ ↗) et des boutons (↻ ▶). Ils sont remplacés par de **vraies icônes vectorielles SVG**, dessinées à la main et intégrées dans le HTML (aucune dépendance, aucune police d'icônes à charger) :

- Tableau de bord → grille ; Itinéraires → fiche ; Banc de vérifications → bouclier à coche ; Historique → horloge ; Retour à Terravive → flèche retour.
- Boutons de l'entête : Actualiser → double flèche circulaire ; Lancer les vérifications → triangle « lecture ».

Chaque icône hérite de la couleur du texte (`stroke="currentColor"`), donc elle s'affiche correctement sur le fond vert foncé du menu **comme** en blanc sur le bouton vert et en sombre sur l'onglet actif. Rien d'autre n'a changé.

## v0.6.4 — historique Supabase fiabilisé (serveur + schéma alignés)

Objectif : que l'historique des contrôles **s'enregistre et se relise** sans erreur, y compris sur la table de production existante.

### Côté serveur (`server.js`)
- **Erreurs Supabase explicites** : la fonction `sb()` ajoute désormais le corps de la réponse Supabase (tronqué à 500 caractères) au message d'erreur. Un échec d'enregistrement devient diagnosticable (« Base : erreur 400 — … ») au lieu d'un simple code.
- **Écriture de l'audit** : l'insert fournit `kind:"audit"`, `plan_title` et `issues` (copies de `title` / `alerts`) pour rester compatible avec l'ancien schéma de production où ces colonnes existaient et bloquaient l'insert quand elles n'étaient pas remplies.
- **Lecture de l'historique** (`qualityListAudits`) : la requête lit la colonne `kind`, charge jusqu'à 100 lignes et écarte celles marquées `kind:"tests"`, pour ne montrer que les audits d'itinéraires.

### Côté base (`schema.sql`) — **l'ajout de cette version**
La table `trv_quality_audits` déclare maintenant les trois colonnes utilisées par le serveur — `kind`, `plan_title`, `issues` — laissées **nullables** (le serveur les fournit toujours, mais une ligne ancienne sans ces valeurs reste valide). Une **migration idempotente** est ajoutée pour les bases déjà créées sous l'ancien schéma :

```sql
alter table trv_quality_audits add column if not exists kind text;
alter table trv_quality_audits add column if not exists plan_title text;
alter table trv_quality_audits add column if not exists issues jsonb;
```

Sans effet si les colonnes existent déjà. Après déploiement, exécuter ce bloc (ou l'intégralité de `schema.sql`) dans le SQL Editor de Supabase : le code et la base lisent et écrivent alors exactement les mêmes colonnes, sur une installation neuve **comme** sur l'existante. Logique de contrôle inchangée : auto-tests 11/11, suite QA 33 tests / 176 vérifications toujours au vert.

## v0.7 — audits enrichis, fiches détaillées, gravité, corrections, tableau de bord

Évolution majeure, en préservant l'existant et la logique de détection.

### Anomalies structurées (gravité + corrections)
Chaque anomalie porte désormais : un titre, une **gravité** (critique / important / mineur), une description, la **justification** du classement, une **correction concrète** proposée, l'**information manquante** à compléter, et un **statut** (à traiter / en cours / résolue). Aucune dose n'est inventée ; les corrections disent quoi mesurer ou compléter. Un **score structurel indicatif** (0–100) est calculé — jamais présenté comme une note agronomique.

### Historique fiable + fiche détaillée
- Lecture robuste (`select=*`) : une colonne encore absente en base ne casse plus l'historique.
- Écriture tolérante : si une colonne manque, l'audit est enregistré en mode compatibilité plutôt que perdu.
- `GET /api/quality/audit?id=…` : fiche complète d'un audit (métadonnées du plan si l'itinéraire existe encore, sinon « non disponible », jamais inventé).
- `POST /api/quality/issue` : passe une anomalie à « à traiter / en cours / résolue » ; statut et score de l'audit recalculés et persistés.
- Séparation nette audits / enregistrements de tests (`kind:"tests"` filtré).

### Tableau de bord sur données réelles + filtres
Agrégats réels : total, conformes, à vérifier, compteurs par gravité, résolues, dernier audit — avec distinction claire entre **absence de données** et **zéro**. Filtres par période, culture, statut et gravité.

### Assistance IA facultative (non automatique)
`POST /api/quality/suggest` réutilise `callClaude` et les variables d'environnement existantes pour proposer une reformulation prudente d'une anomalie, sur demande. Gardée par l'administrateur ; renvoie 503 si `ANTHROPIC_API_KEY` est absente ; aucune clé côté navigateur ; interdiction d'inventer des doses.

### Sécurité & base
Toutes les routes Quality Guard restent réservées à `ADMIN_EMAILS` ; entrées validées ; messages d'erreur sans fuite de secret. `schema.sql` ajoute les colonnes `kind, plan_title, issues, crop, region, score` (nullables) avec migration idempotente, sans suppression de données.

### Tests réellement exécutés (chemin local, stockage fichier)
- Banc de vérifications Quality Guard : **28/28** (détection, gravité, score, statuts, normalisation d'anciens enregistrements, agrégats, filtres).
- Suite QA Terravive (non-régression ITK) : **33 tests / 176 vérifications**, SUCCÈS.
- Intégration bout-en-bout (serveur réel, session admin) : **31/31** — contrôle → historique → fiche → résolution → persistance disque → filtres → 401/403 → validation des entrées.
Non exécuté ici : le chemin Supabase/production réel (clé + réseau) et l'assistance IA (clé réelle) — vérifiés par relecture et par un échec réseau propre sous clé factice.

## v0.8 — exports, comparaison, notifications, journal, rôles, tableau de bord avancé

- **Export PDF** depuis chaque fiche (impression navigateur, zéro dépendance) : métadonnées, statut, score, anomalies, gravité, justification, corrections, statut de résolution, date de génération.
- **Export CSV** d'un audit (une ligne par anomalie) ou d'une liste filtrée (une ligne par audit) : BOM UTF-8, séparateur `;`, **protection anti-injection de formules**. Excel ouvre ces CSV directement (un `.xlsx` natif demanderait une dépendance, écartée par principe).
- **Comparaison** de deux audits d'un même itinéraire : nouvelles / corrigées / toujours présentes, évolution du score (si comparable) et du statut. « Corrigée » seulement avec preuve (non détectée ou marquée résolue).
- **Centre de notifications** in-app (anomalie critique, nouvel audit à vérifier, résolution, échec d'enregistrement), avec déduplication et « tout marquer comme lu ». Aucun e-mail/SMS.
- **Journal d'actions** append-only (création, changement de statut, export, échec) ; sans aucun secret ; lecture réservée aux administrateurs.
- **Rôles** admin / auditeur / lecteur (via `ADMIN_EMAILS`, `QUALITY_AUDITORS`, `QUALITY_VIEWERS`), permissions **vérifiées côté serveur**. Défaut : seuls les admins — comportement préservé.
- **Tableau de bord avancé** : cultures les plus contrôlées, problèmes les plus fréquents, + filtres existants.
- **Sécurité/stabilité** : limitation de débit en mémoire (audit/export/IA), validations, messages d'erreur sans fuite ; l'IA reste facultative et prudente, gère clé absente / réseau / réponse vide.

### Tests réellement exécutés (chemin local)
Banc de vérifications **42/42** · Intégration fonctionnalités **29/29** (rôles, notifications, journal, exports, comparaison, tableau de bord) · Intégration cycle de base **31/31** · Suite QA ITK **33/33**. Non exécuté : Supabase/production réel et IA avec vraie clé.
