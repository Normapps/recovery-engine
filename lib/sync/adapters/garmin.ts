/**
 * Garmin Adapter — Phase 2
 *
 * Garmin Connect uses OAuth 1.0a for authentication, but the Garmin Health API
 * (used by third-party apps) uses OAuth 2.0 with the Consumer Key flow.
 * Docs: https://developer.garmin.com/health-api/overview/
 *
 * Required env vars:
 *   GARMIN_CLIENT_ID      (Consumer Key)
 *   GARMIN_CLIENT_SECRET  (Consumer Secret)
 *
 * Data fields available:
 *   Sleep duration, HRV, resting HR, body battery, daily summary
 *
 * Note: Garmin's Health API requires a partnership agreement.
 * The mock adapter is fully functional for development.
 */

import { ProviderAdapter } from "./base";
import type { OAuthConfig, TokenSet, ProviderData } from "../types";

export class GarminAdapter extends ProviderAdapter {
  readonly provider     = "garmin" as const;
  readonly displayName  = "Garmin";

  oauthConfig(): OAuthConfig {
    return {
      // Garmin uses OAuth 1.0a request token flow — URL below is for initiation
      authUrl:      "https://connect.garmin.com/oauthConfirm",
      tokenUrl:     "https://connectapi.garmin.com/oauth-service/oauth/access_token",
      clientId:     process.env.GARMIN_CLIENT_ID     ?? "",
      clientSecret: process.env.GARMIN_CLIENT_SECRET  ?? "",
      scopes:       [],   // Garmin OAuth 1.0a doesn't use scopes
    };
  }

  async exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
    // Garmin OAuth 1.0a: the "code" here is the oauth_verifier
    // Full implementation requires HMAC-SHA1 signature on every request.
    // TODO: implement OAuth 1.0a signing or use the garmin-connect npm package.
    if (!this.isConfigured()) return this.mockToken();
    throw new Error("Garmin OAuth 1.0a exchange not yet implemented — add oauth-1.0a package.");
  }

  async refreshAccessToken(_refreshToken: string): Promise<TokenSet> {
    // Garmin access tokens do not expire (no refresh needed for OAuth 1.0a)
    return this.mockToken();
  }

  async fetchData(accessToken: string, date: string): Promise<ProviderData> {
    if (!this.isConfigured()) return this.mockData(date);

    // Garmin Wellness API: daily summary
    const resp = await fetch(
      `https://apis.garmin.com/wellness-api/rest/dailies?startTimeInSeconds=${this.dateToUnix(date)}&durationInSeconds=86400`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!resp.ok) return this.mockData(date);
    const body = await resp.json();
    const summary = body?.dailies?.[0];

    return {
      date,
      provider:     this.provider,
      sleepHours:   summary?.sleepingSeconds != null ? summary.sleepingSeconds / 3600 : null,
      hrv:          summary?.averageHRV      ?? null,
      restingHr:    summary?.restingHeartRate ?? null,
      bodyBattery:  summary?.bodyBatteryChargedValue ?? null,
      trainingLoad: summary?.activeKilocalories ?? null,
      rawPayload:   body,
    };
  }

  private dateToUnix(date: string): number {
    return Math.floor(new Date(date + "T00:00:00Z").getTime() / 1000);
  }

  private mockToken(): TokenSet {
    return { accessToken: `garmin_mock_${Date.now()}` };
  }

  private mockData(date: string): ProviderData {
    return {
      date,
      provider:    this.provider,
      sleepHours:  this.rand(6.0, 8.5),
      hrv:         this.rand(40, 85, 0),
      restingHr:   this.rand(50, 65, 0),
      bodyBattery: this.rand(40, 95, 0),
    };
  }
}
