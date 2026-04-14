/**
 * GET /api/sync/scheduled
 *
 * Scheduled daily sync endpoint — syncs all active provider connections
 * for all users with connected devices.
 *
 * Designed to be called by:
 *   - Vercel Cron (vercel.json → crons)
 *   - GitHub Actions scheduled workflow
 *   - Any external cron service (EasyCron, cron-job.org, etc.)
 *
 * Security:
 *   Requires Authorization header: Bearer <CRON_SECRET>
 *   Set CRON_SECRET in env vars. Keep it out of the client bundle (no NEXT_PUBLIC_).
 *
 * To configure Vercel Cron, add to vercel.json:
 * {
 *   "crons": [
 *     { "path": "/api/sync/scheduled", "schedule": "0 6 * * *" }
 *   ]
 * }
 * (Runs at 06:00 UTC daily — adjust for your user base timezone)
 *
 * Response 200:
 *   { synced: number, results: SyncResult[] }
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { syncAllConnectedProviders } from "@/lib/sync/syncEngine";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { format }                    from "date-fns";

export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const today = format(new Date(), "yyyy-MM-dd");

  // ── Find all users with at least one active connection ───────────────────
  const { data: connections, error } = await supabaseAdmin
    .from("device_connections")
    .select("user_id")
    .eq("is_connected", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Deduplicate user_ids
  const userIds = Array.from(new Set((connections ?? []).map((r: { user_id: string }) => r.user_id)));

  // ── Sync each user concurrently ───────────────────────────────────────────
  const allResults = await Promise.allSettled(
    userIds.map((userId) => syncAllConnectedProviders(supabaseAdmin!, userId, today)),
  );

  const results = allResults.flatMap((r) =>
    r.status === "fulfilled" ? r.value : [],
  );

  const synced    = results.filter((r) => r.success).length;
  const failed    = results.filter((r) => !r.success).length;

  console.log(`[scheduled sync] ${today} — ${synced} synced, ${failed} failed across ${userIds.length} users`);

  return NextResponse.json({
    date:    today,
    users:   userIds.length,
    synced,
    failed,
    results,
  });
}
