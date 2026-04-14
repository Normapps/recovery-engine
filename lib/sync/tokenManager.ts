/**
 * Token Manager
 *
 * Handles token storage and refresh for all providers.
 *
 * Tokens are stored in the device_connections table:
 *   access_token, refresh_token, last_sync, is_connected
 *
 * Access tokens are refreshed automatically when they are within
 * REFRESH_BUFFER_MS of expiring (parsed from the stored JSON in
 * the access_token column — see storeTokens / loadTokens below).
 *
 * Token format stored in DB (JSON-serialized into access_token column):
 * {
 *   "at":  "<access_token>",
 *   "exp": 1712345678000    // Unix ms expiry, optional
 * }
 * The refresh_token column stores the raw refresh token string.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeviceProvider } from "@/lib/types";
import type { TokenSet } from "./types";
import { getAdapter } from "./adapters/index";

/** Refresh 5 minutes before actual expiry. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface StoredToken {
  at:   string;
  exp?: number;
}

export function encodeToken(tokens: TokenSet): { access_token: string; refresh_token: string | null } {
  const stored: StoredToken = { at: tokens.accessToken };
  if (tokens.expiresAt) stored.exp = tokens.expiresAt;
  return {
    access_token:  JSON.stringify(stored),
    refresh_token: tokens.refreshToken ?? null,
  };
}

function decodeToken(raw: string): { accessToken: string; expiresAt?: number } {
  try {
    const parsed = JSON.parse(raw) as StoredToken;
    return { accessToken: parsed.at, expiresAt: parsed.exp };
  } catch {
    // Legacy: raw string was stored directly
    return { accessToken: raw };
  }
}

/** Persist a token set to device_connections. */
export async function storeTokens(
  db:       SupabaseClient,
  userId:   string,
  provider: DeviceProvider,
  tokens:   TokenSet,
): Promise<void> {
  const { access_token, refresh_token } = encodeToken(tokens);
  await db.from("device_connections").upsert(
    {
      user_id:       userId,
      provider,
      is_connected:  true,
      access_token,
      refresh_token,
      updated_at:    new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  );
}

interface ConnectionRow {
  access_token:  string | null;
  refresh_token: string | null;
}

/**
 * Load a valid access token for the given provider, refreshing if needed.
 * Returns null if no connection exists or refresh fails.
 */
export async function getValidAccessToken(
  db:       SupabaseClient,
  userId:   string,
  provider: DeviceProvider,
): Promise<string | null> {
  const { data, error } = await db
    .from("device_connections")
    .select("access_token, refresh_token")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("is_connected", true)
    .single<ConnectionRow>();

  if (error || !data?.access_token) return null;

  const { accessToken, expiresAt } = decodeToken(data.access_token);

  // Token still valid — return it
  const needsRefresh = expiresAt != null && Date.now() >= expiresAt - REFRESH_BUFFER_MS;
  if (!needsRefresh) return accessToken;

  // Token expired — attempt refresh
  if (!data.refresh_token) {
    // No refresh token — mark disconnected
    await db.from("device_connections")
      .update({ is_connected: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("provider", provider);
    return null;
  }

  try {
    const adapter    = getAdapter(provider);
    const newTokens  = await adapter.refreshAccessToken(data.refresh_token);
    await storeTokens(db, userId, provider, newTokens);
    return newTokens.accessToken;
  } catch (err) {
    console.error(`[tokenManager] refresh failed for ${provider}:`, err);
    // Mark connection as broken so user can reconnect
    await db.from("device_connections")
      .update({ is_connected: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("provider", provider);
    return null;
  }
}
