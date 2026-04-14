/**
 * WHOOP Adapter — Phase 3
 *
 * OAuth 2.0 (PKCE optional)
 * Docs: https://developer.whoop.com/api
 *
 * Required env vars:
 *   WHOOP_CLIENT_ID
 *   WHOOP_CLIENT_SECRET
 *
 * Data fields available:
 *   Recovery score, HRV (RMSSD), resting HR, sleep duration
 */

import { ProviderAdapter } from "./base";
import type { OAuthConfig, TokenSet, ProviderData } from "../types";

export class WhoopAdapter extends ProviderAdapter {
  readonly provider     = "whoop" as const;
  readonly displayName  = "WHOOP";

  oauthConfig(): OAuthConfig {
    return {
      authUrl:      "https://api.prod.whoop.com/oauth/oauth2/auth",
      tokenUrl:     "https://api.prod.whoop.com/oauth/oauth2/token",
      clientId:     process.env.WHOOP_CLIENT_ID     ?? "",
      clientSecret: process.env.WHOOP_CLIENT_SECRET  ?? "",
      scopes:       ["read:recovery", "read:sleep", "read:workout", "offline"],
    };
  }

  async exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
    return this.postTokenEndpoint(
      this.oauthConfig().tokenUrl,
      { grant_type: "authorization_code", code, redirect_uri: redirectUri },
      { user: this.oauthConfig().clientId, pass: this.oauthConfig().clientSecret },
    );
  }

  async refreshAccessToken(refreshToken: string): Promise<TokenSet> {
    return this.postTokenEndpoint(
      this.oauthConfig().tokenUrl,
      { grant_type: "refresh_token", refresh_token: refreshToken },
      { user: this.oauthConfig().clientId, pass: this.oauthConfig().clientSecret },
    );
  }

  async fetchData(accessToken: string, date: string): Promise<ProviderData> {
    if (!this.isConfigured()) return this.mockData(date);

    // Fetch recovery data (includes HRV + RHR)
    const [recoveryResp, sleepResp] = await Promise.all([
      fetch(`https://api.prod.whoop.com/developer/v1/recovery/?start=${date}T00:00:00Z&end=${date}T23:59:59Z&limit=1`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      fetch(`https://api.prod.whoop.com/developer/v1/activity/sleep/?start=${date}T00:00:00Z&end=${date}T23:59:59Z&limit=1`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    ]);

    const recovery = recoveryResp.ok ? await recoveryResp.json() : null;
    const sleep    = sleepResp.ok    ? await sleepResp.json()    : null;

    const r = recovery?.records?.[0]?.score;
    const s = sleep?.records?.[0];

    return {
      date,
      provider:    this.provider,
      hrv:         r?.hrv_rmssd_milli    ?? null,
      restingHr:   r?.resting_heart_rate ?? null,
      sleepHours:  s?.nap_duration_milli == null ? null
        : (s.sleep_performance_percentage != null
          // WHOOP gives total_in_bed_time_milli for the sleep cycle
          ? (s.total_in_bed_time_milli ?? 0) / 3_600_000
          : null),
      rawPayload:  { recovery, sleep },
    };
  }

  private mockData(date: string): ProviderData {
    return {
      date,
      provider:   this.provider,
      hrv:        this.rand(45, 90, 0),
      restingHr:  this.rand(46, 58, 0),
      sleepHours: this.rand(6.5, 8.5),
    };
  }
}
