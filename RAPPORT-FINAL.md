# Terravive Quality Guard — Compte-rendu de mission (v0.7)

Travail réalisé **directement sur le ZIP fourni** (« correction-historique »), sans réécrire l'application ni créer un projet indépendant. Les fonctionnalités, données et l'intégration Terravive existantes sont préservées. Rien n'a été déployé en production et aucune donnée de production n'a été touchée.

---

## 1. Analyse du projet existant (Partie 1)

- **Architecture** : un serveur Node.js natif « zéro dépendance » (`server.js`), interface statique dans `public/`, base Supabase/PostgreSQL optionnelle (sinon stockage fichier local `data/store.json`), intégration IA via `callClaude` (clés `ANTHROPIC_API_KEY(S)`), hébergement Render.
- **Quality Guard existant** : page `/quality`, contrôles **déterministes** (aucun appel IA), réservés à `ADMIN_EMAILS`. Routes `GET /api/quality/overview`, `POST /api/quality/audit`, `POST /api/quality/tests`. Les audits étaient stockés dans `trv_quality_audits`.
- **Table réellement utilisée** : `trv_quality_audits`. Le code « correction-historique » écrivait déjà `kind / plan_title / issues` pour coller à l'ancien schéma de production ; `schema.sql` ne déclarait pas ces colonnes → risque d'échec d'enregistrement ou d'historique vide selon le schéma réel.
- **Points à corriger / compléter** repérés : anomalies trop pauvres (pas de gravité, ni correction, ni statut), pas de fiche détaillée, pas de tableau de bord sur données réelles, lecture d'historique fragile (sélection de colonnes nommées), incohérence code ↔ `schema.sql`.

Décision : **corrections ciblées + ajouts**, pas de réécriture.

---

## 2. Fichiers créés / modifiés

| Fichier | Nature | Résumé |
|---|---|---|
| `server.js` | modifié | Module Quality Guard enrichi (anomalies structurées, score, normalisation, agrégats, filtres), lecture Supabase robuste (`select=*`), écriture tolérante au schéma, nouvelles routes (`GET /api/quality/audit`, `POST /api/quality/issue`, `POST /api/quality/suggest`), banc de vérifications étendu (28 cas). |
| `public/quality.html` | modifié | Tableau de bord réel + tuiles par gravité, filtres (période/culture/statut/gravité), historique cliquable, **fiche détaillée** (gravité colorée, justification, correction, info manquante, statuts), états chargement/vide/erreur, accessibilité clavier, identité Terravive conservée. |
| `schema.sql` | modifié | Colonnes `kind, plan_title, issues, crop, region, score` (nullables) + **migration idempotente** + note de sécurité RLS. Aucune suppression. |
| `QUALITY-GUARD.md` | modifié | Journal des versions (jusqu'à v0.7) et limites. |
| `RAPPORT-FINAL.md` | créé | Ce document. |

---

## 3. Fiabilisation audit & historique (Partie 2)

Parcours vérifié de bout en bout (voir §9) : sélection d'un itinéraire → lancement du contrôle → analyse → anomalies → résultat structuré → **enregistrement** → apparition dans l'**historique** → **fiche détaillée** → résultat **persistant après actualisation**.

- Lecture robuste : `select=*` (une colonne absente ne casse plus l'historique) + filtrage `kind:"tests"` en JS.
- Écriture tolérante : tentative ligne complète, sinon repli sur les colonnes de base → l'audit n'est **jamais perdu**, avec un avertissement clair invitant à exécuter la migration.
- Séparation stricte **audits / enregistrements de tests**.
- Gestion des champs nuls : une donnée manquante est affichée « Non disponible », jamais comme une fausse valeur.

---

## 4. Fiche détaillée (Partie 3)

`GET /api/quality/audit?id=…` renvoie l'audit complet + les métadonnées du plan **si l'itinéraire existe encore**. La fiche affiche : titre, culture, localisation, date/heure, statut, **score** (uniquement s'il est calculé, libellé « structurel indicatif »), nombre d'anomalies, liste des anomalies, boutons **Consulter** / **Retour à l'historique**, états de chargement, messages d'erreur, état vide.

---

## 5. Gravité & corrections (Parties 4 & 5)

Trois niveaux : **critique** (risque/décision dommageable), **important** (fausse une recommandation/estimation), **mineur** (rédactionnel/présentation). Chaque anomalie fournit : titre, description, gravité, **justification**, **correction recommandée**, statut (à traiter / en cours / résolue), information manquante. Précautions respectées : aucune dose inventée, aucune garantie de rendement/bénéfice, distinction faits/estimations/hypothèses, vérification humaine signalée si besoin.

Assistance IA **facultative** (`POST /api/quality/suggest`) : réutilise `callClaude` et les variables d'environnement existantes, réservée à l'admin, renvoie 503 sans clé, **aucune clé côté navigateur**, interdiction d'inventer des doses. Non automatique.

---

## 6. Tableau de bord (Partie 6)

Indicateurs **réels** : total, conformes, à vérifier, critiques, importantes, mineures, résolues, dernier audit. **Absence de données** (null, affiché « — ») distinguée d'un **zéro**. Filtres par période, culture, statut, gravité.

---

## 7. Sécurité (Partie 8)

- Toutes les routes `/api/quality/*` exigent une session **et** `ADMIN_EMAILS` (401 si non connecté, 403 si non-admin) — vérifié par test.
- Entrées validées (identifiants, statut parmi une liste blanche, dates au format `AAAA-MM-JJ`), corps de requête borné.
- **Aucun secret côté client** : le navigateur n'interroge jamais Supabase ni l'IA directement ; la clé n'apparaît pas dans `quality.html`.
- Messages d'erreur génériques côté utilisateur ; les détails techniques restent dans les journaux Render.
- RLS : Quality Guard passe par le serveur avec la clé Supabase côté serveur. Recommandations RLS documentées en commentaire dans `schema.sql` (ne pas activer sans policy de remplacement).

---

## 8. Base de données & migrations (Partie 9)

`schema.sql` (à exécuter dans **Supabase → SQL Editor**) — idempotent, sans suppression :

```sql
alter table trv_quality_audits add column if not exists kind text;
alter table trv_quality_audits add column if not exists plan_title text;
alter table trv_quality_audits add column if not exists issues jsonb;
alter table trv_quality_audits add column if not exists crop text;
alter table trv_quality_audits add column if not exists region text;
alter table trv_quality_audits add column if not exists score integer;
```

> **Non exécuté par mes soins** : je n'ai pas d'accès à votre Supabase. À lancer vous-même. En mode compatibilité (colonnes manquantes), les audits restent enregistrés avec les colonnes de base ; la migration débloque culture/score et le filtre par culture.

---

## 9. Tests réellement exécutés (Partie 10)

Environnement : ce conteneur de développement, **stockage fichier local** (pas de Supabase réel).

**a) Banc de vérifications Quality Guard — `POST /api/quality/tests` : 28/28 réussis.**
Couvre : détection des 8 anomalies, mapping de gravité, score (−30 par critique, 0 pénalité si résolue), statut (critique→error, résolue→ok, mineure→warn), normalisation d'anciens enregistrements (`high→critique`, stockage `issues`), agrégats (absence ≠ zéro), filtres (statut/gravité/culture), séparation audits/tests.

**b) Suite QA Terravive (non-régression ITK) — `node test/run.js` : 33 tests / 176 vérifications, SUCCÈS.** Aucune régression sur la génération d'itinéraires.

**c) Intégration bout-en-bout (serveur réel démarré, session admin simulée) : 31/31 réussis.**
Sécurité 401/403 sur toutes les routes ; overview initial (total 0, compteurs null) ; lancement d'un audit (anomalie critique détectée, statut error, score < 100, chaque anomalie complète) ; apparition dans l'historique ; agrégats (total 1, ≥1 critique, culture exposée) ; fiche (plan disponible, info manquante pH) ; passage d'une anomalie à « résolue » (statut → warn, score +30) ; **persistance relue sur disque** ; fiche après résolution ; filtres (statut=warn → 1, culture inexistante → 0) ; validations (statut invalide → 400, id manquant → 400, fiche inexistante → 404) ; route IA gardée (403 non-admin, échec réseau propre 502 sous clé factice).

**d) Rendu de l'interface** : page `/quality` chargée dans un vrai navigateur (captures jointes) — tableau de bord, historique, et fiche détaillée (gravités colorées, corrections, chips de statut).

**Non exécuté ici (honnêteté) :**
- Le **chemin Supabase/production réel** (lecture/écriture/RLS) : nécessite votre clé et le réseau Supabase. Code vérifié par relecture ; lecture rendue robuste (`select=*`) ; écriture à repli testée en logique.
- L'**assistance IA** avec une vraie clé : non exécutée (pas de clé ici) ; sous clé factice, la route renvoie une erreur réseau propre (502) sans rien exposer.
- Tout **déploiement** et tout test **en production**.

---

## 10. Déploiement sur Render

1. Sauvegardez le dépôt GitHub actuel (voir §12, rollback).
2. Remplacez les fichiers par ceux de cette archive (dossier `terravive-propre/`). Ne touchez pas aux secrets/variables.
3. Dans **Supabase → SQL Editor**, exécutez le bloc de migration de `schema.sql` (§8).
4. Sur **Render**, vérifiez les variables d'environnement (§11), puis déclenchez un déploiement.
5. Ouvrez `/quality` dans le navigateur où l'administrateur est connecté à Terravive.

Le script de démarrage existant est conservé (`package.json` → `start`). Aucune dépendance ajoutée.

---

## 11. Variables d'environnement à vérifier (sans les divulguer)

| Variable | Rôle | Obligatoire |
|---|---|---|
| `ADMIN_EMAILS` | Adresse(s) administrateur autorisée(s) sur Quality Guard | Oui |
| `SUPABASE_URL` / `SUPABASE_KEY` | Base de données & historique | Oui (sinon stockage local) |
| `ANTHROPIC_API_KEY` (ou `ANTHROPIC_API_KEYS`) | Génération d'itinéraires + assistance IA facultative | Oui pour l'IA |
| `ANTHROPIC_MODEL` | Modèle (défaut `claude-sonnet-5`) | Non |
| `PORT` | Fourni par Render | Non |

Aucun fichier `.env` ni secret n'est inclus dans l'archive.

---

## 12. Vérification après déploiement

1. `GET /api/health` → `{ ok: true, db: "supabase" }`.
2. Ouvrir `/quality` connecté en admin → le tableau de bord se charge (sinon message clair 401/403).
3. « Lancer les vérifications » → **28/28**.
4. Lancer un contrôle sur un itinéraire → il apparaît dans l'historique, la fiche s'ouvre.
5. Dans la fiche, passer une anomalie à « Résolue », **recharger la page** → le statut est conservé (preuve que Supabase enregistre bien).
6. Si un bandeau « mode compatibilité » apparaît : la migration SQL (§8) n'a pas encore été exécutée.

---

## 13. Retour arrière (rollback)

- **Option Git** : avant de déployer, créez une branche/tag de l'état actuel (`git tag pre-quality-v07`). En cas de souci : `git revert` du commit, ou redéploiement du tag depuis Render (« Manual Deploy » → commit précédent).
- **Base** : la migration est **additive** (colonnes nullables) ; aucun rollback de données n'est nécessaire. Si vous tenez à retirer les colonnes ajoutées (déconseillé) : `alter table trv_quality_audits drop column if exists score, drop column if exists region, drop column if exists crop;` — n'affecte pas les audits existants.
- L'ancienne version du front et des routes reste entièrement compatible avec les lignes déjà enregistrées (normalisation rétrocompatible).

---

## 14. Étapes indispensables de votre côté

1. Exécuter le bloc de migration SQL (§8) dans Supabase.
2. Vérifier `ADMIN_EMAILS`, `SUPABASE_URL/KEY`, `ANTHROPIC_API_KEY` sur Render.
3. Déployer, puis dérouler la vérification post-déploiement (§12), notamment l'étape 5 (persistance réelle).
EOF
echo "RAPPORT-FINAL.md écrit" && wc -l /home/claude/uinspect/terravive-propre/RAPPORT-FINAL.md