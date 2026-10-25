# Terravive Quality Guard — Compte-rendu de mission (v0.8)

Travail réalisé **directement sur le ZIP fourni**, sans réécrire l'application ni créer un projet indépendant. Les fonctionnalités, données et l'intégration Terravive existantes sont préservées. Zéro dépendance ajoutée. Rien n'a été déployé en production ; aucune donnée de production n'a été touchée.

> **Important** : les tests ci-dessous ont été exécutés **en local** (stockage fichier). Le test global des API et des fonctionnalités en **environnement réel** (Supabase, Render, IA) reste à faire séparément — la production **n'est pas** déclarée validée.

---

## 1. Fonctionnalités ajoutées (sur l'existant préservé)

| # | Fonctionnalité | Détail |
|---|---|---|
| 2 | **Export PDF** | Bouton « Télécharger le PDF » sur chaque fiche. Rapport imprimable (impression navigateur, zéro dépendance) : itinéraire, culture, localisation, date, statut, score, nombre d'anomalies, anomalies + gravité + justification + correction + statut de résolution, date de génération. |
| 3 | **Export CSV** | Audit unique (une ligne par anomalie) et liste filtrée (une ligne par audit). BOM UTF-8 (accents corrects dans Excel), séparateur `;`, **garde anti-injection de formules** (`= + - @` neutralisés), noms de fichiers explicites, droits vérifiés. Excel ouvre ces CSV directement. |
| 4 | **Comparaison d'audits** | Deux audits d'un même itinéraire : anomalies nouvelles / corrigées / toujours présentes, évolution du score (si comparable) et du statut. Refuse deux itinéraires différents. « Corrigée » uniquement avec preuve (non détectée ou marquée résolue). |
| 5 | **Notifications in-app** | Anomalie critique, nouvel audit à vérifier, résolution, échec d'enregistrement. Déduplication, « tout marquer comme lu », pastille de non-lus. Aucun e-mail/SMS. |
| 6 | **Rôles & permissions** | admin / auditeur / lecteur via `ADMIN_EMAILS`, `QUALITY_AUDITORS`, `QUALITY_VIEWERS`. Permissions vérifiées **côté serveur** sur chaque route. Défaut (variables vides) : seuls les admins → accès actuel inchangé. |
| 7 | **Journal d'actions** | Append-only : création d'audit, changement de statut, export, échec. Date, action, utilisateur, référence. **Sans aucun secret.** Lecture réservée aux admins. |
| 8 | **Tableau de bord avancé** | Cultures les plus contrôlées, problèmes les plus fréquents, en plus des compteurs et filtres existants. Données réelles ; absence ≠ zéro. |
| 9 | **Assistance IA améliorée** | Explique, propose une correction, identifie les données manquantes, distingue faits/estimations/hypothèses, signale la validation humaine. Facultative, clé jamais exposée, gère délais/erreurs/réponse vide. Jamais de dose inventée ni de garantie. |
| 10/12 | **Sécurité & stabilité** | Limitation de débit en mémoire (audit/export/IA), validations d'entrée, messages d'erreur sans fuite, lecture Supabase robuste, écriture tolérante au schéma. |

---

## 2. Fichiers modifiés / créés

| Fichier | Nature |
|---|---|
| `server.js` | Rôles+permissions, rate-limiting, journal, notifications, comparaison, export CSV, tableau de bord avancé ; routes `GET /api/quality/compare`, `GET /api/quality/export.csv`, `GET /api/quality/notifications`, `POST /api/quality/notifications/read`, `GET /api/quality/logs` ; banc de vérifications étendu (42 cas). |
| `public/quality.html` | Bell de notifications + panneau, tuiles « top cultures / problèmes », barre d'export CSV, cases de comparaison, vue de comparaison, boutons PDF/CSV/Comparer sur la fiche, carte Journal (admin), visibilité selon le rôle. Identité Terravive conservée, responsive, clavier. |
| `schema.sql` | Tables `trv_quality_notifications` et `trv_quality_logs` (idempotentes). Colonnes Quality Guard déjà présentes depuis v0.7. |
| `QUALITY-GUARD.md` | Journal des versions (jusqu'à v0.8). |
| `RAPPORT-FINAL.md` | Ce document. |

---

## 3. Tests réellement exécutés (chemin local, stockage fichier)

**a) Banc de vérifications Quality Guard — `POST /api/quality/tests` : 42/42 réussis.**
Détection, gravité, score, statuts, normalisation d'anciens enregistrements, agrégats, filtres, **comparaison** (différents itinéraires refusés, disparue=corrigée, persistante, delta de score, résolue=corrigée avec preuve), **CSV** (anti-injection, échappement, BOM, une ligne/anomalie), **top cultures/problèmes**, **permissions** (lecteur ≠ audit, auditeur ≠ journal, admin = journal).

**b) Intégration fonctionnalités v0.8 (serveur réel, 3 rôles configurés) : 29/29 réussis.**
Rôles (401/403, lecteur lit mais ne lance pas d'audit, auditeur lance mais pas le journal, admin tout) ; audit critique → notification critique ; marquer lu → 0 non-lu ; résolution → notification « resolue » + journal ; journal trace `audit_create`/`issue_status` **sans secret** ; export CSV audit (200, `text/csv`, BOM, en-tête, `Content-Disposition`) ; export CSV liste filtrée ; comparaison même itinéraire (structure) / itinéraires différents → 400 / identiques → 400 ; top cultures non vide ; validations.

**c) Intégration cycle de base : 31/31 réussis.** Contrôle → historique → fiche → résolution → **persistance disque** → filtres → 401/403 → validations.

**d) Non-régression ITK — `node test/run.js` : 33 tests / 176 vérifications, SUCCÈS.**

**e) Interface** : page `/quality` chargée dans un vrai navigateur (captures jointes), **sans erreur console** — tableau de bord avancé, notifications, fiche, comparaison de deux contrôles.

**Total : 135 vérifications, 0 échec.**

**Non exécuté ici (honnêteté) :**
- Le **chemin Supabase/production réel** (lecture/écriture/RLS des nouvelles tables) : nécessite votre clé et le réseau. Lecture rendue robuste (`select=*`), écriture tolérante ; la journalisation et les notifications échouent « en silence » sans bloquer l'action principale si les tables manquent.
- L'**assistance IA** avec une vraie clé (non disponible ici) ; sous clé factice la route renvoie des erreurs propres (503/502) sans rien exposer.
- Tout **déploiement** et tout test **en production**.

---

## 4. Migrations SQL (Supabase → SQL Editor) — idempotentes, sans suppression

```sql
-- (v0.7, si pas déjà fait)
alter table trv_quality_audits add column if not exists kind text;
alter table trv_quality_audits add column if not exists plan_title text;
alter table trv_quality_audits add column if not exists issues jsonb;
alter table trv_quality_audits add column if not exists crop text;
alter table trv_quality_audits add column if not exists region text;
alter table trv_quality_audits add column if not exists score integer;

-- (v0.8) notifications & journal
create table if not exists trv_quality_notifications (
  id text primary key, type text not null, severity text not null default 'info',
  message text not null, audit_id text, dedup text,
  read boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists trv_quality_logs (
  id text primary key, action text not null, actor text, ref jsonb,
  created_at timestamptz not null default now()
);
```

> Le fichier `schema.sql` contient l'ensemble (tables + index). **Non exécuté par mes soins** : à lancer vous-même. Si ces tables manquent, Quality Guard continue de fonctionner : notifications et journal basculent en stockage local et n'échouent jamais bruyamment.

---

## 5. Variables d'environnement à vérifier (sans divulguer les valeurs)

| Variable | Rôle | Obligatoire |
|---|---|---|
| `ADMIN_EMAILS` | Administrateur(s) Quality Guard | Oui |
| `QUALITY_AUDITORS` | Auditeurs (peuvent contrôler/résoudre, pas le journal) | Non (défaut : vide) |
| `QUALITY_VIEWERS` | Lecteurs (consultation + export) | Non (défaut : vide) |
| `SUPABASE_URL` / `SUPABASE_KEY` | Base & historique | Oui (sinon stockage local) |
| `ANTHROPIC_API_KEY` (ou `ANTHROPIC_API_KEYS`) | Génération ITK + assistance IA | Oui pour l'IA |
| `ANTHROPIC_MODEL` | Modèle (défaut `claude-sonnet-5`) | Non |

Aucun fichier `.env` ni secret n'est inclus dans l'archive.

---

## 6. Déploiement sur Render

1. Sauvegardez le dépôt GitHub (voir §9).
2. Remplacez les fichiers par ceux de l'archive (dossier `terravive-propre/`). Ne touchez pas aux secrets.
3. Supabase → SQL Editor : exécutez les migrations (§4).
4. Render : vérifiez les variables (§5), puis déployez.
5. Ouvrez `/quality` connecté en administrateur.

Script de démarrage conservé (`package.json` → `start`). Aucune dépendance ajoutée.

---

## 7. Procédure de test après déploiement

1. `GET /api/health` → `{ ok: true, db: "supabase" }`.
2. `/quality` connecté admin → tableau de bord + badge « Rôle : admin ».
3. « Lancer les vérifications » → **42/42**.
4. Contrôler un itinéraire → apparaît dans l'historique, la fiche s'ouvre, une **notification** apparaît (cloche) si anomalie critique.
5. Dans la fiche : « Télécharger le PDF » (impression) et « Exporter CSV » (téléchargement) fonctionnent.
6. Passer une anomalie à « Résolue », **recharger** → statut conservé (preuve de persistance Supabase).
7. Cocher deux audits d'un même itinéraire → « Comparer la sélection ».
8. Journal (admin) → les actions sont tracées, **sans secret**.
9. Tester un compte `QUALITY_VIEWERS` : lecture + export OK, « Contrôler » absent, journal refusé.

---

## 8. Stratégie de sauvegarde & restauration

- **À sauvegarder** : le dépôt GitHub (code), et la base Supabase (tables `trv_*`, dont `trv_quality_audits`, `trv_quality_notifications`, `trv_quality_logs`).
- **Méthodes** : Supabase propose des sauvegardes selon l'offre (à **vérifier dans votre tableau de bord Supabase** — je n'ai pas pu le vérifier). Sauvegarde manuelle possible via `pg_dump`/export SQL depuis Supabase. Render redéploie depuis un commit Git.
- **Restauration** : réimporter le dump SQL dans Supabase ; redéployer le commit voulu sur Render.
- **Avant migration** : exportez la table `trv_quality_audits` (les migrations sont additives et idempotentes, mais une sauvegarde reste prudente).
- Je **n'affirme pas** que des sauvegardes automatiques sont actives : à confirmer côté Supabase/Render.

---

## 9. Retour arrière (rollback)

- **Git** : avant de déployer, créez un tag (`git tag pre-quality-v08`). En cas de souci : `git revert` ou redéploiement du commit précédent depuis Render.
- **Base** : migrations **additives** (tables/colonnes nullables) → aucun rollback de données nécessaire. Les nouvelles tables peuvent rester en place sans effet si vous revenez au code précédent.
- Rétrocompatibilité : le code normalise les anciens enregistrements ; aucune donnée existante n'est modifiée.

---

## 10. Reste à configurer de votre côté

1. Exécuter les migrations SQL (§4) dans Supabase.
2. Définir `QUALITY_AUDITORS` / `QUALITY_VIEWERS` sur Render **si** vous voulez des rôles auditeur/lecteur (sinon seuls les admins ont accès).
3. Vérifier `ADMIN_EMAILS`, `SUPABASE_*`, `ANTHROPIC_API_KEY`.
4. Confirmer la stratégie de sauvegarde Supabase (§8).
5. Déployer, puis dérouler la procédure post-déploiement (§7), et mener le **test global en environnement réel** prévu séparément.
