/**
 * Supabase helpers
 *
 * All DB operations use the shared singleton client from lib/supabaseClient.ts.
 * Do NOT create a second createClient() call here — that causes duplicate
 * GoTrueClient instances and undefined auth behaviour.
 */

import type { PlanTaskItem, TrainingDay, PerformanceProfile } from "./types";
import { supabaseClient } from "./supabaseClient";

/** Re-export the shared client as `supabase` for backwards compatibility. */
export const supabase = supabaseClient;

export const isSupabaseConnected = Boolean(supabase);

/**
 * Persist the athlete's daily psychological readiness rating (1–5).
 *
 * Table: daily_checkins
 * Columns: date (text PK, YYYY-MM-DD), psych_score (integer 1–5)
 *
 * Upserts on `date` so calling this multiple times per day is safe —
 * the latest rating wins. No-ops when Supabase is not configured so
 * the app continues to work in offline/localStorage mode.
 */
export async function upsertDailyCheckin(
  date:       string,
  psychScore: number,
): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("daily_checkins")
    .upsert({ date, psych_score: psychScore }, { onConflict: "date" });
}

/**
 * Persist the athlete's daily task completion state.
 *
 * Table: daily_tasks
 * Columns:
 *   date                 text    PK (YYYY-MM-DD)
 *   training_completed   boolean
 *   recovery_completed   boolean
 *   nutrition_completed  boolean
 *   rehab_completed      boolean
 *
 * Upserts on `date` — safe to call on every toggle.
 * No-ops when Supabase is not configured (offline / localStorage mode).
 *
 * SQL to create the table:
 *   create table daily_tasks (
 *     date                 text primary key,
 *     training_completed   boolean default false,
 *     recovery_completed   boolean default false,
 *     nutrition_completed  boolean default false,
 *     rehab_completed      boolean default false
 *   );
 */
export async function upsertTaskCompletion(
  date:                string,
  training_completed:  boolean,
  recovery_completed:  boolean,
  nutrition_completed: boolean,
  rehab_completed:     boolean,
): Promise<void> {
  if (!supabase) return;
  await supabase.from("daily_tasks").upsert(
    { date, training_completed, recovery_completed, nutrition_completed, rehab_completed },
    { onConflict: "date" },
  );
}

/**
 * Persist the athlete's per-instruction plan task checklist for a given day.
 *
 * Table: plan_tasks
 * Columns: date (text PK, YYYY-MM-DD), tasks (jsonb — PlanTaskItem[])
 *
 * SQL to create the table:
 *   create table plan_tasks (
 *     date  text primary key,
 *     tasks jsonb not null default '[]'
 *   );
 *
 * Upserts on `date` — safe to call on every toggle.
 * No-ops when Supabase is not configured (offline / localStorage mode).
 */
export async function upsertPlanTasks(
  date:  string,
  tasks: PlanTaskItem[],
): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("plan_tasks")
    .upsert({ date, tasks }, { onConflict: "date" });
}

/**
 * Persist a parsed training plan after PDF upload.
 *
 * Table: training_plans
 * Columns:
 *   id          uuid primary key default gen_random_uuid()
 *   user_id     text (null until auth is wired)
 *   sport       text
 *   schedule    jsonb  (TrainingDay[])
 *   created_at  timestamptz default now()
 *
 * SQL to create the table:
 *   create table training_plans (
 *     id         uuid primary key default gen_random_uuid(),
 *     user_id    text,
 *     sport      text not null,
 *     schedule   jsonb not null default '[]',
 *     created_at timestamptz default now()
 *   );
 *
 * No-ops when Supabase is not configured (offline / localStorage mode).
 */
/**
 * Save the athlete's full performance profile to Supabase.
 * Upserts on user_id so re-saves overwrite safely.
 * No-ops when Supabase is not configured (offline mode).
 */
export async function upsertPerformanceProfile(
  userId: string,
  profile: PerformanceProfile,
): Promise<{ error?: string }> {
  if (!supabase) return {};
  const { error } = await supabase
    .from("performance_profiles")
    .upsert(
      {
        user_id:                userId,
        primary_goal:           profile.primaryGoal,
        training_focus:         profile.trainingFocus   ?? null,
        priority:               profile.priority        ?? null,
        position:               profile.position        ?? null,
        event_date:             profile.eventDate       ?? null,
        age:                    profile.age             ?? null,
        sex:                    profile.sex             ?? null,
        height_in:              profile.heightIn        ?? null,
        body_weight_lbs:        profile.bodyWeightLbs   ?? null,
        experience_level:       profile.experienceLevel ?? null,
        weekly_hours:           profile.weeklyHours     ?? null,
        training_days_per_week: profile.trainingDaysPerWeek ?? null,
        training_intensity:     profile.trainingIntensity   ?? null,
        injury_active:          profile.injuryActive    ?? false,
        injury_body_part:       profile.injuryBodyPart  ?? null,
        injury_severity:        profile.injurySeverity  ?? null,
        injury_notes:           profile.injuryNotes     ?? null,
        event_training:         profile.eventTraining   ?? false,
        event_type:             profile.eventType       ?? null,
        event_importance:       profile.eventImportance ?? null,
      },
      { onConflict: "user_id" },
    );
  return error ? { error: error.message } : {};
}

/**
 * Persist a daily entry to Supabase (daily_entries table).
 *
 * Maps the frontend DailyEntry shape → snake_case DB columns.
 * Requires a valid user_id (UUID from the users table) — no-ops in
 * offline/localStorage mode when Supabase is not configured.
 *
 * NOTE: user_id must be a real UUID linked to a users row due to FK.
 * Wire Supabase Auth first; until then, call this only when auth is present.
 *
 * Table: daily_entries
 * Conflict key: (user_id, date)
 *
 * SQL to add missing feel columns (run migration 004):
 *   alter table public.daily_entries
 *     add column if not exists soreness     smallint check (soreness between 1 and 5),
 *     add column if not exists energy_level smallint check (energy_level between 1 and 5);
 */
export async function upsertDailyEntry(
  userId: string,
  entry:  import("./types").DailyEntry,
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("daily_entries").upsert(
    {
      user_id:              userId,
      date:                 entry.date,
      // Sleep / HRV
      sleep_duration:       entry.sleep.duration       ?? null,
      sleep_quality_rating: entry.sleep.qualityRating  ?? null,
      hrv:                  entry.sleep.hrv            ?? null,
      resting_hr:           entry.sleep.restingHR      ?? null,
      body_battery:         entry.sleep.bodyBattery    ?? null,
      // Nutrition
      calories:             entry.nutrition.calories   ?? null,
      protein_g:            entry.nutrition.protein    ?? null,
      hydration_oz:         entry.nutrition.hydration  ?? null,
      nutrition_notes:      entry.nutrition.notes      ?? null,
      // Training
      strength_training:    entry.training.strengthTraining ?? false,
      strength_duration:    entry.training.strengthDuration ?? null,
      cardio:               entry.training.cardio           ?? false,
      cardio_duration:      entry.training.cardioDuration   ?? null,
      core_work:            entry.training.coreWork         ?? false,
      mobility:             entry.training.mobility         ?? false,
      // Recovery modalities
      ice_bath:             entry.recovery?.iceBath     ?? false,
      sauna:                entry.recovery?.sauna       ?? false,
      compression:          entry.recovery?.compression ?? false,
      massage:              entry.recovery?.massage     ?? false,
      // Feel inputs (migration 004)
      soreness:             entry.soreness     ?? null,
      energy_level:         entry.energyLevel  ?? null,
    },
    { onConflict: "user_id,date" },
  );
  if (error) console.error("[supabase] upsertDailyEntry error:", error.message);
}

export async function upsertTrainingPlan(payload: {
  user_id:    string | null;
  sport:      string;
  schedule:   TrainingDay[];
  created_at: string;
}): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("training_plans").insert(payload);
  if (error) console.error("[supabase] upsertTrainingPlan error:", error.message);
}
