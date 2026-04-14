-- ============================================================
-- 009 — Device Connections
-- Project: aqqvreopgqsfykfhuaot
--
-- Stores OAuth credentials and sync state for each connected
-- wearable, health platform, training app, or nutrition app.
-- One row per (user, provider) pair.
-- ============================================================

create table if not exists public.device_connections (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references public.users(id) on delete cascade,
  provider      text        not null,                      -- e.g. 'whoop', 'garmin'
  is_connected  boolean     not null default false,
  access_token  text,                                      -- encrypted in prod
  refresh_token text,                                      -- encrypted in prod
  last_sync     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (user_id, provider)
);

create index if not exists device_connections_user_id
  on public.device_connections (user_id);

-- Auto-update updated_at
do $$ begin
  create trigger trg_device_connections_updated_at
    before update on public.device_connections
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

-- RLS: each user can only see/edit their own connections
alter table public.device_connections enable row level security;

create policy "device_connections: own rows"
  on public.device_connections
  for all
  using  (user_id in (select id from public.users where auth_id = auth.uid()))
  with check (user_id in (select id from public.users where auth_id = auth.uid()));
