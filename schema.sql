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

-- Historique Quality Guard (audit indicatif, sans modification automatique des itinéraires)
create table if not exists trv_quality_audits (
  id text primary key,
  plan_id text,
  plan_title text,
  kind text,
  status text,
  score integer,
  issues jsonb default '[]'::jsonb,
  deterministic jsonb,
  ai jsonb,
  model text,
  created_at timestamptz default now(),
  created_by text,
  details jsonb
);
create index if not exists trv_quality_audits_created_idx on trv_quality_audits (created_at desc);
