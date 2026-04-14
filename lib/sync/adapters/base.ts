/**
 * Abstract ProviderAdapter
 *
 * Every wearable / health-app adapter extends this class.
 * Subclasses only need to implement:
 *   - oauthConfig()        → client credentials + URLs
 *   - exchangeCode()       → POST to token endpoint
 *   - refreshAccessToken() → POST to token endpoint with refresh grant
 *   - fetchData()          → call provider API, return normalized ProviderData
 *
 * isConfigured() returns false when client credentials are absent,
 * which causes buildAuthUrl / exchange to fall through to mock mode
 * in the subclass.
 */

import type { DeviceProvider } from "@/lib/types";
import type { ProviderData, TokenSet, OAuthConfig } from "../types";

export abstract class ProviderAdapter {
  abstract readonly provider:     DeviceProvider;
  abstract readonly displayName:  string;

  /** Returns OAuth config — may throw if env vars are missing. */
  abstract oauthConfig(): OAuthConfig;

  /** Exchange an authorization code for tokens. */
  abstract exchangeCode(code: string, redirectUri: string): Promise<TokenSet>;

  /** Use a refresh token to get a new access token. */
  abstract refreshAccessToken(refreshToken: string): Promise<TokenSet>;

  /**
   * Fetch today's biometrics from the provider API.
   * Falls back to realistic mock data when credentials are absent.
   */
  abstract fetchData(accessToken: string, date: string): Promise<ProviderData>;

  /** True when PROVIDER_CLIENT_ID and PROVIDER_CLIENT_SECRET env vars are set. */
  isConfigured(): boolean {
    try {
      const cfg = this.oauthConfig();
      return Boolean(cfg.clientId && cfg.clientSecret);
    } catch {
      return false;
    }
  }

  /** Constructs the provider's OAuth authorization URL. */
  buildAuthUrl(redirectUri: string, state: string): string {
    const cfg = this.oauthConfig();
    const p = new URLSearchParams({
      client_id:     cfg.clientId,
      redirect_uri:  redirectUri,
      response_type: "code",
      scope:         cfg.scopes.join(" "),
      state,
    });
    return `${cfg.authUrl}?${p.toString()}`;
  }

  /** Shared token exchange helper — POST application/x-www-form-urlencoded. */
  protected async postTokenEndpoint(
    tokenUrl:  string,
    params:    Record<string, string>,
    basicAuth: { user: string; pass: string },
  ): Promise<TokenSet> {
    const resp = await fetch(tokenUrl, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        "Authorization": "Basic " + btoa(`${basicAuth.user}:${basicAuth.pass}`),
      },
      body: new URLSearchParams(params).toString(),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Token endpoint ${resp.status}: ${txt}`);
    }
    const data = await resp.json() as {
      access_token:  string;
      refresh_token?: string;
      expires_in?:   number;
      token_type?:   string;
      scope?:        string;
    };
    return {
      accessToken:  data.access_token,
      refreshToken: data.refresh_token,
      expiresAt:    data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      tokenType:    data.token_type,
      scope:        data.scope,
    };
  }

  /** Clamp a value to a range and round to `dp` decimal places. */
  protected rand(min: number, max: number, dp = 1): number {
    const v = min + Math.random() * (max - min);
    const f = Math.pow(10, dp);
    return Math.round(v * f) / f;
  }
}
