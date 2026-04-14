-- ============================================================
-- Synergy Recovery — Initial Schema
-- Project: aqqvreopgqsfykfhuaot
-- ============================================================

-- ─── EXTENSIONS ──────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ─── 1. USERS ────────────────────────────────────────────────────────────────
-- Extends Supabase auth.users with app-level profile data.
create table if not exists public.users (
  id              uuid primary key default gen_random_uuid(),
  auth_id         uuid unique,                          -- links to auth.users.id
  display_name    text,
  email           text unique,
  coach_mode      text not null default 'balanced'
                    check (coach_mode in ('hardcore','balanced','recovery')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─── 2. PERFORMANCE PROFILES ─────────────────────────────────────────────────
create table if not exists public.performance_profiles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.users(id) on delete cascade,
  primary_goal    text not null,
  training_focus  text check (training_focus in ('Endurance','Strength','Hybrid')),
  priority        text check (priority in ('Performance','Recovery','Longevity')),
  event_date      date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─── 3. DAILY ENTRIES ────────────────────────────────────────────────────────
-- Core daily log: sleep, nutrition, training, recovery modalities.
create table if not exists public.daily_entries (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references public.users(id) on delete cascade,
  date                  date not null,

  -- Sleep
  sleep_duration        numeric(4,1),                  -- hours
  sleep_quality_rating  smallint check (sleep_quality_rating between 1 and 5),
  hrv                   numeric(6,1),                  -- ms
  resting_hr            smallint,                      -- bpm
  body_battery          smallint check (body_battery between 0 and 100),

  -- Nutrition
  calories              integer,
  protein_g             numeric(6,1),
  hydration_oz          numeric(6,1),
  nutrition_notes       text,

  -- Training
  strength_training     boolean not null default false,
  strength_duration     smallint,                      -- minutes
  cardio                boolean not null default false,
  cardio_duration       smallint,                      -- minutes
  core_work             boolean not null default false,
  mobility              boolean not null default false,

  -- Recovery modalities
  ice_bath              boolean not null default false,
  sauna                 boolean not null default false,
  compression           boolean not null default false,
  massage               boolean not null default false,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (user_id, date)
);

-- ─── 4. RECOVERY SCORES ──────────────────────────────────────────────────────
create table if not exists public.recovery_scores (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references public.users(id) on delete cascade,
  date                date not null,

  calculated_score    smallint not null check (calculated_score between 0 and 100),
  adjusted_score      smallint check (adjusted_score between 0 and 100),
  confidence          text not null check (confidence in ('Low','Medium','High')),
  data_completeness   numeric(4,3) check (data_completeness between 0 and 1),

  -- Subscores (0–100 each)
  score_sleep         smallint check (score_sleep between 0 and 100),
  score_hrv           smallint check (score_hrv between 0 and 100),
  score_training      smallint check (score_training between 0 and 100),
  score_nutrition     smallint check (score_nutrition between 0 and 100),
  score_modalities    smallint check (score_modalities between 0 and 100),
  score_bloodwork     smallint check (score_bloodwork between 0 and 100),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (user_id, date)
);

-- ─── 5. BLOODWORK ENTRIES ────────────────────────────────────────────────────
-- The panel has 130+ biomarkers — stored as JSONB for flexibility.
create table if not exists public.bloodwork_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users(id) on delete cascade,
  date        date not null,
  lab_name    text,
  panel       jsonb not null default '{}'::jsonb,      -- BloodworkPanel
  notes       text,
  created_at  timestamptz not null default now()
);

create index if not exists bloodwork_entries_user_date
  on public.bloodwork_entries (user_id, date desc);

-- ─── 6. TRAINING PLANS ───────────────────────────────────────────────────────
create table if not exists public.training_plans (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.users(id) on delete cascade,
  name            text not null,
  sport           text,
  weekly_schedule jsonb not null default '[]'::jsonb,  -- TrainingDay[]
  raw_input       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─── 7. DAILY CHECKINS (mood / psych score) ──────────────────────────────────
create table if not exists public.daily_checkins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users(id) on delete cascade,
  date        date not null,
  psych_score smallint not null check (psych_score between 1 and 5),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (user_id, date)
);

-- ─── 8. DAILY TASKS ──────────────────────────────────────────────────────────
create table if not exists public.daily_tasks (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid references public.users(id) on delete cascade,
  date                 date not null,
  training_completed   boolean not null default false,
  recovery_completed   boolean not null default false,
  nutrition_completed  boolean not null default false,
  rehab_completed      boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (user_id, date)
);

-- ─── 9. PLAN TASKS ───────────────────────────────────────────────────────────
-- Per-instruction checklist items generated from the training plan.
create table if not exists public.plan_tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users(id) on delete cascade,
  date        date not null,
  tasks       jsonb not null default '[]'::jsonb,       -- PlanTaskItem[]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (user_id, date)
);

-- ─── UPDATED_AT TRIGGER ──────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  create trigger trg_users_updated_at
    before update on public.users
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_performance_profiles_updated_at
    before update on public.performance_profiles
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_daily_entries_updated_at
    before update on public.daily_entries
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_recovery_scores_updated_at
    before update on public.recovery_scores
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_daily_checkins_updated_at
    before update on public.daily_checkins
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_daily_tasks_updated_at
    before update on public.daily_tasks
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_plan_tasks_updated_at
    before update on public.plan_tasks
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────────────────────
alter table public.users               enable row level security;
alter table public.performance_profiles enable row level security;
alter table public.daily_entries       enable row level security;
alter table public.recovery_scores     enable row level security;
alter table public.bloodwork_entries   enable row level security;
alter table public.training_plans      enable row level security;
alter table public.daily_checkins      enable row level security;
alter table public.daily_tasks         enable row level security;
alter table public.plan_tasks          enable row level security;

-- Policies: each user can only read/write their own rows.
-- (Expand these when multi-coach / team features are added.)

create policy "users: own row" on public.users
  for all using (auth.uid() = auth_id);

create policy "performance_profiles: own rows" on public.performance_profiles
  for all using (user_id in (select id from public.users where auth_id = auth.uid()));

create policy "daily_entries: own rows" on public.daily_entries
  for all using (user_id in (select id from public.users where auth_id = auth.uid()));

create policy "recovery_scores: own rows" on public.recovery_scores
  for all using (user_id in (select id from public.users where auth_id = auth.uid()));

create policy "bloodwork_entries: own rows" on public.bloodwork_entries
  for all using (user_id in (select id from public.users where auth_id = auth.uid()));

create policy "training_plans: own rows" on public.training_plans
  for all using (user_id in (select id from public.users where auth_id = auth.uid()));

create policy "daily_checkins: own rows" on public.daily_checkins
  for all using (user_id in (select id from public.users where auth_id = auth.uid()));

create policy "daily_tasks: own rows" on public.daily_tasks
  for all using (user_id in (select id from public.users where auth_id = auth.uid()));

create policy "plan_tasks: own rows" on public.plan_tasks
  for all using (user_id in (select id from public.users where auth_id = auth.uid()));
