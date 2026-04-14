-- ============================================================
-- Migration 004: add soreness + energy_level to daily_entries
--
-- These fields were added to the DailyEntry TypeScript type and
-- DailyLogForm UI but were never persisted to the database.
-- Both columns are nullable (not logged = NULL, not zero).
-- ============================================================

alter table public.daily_entries
  add column if not exists soreness     smallint check (soreness     between 1 and 5),
  add column if not exists energy_level smallint check (energy_level between 1 and 5);

comment on column public.daily_entries.soreness     is 'Perceived muscle soreness: 1=None 2=Mild 3=Moderate 4=Significant 5=Severe';
comment on column public.daily_entries.energy_level is 'Subjective energy: 1=Depleted 2=Low 3=Moderate 4=Good 5=Excellent';
