create extension if not exists pgcrypto;

create table if not exists public.pf_profiles (
  id uuid primary key,
  email text not null unique,
  username text,
  provider text default 'email',
  role text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pf_user_settings (
  owner_id uuid primary key,
  active_env_id uuid,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pf_collections (
  id uuid primary key,
  owner_id uuid not null,
  name text not null,
  description text not null default '',
  variables jsonb not null default '{}'::jsonb,
  requests jsonb not null default '[]'::jsonb,
  docs_url text not null default '',
  docs_notes text not null default '',
  allow_ai_doc_fetch boolean not null default false,
  ai_sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pf_collections_owner_created_idx
  on public.pf_collections (owner_id, created_at desc);

create table if not exists public.pf_environments (
  id uuid primary key,
  owner_id uuid not null,
  name text not null,
  variables jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pf_environments_owner_created_idx
  on public.pf_environments (owner_id, created_at desc);

create table if not exists public.pf_history (
  id uuid primary key,
  owner_id uuid not null,
  method text not null,
  url text not null,
  status_code integer not null,
  elapsed_ms integer not null,
  size_bytes integer not null,
  timestamp timestamptz not null default now()
);

create index if not exists pf_history_owner_timestamp_idx
  on public.pf_history (owner_id, timestamp desc);

comment on table public.pf_profiles is 'PostFreely user profiles mirrored from Supabase Auth';
comment on table public.pf_user_settings is 'Per-user UI settings and active environment';
comment on table public.pf_collections is 'Saved collections with nested requests';
comment on table public.pf_environments is 'Saved environments per workspace owner';
comment on table public.pf_history is 'Recent request history per workspace owner';
