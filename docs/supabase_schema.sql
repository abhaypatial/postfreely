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

create or replace function public.pf_is_admin(user_id uuid)
returns boolean
language sql
stable
as $$
  select exists(
    select 1
    from public.pf_profiles p
    where p.id = user_id
      and p.role = 'admin'
  );
$$;

create or replace function public.pf_apply_profile_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.email := lower(trim(new.email));
  new.updated_at := now();
  new.username := nullif(trim(coalesce(new.username, '')), '');
  new.provider := coalesce(nullif(trim(coalesce(new.provider, '')), ''), 'email');
  if new.email = 'abhay.patial13@gmail.com' then
    new.role := 'admin';
  else
    new.role := 'user';
  end if;
  return new;
end;
$$;

drop trigger if exists pf_profiles_defaults on public.pf_profiles;
create trigger pf_profiles_defaults
before insert or update on public.pf_profiles
for each row execute function public.pf_apply_profile_defaults();

alter table public.pf_profiles enable row level security;
alter table public.pf_user_settings enable row level security;
alter table public.pf_collections enable row level security;
alter table public.pf_environments enable row level security;
alter table public.pf_history enable row level security;

drop policy if exists "pf_profiles_select_self_or_admin" on public.pf_profiles;
create policy "pf_profiles_select_self_or_admin"
on public.pf_profiles
for select
using (id = auth.uid() or public.pf_is_admin(auth.uid()));

drop policy if exists "pf_profiles_insert_self" on public.pf_profiles;
create policy "pf_profiles_insert_self"
on public.pf_profiles
for insert
with check (id = auth.uid());

drop policy if exists "pf_profiles_update_self_or_admin" on public.pf_profiles;
create policy "pf_profiles_update_self_or_admin"
on public.pf_profiles
for update
using (id = auth.uid() or public.pf_is_admin(auth.uid()))
with check (id = auth.uid() or public.pf_is_admin(auth.uid()));

drop policy if exists "pf_user_settings_rw_owner_or_admin" on public.pf_user_settings;
create policy "pf_user_settings_rw_owner_or_admin"
on public.pf_user_settings
for all
using (owner_id = auth.uid() or public.pf_is_admin(auth.uid()))
with check (owner_id = auth.uid() or public.pf_is_admin(auth.uid()));

drop policy if exists "pf_collections_rw_owner_or_admin" on public.pf_collections;
create policy "pf_collections_rw_owner_or_admin"
on public.pf_collections
for all
using (owner_id = auth.uid() or public.pf_is_admin(auth.uid()))
with check (owner_id = auth.uid() or public.pf_is_admin(auth.uid()));

drop policy if exists "pf_environments_rw_owner_or_admin" on public.pf_environments;
create policy "pf_environments_rw_owner_or_admin"
on public.pf_environments
for all
using (owner_id = auth.uid() or public.pf_is_admin(auth.uid()))
with check (owner_id = auth.uid() or public.pf_is_admin(auth.uid()));

drop policy if exists "pf_history_rw_owner_or_admin" on public.pf_history;
create policy "pf_history_rw_owner_or_admin"
on public.pf_history
for all
using (owner_id = auth.uid() or public.pf_is_admin(auth.uid()))
with check (owner_id = auth.uid() or public.pf_is_admin(auth.uid()));
