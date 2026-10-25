# Terravive Stock — module de gestion des stocks

Module intégré à l'application Terravive existante (serveur Node.js natif `server.js`, zéro dépendance, Supabase REST ou stockage local de repli, sessions `trv_session`). Accessible sur **`/stock`**. Aucune fonctionnalité existante n'est modifiée ; Quality Guard et les autres modules restent intacts.

## 1. Architecture

- **Backend** : intégré dans `server.js` (bloc « Terravive Stock »), suivant la convention Terravive (un serveur mono-fichier). Réutilise `currentUser`, `sb()` (Supabase REST), `loadStore/saveStore` (repli local), `sendJson`, `readBody`, `crypto`.
- **Frontend** : `public/stock.html` — page autoportante (comme `app.html`, `quality.html`), même identité visuelle (vert `#176443`/`#123e2a`, cartes blanches, titres Georgia). Vues : tableau de bord, produits & stock, récoltes, ventes & paiements, pertes & qualité, producteurs, journal. Responsive, accessible clavier, FCFA (XOF) formaté `fr-FR`.
- **Base** : `supabase/stock-schema.sql` (tables `trv_stock_*` + RPC de validation atomique).

### Règle d'or
Le **stock disponible se calcule** à partde `trv_stock_movements` (somme signée : `in` − `out`). Il n'est **jamais** stocké en double dans une colonne « quantité » susceptible de diverger.

## 2. Routes (toutes réservées par rôle côté serveur)

| Méthode | Route | Rôle requis | Rôle |
|---|---|---|---|
| GET | `/stock` | — (page ; l'API derrière est protégée) | |
| GET | `/api/stock/overview` | read | tableau de bord (filtre `?from&to`) |
| GET | `/api/stock/products` | read | liste + disponible + statut |
| POST | `/api/stock/products` | products | créer un produit |
| POST | `/api/stock/products/update` | products | modifier |
| GET | `/api/stock/product?id=` | read | détail + mouvements |
| GET/POST | `/api/stock/producers` | read / producers | producteurs |
| GET/POST | `/api/stock/harvests` | read / harvest | récoltes (crée un mouvement `in`) |
| GET/POST | `/api/stock/losses` | read / loss | pertes (crée un mouvement `out`, refuse > stock) |
| GET | `/api/stock/sales` · `/api/stock/sale?id=` | read | ventes |
| POST | `/api/stock/sales` | sale | créer une vente (brouillon, total recalculé serveur) |
| POST | `/api/stock/sales/validate` | validate | **valider** (atomique : contrôle stock + mouvements `out`) |
| POST | `/api/stock/sales/cancel` | validate | annuler (compensation `in` si validée) |
| POST | `/api/stock/payments` | payment | enregistrer un règlement reçu |
| GET | `/api/stock/export.csv?type=products\|movements\|sales` | export | export CSV (BOM UTF-8, anti-injection) |
| GET | `/api/stock/logs` | logs | journal d'audit |
| GET | `/api/stock/public/products` | — (si `STOCK_PUBLIC_ENABLED`) | vitrine lecture seule |
| POST | `/api/stock/public/orders` | — | **désactivé (503)** tant que non configuré |

## 3. Rôles & permissions (vérifiés côté serveur)

- `admin` : `ADMIN_EMAILS` ∪ `STOCK_ADMINS` — tout, y compris le journal.
- `operateur` : `STOCK_OPERATORS` — lire, produits, récoltes, ventes, validation, pertes, paiements, producteurs, export (pas le journal).
- `lecteur` : `STOCK_VIEWERS` — lecture + export.
- Défaut (variables vides) : **seuls les administrateurs** → accès restreint préservé.

Les autorisations sont appliquées dans le serveur (`stockGuard`), jamais seulement masquées dans l'interface.

## 4. Tables Supabase (voir `supabase/stock-schema.sql`)

`trv_stock_producers`, `trv_stock_products`, `trv_stock_movements` (source de vérité), `trv_stock_harvests`, `trv_stock_sales`, `trv_stock_sale_items`, `trv_stock_payments`, `trv_stock_losses`, `trv_stock_audit_logs`, et (préparées, désactivées) `trv_stock_customers`, `trv_stock_orders`, `trv_stock_order_items`.
Montants en `numeric(14,2)` (FCFA), quantités en `numeric(14,3)`. Clés étrangères et index sur les colonnes filtrées. RPC `trv_stock_validate_sale(p_sale_id, p_actor)` : valide une vente **dans une transaction** (contrôle du stock, mouvements `out`, passage à `validee`).

## 5. Règles métier

- Une **récolte** crée le produit entrant (`in`).
- Une **vente** se crée en **brouillon** (le serveur recalcule sous-totaux et total), puis se **valide** : contrôle du stock de chaque ligne, refus si insuffisant, mouvements `out`, statut `validee`. En base, c'est **atomique** (RPC) ; en local, exécuté en mémoire (mono-thread).
- **Double validation** impossible (le statut bloque). **Annulation** d'une vente validée → mouvements `in` de compensation (traçable, aucune suppression d'historique).
- Une **perte** supérieure au disponible est refusée.
- **Paiements** : enregistrement des règlements réellement reçus ; reste à payer et statut (`solde`/`partiel`/`impaye`) dérivés. **Aucun paiement automatique**, aucune intégration opérateur simulée.
- **Journal d'audit** append-only, sans aucun secret.

## 6. Variables d'environnement

| Variable | Rôle | Obligatoire |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_KEY` | base & persistance | oui (sinon stockage local) |
| `ADMIN_EMAILS` | administrateurs Terravive (admin Stock) | oui |
| `STOCK_ADMINS` | admins Stock additionnels | non |
| `STOCK_OPERATORS` | opérateurs | non |
| `STOCK_VIEWERS` | lecteurs | non |
| `STOCK_PUBLIC_ENABLED` | active la vitrine publique (lecture) — défaut off | non |

Aucun secret n'est présent dans le frontend ni dans les livrables. Le navigateur n'interroge jamais Supabase directement.

## 7. Tests

- Suite d'intégration locale (serveur réel, stockage fichier) : `node test-stock.js` (voir le rapport de livraison). Couvre rôles, produits, récolte→stock, vente→validation→décrément, refus de sur-vente, double validation, paiement partiel, perte, perte>stock, annulation+compensation, tableau de bord, export CSV, journal, vitrine désactivée, persistance, validations.

## 8. Limites actuelles

- **Vitrine publique & commandes** : base prête, mais les commandes en ligne sont **volontairement désactivées** (`POST /api/stock/public/orders` → 503) jusqu'à une décision commerciale et la configuration de moyens de paiement réels.
- **Atomicité** : la validation de vente est atomique (RPC). La création d'une récolte/perte insère l'enregistrement puis son mouvement (deux écritures) ; en cas d'échec réseau entre les deux, une incohérence mineure est possible et journalisée — acceptable à l'échelle d'une coopérative.
- **Multi-unités** : les sommes de quantités de produits d'unités différentes ne sont pas agrégées (ce serait trompeur) ; les agrégats monétaires le sont.

## 9. Images des produits (v1.5)

- **Galerie intégrée** : 7 images reprises du prototype (tomate, concombre, piment, aubergine, laitue, gombo, poivron), servies depuis `public/stock/img/`.
- À la création d'un produit, une **image par défaut est attribuée selon le nom** (ex. « Tomate » → tomate.webp) ; sinon on peut choisir dans la galerie, **téléverser une photo** (redimensionnée côté navigateur à ≤600 px), ou « Aucune ».
- Modifiable par **administrateur et animateur** (permission `products`) via le bouton **Modifier** de chaque produit.
- Stockage : colonne `image` de `trv_stock_products` (chemin intégré `/stock/img/..` ou data URL compacte). **Sécurité** : seules nos images intégrées ou une data URL image bornée (≤ ~440 Ko) sont acceptées — aucune URL externe (anti-hotlink / anti-injection).
