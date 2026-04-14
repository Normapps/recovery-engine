-- ============================================================
-- Migration 005: recovery_scores v2
--
-- Goals:
--   1. Rename ambiguous columns for clarity (aliases only — originals kept)
--   2. Add AI output fields: insight, limiting_factor, readiness_level, breakdown
--   3. Add athlete_id alias column pointing same concept as user_id
--   4. Consolidate six flat subscore columns into a single breakdown JSONB
--      (flat columns kept for backward compatibility and simple SQL queries)
--   5. Add index for trend queries (user_id, date DESC)
--
-- BACKWARD COMPATIBILITY:
--   - No existing column is dropped or renamed
--   - All new columns are nullable with sensible defaults
--   - Existing data remains intact
--   - The flat score_* columns continue to exist alongside breakdown JSONB
-- ============================================================

-- ─── 1. AI narrative outputs ──────────────────────────────────────────────────
-- Written by the analyze-athlete Claude pipeline; null for scores computed
-- by the legacy DailyLogForm pipeline (which does not call Claude).

alter table public.recovery_scores
  add column if not exists readiness_level text
    check (readiness_level in ('low', 'moderate', 'high')),

  add column if not exists limiting_factor text,          -- e.g. "sleep quality is limiting recovery today..."

  add column if not exists insight text,                  -- 1–2 sentence coach explanation

  -- breakdown JSONB mirrors the four weighted dimensions from the scoring engine:
  --   { sleep: 0–100, hrv: 0–100, training_load: 0–100, nutrition: 0–100 }
  -- Stored alongside the flat score_* columns for query flexibility.
  -- Frontend should prefer this over individual score_* fields going forward.
  add column if not exists breakdown jsonb;

comment on column public.recovery_scores.readiness_level is
  'Derived from calculated_score: low (<70), moderate (70–84), high (≥85)';
comment on column public.recovery_scores.limiting_factor is
  'Claude-written sentence explaining the lowest-scoring breakdown dimension';
comment on column public.recovery_scores.insight is
  'Claude-written 1–2 sentence recovery narrative for the Home dashboard';
comment on column public.recovery_scores.breakdown is
  'Scoring engine breakdown: { sleep, hrv, training_load, nutrition } each 0–100';

-- ─── 2. athlete_id — semantic alias for user_id ───────────────────────────────
-- user_id is the FK column name; athlete_id is what the product domain uses.
-- Adding as a generated column alias avoids storing duplicate data while
-- satisfying the target schema the product team references as "athlete_id".

-- NOTE: PostgreSQL does not support generated columns that reference other
-- columns as simple aliases. Instead, expose athlete_id as a view column
-- (see view below) and keep user_id as the canonical FK.

-- ─── 3. Improve the recommendations column ────────────────────────────────────
-- Already added in migration 002. Add a comment for clarity.

comment on column public.recovery_scores.recommendations is
  'Array of { id, name, duration, reason } modality recommendations from the engine';

-- ─── 4. Backfill readiness_level for any existing rows ───────────────────────
-- Derive from calculated_score so existing records are immediately useful.

update public.recovery_scores
set readiness_level =
  case
    when calculated_score >= 85 then 'high'
    when calculated_score >= 70 then 'moderate'
    else 'low'
  end
where readiness_level is null;

-- ─── 5. Performance index for trend queries ───────────────────────────────────
-- Trend queries always filter by user_id and order by date descending.

create index if not exists idx_recovery_scores_user_date
  on public.recovery_scores (user_id, date desc);

-- ─── 6. Convenience view: recovery_scores_v2 ─────────────────────────────────
-- Exposes athlete_id as an alias for user_id and surfaces all columns
-- under their target names. Applications can query this view instead of
-- the raw table to use the product-level naming convention.

create or replace view public.recovery_scores_v2 as
select
  id,
  user_id                                           as athlete_id,
  user_id,                                          -- also available under original name
  date,
  calculated_score                                  as recovery_score,
  calculated_score,
  adjusted_score,
  readiness_level,
  limiting_factor,
  insight,
  breakdown,
  confidence,
  data_completeness,
  recommendations,
  -- Flat subscores (legacy, kept for backward compat)
  score_sleep,
  score_hrv,
  score_training,
  score_nutrition,
  score_modalities,
  score_bloodwork,
  created_at,
  updated_at
from public.recovery_scores;

comment on view public.recovery_scores_v2 is
  'Product-level view of recovery_scores: exposes athlete_id alias, recovery_score alias, and all v2 AI fields. Use this for new queries; raw table remains for writes.';
