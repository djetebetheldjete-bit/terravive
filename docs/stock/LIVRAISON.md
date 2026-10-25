# Terravive Stock — livraison

Module **Terravive Stock** transformé en vrai module de l'application Terravive existante (route `/stock`), persistant (Supabase), sécurisé par rôle côté serveur, sans casser l'existant et sans dépendance ajoutée. Design et ton d'écriture **uniformes** avec Terravive / Quality Guard.

## A. Ce qui a été livré (concret)

- `server.js` — bloc « Terravive Stock » : rôles/permissions, accès données (Supabase REST + repli local), calcul du stock à partir des mouvements, produits, producteurs, récoltes, ventes (brouillon → validation atomique → décrément), paiements, pertes, tableau de bord réel, export CSV, journal d'audit, vitrine publique (désactivée par défaut). ~20 routes `/api/stock/*`. Route `/stock` ajoutée au serveur statique.
- `public/stock.html` — interface complète et autoportante (tableau de bord, produits, récoltes, ventes + fiche + reçu imprimable, pertes, producteurs, journal), FCFA, responsive, rôle-aware, modales (pas d'`alert()` rudimentaire).
- `supabase/stock-schema.sql` — schéma complet : tables `trv_stock_*`, index, clés étrangères, contraintes, **RPC `trv_stock_validate_sale`** (validation atomique), note de sécurité RLS. Idempotent, sans suppression.
- `test-stock.js` — suite d'intégration exécutable (`node test-stock.js`).
- `docs/stock/README.md` — documentation technique (architecture, routes, tables, règles métier, sécurité, variables, limites).

## B. Tests réellement exécutés (chemin local, stockage fichier)

`node test-stock.js` → **36 / 36 réussis, 0 échec.** Couverture :

1. `/stock` sert la page.
2. Rôles : non connecté → 401 ; rôle absent → 403 ; lecteur lit mais ne crée pas (403) ; opérateur crée (200).
3. Création de produit ; stock initial 0 = rupture.
4. Récolte → **mouvement d'entrée** ; stock passe à 20.
5. Vente brouillon : **total recalculé côté serveur** (60 000 FCFA) ; référence générée.
6. Validation **au-delà du stock → refusée (400)** ; stock inchangé.
7. Validation valide → **stock décrémenté** (20 → 15).
8. **Double validation refusée (400).**
9. Paiement partiel : reste 40 000, statut « partiel ».
10. Perte → stock 15 → 12 ; **perte > stock refusée (400)**.
11. **Annulation d'une vente validée → compensation** (stock 12 → 17), traçable.
12. Tableau de bord : métriques réelles, **valeur des pertes calculée** (3 × 12 000 = 36 000).
13. Export CSV (200, `text/csv`, BOM UTF-8).
14. Journal : actions tracées, **interdit au lecteur (403)**.
15. Vitrine publique **désactivée → 404** ; commande publique **désactivée → 503**.
16. **Persistance disque** (produits, mouvements).
17. Validations d'entrée (nom vide → 400 ; quantité ≤ 0 → 400).

**Non-régression** (modules existants) : suite QA ITK **SUCCÈS**, Quality Guard **28/28** + intégration **29/29** — inchangés.

**Rendu interface** : page `/stock` chargée dans un vrai navigateur (captures jointes), **sans erreur console** — tableau de bord, produits, fiche de vente.

**Non exécuté ici (honnêteté)** :
- Le chemin **Supabase/production réel** (lecture/écriture, RPC, RLS) : nécessite votre clé et le réseau. Code écrit pour l'API REST existante ; l'écriture journal/mouvement ne bloque jamais l'action si une table manque.
- Aucun **déploiement** Render exécuté (pas d'accès).

## C. Migrations SQL (Supabase → SQL Editor)

Exécuter **`supabase/stock-schema.sql`** en entier (idempotent, sans suppression). Il crée les tables `trv_stock_*`, les index, les contraintes et la fonction `trv_stock_validate_sale`. Rien n'est supprimé ; si des tables de mêmes noms existaient, `create table if not exists` les laisse intactes.

> Non appliqué par mes soins (pas d'accès à votre Supabase). Sans ces tables, le module fonctionne en **stockage local** (repli), mais la persistance Supabase exige la migration.

## D. Guide de déploiement Render (pas à pas)

1. **Sauvegarder** : créez un tag Git de l'état actuel (`git tag pre-stock`) et, si possible, un export de votre base Supabase.
2. **Vérifier les fichiers** livrés : `server.js`, `public/stock.html`, `supabase/stock-schema.sql`, `docs/stock/`, `test-stock.js`.
3. **Migrations** : dans Supabase → SQL Editor, exécutez `supabase/stock-schema.sql`.
4. **Variables Render** (Settings → Environment) : vérifiez `SUPABASE_URL`, `SUPABASE_KEY`, `ADMIN_EMAILS`. Optionnel : `STOCK_OPERATORS`, `STOCK_VIEWERS`, `STOCK_ADMINS`, `STOCK_PUBLIC_ENABLED`. **Ne supprimez aucune variable existante.**
5. **Intégrer le code** : remplacez les fichiers dans votre dépôt (le point d'entrée `server.js` et le script `start` restent inchangés).
6. **Déployer** depuis Render (ou push Git si déploiement automatique).
7. **Tester** : ouvrez `/stock` connecté avec un compte `ADMIN_EMAILS` ; créez un produit, une récolte, une vente, validez-la, rechargez la page (persistance).
8. **Rollback** si besoin : redéployez le commit/tag précédent depuis Render. Les tables ajoutées peuvent rester (sans effet) ; aucune donnée existante n'est touchée.

## E. Procédure de vérification après déploiement

1. `GET /api/health` → `{ ok:true, db:"supabase" }`.
2. `/stock` en admin → tableau de bord chargé (sinon message clair 401/403).
3. Créer un produit → il apparaît dans « Produits & stock ».
4. Enregistrer une récolte → le disponible augmente (mouvement `in`).
5. Créer une vente, la **valider** → le disponible diminue ; recharger la page → persistant.
6. Tenter une vente supérieure au stock → refus clair.
7. Enregistrer un paiement partiel → reste à payer correct.
8. Exporter un CSV → fichier téléchargé, accents corrects.

## F. Éléments à configurer de votre côté

1. **Migrations SQL** : exécuter `supabase/stock-schema.sql` dans Supabase.
2. **Rôles** (facultatif) : définir `STOCK_OPERATORS` / `STOCK_VIEWERS` / `STOCK_ADMINS` sur Render selon qui gère le stock (sinon, seuls les admins).
3. **Vitrine publique** (facultatif) : mettre `STOCK_PUBLIC_ENABLED=true` quand vous voulez exposer le catalogue public (lecture seule). **Les commandes en ligne restent désactivées** jusqu'à décision commerciale + configuration d'un moyen de paiement réel (aucun faux paiement n'est fait).
4. **Paiements** : l'enregistrement des règlements est prêt ; toute intégration d'opérateur (Mobile Money, etc.) devra utiliser son API officielle et des clés en variables d'environnement serveur — à configurer plus tard.
5. **RLS** (facultatif, défense en profondeur) : voir la note dans `supabase/stock-schema.sql` ; n'activez jamais une policy « tout autoriser à tous ».
6. **Déploiement Render** : à lancer par vos soins.

## G. Critères d'acceptation — état

Route `/stock` intégrée ✓ · auth réutilisée ✓ · accès non autorisés bloqués côté serveur ✓ · produits gérables ✓ · récoltes enregistrables ✓ · entrées/sorties cohérentes ✓ · vente validée modifie le stock ✓ · pertes traçables ✓ · paiements suivis sans faux paiement ✓ · persistance (local prouvée ; Supabase prête, à migrer) ◑ · tableau de bord sur données réelles ✓ · pas de données fictives présentées comme réelles ✓ · design Terravive conservé ✓ · routes existantes préservées ✓ · migrations documentées ✓ · tests rapportés honnêtement ✓ · ZIP créé ✓ · instructions de déploiement ✓.
