/**
 * GET /api/trends?range=30d&user_id=<uuid>
 *
 * Returns recovery_scores + daily_entries rows for the requested date range.
 * Rows are sorted ascending by date. Missing days are absent — not synthesized.
 *
 * Query params:
 *   range    — "7d" | "30d" | "90d" | "6m" | "1y"  (default: "30d")
 *   user_id  — UUID from the users table (required; comes from auth session
 *              when Supabase Auth is wired — passed explicitly until then)
 *
 * Responses:
 *   200 { source: "supabase", scores: [...], entries: [...] }
 *   200 { source: "unavailable", scores: [], entries: [], reason: string }
 *   400 { error: string }
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { fetchTrends }               from "@/lib/api/fetchTrends";
import { format, subDays }           from "date-fns";

// ─── Range → day count ────────────────────────────────────────────────────────

const RANGE_DAYS: Record<string, number> = {
  "7d":  7,
  "30d": 30,
  "90d": 90,
  "6m":  182,
  "1y":  365,
};

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);

  const range  = searchParams.get("range")   ?? "30d";
  const userId = searchParams.get("user_id") ?? "";

  // user_id is required — once Supabase Auth is wired, extract from session here.
  if (!userId) {
    return NextResponse.json({
      source:  "unavailable",
      scores:  [],
      entries: [],
      reason:  "user_id not provided — wire Supabase Auth to enable server-side fetching.",
    });
  }

  const days     = RANGE_DAYS[range] ?? 30;
  const toDate   = format(new Date(), "yyyy-MM-dd");
  const fromDate = format(subDays(new Date(), days - 1), "yyyy-MM-dd");

  const result = await fetchTrends(userId, fromDate, toDate);

  if (!result.success) {
    // Supabase not configured or query failed — caller falls back to localStorage.
    return NextResponse.json({
      source:  "unavailable",
      scores:  [],
      entries: [],
      reason:  result.error.message,
    });
  }

  return NextResponse.json({
    source:  "supabase",
    scores:  result.data.scores,
    entries: result.data.entries,
  });
}
