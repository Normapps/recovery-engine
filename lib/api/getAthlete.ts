/**
 * getAthlete
 *
 * Fetches a full athlete record by user_id.
 *
 * Data lives across two tables (our schema has no separate "athletes" table —
 * athlete identity and profile are split between `users` and
 * `performance_profiles`):
 *
 *   users                → identity, coach mode, timestamps
 *   performance_profiles → goal, training focus, priority, event date
 *
 * Returns a single merged AthleteRecord, or null if not found.
 */

import { supabaseClient } from "@/lib/supabaseClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AthleteRecord {
  // Identity (from users)
  id:            string;
  auth_id:       string | null;
  display_name:  string | null;
  email:         string | null;
  coach_mode:    "hardcore" | "balanced" | "recovery";
  created_at:    string;
  updated_at:    string;

  // Performance profile (from performance_profiles — null if not yet set)
  profile: {
    id:             string;
    primary_goal:   string;
    training_focus: "Endurance" | "Strength" | "Hybrid" | null;
    priority:       "Performance" | "Recovery" | "Longevity" | null;
    event_date:     string | null;
    created_at:     string;
    updated_at:     string;
  } | null;
}

// ─── Error type ───────────────────────────────────────────────────────────────

export interface AthleteError {
  code:    string;
  message: string;
}

// ─── Result type (discriminated union — no exceptions thrown) ─────────────────

export type AthleteResult =
  | { success: true;  data:  AthleteRecord }
  | { success: false; error: AthleteError  };

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Fetch a full athlete record by user_id.
 *
 * @param userId - The UUID from the `users` table (NOT the Supabase auth UID).
 *                 To look up by auth UID, use getAthleteByAuthId() below.
 *
 * @returns AthleteResult — always resolves, never throws.
 *
 * @example
 *   const result = await getAthlete("uuid-here");
 *   if (!result.success) { console.error(result.error.message); return; }
 *   console.log(result.data.display_name);
 */
export async function getAthlete(userId: string): Promise<AthleteResult> {
  if (!supabaseClient) {
    return {
      success: false,
      error: { code: "CLIENT_UNAVAILABLE", message: "Supabase is not configured." },
    };
  }

  if (!userId?.trim()) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "user_id is required." },
    };
  }

  // Fetch user row
  const { data: user, error: userError } = await supabaseClient
    .from("users")
    .select("id, auth_id, display_name, email, coach_mode, created_at, updated_at")
    .eq("id", userId)
    .single();

  if (userError) {
    return {
      success: false,
      error: {
        code:    userError.code ?? "USER_FETCH_ERROR",
        message: userError.message,
      },
    };
  }

  if (!user) {
    return {
      success: false,
      error: { code: "NOT_FOUND", message: `No athlete found for user_id: ${userId}` },
    };
  }

  // Fetch the most recent performance profile (may not exist yet)
  const { data: profile, error: profileError } = await supabaseClient
    .from("performance_profiles")
    .select("id, primary_goal, training_focus, priority, event_date, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Profile not existing is not an error — return null for it
  if (profileError) {
    return {
      success: false,
      error: {
        code:    profileError.code ?? "PROFILE_FETCH_ERROR",
        message: profileError.message,
      },
    };
  }

  const record: AthleteRecord = {
    id:           user.id,
    auth_id:      user.auth_id ?? null,
    display_name: user.display_name ?? null,
    email:        user.email ?? null,
    coach_mode:   user.coach_mode,
    created_at:   user.created_at,
    updated_at:   user.updated_at,
    profile:      profile ?? null,
  };

  return { success: true, data: record };
}

// ─── Auth UID variant ─────────────────────────────────────────────────────────

/**
 * Fetch a full athlete record by Supabase auth UID (auth.users.id).
 * Use this when you have the session user — e.g. in API routes or server components.
 *
 * @param authId - The UUID from Supabase auth (supabaseClient.auth.getUser())
 */
export async function getAthleteByAuthId(authId: string): Promise<AthleteResult> {
  if (!supabaseClient) {
    return {
      success: false,
      error: { code: "CLIENT_UNAVAILABLE", message: "Supabase is not configured." },
    };
  }

  if (!authId?.trim()) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "auth_id is required." },
    };
  }

  const { data: user, error } = await supabaseClient
    .from("users")
    .select("id")
    .eq("auth_id", authId)
    .single();

  if (error || !user) {
    return {
      success: false,
      error: {
        code:    error?.code ?? "NOT_FOUND",
        message: error?.message ?? `No athlete found for auth_id: ${authId}`,
      },
    };
  }

  return getAthlete(user.id);
}
