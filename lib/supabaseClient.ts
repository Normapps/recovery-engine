/**
 * Supabase Client
 *
 * Single reusable client instance for the entire application.
 *
 * Required environment variables (set in .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL      — Project URL from Supabase dashboard
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY — Public anon key from Supabase dashboard
 *
 * The client is null when env vars are missing so the app continues
 * to function in offline / localStorage-only mode without a connection.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// NEXT_PUBLIC_ prefix for browser/client components; unprefixed for API routes.
// Falls back so either pair works depending on execution context.
const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL     ?? process.env.SUPABASE_URL     ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  if (process.env.NODE_ENV === "development") {
    console.warn(
      "[supabaseClient] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. " +
      "Running in offline mode — data will be persisted to localStorage only.",
    );
  }
}

/**
 * The active Supabase client, or null if env vars are not configured.
 * Always null-check before calling: `if (!supabaseClient) return;`
 */
export const supabaseClient: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession:    true,
          autoRefreshToken:  true,
          detectSessionInUrl: true,
        },
      })
    : null;

/** True when a Supabase connection is configured and available. */
export const isConnected: boolean = supabaseClient !== null;
