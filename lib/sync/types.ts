/**
 * Core types for the device sync system.
 *
 * All provider adapters normalize their raw API responses into ProviderData.
 * The data mapper converts ProviderData → DailyEntryPatch (DB columns).
 */

// ─── Normalized provider output ───────────────────────────────────────────────

/** All biometric and activity data extracted from a provider for one date. */
export interface ProviderData {
  date:             string;          // YYYY-MM-DD
  provider:         string;
  // Sleep
  sleepHours?:      number | null;   // decimal hours, e.g. 7.5
  sleepQuality?:    number | null;   // normalized 1–5 (some providers give 0–100 score)
  // Biometrics
  hrv?:             number | null;   // ms RMSSD
  restingHr?:       number | null;   // bpm
  bodyBattery?:     number | null;   // 0–100 (Garmin-specific, used as rough readiness proxy)
  // Activity
  trainingLoad?:    number | null;   // arbitrary units (provider-specific)
  activeCalories?:  number | null;   // kcal
  // Debug
  rawPayload?:      unknown;
}

// ─── Sync result ──────────────────────────────────────────────────────────────

export interface SyncResult {
  provider:    string;
  date:        string;
  success:     boolean;
  error?:      string;
  /** Which fields were populated from provider data. */
  fields:      string[];
  rowsUpserted: number;
}

// ─── OAuth tokens ─────────────────────────────────────────────────────────────

export interface TokenSet {
  accessToken:   string;
  refreshToken?: string;
  expiresAt?:    number;   // Unix ms — when access_token expires
  tokenType?:    string;   // usually "Bearer"
  scope?:        string;
}

// ─── OAuth provider config ────────────────────────────────────────────────────

export interface OAuthConfig {
  authUrl:      string;
  tokenUrl:     string;
  clientId:     string;
  clientSecret: string;
  scopes:       string[];
}

// ─── Partial daily_entries patch (snake_case matches DB columns) ───────────────

export interface DailyEntryPatch {
  sleep_duration?:       number | null;
  sleep_quality_rating?: number | null;
  hrv?:                  number | null;
  resting_hr?:           number | null;
  body_battery?:         number | null;
  calories?:             number | null;
}
