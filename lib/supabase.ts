/**
 * Supabase client
 *
 * Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
 * in your .env.local to connect. The app works in offline/localStorage
 * mode without these values.
 */

import { createClient } from "@supabase/supabase-js";

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
