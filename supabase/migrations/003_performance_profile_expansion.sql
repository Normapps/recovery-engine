-- ============================================================
-- Migration 003: Expand performance_profiles
-- Adds athlete demographics, training load, injury, and event fields
-- ============================================================

alter table public.performance_profiles
  add column if not exists age               smallint,
  add column if not exists sex               text check (sex in ('male','female','other')),
  add column if not exists height_in         numeric(5,1),      -- inches
  add column if not exists body_weight_lbs   numeric(6,1),
  add column if not exists experience_level  text check (experience_level in ('beginner','intermediate','advanced')),
  add column if not exists position          text,              -- e.g. "Midfielder", "Open Water"
  add column if not exists weekly_hours      numeric(4,1),
  add column if not exists training_days_per_week smallint check (training_days_per_week between 1 and 7),
  add column if not exists training_intensity text check (training_intensity in ('low','moderate','high')),
  -- Injury
  add column if not exists injury_active     boolean not null default false,
  add column if not exists injury_body_part  text,
  add column if not exists injury_severity   smallint check (injury_severity between 1 and 5),
  add column if not exists injury_notes      text,
  -- Event
  add column if not exists event_training    boolean not null default false,
  add column if not exists event_type        text,              -- e.g. "Ironman 70.3"
  add column if not exists event_importance  text check (event_importance in ('A','B','C'));
