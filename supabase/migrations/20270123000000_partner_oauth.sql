-- Partner apps (e.g. indoor-cycling games) connect to a rider's account through our own OAuth 2.0 provider.
-- Secrets and tokens are stored hashed (SHA-256); these tables are only reachable with the service role
-- except that owners may read their apps and riders may read/revoke their own grants.

create table if not exists public.developer_apps (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  description text,
  homepage_url text,
  logo_url text,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}$'),
  client_id text not null unique,
  client_secret_hash text,
  redirect_uris text[] not null default '{}',
  scopes text[] not null default '{activities:write}',
  status text not null default 'pending' check (status in ('pending','approved','suspended')),
  rate_limit_per_min integer not null default 60,
  rate_limit_per_day integer not null default 500,
  created_at timestamptz not null default now()
);

create table if not exists public.oauth_authorization_codes (
  code_hash text primary key,
  app_id uuid not null references public.developer_apps(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_uri text not null,
  scopes text[] not null,
  code_challenge text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.oauth_grants (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  app_id uuid not null references public.developer_apps(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scopes text[] not null,
  access_token_hash text not null unique,
  access_expires_at timestamptz not null,
  refresh_token_hash text not null unique,
  refresh_expires_at timestamptz not null,
  rotated_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists oauth_grants_user_idx on public.oauth_grants (user_id) where revoked_at is null;
create index if not exists oauth_grants_family_idx on public.oauth_grants (family_id);

create table if not exists public.partner_audit_log (
  id bigint generated always as identity primary key,
  app_id uuid references public.developer_apps(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  event text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.developer_apps enable row level security;
alter table public.oauth_authorization_codes enable row level security;
alter table public.oauth_grants enable row level security;
alter table public.partner_audit_log enable row level security;

drop policy if exists developer_apps_owner_read on public.developer_apps;
create policy developer_apps_owner_read on public.developer_apps for select using (owner_user_id = auth.uid());

drop policy if exists oauth_grants_rider_read on public.oauth_grants;
create policy oauth_grants_rider_read on public.oauth_grants for select using (user_id = auth.uid());

-- Riders see which apps are connected without ever seeing token hashes.
revoke all on public.oauth_grants from anon, authenticated;
grant select (id, family_id, app_id, user_id, scopes, revoked_at, last_used_at, created_at) on public.oauth_grants to authenticated;
revoke all on public.developer_apps from anon, authenticated;
grant select (id, owner_user_id, name, description, homepage_url, logo_url, slug, client_id, redirect_uris, scopes, status, created_at) on public.developer_apps to authenticated;
