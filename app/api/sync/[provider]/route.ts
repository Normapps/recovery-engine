/**
 * POST /api/sync/[provider]
 *
 * Manually triggers a data sync for a specific provider.
 * Called when the user clicks the "Sync" button in the UI.
 *
 * Body (JSON):
 *   { user_id: string, date?: string }
 *
 * Response 200:
 *   { success: true, fields: string[], rowsUpserted: number, date: string }
 *
 * Response 400/500:
 *   { success: false, error: string }
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import type { DeviceProvider }        from "@/lib/types";
import { syncProvider }               from "@/lib/sync/syncEngine";
import { supabaseAdmin }              from "@/lib/supabaseAdmin";

export async function POST(
  req: NextRequest,
  { params }: { params: { provider: string } },
) {
  const provider = params.provider as DeviceProvider;

  let body: { user_id?: string; date?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { user_id: userId, date } = body;

  if (!userId) {
    return NextResponse.json({ success: false, error: "user_id is required" }, { status: 400 });
  }

  if (!supabaseAdmin) {
    // Offline mode — return a mock success so the UI can still update
    return NextResponse.json({
      success:      true,
      fields:       ["sleep_duration", "hrv", "resting_hr"],
      rowsUpserted: 1,
      date:         date ?? new Date().toISOString().split("T")[0],
      note:         "Supabase not configured — mock sync only",
    });
  }

  const result = await syncProvider(supabaseAdmin, userId, provider, date);

  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
