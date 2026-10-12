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
