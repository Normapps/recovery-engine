/**
 * Supabase client
 *
 * Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
 * in your .env.local to connect. The app works in offline/localStorage
 * mode without these values.
 */

import { createClient } from "@supabase/supabase-js";
import type { PlanTaskItem, TrainingDay, PerformanceProfile } from "./types";

const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL     ?? process.env.SUPABASE_URL     ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

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
