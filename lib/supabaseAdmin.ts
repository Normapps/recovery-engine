/**
 * Supabase Admin Client (server-only)
 *
 * Uses the service_role key to bypass RLS.
 * NEVER import this in client components — it would expose the secret key.
 *
 * Required env vars (server-side only, no NEXT_PUBLIC_ prefix):
 *   SUPABASE_URL              — Project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Service role secret (Settings → API)
 *
 * Falls back to the anon client when the service role key is absent so the
 * app continues to work during local development without full credentials.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url     = process.env.SUPABASE_URL     ?? process.env.NEXT_PUBLIC_SUPABASE_URL     ?? "";
const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Admin client — bypasses RLS; for scheduled jobs and server-only sync. */
export const supabaseAdmin: SupabaseClient | null =
  url && (svcKey || anonKey)
    ? createClient(url, svcKey || anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
