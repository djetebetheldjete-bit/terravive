-- ============================================================================
-- Terravive Stock — schéma PostgreSQL / Supabase
-- Idempotent (create table if not exists / add column if not exists).
-- N'exécute AUCUNE suppression. À lancer dans Supabase → SQL Editor.
-- Montants en FCFA (XOF) : numeric(14,2). Quantités : numeric(14,3).
-- La règle d'or : le stock disponible se CALCULE à partir des mouvements
--   (trv_stock_movements), jamais stocké en double dans une colonne « quantité ».
-- ============================================================================

-- Producteurs partenaires -----------------------------------------------------
create table if not exists trv_stock_producers (
  id          text primary key,
  name        text not null,
  phone       text,
  region      text,
  cooperative text,
  consent_public boolean not null default false,  -- accepte d'être présenté en vitrine
  created_at  timestamptz not null default now(),
  created_by  text
);

-- Produits agricoles ----------------------------------------------------------
create table if not exists trv_stock_products (
  id          text primary key,
  name        text not null,
  category    text,
  unit        text not null default 'kg',         -- kg | g | t | l | unite | caisse | sac
  min_qty     numeric(14,3) not null default 0,   -- seuil d'alerte stock bas
  price       numeric(14,2) not null default 0,   -- prix de vente indicatif (FCFA)
  producer_id text references trv_stock_producers(id),
  is_public   boolean not null default false,     -- visible en vitrine publique
  image       text,                               -- chemin d'image intégrée (/stock/img/..) ou data URL
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  text
);
create index if not exists trv_stock_products_name_idx on trv_stock_products (name);
-- Migration idempotente : colonne image si la table existait déjà.
alter table trv_stock_products add column if not exists image text;

-- Mouvements de stock : SOURCE DE VÉRITÉ du disponible --------------------------
-- type 'in' ajoute, 'out' retire. qty toujours positive. reason donne le contexte.
create table if not exists trv_stock_movements (
  id          text primary key,
  product_id  text not null references trv_stock_products(id),
  type        text not null check (type in ('in','out')),
  qty         numeric(14,3) not null check (qty > 0),
  reason      text not null,                       -- harvest | sale | loss | adjustment | order
  ref_type    text,                                -- harvest | sale | loss ...
  ref_id      text,                                -- id de l'objet d'origine
  note        text,
  created_at  timestamptz not null default now(),
  created_by  text
);
create index if not exists trv_stock_movements_product_idx on trv_stock_movements (product_id);
create index if not exists trv_stock_movements_created_idx on trv_stock_movements (created_at desc);

-- Récoltes --------------------------------------------------------------------
create table if not exists trv_stock_harvests (
  id          text primary key,
  product_id  text not null references trv_stock_products(id),
  producer_id text references trv_stock_producers(id),
  qty         numeric(14,3) not null check (qty > 0),
  unit        text not null default 'kg',
  quality     text,                                -- A | B | C ou libre
  parcel      text,                                -- parcelle / provenance
  batch_ref   text,                                -- lot
  harvested_at date,
  created_at  timestamptz not null default now(),
  created_by  text
);
create index if not exists trv_stock_harvests_created_idx on trv_stock_harvests (created_at desc);

-- Ventes ----------------------------------------------------------------------
create table if not exists trv_stock_sales (
  id           text primary key,
  reference    text unique not null,
  customer_name text,
  status       text not null default 'brouillon' check (status in ('brouillon','validee','annulee')),
  total        numeric(14,2) not null default 0,
  paid         numeric(14,2) not null default 0,
  sold_at      date,
  created_at   timestamptz not null default now(),
  validated_at timestamptz,
  created_by   text
);
create index if not exists trv_stock_sales_created_idx on trv_stock_sales (created_at desc);

create table if not exists trv_stock_sale_items (
  id          text primary key,
  sale_id     text not null references trv_stock_sales(id),
  product_id  text not null references trv_stock_products(id),
  qty         numeric(14,3) not null check (qty > 0),
  unit_price  numeric(14,2) not null default 0,
  subtotal    numeric(14,2) not null default 0
);
create index if not exists trv_stock_sale_items_sale_idx on trv_stock_sale_items (sale_id);

-- Paiements (suivi des règlements réellement reçus / attendus) -----------------
create table if not exists trv_stock_payments (
  id          text primary key,
  sale_id     text not null references trv_stock_sales(id),
  amount      numeric(14,2) not null check (amount > 0),
  method      text not null default 'especes',     -- especes | mobile_money | virement | livraison
  reference   text,
  paid_at     date,
  created_at  timestamptz not null default now(),
  created_by  text
);
create index if not exists trv_stock_payments_sale_idx on trv_stock_payments (sale_id);

-- Pertes ----------------------------------------------------------------------
create table if not exists trv_stock_losses (
  id          text primary key,
  product_id  text not null references trv_stock_products(id),
  qty         numeric(14,3) not null check (qty > 0),
  cause       text not null,                        -- pourriture | degradation | invendu | transport | stockage | autre
  note        text,
  lost_at     date,
  created_at  timestamptz not null default now(),
  created_by  text
);
create index if not exists trv_stock_losses_created_idx on trv_stock_losses (created_at desc);

-- Journal d'audit du module stock (append-only, jamais de secret) --------------
create table if not exists trv_stock_audit_logs (
  id          text primary key,
  action      text not null,
  actor       text,
  ref         jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists trv_stock_audit_logs_idx on trv_stock_audit_logs (created_at desc);

-- Vitrine publique & commandes (PRÉPARÉ, désactivé par défaut côté serveur) -----
-- Les tables existent pour être prêtes ; aucune route publique de commande n'est
-- active tant que STOCK_PUBLIC_ENABLED n'est pas mis à true (décision commerciale).
create table if not exists trv_stock_customers (
  id         text primary key,
  name       text not null,
  phone      text,
  email      text,
  created_at timestamptz not null default now()
);
create table if not exists trv_stock_orders (
  id          text primary key,
  reference   text unique not null,
  customer_id text references trv_stock_customers(id),
  status      text not null default 'en_attente'
              check (status in ('en_attente','confirmee','preparation','expediee','livree','annulee')),
  total       numeric(14,2) not null default 0,
  delivery    text,
  created_at  timestamptz not null default now()
);
create table if not exists trv_stock_order_items (
  id         text primary key,
  order_id   text not null references trv_stock_orders(id),
  product_id text not null references trv_stock_products(id),
  qty        numeric(14,3) not null check (qty > 0),
  unit_price numeric(14,2) not null default 0,
  subtotal   numeric(14,2) not null default 0
);
create index if not exists trv_stock_order_items_order_idx on trv_stock_order_items (order_id);

-- ============================================================================
-- RPC : validation ATOMIQUE d'une vente (Partie 12).
-- Vérifie le stock disponible de chaque ligne, refuse si insuffisant, crée les
-- mouvements 'out', passe la vente à 'validee' — le tout dans UNE transaction.
-- Appelée par le serveur via POST /rest/v1/rpc/trv_stock_validate_sale.
-- ============================================================================
create or replace function trv_stock_validate_sale(p_sale_id text, p_actor text)
returns json
language plpgsql
set search_path = public, extensions
as $$
declare
  v_status text;
  r record;
  v_available numeric(14,3);
begin
  select status into v_status from trv_stock_sales where id = p_sale_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Vente introuvable.');
  end if;
  if v_status = 'validee' then
    return json_build_object('ok', false, 'error', 'Cette vente est déjà validée.');
  end if;
  if v_status = 'annulee' then
    return json_build_object('ok', false, 'error', 'Cette vente est annulée.');
  end if;

  -- 1) Contrôle du stock disponible pour chaque ligne
  for r in select product_id, sum(qty) as qty
           from trv_stock_sale_items where sale_id = p_sale_id group by product_id loop
    select coalesce(sum(case when type='in' then qty else -qty end),0)
      into v_available from trv_stock_movements where product_id = r.product_id;
    if r.qty > v_available then
      return json_build_object('ok', false, 'error',
        'Stock insuffisant pour le produit ' || r.product_id ||
        ' (demandé ' || r.qty || ', disponible ' || v_available || ').');
    end if;
  end loop;

  -- 2) Création des mouvements de sortie
  for r in select id, product_id, qty from trv_stock_sale_items where sale_id = p_sale_id loop
    insert into trv_stock_movements(id, product_id, type, qty, reason, ref_type, ref_id, created_by)
    values (encode(gen_random_bytes(12),'hex'), r.product_id, 'out', r.qty, 'sale', 'sale', p_sale_id, p_actor);
  end loop;

  -- 3) Validation de la vente
  update trv_stock_sales set status='validee', validated_at=now() where id = p_sale_id;

  insert into trv_stock_audit_logs(id, action, actor, ref)
  values (encode(gen_random_bytes(10),'hex'), 'sale_validate', p_actor, json_build_object('sale_id', p_sale_id));

  return json_build_object('ok', true);
end;
$$;

-- ============================================================================
-- Sécurité (défense en profondeur). Le navigateur n'interroge JAMAIS Supabase
-- directement : seul le serveur le fait, avec la clé côté serveur, et chaque
-- route est protégée par rôle. Si vous utilisez la clé service_role côté serveur,
-- elle contourne la RLS (attendu). Pour activer la RLS malgré tout, créez des
-- policies adaptées — n'activez JAMAIS une policy « tout autoriser à tous ».
-- Exemple (à adapter, ne pas copier aveuglément) :
--   alter table trv_stock_products enable row level security;
--   -- puis une policy réservant l'accès au rôle de service / aux comptes autorisés.
-- ============================================================================
