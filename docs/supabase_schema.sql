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

create table if not exists public.pf_workspaces (
  id uuid primary key,
  owner_id uuid not null,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pf_workspaces_owner_created_idx
  on public.pf_workspaces (owner_id, created_at desc);

create table if not exists public.pf_workspace_members (
  id uuid primary key,
  workspace_id uuid not null references public.pf_workspaces(id) on delete cascade,
  user_id uuid,
  email text not null,
  role text not null default 'collaborator',
  permissions jsonb not null default '{"read": true, "write": true, "run": true, "manage": false}'::jsonb,
  status text not null default 'active',
  added_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email)
);

create index if not exists pf_workspace_members_user_idx
  on public.pf_workspace_members (user_id, workspace_id);

create index if not exists pf_workspace_members_workspace_idx
  on public.pf_workspace_members (workspace_id, role, status);

alter table public.pf_workspace_members
  add column if not exists permissions jsonb not null default '{"read": true, "write": true, "run": true, "manage": false}'::jsonb;

create table if not exists public.pf_workspace_collections (
  id uuid primary key,
  workspace_id uuid not null references public.pf_workspaces(id) on delete cascade,
  collection_id uuid not null references public.pf_collections(id) on delete cascade,
  added_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, collection_id)
);

create index if not exists pf_workspace_collections_workspace_idx
  on public.pf_workspace_collections (workspace_id, created_at desc);

create table if not exists public.pf_collection_drafts (
  id uuid primary key,
  workspace_id uuid not null references public.pf_workspaces(id) on delete cascade,
  collection_id uuid not null references public.pf_collections(id) on delete cascade,
  editor_user_id uuid not null,
  name text not null,
  description text not null default '',
  requests jsonb not null default '[]'::jsonb,
  docs_url text not null default '',
  docs_notes text not null default '',
  allow_ai_doc_fetch boolean not null default false,
  ai_sources jsonb not null default '[]'::jsonb,
  base_collection_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, collection_id, editor_user_id)
);

create index if not exists pf_collection_drafts_editor_idx
  on public.pf_collection_drafts (editor_user_id, updated_at desc);

create index if not exists pf_collection_drafts_workspace_idx
  on public.pf_collection_drafts (workspace_id, updated_at desc);

comment on table public.pf_profiles is 'PostFreely user profiles mirrored from Supabase Auth';
comment on table public.pf_user_settings is 'Per-user UI settings and active environment';
comment on table public.pf_collections is 'Saved collections with nested requests';
comment on table public.pf_environments is 'Saved environments per workspace owner';
comment on table public.pf_history is 'Recent request history per workspace owner';
comment on table public.pf_workspaces is 'Shared collaboration spaces for collections';
comment on table public.pf_workspace_members is 'Workspace membership and roles';
comment on table public.pf_workspace_collections is 'Collections assigned to workspaces';
comment on table public.pf_collection_drafts is 'Per-user collection drafts. Variables are intentionally excluded from promotion.';

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

create or replace function public.pf_workspace_role(workspace uuid, user_id uuid)
returns text
language sql
stable
as $$
  select case
    when exists(
      select 1
      from public.pf_workspaces w
      where w.id = workspace
        and w.owner_id = user_id
    ) then 'owner'
    else (
      select m.role
      from public.pf_workspace_members m
      where m.workspace_id = workspace
        and m.user_id = user_id
        and m.status = 'active'
      limit 1
    )
  end;
$$;

create or replace function public.pf_workspace_is_member(workspace uuid, user_id uuid)
returns boolean
language sql
stable
as $$
  select public.pf_workspace_role(workspace, user_id) is not null;
$$;

create or replace function public.pf_workspace_is_admin(workspace uuid, user_id uuid)
returns boolean
language sql
stable
as $$
  select public.pf_workspace_role(workspace, user_id) in ('owner', 'admin');
$$;

create or replace function public.pf_workspace_has_permission(workspace uuid, user_id uuid, permission text)
returns boolean
language sql
stable
as $$
  select
    public.pf_workspace_is_admin(workspace, user_id)
    or exists (
      select 1
      from public.pf_workspace_members m
      where m.workspace_id = workspace
        and m.user_id = user_id
        and m.status = 'active'
        and coalesce((m.permissions ->> permission)::boolean, false)
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
alter table public.pf_workspaces enable row level security;
alter table public.pf_workspace_members enable row level security;
alter table public.pf_workspace_collections enable row level security;
alter table public.pf_collection_drafts enable row level security;

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

drop policy if exists "pf_collections_select_workspace_members" on public.pf_collections;
create policy "pf_collections_select_workspace_members"
on public.pf_collections
for select
using (
  owner_id = auth.uid()
  or public.pf_is_admin(auth.uid())
  or exists (
    select 1
    from public.pf_workspace_collections wc
    where wc.collection_id = pf_collections.id
      and public.pf_workspace_has_permission(wc.workspace_id, auth.uid(), 'write')
  )
);

create or replace function public.pf_preserve_shared_collection_variables()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.owner_id <> auth.uid() and not public.pf_is_admin(auth.uid()) then
    new.owner_id := old.owner_id;
    new.variables := old.variables;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pf_preserve_shared_collection_variables_trg on public.pf_collections;
create trigger pf_preserve_shared_collection_variables_trg
before update on public.pf_collections
for each row execute function public.pf_preserve_shared_collection_variables();

drop policy if exists "pf_collections_update_workspace_members_without_variables" on public.pf_collections;
create policy "pf_collections_update_workspace_members_without_variables"
on public.pf_collections
for update
using (
  exists (
    select 1
    from public.pf_workspace_collections wc
    where wc.collection_id = pf_collections.id
      and public.pf_workspace_has_permission(wc.workspace_id, auth.uid(), 'write')
  )
)
with check (
  exists (
    select 1
    from public.pf_workspace_collections wc
    where wc.collection_id = pf_collections.id
      and public.pf_workspace_has_permission(wc.workspace_id, auth.uid(), 'read')
  )
);

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

drop policy if exists "pf_workspaces_select_member" on public.pf_workspaces;
create policy "pf_workspaces_select_member"
on public.pf_workspaces
for select
using (
  owner_id = auth.uid()
  or public.pf_workspace_is_member(id, auth.uid())
  or public.pf_is_admin(auth.uid())
);

drop policy if exists "pf_workspaces_insert_owner" on public.pf_workspaces;
create policy "pf_workspaces_insert_owner"
on public.pf_workspaces
for insert
with check (owner_id = auth.uid() or public.pf_is_admin(auth.uid()));

drop policy if exists "pf_workspaces_update_admin" on public.pf_workspaces;
create policy "pf_workspaces_update_admin"
on public.pf_workspaces
for update
using (
  owner_id = auth.uid()
  or public.pf_workspace_is_admin(id, auth.uid())
  or public.pf_is_admin(auth.uid())
)
with check (
  owner_id = auth.uid()
  or public.pf_workspace_is_admin(id, auth.uid())
  or public.pf_is_admin(auth.uid())
);

drop policy if exists "pf_workspaces_delete_admin" on public.pf_workspaces;
create policy "pf_workspaces_delete_admin"
on public.pf_workspaces
for delete
using (
  owner_id = auth.uid()
  or public.pf_workspace_is_admin(id, auth.uid())
  or public.pf_is_admin(auth.uid())
);

drop policy if exists "pf_workspace_members_select_members" on public.pf_workspace_members;
create policy "pf_workspace_members_select_members"
on public.pf_workspace_members
for select
using (
  user_id = auth.uid()
  or public.pf_workspace_is_member(workspace_id, auth.uid())
  or public.pf_is_admin(auth.uid())
);

drop policy if exists "pf_workspace_members_manage_admins" on public.pf_workspace_members;
create policy "pf_workspace_members_manage_admins"
on public.pf_workspace_members
for all
using (
  public.pf_workspace_is_admin(workspace_id, auth.uid())
  or public.pf_is_admin(auth.uid())
)
with check (
  public.pf_workspace_is_admin(workspace_id, auth.uid())
  or public.pf_is_admin(auth.uid())
);

drop policy if exists "pf_workspace_collections_select_members" on public.pf_workspace_collections;
create policy "pf_workspace_collections_select_members"
on public.pf_workspace_collections
for select
using (
  public.pf_workspace_has_permission(workspace_id, auth.uid(), 'read')
  or public.pf_is_admin(auth.uid())
);

drop policy if exists "pf_workspace_collections_manage_members" on public.pf_workspace_collections;
create policy "pf_workspace_collections_manage_members"
on public.pf_workspace_collections
for all
using (
  public.pf_workspace_has_permission(workspace_id, auth.uid(), 'manage')
  or public.pf_is_admin(auth.uid())
)
with check (
  public.pf_workspace_has_permission(workspace_id, auth.uid(), 'manage')
  or public.pf_is_admin(auth.uid())
);

drop policy if exists "pf_collection_drafts_select_own_or_workspace_admin" on public.pf_collection_drafts;
create policy "pf_collection_drafts_select_own_or_workspace_admin"
on public.pf_collection_drafts
for select
using (
  editor_user_id = auth.uid()
  or public.pf_workspace_is_admin(workspace_id, auth.uid())
  or public.pf_is_admin(auth.uid())
);

drop policy if exists "pf_collection_drafts_insert_member" on public.pf_collection_drafts;
create policy "pf_collection_drafts_insert_member"
on public.pf_collection_drafts
for insert
with check (
  editor_user_id = auth.uid()
  and (
    public.pf_workspace_is_member(workspace_id, auth.uid())
    or public.pf_is_admin(auth.uid())
  )
);

drop policy if exists "pf_collection_drafts_update_own_or_workspace_admin" on public.pf_collection_drafts;
create policy "pf_collection_drafts_update_own_or_workspace_admin"
on public.pf_collection_drafts
for update
using (
  editor_user_id = auth.uid()
  or public.pf_workspace_is_admin(workspace_id, auth.uid())
  or public.pf_is_admin(auth.uid())
)
with check (
  editor_user_id = auth.uid()
  or public.pf_workspace_is_admin(workspace_id, auth.uid())
  or public.pf_is_admin(auth.uid())
);

drop policy if exists "pf_collection_drafts_delete_own_or_workspace_admin" on public.pf_collection_drafts;
create policy "pf_collection_drafts_delete_own_or_workspace_admin"
on public.pf_collection_drafts
for delete
using (
  editor_user_id = auth.uid()
  or public.pf_workspace_is_admin(workspace_id, auth.uid())
  or public.pf_is_admin(auth.uid())
);
