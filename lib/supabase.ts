/**
 * Supabase client
 *
 * Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
 * in your .env.local to connect. The app works in offline/localStorage
 * mode without these values.
 */

import { createClient } from "@supabase/supabase-js";
import type { PlanTaskItem } from "./types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

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
