/**
 * fetchAthleteContext
 *
 * Fetches performance_profiles and today's daily_entries for a given user
 * and returns them as a single combined object.
 *
 * Returns { profile, metrics } where either field may be null if the data
 * has not been saved yet. Never throws — all errors are returned inline.
 */

import { supabaseClient } from "@/lib/supabaseClient";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** All columns from performance_profiles (includes migration 003 expansion). */
export interface ProfileData {
  id:                     string;
  user_id:                string;
  // Core
  primary_goal:           string | null;
  training_focus:         string | null;
  priority:               string | null;
  event_date:             string | null;
  // Demographics (migration 003)
  age:                    number | null;
  sex:                    "male" | "female" | "other" | null;
  height_in:              number | null;
  body_weight_lbs:        number | null;
  experience_level:       "beginner" | "intermediate" | "advanced" | null;
  position:               string | null;
  // Training load (migration 003)
  weekly_hours:           number | null;
  training_days_per_week: number | null;
  training_intensity:     "low" | "moderate" | "high" | null;
  // Injury (migration 003)
  injury_active:          boolean;
  injury_body_part:       string | null;
  injury_severity:        number | null;
  injury_notes:           string | null;
  // Event (migration 003)
  event_training:         boolean;
  event_type:             string | null;
  event_importance:       "A" | "B" | "C" | null;
  // Timestamps
  created_at:             string;
  updated_at:             string;
}

/** All columns from daily_entries for a single day. */
export interface MetricsData {
  id:                   string;
  user_id:              string;
  date:                 string;
  // Sleep / HRV
  sleep_duration:       number | null;   // hours
  sleep_quality_rating: number | null;   // 1–5
  hrv:                  number | null;   // ms
  resting_hr:           number | null;   // bpm
  body_battery:         number | null;   // 0–100
  // Nutrition
  calories:             number | null;
  protein_g:            number | null;
  hydration_oz:         number | null;
  nutrition_notes:      string | null;
  // Training
  strength_training:    boolean;
  strength_duration:    number | null;   // minutes
  cardio:               boolean;
  cardio_duration:      number | null;   // minutes
  core_work:            boolean;
  mobility:             boolean;
  // Recovery modalities
  ice_bath:             boolean;
  sauna:                boolean;
  compression:          boolean;
  massage:              boolean;
  // Timestamps
  created_at:           string;
  updated_at:           string;
}

export interface AthleteContext {
  profile: ProfileData | null;
  metrics: MetricsData | null;
}

export interface AthleteContextError {
  code:    string;
  message: string;
}

export type AthleteContextResult =
  | { success: true;  data:  AthleteContext      }
  | { success: false; error: AthleteContextError };

// ─── Main function ─────────────────────────────────────────────────────────────

/**
 * Fetch the athlete's performance profile and today's daily entry.
 *
 * @param userId - UUID from the `users` table
 * @param date   - ISO date string YYYY-MM-DD (defaults to today)
 *
 * @returns AthleteContextResult — always resolves, never throws.
 *
 * @example
 *   const result = await fetchAthleteContext("uuid", "2026-04-12");
 *   if (!result.success) return console.error(result.error.message);
 *   const { profile, metrics } = result.data;
 */
export async function fetchAthleteContext(
  userId: string,
  date:   string = new Date().toISOString().slice(0, 10),
): Promise<AthleteContextResult> {
  if (!supabaseClient) {
    return {
      success: false,
      error: { code: "CLIENT_UNAVAILABLE", message: "Supabase is not configured." },
    };
  }

  if (!userId?.trim()) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "userId is required." },
    };
  }

  // Fetch both tables concurrently — neither depends on the other.
  const [profileResult, metricsResult] = await Promise.all([
    supabaseClient
      .from("performance_profiles")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabaseClient
      .from("daily_entries")
      .select("*")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle(),
  ]);

  // A DB error on either query is a hard failure.
  if (profileResult.error) {
    return {
      success: false,
      error: {
        code:    profileResult.error.code ?? "PROFILE_FETCH_ERROR",
        message: profileResult.error.message,
      },
    };
  }

  if (metricsResult.error) {
    return {
      success: false,
      error: {
        code:    metricsResult.error.code ?? "METRICS_FETCH_ERROR",
        message: metricsResult.error.message,
      },
    };
  }

  // Both fields may be null — that is not an error.
  return {
    success: true,
    data: {
      profile: (profileResult.data as ProfileData | null) ?? null,
      metrics: (metricsResult.data as MetricsData | null) ?? null,
    },
  };
}
