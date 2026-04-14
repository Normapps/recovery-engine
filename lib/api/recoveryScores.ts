/**
 * Recovery Score API
 *
 * insertRecoveryScore  — write a new score record for a given day
 * updateAthleteProfile — update display name, email, or coach mode on the users table
 *
 * Both functions:
 *   - Are async
 *   - Never throw — return a discriminated union { success, data | error }
 *   - Validate inputs before hitting the database
 */

import { supabaseClient } from "@/lib/supabaseClient";
import type { ModalityRecommendation } from "@/lib/modality-recommendations";

// ─── Shared result types ──────────────────────────────────────────────────────

export interface ApiError {
  code:    string;
  message: string;
}

export type ApiResult<T> =
  | { success: true;  data:  T        }
  | { success: false; error: ApiError };

function dbError(e: { code?: string; message: string }): ApiResult<never> {
  return { success: false, error: { code: e.code ?? "DB_ERROR", message: e.message } };
}

function inputError(message: string): ApiResult<never> {
  return { success: false, error: { code: "INVALID_INPUT", message } };
}

function noClient(): ApiResult<never> {
  return { success: false, error: { code: "CLIENT_UNAVAILABLE", message: "Supabase is not configured." } };
}

// ─── 1. INSERT RECOVERY SCORE ─────────────────────────────────────────────────

export interface InsertRecoveryScoreInput {
  user_id:         string;
  date:            string;           // YYYY-MM-DD
  score:           number;           // 0–100  → stored as calculated_score
  recommendations: ModalityRecommendation[];

  // Optional — subscores and metadata
  adjusted_score?:     number | null;
  confidence?:         "Low" | "Medium" | "High";
  data_completeness?:  number;        // 0–1
  score_sleep?:        number;
  score_hrv?:          number;
  score_training?:     number;
  score_nutrition?:    number;
  score_modalities?:   number;
  score_bloodwork?:    number;
}

export interface RecoveryScoreRow {
  id:               string;
  user_id:          string;
  date:             string;
  calculated_score: number;
  adjusted_score:   number | null;
  confidence:       string;
  data_completeness: number | null;
  recommendations:  ModalityRecommendation[];
  score_sleep:      number | null;
  score_hrv:        number | null;
  score_training:   number | null;
  score_nutrition:  number | null;
  score_modalities: number | null;
  score_bloodwork:  number | null;
  created_at:       string;
  updated_at:       string;
}

/**
 * Insert (or upsert) a recovery score for a given user + date.
 * If a row already exists for that day it is updated — safe to call multiple times.
 *
 * @example
 *   const result = await insertRecoveryScore({
 *     user_id: "uuid",
 *     date: "2026-04-12",
 *     score: 74,
 *     recommendations: [...modalities],
 *   });
 *   if (!result.success) console.error(result.error.message);
 *   else console.log("Saved:", result.data.id);
 */
export async function insertRecoveryScore(
  input: InsertRecoveryScoreInput,
): Promise<ApiResult<RecoveryScoreRow>> {
  if (!supabaseClient) return noClient();

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!input.user_id?.trim())
    return inputError("user_id is required.");
  if (!input.date?.match(/^\d{4}-\d{2}-\d{2}$/))
    return inputError("date must be in YYYY-MM-DD format.");
  if (typeof input.score !== "number" || input.score < 0 || input.score > 100)
    return inputError("score must be a number between 0 and 100.");
  if (!Array.isArray(input.recommendations))
    return inputError("recommendations must be an array.");

  // ── Build row ─────────────────────────────────────────────────────────────
  const row = {
    user_id:           input.user_id,
    date:              input.date,
    calculated_score:  Math.round(input.score),
    adjusted_score:    input.adjusted_score   ?? null,
    confidence:        input.confidence       ?? "Medium",
    data_completeness: input.data_completeness ?? null,
    recommendations:   input.recommendations,
    score_sleep:       input.score_sleep      ?? null,
    score_hrv:         input.score_hrv        ?? null,
    score_training:    input.score_training   ?? null,
    score_nutrition:   input.score_nutrition  ?? null,
    score_modalities:  input.score_modalities ?? null,
    score_bloodwork:   input.score_bloodwork  ?? null,
  };

  // ── Upsert (safe to call multiple times per day) ──────────────────────────
  const { data, error } = await supabaseClient
    .from("recovery_scores")
    .upsert(row, { onConflict: "user_id,date" })
    .select()
    .single();

  if (error) return dbError(error);
  return { success: true, data: data as RecoveryScoreRow };
}

// ─── 2. UPDATE ATHLETE PROFILE ────────────────────────────────────────────────

export interface UpdateAthleteProfileInput {
  user_id: string;

  // users table fields
  display_name?: string;
  email?:        string;
  coach_mode?:   "hardcore" | "balanced" | "recovery";

  // performance_profiles fields (pass any subset to update)
  primary_goal?:   string;
  training_focus?: "Endurance" | "Strength" | "Hybrid" | null;
  priority?:       "Performance" | "Recovery" | "Longevity" | null;
  event_date?:     string | null;   // YYYY-MM-DD or null to clear
}

export interface UpdateAthleteProfileResult {
  user_updated:    boolean;
  profile_updated: boolean;
  profile_created: boolean;
}

/**
 * Update an athlete's profile — any combination of user identity fields
 * and performance profile fields. Only provided fields are changed.
 *
 * - If no performance profile exists yet, one is created automatically.
 * - Partial updates are safe — omitted fields are left unchanged.
 *
 * @example
 *   const result = await updateAthleteProfile({
 *     user_id: "uuid",
 *     display_name: "Norman",
 *     coach_mode: "hardcore",
 *     primary_goal: "Marathon",
 *     event_date: "2026-10-15",
 *   });
 *   if (!result.success) console.error(result.error.message);
 */
export async function updateAthleteProfile(
  input: UpdateAthleteProfileInput,
): Promise<ApiResult<UpdateAthleteProfileResult>> {
  if (!supabaseClient) return noClient();

  if (!input.user_id?.trim())
    return inputError("user_id is required.");

  const result: UpdateAthleteProfileResult = {
    user_updated:    false,
    profile_updated: false,
    profile_created: false,
  };

  // ── Update users table (only fields that were provided) ───────────────────
  const userPatch: Record<string, unknown> = {};
  if (input.display_name !== undefined) userPatch.display_name = input.display_name;
  if (input.email        !== undefined) userPatch.email        = input.email;
  if (input.coach_mode   !== undefined) userPatch.coach_mode   = input.coach_mode;

  if (Object.keys(userPatch).length > 0) {
    const { error } = await supabaseClient
      .from("users")
      .update(userPatch)
      .eq("id", input.user_id);

    if (error) return dbError(error);
    result.user_updated = true;
  }

  // ── Update / create performance_profiles ─────────────────────────────────
  const profileFields = ["primary_goal", "training_focus", "priority", "event_date"] as const;
  const hasProfileUpdate = profileFields.some((f) => f in input);

  if (hasProfileUpdate) {
    // Check if a profile already exists
    const { data: existing } = await supabaseClient
      .from("performance_profiles")
      .select("id")
      .eq("user_id", input.user_id)
      .maybeSingle();

    const profilePatch: Record<string, unknown> = { user_id: input.user_id };
    if (input.primary_goal   !== undefined) profilePatch.primary_goal   = input.primary_goal;
    if (input.training_focus !== undefined) profilePatch.training_focus = input.training_focus;
    if (input.priority       !== undefined) profilePatch.priority       = input.priority;
    if (input.event_date     !== undefined) profilePatch.event_date     = input.event_date;

    if (existing) {
      // Update existing profile
      const { error } = await supabaseClient
        .from("performance_profiles")
        .update(profilePatch)
        .eq("id", existing.id);

      if (error) return dbError(error);
      result.profile_updated = true;
    } else {
      // Create new profile — primary_goal required
      if (!input.primary_goal)
        return inputError("primary_goal is required when creating a performance profile.");

      const { error } = await supabaseClient
        .from("performance_profiles")
        .insert(profilePatch);

      if (error) return dbError(error);
      result.profile_created = true;
    }
  }

  return { success: true, data: result };
}
