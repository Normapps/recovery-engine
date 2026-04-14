-- ============================================================
-- Recovery Engine — Supabase Database Schema
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ──────────────────────────────────────────────────────────────
-- USERS
-- Extends Supabase auth.users with profile data
-- ──────────────────────────────────────────────────────────────
CREATE TABLE public.users (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can only access their own profile"
  ON public.users FOR ALL
  USING (auth.uid() = id);

-- ──────────────────────────────────────────────────────────────
-- COACHING PREFERENCES
-- ──────────────────────────────────────────────────────────────
CREATE TYPE coaching_mode AS ENUM ('hardcore', 'balanced', 'recovery');

CREATE TABLE public.coaching_preferences (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  mode          coaching_mode NOT NULL DEFAULT 'balanced',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.coaching_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own coaching prefs"
  ON public.coaching_preferences FOR ALL
  USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────
-- DAILY ENTRIES
-- Sleep, training, nutrition, modalities for each day
-- ──────────────────────────────────────────────────────────────
CREATE TABLE public.daily_entries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date            DATE NOT NULL,

  -- Sleep / biometrics
  sleep_duration    NUMERIC(4,2),   -- hours, e.g. 7.50
  sleep_quality     SMALLINT CHECK (sleep_quality BETWEEN 1 AND 5),
  hrv               NUMERIC(6,2),   -- ms
  resting_hr        SMALLINT,       -- bpm
  body_battery      SMALLINT CHECK (body_battery BETWEEN 0 AND 100),

  -- Nutrition
  calories          INTEGER,
  protein_g         NUMERIC(6,1),
  hydration_oz      NUMERIC(6,1),
  nutrition_notes   TEXT,

  -- Training
  strength_training   BOOLEAN NOT NULL DEFAULT FALSE,
  strength_duration   INTEGER,  -- minutes
  cardio              BOOLEAN NOT NULL DEFAULT FALSE,
  cardio_duration     INTEGER,  -- minutes
  core_work           BOOLEAN NOT NULL DEFAULT FALSE,
  mobility            BOOLEAN NOT NULL DEFAULT FALSE,

  -- Recovery modalities
  ice_bath        BOOLEAN NOT NULL DEFAULT FALSE,
  sauna           BOOLEAN NOT NULL DEFAULT FALSE,
  compression     BOOLEAN NOT NULL DEFAULT FALSE,
  massage         BOOLEAN NOT NULL DEFAULT FALSE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, date)
);

ALTER TABLE public.daily_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own daily entries"
  ON public.daily_entries FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX idx_daily_entries_user_date ON public.daily_entries (user_id, date DESC);

-- ──────────────────────────────────────────────────────────────
-- RECOVERY SCORES
-- One per user per day; stores both calculated and adjusted
-- ──────────────────────────────────────────────────────────────
CREATE TYPE confidence_level AS ENUM ('Low', 'Medium', 'High');

CREATE TABLE public.recovery_scores (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  daily_entry_id      UUID REFERENCES public.daily_entries(id) ON DELETE CASCADE,
  date                DATE NOT NULL,

  -- Scores
  calculated_score    SMALLINT NOT NULL CHECK (calculated_score BETWEEN 0 AND 100),
  adjusted_score      SMALLINT CHECK (adjusted_score BETWEEN 0 AND 100),

  -- Breakdown subscores (0–100)
  score_sleep         SMALLINT,
  score_hrv           SMALLINT,
  score_training      SMALLINT,
  score_nutrition     SMALLINT,
  score_modalities    SMALLINT,

  -- Metadata
  confidence          confidence_level NOT NULL DEFAULT 'Low',
  data_completeness   NUMERIC(4,3) NOT NULL DEFAULT 0,  -- 0.0–1.0

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, date)
);

ALTER TABLE public.recovery_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own recovery scores"
  ON public.recovery_scores FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX idx_recovery_scores_user_date ON public.recovery_scores (user_id, date DESC);

-- ──────────────────────────────────────────────────────────────
-- BLOODWORK ENTRIES
-- Periodic, not daily — flexible marker schema
-- ──────────────────────────────────────────────────────────────
CREATE TABLE public.bloodwork_entries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date            DATE NOT NULL,

  -- Core markers
  testosterone    NUMERIC(8,2),   -- ng/dL
  vitamin_d       NUMERIC(6,2),   -- ng/mL
  cortisol        NUMERIC(6,2),   -- mcg/dL

  -- Flexible extra markers stored as JSON
  -- e.g. { "ferritin": 85.2, "crp": 0.4, "tsh": 1.8 }
  markers         JSONB NOT NULL DEFAULT '{}',

  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bloodwork_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own bloodwork"
  ON public.bloodwork_entries FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX idx_bloodwork_user_date ON public.bloodwork_entries (user_id, date DESC);
CREATE INDEX idx_bloodwork_markers ON public.bloodwork_entries USING GIN (markers);

-- ──────────────────────────────────────────────────────────────
-- UPDATED_AT TRIGGER (shared function)
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_daily_entries_updated_at
  BEFORE UPDATE ON public.daily_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_recovery_scores_updated_at
  BEFORE UPDATE ON public.recovery_scores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_bloodwork_updated_at
  BEFORE UPDATE ON public.bloodwork_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_coaching_prefs_updated_at
  BEFORE UPDATE ON public.coaching_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
