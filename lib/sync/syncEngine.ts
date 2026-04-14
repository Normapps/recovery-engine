/**
 * Sync Engine
 *
 * Orchestrates the full sync pipeline for one provider:
 *
 *   1. Load a valid access token (refresh if needed via tokenManager)
 *   2. Fetch today's data via the provider adapter
 *   3. Map to daily_entries columns via dataMapper
 *   4. Upsert into daily_entries — no-clobber: only write non-null fields
 *      using ON CONFLICT (user_id, date) DO UPDATE
 *   5. Update device_connections.last_sync
 *   6. Recalculate and store the recovery score for today
 *
 * Also exports syncAllConnectedProviders() for the scheduled job.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeviceProvider } from "@/lib/types";
import type { SyncResult }      from "./types";
import { getAdapter }            from "./adapters/index";
import { getValidAccessToken }   from "./tokenManager";
import { mapProviderDataToPatch, patchFields } from "./dataMapper";
import { format } from "date-fns";

// ─── Single-provider sync ─────────────────────────────────────────────────────

export async function syncProvider(
  db:       SupabaseClient,
  userId:   string,
  provider: DeviceProvider,
  date?:    string,
): Promise<SyncResult> {
  const today = date ?? format(new Date(), "yyyy-MM-dd");

  try {
    const adapter     = getAdapter(provider);
    const accessToken = await getValidAccessToken(db, userId, provider);

    if (!accessToken) {
      return { provider, date: today, success: false, fields: [], rowsUpserted: 0,
               error: "No valid access token — please reconnect." };
    }

    // 1. Fetch normalized data
    const providerData = await adapter.fetchData(accessToken, today);

    // 2. Map to DB columns (only populated fields)
    const patch = mapProviderDataToPatch(providerData);
    const fields = patchFields(patch);

    // 3. Upsert into daily_entries — skips empty patch
    let rowsUpserted = 0;
    if (fields.length > 0) {
      const { error: upsertErr } = await db.from("daily_entries").upsert(
        { user_id: userId, date: today, ...patch, updated_at: new Date().toISOString() },
        { onConflict: "user_id,date" },
      );
      if (upsertErr) throw new Error(upsertErr.message);
      rowsUpserted = 1;
    }

    // 4. Update last_sync on the connection
    await db.from("device_connections").update(
      { last_sync: new Date().toISOString(), updated_at: new Date().toISOString() },
    ).eq("user_id", userId).eq("provider", provider);

    // 5. Recalculate recovery score for today
    await recalculateRecoveryScore(db, userId, today);

    return { provider, date: today, success: true, fields, rowsUpserted };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[syncEngine] ${provider} sync failed:`, message);
    return { provider, date: today, success: false, fields: [], rowsUpserted: 0, error: message };
  }
}

// ─── All connected providers ──────────────────────────────────────────────────

/** Sync every active connection for a user (used by the scheduled job). */
export async function syncAllConnectedProviders(
  db:     SupabaseClient,
  userId: string,
  date?:  string,
): Promise<SyncResult[]> {
  const { data, error } = await db
    .from("device_connections")
    .select("provider")
    .eq("user_id", userId)
    .eq("is_connected", true);

  if (error || !data) return [];

  const results = await Promise.allSettled(
    data.map((row) => syncProvider(db, userId, row.provider as DeviceProvider, date)),
  );

  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { provider: "unknown", date: date ?? format(new Date(), "yyyy-MM-dd"),
          success: false, fields: [], rowsUpserted: 0, error: String(r.reason) },
  );
}

// ─── Recovery score recalculation ────────────────────────────────────────────

/**
 * After a sync, pull the updated daily_entries row and recompute the
 * recovery score using the server-side scoring pipeline.
 *
 * This mirrors what the client does in DailyLogForm.handleSubmit but runs
 * fully server-side so scheduled syncs stay autonomous.
 */
async function recalculateRecoveryScore(
  db:     SupabaseClient,
  userId: string,
  date:   string,
): Promise<void> {
  // Fetch the updated daily entry
  const { data: entryRow } = await db
    .from("daily_entries")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .single<DailyEntryRow>();

  if (!entryRow) return;

  // Map DB row → simple score components (lightweight server-side scorer)
  const score = computeSimpleScore(entryRow);
  if (score == null) return;

  await db.from("recovery_scores").upsert(
    {
      user_id:          userId,
      date,
      calculated_score: Math.round(score.total),
      confidence:       score.confidence,
      data_completeness: score.completeness,
      score_sleep:      score.sleep,
      score_hrv:        score.hrv,
      score_training:   score.training,
      updated_at:       new Date().toISOString(),
    },
    { onConflict: "user_id,date" },
  );
}

// ─── Lightweight server-side scorer ──────────────────────────────────────────

interface DailyEntryRow {
  sleep_duration?:       number | null;
  sleep_quality_rating?: number | null;
  hrv?:                  number | null;
  resting_hr?:           number | null;
  body_battery?:         number | null;
  strength_training?:    boolean;
  cardio?:               boolean;
}

interface SimpleScore {
  total:        number;
  sleep:        number;
  hrv:          number;
  training:     number;
  confidence:   string;
  completeness: number;
}

function computeSimpleScore(row: DailyEntryRow): SimpleScore | null {
  let fields = 0;
  let total  = 0;

  // Sleep subscore (0–100)
  let sleepScore = 50;
  if (row.sleep_duration != null) {
    const h = row.sleep_duration;
    sleepScore = h >= 8 ? 95 : h >= 7 ? 82 : h >= 6 ? 65 : h >= 5 ? 45 : 25;
    if (row.sleep_quality_rating != null) {
      sleepScore = sleepScore * 0.6 + (row.sleep_quality_rating / 5) * 100 * 0.4;
    }
    fields++;
  }

  // HRV subscore (0–100) — higher HRV is better; normalize around 50–90 ms range
  let hrvScore = 50;
  if (row.hrv != null) {
    const h = row.hrv;
    hrvScore = h >= 80 ? 95 : h >= 65 ? 85 : h >= 50 ? 72 : h >= 35 ? 55 : 35;
    fields++;
  }

  // Resting HR modifier — lower is better
  if (row.resting_hr != null) {
    const rhr = row.resting_hr;
    const rhrBonus = rhr <= 50 ? 8 : rhr <= 58 ? 4 : rhr <= 65 ? 0 : -6;
    hrvScore = Math.min(100, Math.max(0, hrvScore + rhrBonus));
  }

  // Training load penalty (if body_battery shows fatigue)
  let trainingScore = 70;
  if (row.body_battery != null) {
    trainingScore = row.body_battery >= 70 ? 85 : row.body_battery >= 50 ? 70 : 50;
    fields++;
  }

  if (fields === 0) return null;  // No data at all — skip score write

  total = (sleepScore * 0.5) + (hrvScore * 0.35) + (trainingScore * 0.15);
  const completeness = Math.min(1, fields / 3);
  const confidence   = fields >= 3 ? "High" : fields >= 2 ? "Medium" : "Low";

  return {
    total:        Math.min(100, Math.max(0, total)),
    sleep:        Math.round(sleepScore),
    hrv:          Math.round(hrvScore),
    training:     Math.round(trainingScore),
    confidence,
    completeness: Math.round(completeness * 1000) / 1000,
  };
}
