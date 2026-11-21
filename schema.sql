-- ============================================================
-- Terravive — schéma de la base de données
-- (Supabase / PostgreSQL — à coller dans « SQL Editor » puis « Run »)
-- Idempotent : peut être exécuté plusieurs fois sans risque.
-- ============================================================

-- Comptes des agriculteurs (et administrateurs)
create table if not exists trv_users (
  id text primary key,
  email text unique,
  name text,
  pass text,
  region text,
  created_at timestamptz default now()
);

-- Statut « animateur » accordé par le propriétaire (true = peut créer/animer une coopérative)
alter table trv_users add column if not exists animator boolean default false;
alter table trv_users add column if not exists certified boolean default false;   -- cultivateur certifié (gère son stock)
alter table trv_users add column if not exists profile text default 'cultivateur'; -- 'client' | 'cultivateur'
alter table trv_users add column if not exists coop_auto_done boolean default false; -- rattachement automatique à un animateur déjà fait (v8.11)

-- Sessions de connexion (jeton aléatoire)
create table if not exists trv_sessions (
  token text primary key,
  user_id text,
  created_at timestamptz default now()
);

-- Plans de culture durables générés
create table if not exists trv_plans (
  id text primary key,
  user_id text,
  title text,
  crop text,
  region text,
  area text,
  soil text,
  season text,
  goal text,
  notes text,
  content text,               -- le plan (Markdown)
  created_at timestamptz default now()
);
create index if not exists trv_plans_user_idx on trv_plans (user_id, created_at desc);
-- v7.9 : fiche pratique terrain (JSON), gardée avec l'itinéraire pour ne pas la régénérer
alter table trv_plans add column if not exists fiche text;

-- Projets d'automatisation agricole (Arduino) générés
create table if not exists trv_devices (
  id text primary key,
  user_id text,
  title text,
  kind text,                  -- type de projet (ex. « arrosage automatique »)
  sector text,                -- région / secteur (pour la mémoire partagée)
  need text,                  -- le besoin décrit par la personne
  content text,               -- le projet complet (Markdown : matériel, câblage, sketch…)
  created_at timestamptz default now()
);
create index if not exists trv_devices_user_idx on trv_devices (user_id, created_at desc);

-- Station connectée de l'agriculteur (clé secrète que l'ESP32 utilise pour envoyer ses mesures)
create table if not exists trv_stations (
  id text primary key,
  user_id text,
  name text,
  device_key text unique,     -- clé d'appareil (à mettre dans le programme de la carte)
  created_at timestamptz default now()
);
create index if not exists trv_stations_user_idx on trv_stations (user_id);

-- Mesures envoyées par les capteurs (humidité du sol, température, humidité de l'air, niveau de cuve)
create table if not exists trv_readings (
  id text primary key,
  user_id text,
  station_id text,
  soil int,                   -- humidité du sol en % (0–100)
  temp real,                  -- température en °C
  hum int,                    -- humidité de l'air en %
  level int,                  -- niveau de la cuve en % (0–100)
  created_at timestamptz default now()
);
create index if not exists trv_readings_user_idx on trv_readings (user_id, created_at desc);
-- v8.0 : origine de la mesure (capteur, manuel, toucher) et observation
alter table trv_readings add column if not exists source text;
alter table trv_readings add column if not exists note text;

-- Journal des questions posées au conseiller (pour voir ce que les cultivateurs cherchent à comprendre)
create table if not exists trv_questions (
  id text primary key,
  user_id text,
  question text,
  crop text,
  created_at timestamptz default now()
);
create index if not exists trv_questions_idx on trv_questions (created_at desc);

-- Parcelles enregistrées (limites de la zone dessinée, pour revisualiser plus tard)
create table if not exists trv_parcels (
  id text primary key,
  user_id text,
  name text,
  geom text,                  -- zone en JSON : {"bbox":[o,s,e,n]} ou {"polygon":[[lng,lat],...]}
  created_at timestamptz default now()
);
create index if not exists trv_parcels_user_idx on trv_parcels (user_id, created_at desc);

-- Sol & racines d'une parcelle : estimation satellite (iSDAsoil / SoilGrids) + correction terrain,
-- culture en place et date de semis. Une ligne par parcelle. (Ajouté en v7 : exécutez ce bloc
-- sur une base existante, il ne touche pas aux autres tables.)
create table if not exists trv_parcel_soil (
  parcel_id text primary key,
  user_id text,
  crop text,
  sown_at date,
  estimate text,              -- JSON : {source, texture, sand, silt, clay, stones, bedrock_cm, ph, oc_gkg, n_gkg, p_ppm, k_ppm, fetched_at}
  estimate_error text,
  manual text,                -- JSON : {texture, depth_cm, stones, at} (test du bocal, fosse)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists trv_parcel_soil_user_idx on trv_parcel_soil (user_id, updated_at desc);

-- Carnet de champ : interventions et récoltes notées par parcelle (v7.8)
create table if not exists trv_field_log (
  id text primary key,
  user_id text,
  parcel_id text,
  date date,
  kind text,                  -- arrosage | pluie | compost | engrais | traitement | semis | recolte | perte | residu | germination | incident | observation
  qty numeric,
  unit text,                  -- L, kg, mm ou % (test de germination)
  note text,
  created_at timestamptz default now()
);
create index if not exists trv_field_log_parcel_idx on trv_field_log (user_id, parcel_id, date desc);
-- v8.0 : saison / campagne et type d'intrant dans le carnet ; référence « avant » par parcelle
alter table trv_field_log add column if not exists season text;
alter table trv_field_log add column if not exists product text;
create index if not exists trv_field_log_user_idx on trv_field_log (user_id, date);
create table if not exists trv_parcel_ref (
  parcel_id text primary key,
  user_id text,
  label text,                 -- ex. « Saison 2025 avant Terravive »
  water_l numeric,            -- totaux d'une saison complète, saisis à la main (nature : déclaré)
  compost_kg numeric,
  chem_kg numeric,
  yield_kg numeric,
  note text,
  updated_at timestamptz default now()
);
-- v8.2 : test côte à côte — parcelle Terravive et sa parcelle témoin
create table if not exists trv_parcel_pair (
  parcel_id text primary key, -- parcelle conduite avec Terravive
  user_id text,
  control_id text,            -- parcelle témoin (pratique habituelle)
  updated_at timestamptz default now()
);

-- Coopératives (relais humain + base achats groupés / mise en marché)
create table if not exists trv_coops (
  id text primary key,
  name text,
  region text,
  code text unique,           -- code d'invitation à partager
  owner_id text,              -- créateur (animateur)
  created_at timestamptz default now()
);
create table if not exists trv_coop_members (
  id text primary key,
  coop_id text,
  user_id text,
  role text,                  -- 'animateur' ou 'membre'
  joined_at timestamptz default now()
);
create index if not exists trv_coop_members_coop_idx on trv_coop_members (coop_id);
create index if not exists trv_coop_members_user_idx on trv_coop_members (user_id);

-- Matériel partagé de la coopérative (tracteur, pulvérisateur, motopompe…)
create table if not exists trv_coop_equipment (
  id text primary key,
  coop_id text,
  owner_id text,              -- membre qui met le matériel à disposition
  name text,
  kind text,                  -- type (facultatif)
  note text,
  status text,                -- 'dispo' par défaut
  created_at timestamptz default now()
);
create index if not exists trv_coop_equipment_coop_idx on trv_coop_equipment (coop_id, created_at desc);

-- Réservations / emprunts de matériel entre membres
create table if not exists trv_coop_resa (
  id text primary key,
  coop_id text,
  equipment_id text,
  equipment_name text,
  user_id text,               -- membre qui réserve
  date_from text,             -- date souhaitée (texte AAAA-MM-JJ)
  date_to text,
  note text,
  status text,                -- 'demandée' | 'acceptée' | 'refusée' | 'annulée' | 'terminée'
  created_at timestamptz default now()
);
create index if not exists trv_coop_resa_coop_idx on trv_coop_resa (coop_id, created_at desc);
create index if not exists trv_coop_resa_equip_idx on trv_coop_resa (equipment_id);

-- Achats groupés d'intrants (campagnes)
create table if not exists trv_coop_buy (
  id text primary key,
  coop_id text,
  created_by text,
  item text,                  -- ce qu'on achète (ex. engrais NPK)
  unit text,                  -- unité (sac, kg, litre…)
  deadline text,              -- date limite (texte AAAA-MM-JJ)
  note text,
  status text,                -- 'ouvert' | 'clos'
  created_at timestamptz default now()
);
create index if not exists trv_coop_buy_coop_idx on trv_coop_buy (coop_id, created_at desc);

-- Participations des membres à un achat groupé (quantité demandée)
create table if not exists trv_coop_buy_join (
  id text primary key,
  buy_id text,
  user_id text,
  qty real,
  name text,
  created_at timestamptz default now()
);
create index if not exists trv_coop_buy_join_buy_idx on trv_coop_buy_join (buy_id);

-- Demandes pour devenir animateur (soumises dans l'app, décidées par le propriétaire)
create table if not exists trv_anim_requests (
  id text primary key,
  user_id text,
  name text,
  email text,
  region text,
  message text,
  status text,                -- 'en_attente' | 'acceptée' | 'refusée'
  created_at timestamptz default now(),
  decided_at timestamptz
);
create index if not exists trv_anim_requests_status_idx on trv_anim_requests (status, created_at desc);
create index if not exists trv_anim_requests_user_idx on trv_anim_requests (user_id);

-- Demandes de certification cultivateur (maîtrise de Terravive), décidées par l'administrateur.
create table if not exists trv_cert_requests (
  id text primary key,
  user_id text,
  name text,
  email text,
  region text,
  status text,                -- 'en_attente' | 'acceptée' | 'refusée'
  created_at timestamptz default now(),
  decided_at timestamptz
);
create index if not exists trv_cert_requests_status_idx on trv_cert_requests (status, created_at desc);
create index if not exists trv_cert_requests_user_idx on trv_cert_requests (user_id);


-- Terravive Quality Guard : historique des audits administratifs
create table if not exists trv_quality_audits (
  id text primary key,
  plan_id text,
  title text,
  status text not null default 'warn',
  alert_count integer not null default 0,
  alerts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by text,
  -- Colonnes écrites par le serveur (voir handleQualityAudit / qualityListAudits).
  -- Laissées NULLABLE : le serveur les fournit toujours, mais une ligne ancienne
  -- sans ces valeurs reste valide.
  kind text,          -- "audit" pour un contrôle d'itinéraire (les "tests" sont filtrés à la lecture)
  plan_title text,    -- copie du titre (compatibilité ancien schéma de production)
  issues jsonb,       -- copie des alertes  (compatibilité ancien schéma de production)
  crop text,          -- culture de l'itinéraire (tableau de bord : filtre par culture)
  region text,        -- localisation de l'itinéraire
  score integer       -- score structurel indicatif 0..100 (jamais une note agronomique)
);
-- Migration idempotente : ajoute les colonnes sur une table déjà créée en production.
-- Sans effet si elles existent déjà. Aucune donnée existante n'est supprimée ni modifiée.
alter table trv_quality_audits add column if not exists kind text;
alter table trv_quality_audits add column if not exists plan_title text;
alter table trv_quality_audits add column if not exists issues jsonb;
alter table trv_quality_audits add column if not exists crop text;
alter table trv_quality_audits add column if not exists region text;
alter table trv_quality_audits add column if not exists score integer;
create index if not exists trv_quality_audits_created_idx
  on trv_quality_audits (created_at desc);

-- Sécurité (défense en profondeur). Quality Guard n'est JAMAIS requêté directement par le
-- navigateur : le serveur seul lit/écrit cette table avec la clé Supabase côté serveur
-- (jamais exposée au client), et chaque route est réservée à ADMIN_EMAILS. Si vous utilisez
-- la clé « service_role » côté serveur, elle contourne la RLS (comportement attendu).
-- Si vous préférez activer la RLS malgré tout, faites-le SANS casser l'accès serveur, p. ex. :
--   alter table trv_quality_audits enable row level security;
--   -- puis une policy autorisant le rôle de service, ou l'adresse administrateur, selon votre setup.
-- N'activez pas la RLS sans policy de remplacement : vous bloqueriez l'enregistrement des audits.

-- ===================================================================
-- Terravive Quality Guard v0.8 : notifications & journal d'actions
-- (créées à la demande ; si absentes, le serveur bascule en stockage
--  local sans échouer. Aucune donnée existante n'est touchée.)
-- ===================================================================

-- Centre de notifications in-app (jamais d'e-mail/SMS sans configuration).
create table if not exists trv_quality_notifications (
  id text primary key,
  type text not null,                 -- critique | nouvel_audit | resolue | echec
  severity text not null default 'info',
  message text not null,
  audit_id text,
  dedup text,                         -- clé de déduplication (évite les doublons)
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists trv_quality_notifications_idx
  on trv_quality_notifications (read, created_at desc);

-- Journal d'actions (append-only côté application : pas de route de modification
-- ni de suppression). Ne contient JAMAIS de secret (mot de passe, clé, jeton).
create table if not exists trv_quality_logs (
  id text primary key,
  action text not null,               -- audit_create | issue_status | export | echec ...
  actor text,                         -- e-mail de l'utilisateur si disponible
  ref jsonb,                          -- référence de l'objet (audit_id, plan_id, ...)
  created_at timestamptz not null default now()
);
create index if not exists trv_quality_logs_idx
  on trv_quality_logs (created_at desc);
