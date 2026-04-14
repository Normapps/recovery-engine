/**
 * fetchTrends
 *
 * Fetches recovery_scores and daily_entries from Supabase for a date range.
 * Returns rows sorted ascending by date. Missing days are absent — not filled
 * with nulls or estimates. Callers should handle gaps explicitly.
 *
 * Requires a valid user_id (UUID from the users table via Supabase Auth).
 * Returns empty arrays when Supabase is not configured or user is not found.
 */

import { supabaseClient } from "@/lib/supabaseClient";

// ─── Row types (mirror DB columns exactly) ─────────────────────────────────────

export interface ScoreRow {
  date:               string;   // YYYY-MM-DD
  calculated_score:   number;
  adjusted_score:     number | null;
  confidence:         string | null;
  score_sleep:        number | null;
  score_hrv:          number | null;
  score_training:     number | null;
  score_nutrition:    number | null;
  score_modalities:   number | null;
  score_bloodwork:    number | null;
}

export interface EntryRow {
  date:                 string;   // YYYY-MM-DD
  sleep_duration:       number | null;
  sleep_quality_rating: number | null;
  hrv:                  number | null;
  resting_hr:           number | null;
  body_battery:         number | null;
  calories:             number | null;
  protein_g:            number | null;
  hydration_oz:         number | null;
  soreness:             number | null;
  energy_level:         number | null;
  strength_training:    boolean;
  cardio:               boolean;
  core_work:            boolean;
  mobility:             boolean;
  strength_duration:    number | null;
  cardio_duration:      number | null;
}

export interface TrendsData {
  scores:  ScoreRow[];
  entries: EntryRow[];
}

export interface TrendsFetchError {
  code:    string;
  message: string;
}

export type TrendsFetchResult =
  | { success: true;  data:  TrendsData       }
  | { success: false; error: TrendsFetchError };

// ─── Main function ─────────────────────────────────────────────────────────────

/**
 * Fetch recovery_scores and daily_entries for a user over a date range.
 *
 * @param userId  - UUID from auth.users (via getAthlete/getAthleteByAuthId)
 * @param fromDate - Start date inclusive, YYYY-MM-DD
 * @param toDate   - End date inclusive, YYYY-MM-DD
 *
 * @returns TrendsFetchResult — always resolves, never throws.
 */
export async function fetchTrends(
  userId:   string,
  fromDate: string,
  toDate:   string,
): Promise<TrendsFetchResult> {
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

  // Fetch both tables concurrently — independent queries.
  const [scoresResult, entriesResult] = await Promise.all([
    supabaseClient
      .from("recovery_scores")
      .select([
        "date",
        "calculated_score",
        "adjusted_score",
        "confidence",
        "score_sleep",
        "score_hrv",
        "score_training",
        "score_nutrition",
        "score_modalities",
        "score_bloodwork",
      ].join(","))
      .eq("user_id", userId)
      .gte("date", fromDate)
      .lte("date", toDate)
      .order("date", { ascending: true }),

    supabaseClient
      .from("daily_entries")
      .select([
        "date",
        "sleep_duration",
        "sleep_quality_rating",
        "hrv",
        "resting_hr",
        "body_battery",
        "calories",
        "protein_g",
        "hydration_oz",
        "soreness",
        "energy_level",
        "strength_training",
        "cardio",
        "core_work",
        "mobility",
        "strength_duration",
        "cardio_duration",
      ].join(","))
      .eq("user_id", userId)
      .gte("date", fromDate)
      .lte("date", toDate)
      .order("date", { ascending: true }),
  ]);

  if (scoresResult.error) {
    return {
      success: false,
      error: {
        code:    scoresResult.error.code ?? "SCORES_FETCH_ERROR",
        message: scoresResult.error.message,
      },
    };
  }

  if (entriesResult.error) {
    return {
      success: false,
      error: {
        code:    entriesResult.error.code ?? "ENTRIES_FETCH_ERROR",
        message: entriesResult.error.message,
      },
    };
  }

  return {
    success: true,
    data: {
      scores:  (scoresResult.data  ?? []) as unknown as ScoreRow[],
      entries: (entriesResult.data ?? []) as unknown as EntryRow[],
    },
  };
}
