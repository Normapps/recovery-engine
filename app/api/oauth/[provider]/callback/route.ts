/**
 * GET /api/oauth/[provider]/callback
 *
 * Receives the OAuth authorization callback from the provider.
 *
 * Flow:
 *   1. Parse state → { userId, provider, returnUrl }
 *   2. Exchange the authorization code for tokens
 *   3. Store tokens in device_connections via storeTokens()
 *   4. Trigger an initial sync for today's data
 *   5. Redirect to returnUrl?synced=[provider]
 *
 * Error handling:
 *   - Missing state → redirect to /log?error=invalid_state
 *   - Token exchange failure → redirect to /log?error=exchange_failed
 *   - Sync failure → connect still succeeds; sync error is non-blocking
 *
 * Query params from provider:
 *   code  — authorization code
 *   state — base64 encoded state from initiation
 *   error — set by provider on user deny / error
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import type { DeviceProvider }        from "@/lib/types";
import { getAdapter }                 from "@/lib/sync/adapters/index";
import { storeTokens }                from "@/lib/sync/tokenManager";
import { syncProvider }               from "@/lib/sync/syncEngine";
import { supabaseAdmin }              from "@/lib/supabaseAdmin";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

interface OAuthState {
  userId:    string;
  provider:  string;
  returnUrl: string;
  nonce:     string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { provider: string } },
) {
  const provider   = params.provider as DeviceProvider;
  const searchParams = req.nextUrl.searchParams;
  const code       = searchParams.get("code");
  const stateRaw   = searchParams.get("state");
  const oauthError = searchParams.get("error");

  // ── User denied authorization ─────────────────────────────────────────────
  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/log?error=${encodeURIComponent(oauthError)}`, APP_URL),
    );
  }

  // ── Parse state ───────────────────────────────────────────────────────────
  let state: OAuthState;
  try {
    state = JSON.parse(Buffer.from(stateRaw ?? "", "base64url").toString()) as OAuthState;
  } catch {
    return NextResponse.redirect(new URL("/log?error=invalid_state", APP_URL));
  }

  if (!code) {
    return NextResponse.redirect(
      new URL(`${state.returnUrl}?error=missing_code`, APP_URL),
    );
  }

  // ── Token exchange ────────────────────────────────────────────────────────
  let adapter;
  try {
    adapter = getAdapter(provider);
  } catch {
    return NextResponse.redirect(
      new URL(`${state.returnUrl}?error=unknown_provider`, APP_URL),
    );
  }

  const redirectUri = `${APP_URL}/api/oauth/${provider}/callback`;

  let tokens;
  try {
    tokens = await adapter.exchangeCode(code, redirectUri);
  } catch (err) {
    console.error(`[oauth/callback] token exchange failed for ${provider}:`, err);
    return NextResponse.redirect(
      new URL(`${state.returnUrl}?error=exchange_failed`, APP_URL),
    );
  }

  // ── Persist tokens ────────────────────────────────────────────────────────
  if (supabaseAdmin) {
    await storeTokens(supabaseAdmin, state.userId, provider, tokens);

    // ── Initial sync (non-blocking — failure doesn't break the connect) ────
    try {
      await syncProvider(supabaseAdmin, state.userId, provider);
    } catch (err) {
      console.warn(`[oauth/callback] initial sync failed for ${provider}:`, err);
    }
  }

  // ── Redirect back to the app ──────────────────────────────────────────────
  const dest = new URL(state.returnUrl, APP_URL);
  dest.searchParams.set("synced", provider);
  return NextResponse.redirect(dest);
}
