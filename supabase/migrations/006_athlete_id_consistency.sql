-- ============================================================
-- Migration 006: athlete_id key consistency
--
-- AUDIT FINDINGS:
--   1. All existing tables use user_id → public.users(id)  (consistent)
--   2. No physical athlete_id column exists anywhere yet
--   3. recovery_scores_v2 VIEW (migration 005) introduced athlete_id alias
--   4. injuries / events do not exist as standalone tables
--   5. daily_metrics is the product name for the physical daily_entries table
--
-- STRATEGY:
--   - EXISTING tables: add views that expose athlete_id alias.
--     Physical user_id columns are NOT renamed (would require dropping FK
--     constraints, unique constraints, RLS policies, and all app code changes).
--   - NEW tables (injuries, events): use athlete_id as the FK column name
--     from day one — clean canonical naming for net-new tables.
--   - VIEWS: all surface athlete_id so queries can be written consistently.
--
-- NAMING CONVENTION GOING FORWARD:
--   Physical FK column in existing tables → user_id  (backward compat)
--   Physical FK column in new tables      → athlete_id
--   All views                             → expose both athlete_id + user_id
-- ============================================================

-- ─── 1. athletes — canonical domain view over users ───────────────────────────
-- "Athlete" is the product-domain concept; "user" is the auth/infra concept.
-- Code that thinks in athlete terms can query this view.

create or replace view public.athletes as
select
  id              as athlete_id,      -- canonical app identifier
  id              as user_id,         -- same UUID, auth-layer name preserved
  auth_id,                            -- links to auth.users.id (Supabase Auth)
  display_name,
  email,
  coach_mode,
  created_at,
  updated_at
from public.users;

comment on view public.athletes is
  'Domain view of users: exposes athlete_id alias for the app-level primary key. '
  'Use this in product queries; write to public.users directly.';

-- ─── 2. performance_profiles — add athlete_id alias view ─────────────────────

create or replace view public.performance_profiles_v as
select
  id,
  user_id                   as athlete_id,
  user_id,
  primary_goal,
  training_focus,
  priority,
  event_date,
  -- migration 003 columns
  age,
  sex,
  height_in,
  body_weight_lbs,
  experience_level,
  position,
  weekly_hours,
  training_days_per_week,
  training_intensity,
  -- injury flags (inline — standalone injuries table created below)
  injury_active,
  injury_body_part,
  injury_severity,
  injury_notes,
  -- event flags (inline — standalone events table created below)
  event_training,
  event_type,
  event_importance,
  created_at,
  updated_at
from public.performance_profiles;

comment on view public.performance_profiles_v is
  'performance_profiles with athlete_id alias for user_id. Use for reads; write to base table.';

-- ─── 3. daily_metrics — alias view for daily_entries ─────────────────────────
-- Product calls this "daily_metrics"; DB table is "daily_entries".
-- View resolves the naming gap without any data migration.

create or replace view public.daily_metrics as
select
  id,
  user_id                   as athlete_id,
  user_id,
  date,
  -- Sleep / recovery signals
  sleep_duration,
  sleep_quality_rating,
  hrv,
  resting_hr,
  body_battery,
  -- Nutrition
  calories,
  protein_g,
  hydration_oz,
  nutrition_notes,
  -- Training
  strength_training,
  strength_duration,
  cardio,
  cardio_duration,
  core_work,
  mobility,
  -- Recovery modalities
  ice_bath,
  sauna,
  compression,
  massage,
  -- Subjective feel (migration 004)
  soreness,
  energy_level,
  created_at,
  updated_at
from public.daily_entries;

comment on view public.daily_metrics is
  'Product-level alias for daily_entries: exposes athlete_id and uses the product name "daily_metrics". '
  'Writes must go to public.daily_entries directly (views are not updatable here due to the rename).';

-- ─── 4. injuries — standalone table ──────────────────────────────────────────
-- Injuries embedded in performance_profiles (migration 003) can only hold ONE
-- active injury and no history. A standalone table enables:
--   • Multiple concurrent injuries
--   • Injury history / resolved injuries
--   • Per-injury severity progression
--
-- Uses athlete_id as the FK column (new naming convention for new tables).

create table if not exists public.injuries (
  id              uuid primary key default gen_random_uuid(),
  athlete_id      uuid not null references public.users(id) on delete cascade,

  body_part       text not null,          -- e.g. "Left knee", "Lower back"
  injury_type     text,                   -- e.g. "Strain", "Tendinopathy", "Fracture"
  severity        smallint not null check (severity between 1 and 5),
                                          -- 1=Minimal 2=Mild 3=Moderate 4=Significant 5=Severe
  status          text not null default 'active'
                    check (status in ('active','monitoring','resolved')),

  onset_date      date,                   -- when the injury was first noticed
  resolved_date   date,                   -- null until resolved

  notes           text,                   -- coach/athlete notes
  clearance_note  text,                   -- medical clearance note when resolved

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_injuries_athlete_status
  on public.injuries (athlete_id, status);

comment on table  public.injuries                 is 'Full injury history per athlete. Supersedes injury_* columns in performance_profiles.';
comment on column public.injuries.athlete_id      is 'FK → public.users(id). Called athlete_id here; same UUID as user_id elsewhere.';
comment on column public.injuries.severity        is '1=Minimal 2=Mild 3=Moderate 4=Significant 5=Severe';
comment on column public.injuries.status          is 'active | monitoring | resolved';

-- updated_at trigger for injuries
do $$ begin
  create trigger trg_injuries_updated_at
    before update on public.injuries
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

-- RLS
alter table public.injuries enable row level security;

create policy "injuries: own rows" on public.injuries
  for all using (
    athlete_id in (select id from public.users where auth_id = auth.uid())
  );

-- ─── 5. events — standalone table ────────────────────────────────────────────
-- Events embedded in performance_profiles (migration 003 + event_date in 001)
-- only support ONE target event. A standalone table enables:
--   • A race calendar with multiple events per season
--   • A-/B-/C-priority race hierarchy
--   • Past-event history for trend context
--
-- Uses athlete_id as the FK column (new naming convention for new tables).

create table if not exists public.events (
  id              uuid primary key default gen_random_uuid(),
  athlete_id      uuid not null references public.users(id) on delete cascade,

  name            text not null,          -- e.g. "Ironman 70.3 Oceanside"
  event_type      text,                   -- e.g. "Triathlon", "Marathon", "Powerlifting"
  event_date      date not null,

  priority        text not null default 'B'
                    check (priority in ('A','B','C')),
                                          -- A=Peak race, B=Tune-up, C=Training race
  location        text,
  distance        text,                   -- e.g. "70.3 miles", "26.2 miles"
  notes           text,

  -- Outcome (filled after the event)
  completed       boolean not null default false,
  result_notes    text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_events_athlete_date
  on public.events (athlete_id, event_date);

comment on table  public.events              is 'Race / event calendar per athlete. Supersedes event_* columns in performance_profiles.';
comment on column public.events.athlete_id   is 'FK → public.users(id). Called athlete_id here; same UUID as user_id elsewhere.';
comment on column public.events.priority     is 'A=Peak/goal race  B=Tune-up  C=Training race';

-- updated_at trigger for events
do $$ begin
  create trigger trg_events_updated_at
    before update on public.events
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

-- RLS
alter table public.events enable row level security;

create policy "events: own rows" on public.events
  for all using (
    athlete_id in (select id from public.users where auth_id = auth.uid())
  );

-- ─── 6. Convenience summary: all athlete-scoped table/view names ──────────────
--
-- WRITES (use these for INSERT / UPDATE / DELETE / UPSERT):
--   public.users                  → identity / auth link
--   public.performance_profiles   → athlete profile + inline injury/event fields
--   public.daily_entries          → daily log (all FK columns named user_id)
--   public.recovery_scores        → computed scores (all FK columns named user_id)
--   public.injuries               → injury history (FK column named athlete_id)
--   public.events                 → race calendar  (FK column named athlete_id)
--
-- READS (prefer these views for consistent athlete_id naming):
--   public.athletes               → users with athlete_id alias
--   public.performance_profiles_v → profiles with athlete_id alias
--   public.daily_metrics          → daily_entries with athlete_id alias
--   public.recovery_scores_v2     → scores with athlete_id + recovery_score aliases (migration 005)
--   public.injuries               → native athlete_id column
--   public.events                 → native athlete_id column
