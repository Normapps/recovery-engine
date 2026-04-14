/**
 * GET /api/oauth/[provider]
 *
 * Initiates the OAuth 2.0 authorization flow for a provider.
 *
 * Flow:
 *   1. Resolve user_id from the request (query param until auth is wired)
 *   2. Build the provider-specific OAuth URL with:
 *      - redirect_uri pointing to our callback
 *      - state = base64(JSON{ userId, provider, nonce })
 *   3. Redirect the browser to the provider's auth page
 *
 * Mock mode (no client credentials):
 *   Skips the provider redirect entirely — generates a mock token,
 *   stores it in device_connections, and redirects to /log?synced=[provider].
 *   Drop real credentials into env vars to switch to live mode.
 *
 * Query params:
 *   user_id   — UUID from users table (required until Supabase Auth is wired)
 *   returnUrl — where to redirect after connect (default: /log)
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import type { DeviceProvider }        from "@/lib/types";
import { getAdapter }                 from "@/lib/sync/adapters/index";
import { storeTokens }                from "@/lib/sync/tokenManager";
import { supabaseAdmin }              from "@/lib/supabaseAdmin";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function GET(
  req: NextRequest,
  { params }: { params: { provider: string } },
) {
  const provider   = params.provider as DeviceProvider;
  const searchParams = req.nextUrl.searchParams;
  const userId     = searchParams.get("user_id");
  const returnUrl  = searchParams.get("returnUrl") ?? "/log";

  if (!userId) {
    return NextResponse.redirect(new URL(`${returnUrl}?error=missing_user_id`, APP_URL));
  }

  let adapter;
  try {
    adapter = getAdapter(provider);
  } catch {
    return NextResponse.redirect(new URL(`${returnUrl}?error=unknown_provider`, APP_URL));
  }

  // ── Mock mode ─────────────────────────────────────────────────────────────
  // When no client credentials exist, simulate a successful connect immediately.
  if (!adapter.isConfigured()) {
    if (supabaseAdmin) {
      await storeTokens(supabaseAdmin, userId, provider, {
        accessToken:  `mock_${provider}_${Date.now()}`,
        refreshToken: `mock_refresh_${provider}_${Date.now()}`,
        expiresAt:    Date.now() + 3600 * 1000,
      });
    }
    const dest = new URL(returnUrl, APP_URL);
    dest.searchParams.set("synced", provider);
    return NextResponse.redirect(dest);
  }

  // ── Live OAuth mode ───────────────────────────────────────────────────────
  const state = Buffer.from(
    JSON.stringify({ userId, provider, returnUrl, nonce: crypto.randomUUID() }),
  ).toString("base64url");

  const redirectUri = `${APP_URL}/api/oauth/${provider}/callback`;
  const authUrl     = adapter.buildAuthUrl(redirectUri, state);

  return NextResponse.redirect(authUrl);
}
