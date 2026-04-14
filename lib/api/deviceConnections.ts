/**
 * Device Connections API
 *
 * Handles connect / disconnect / sync for all wearables and health apps.
 * Store-first: all state is written to Zustand immediately; Supabase sync
 * is opportunistic (requires auth session).
 *
 * Mock OAuth: real token exchange is not implemented — providers are marked
 * connected with a stub token so the UI can demonstrate the full flow.
 * Replace the `access_token` stub with a real OAuth redirect in production.
 */

import { supabase } from "@/lib/supabase";
import { resolveCurrentUserId } from "./uploadAvatar";
import type { DeviceProvider, DeviceConnection, DeviceDataType } from "@/lib/types";

// ─── Provider metadata ────────────────────────────────────────────────────────

export const PROVIDER_DATA_TYPES: Record<DeviceProvider, DeviceDataType[]> = {
  whoop:          ["Sleep", "HRV", "Training Load"],
  garmin:         ["Sleep", "HRV", "Heart Rate", "Training Load"],
  apple_watch:    ["Sleep", "Heart Rate", "HRV"],
  fitbit:         ["Sleep", "Heart Rate", "Steps"],
  oura:           ["Sleep", "HRV", "Heart Rate"],
  apple_health:   ["Sleep", "HRV", "Heart Rate", "Steps"],
  google_fit:     ["Heart Rate", "Steps", "Training Load"],
  strava:         ["Training Load"],
  training_peaks: ["Training Load"],
  nike_run_club:  ["Training Load"],
  myfitnesspal:   ["Nutrition"],
  cronometer:     ["Nutrition"],
};

// ─── Fetch ────────────────────────────────────────────────────────────────────

/** Load all connections for the current user from Supabase. Returns [] if not authenticated. */
export async function fetchDeviceConnections(): Promise<DeviceConnection[]> {
  const userId = await resolveCurrentUserId();
  if (!userId || !supabase) return [];

  const { data, error } = await supabase
    .from("device_connections")
    .select("provider, is_connected, last_sync")
    .eq("user_id", userId);

  if (error || !data) return [];

  return data.map((row) => ({
    provider:    row.provider as DeviceProvider,
    isConnected: row.is_connected,
    lastSync:    row.last_sync ?? null,
    dataTypes:   PROVIDER_DATA_TYPES[row.provider as DeviceProvider] ?? [],
  }));
}

// ─── Connect ─────────────────────────────────────────────────────────────────

/**
 * Mark a provider as connected and persist to Supabase.
 * In production: call after receiving the real OAuth access_token.
 */
export async function connectDevice(
  provider: DeviceProvider,
): Promise<{ success: boolean; error?: string }> {
  const userId = await resolveCurrentUserId();
  if (!userId || !supabase) {
    // Return success so the UI can still show the connected state locally.
    return { success: true };
  }

  const { error } = await supabase.from("device_connections").upsert(
    {
      user_id:      userId,
      provider,
      is_connected: true,
      access_token: `mock_${provider}_${Date.now()}`,
      updated_at:   new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  );

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── Disconnect ───────────────────────────────────────────────────────────────

export async function disconnectDevice(
  provider: DeviceProvider,
): Promise<{ success: boolean; error?: string }> {
  const userId = await resolveCurrentUserId();
  if (!userId || !supabase) return { success: true };

  const { error } = await supabase.from("device_connections").upsert(
    {
      user_id:       userId,
      provider,
      is_connected:  false,
      access_token:  null,
      refresh_token: null,
      updated_at:    new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  );

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

/**
 * Simulates a data pull from the provider.
 * Maps provider data to daily_entries columns and upserts today's row.
 * Uses ON CONFLICT (user_id, date) to merge without duplication.
 */
export async function syncDevice(
  provider: DeviceProvider,
): Promise<{ success: boolean; error?: string }> {
  const userId = await resolveCurrentUserId();
  if (!userId || !supabase) return { success: true };

  const now   = new Date().toISOString();
  const today = now.split("T")[0];

  // Update last_sync on the connection row
  await supabase.from("device_connections").upsert(
    { user_id: userId, provider, is_connected: true, last_sync: now, updated_at: now },
    { onConflict: "user_id,provider" },
  );

  // Map mock provider data → daily_entries columns
  const payload = buildMockPayload(provider);
  if (payload) {
    const { error } = await supabase.from("daily_entries").upsert(
      { user_id: userId, date: today, ...payload, updated_at: now },
      { onConflict: "user_id,date" },
    );
    if (error) return { success: false, error: error.message };
  }

  return { success: true };
}

// ─── Mock data generator ──────────────────────────────────────────────────────

function rand(min: number, max: number, decimals = 1): number {
  const v = min + Math.random() * (max - min);
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

/**
 * Returns a partial daily_entries payload for the given provider.
 * Column names match the physical table: sleep_duration, hrv, resting_hr, body_battery.
 * Returns null for providers that don't map to daily_entries fields (training apps, nutrition).
 */
function buildMockPayload(provider: DeviceProvider): Record<string, number | null> | null {
  switch (provider) {
    case "whoop":
      return {
        sleep_duration:       rand(6.5, 8.5),
        hrv:                  rand(45, 90, 0),
        resting_hr:           rand(48, 62, 0),
      };
    case "garmin":
      return {
        sleep_duration:       rand(6.0, 8.5),
        hrv:                  rand(40, 85, 0),
        resting_hr:           rand(50, 65, 0),
        body_battery:         rand(40, 95, 0),
      };
    case "apple_watch":
      return {
        sleep_duration:       rand(6.5, 8.5),
        hrv:                  rand(35, 75, 0),
        resting_hr:           rand(52, 68, 0),
      };
    case "fitbit":
      return {
        sleep_duration:       rand(6.5, 9.0),
        resting_hr:           rand(54, 70, 0),
      };
    case "oura":
      return {
        sleep_duration:       rand(7.0, 8.5),
        hrv:                  rand(50, 95, 0),
        resting_hr:           rand(48, 62, 0),
      };
    case "apple_health":
    case "google_fit":
      return { resting_hr: rand(54, 68, 0) };
    // Training apps and nutrition apps don't map to daily_entries columns directly
    default:
      return null;
  }
}
