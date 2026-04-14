/**
 * Data Mapper
 *
 * Converts normalized ProviderData → DailyEntryPatch (DB columns).
 *
 * Rules:
 *   - Only include fields that the provider actually returned (no null-writes
 *     for fields the device doesn't cover).
 *   - Clamp values to DB column constraints.
 *   - Normalize sleep quality from provider-specific scores to 1–5 scale.
 */

import type { ProviderData, DailyEntryPatch } from "./types";

/** Clamp a number to [min, max]. */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Convert a 0–100 sleep or readiness score to a 1–5 quality rating.
 * Providers like Oura and WHOOP use 0–100.
 */
function scoreToRating(score: number): number {
  if (score >= 85) return 5;
  if (score >= 70) return 4;
  if (score >= 55) return 3;
  if (score >= 40) return 2;
  return 1;
}

/**
 * Maps a ProviderData object to a partial daily_entries patch.
 *
 * Only keys with actual values are included in the returned object.
 * This ensures the upsert only overwrites columns the provider covers —
 * manual entries for other columns are left untouched.
 */
export function mapProviderDataToPatch(data: ProviderData): DailyEntryPatch {
  const patch: DailyEntryPatch = {};

  if (data.sleepHours != null) {
    patch.sleep_duration = Math.round(clamp(data.sleepHours, 0, 16) * 10) / 10;
  }

  if (data.sleepQuality != null) {
    // If the value is already 1–5, keep it; if 0–100, convert it.
    const raw = data.sleepQuality;
    patch.sleep_quality_rating = raw > 5
      ? scoreToRating(raw)
      : Math.round(clamp(raw, 1, 5));
  }

  if (data.hrv != null) {
    patch.hrv = Math.round(clamp(data.hrv, 0, 300) * 10) / 10;
  }

  if (data.restingHr != null) {
    patch.resting_hr = Math.round(clamp(data.restingHr, 20, 250));
  }

  if (data.bodyBattery != null) {
    patch.body_battery = Math.round(clamp(data.bodyBattery, 0, 100));
  }

  if (data.activeCalories != null) {
    patch.calories = Math.round(clamp(data.activeCalories, 0, 10_000));
  }

  return patch;
}

/** Returns which field names were populated (for logging / SyncResult). */
export function patchFields(patch: DailyEntryPatch): string[] {
  return Object.entries(patch)
    .filter(([, v]) => v != null)
    .map(([k]) => k);
}
