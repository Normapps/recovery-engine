/**
 * Strava Adapter — Phase 2
 *
 * OAuth 2.0
 * Docs: https://developers.strava.com/docs/authentication/
 *
 * Required env vars:
 *   STRAVA_CLIENT_ID
 *   STRAVA_CLIENT_SECRET
 *
 * Data fields available:
 *   Training load (suffer score), active calories, activity duration
 *
 * Note: Strava does not provide sleep or HRV data.
 * It maps only to training_load + active_calories in daily_entries.
 */

import { ProviderAdapter } from "./base";
import type { OAuthConfig, TokenSet, ProviderData } from "../types";

export class StravaAdapter extends ProviderAdapter {
  readonly provider     = "strava" as const;
  readonly displayName  = "Strava";

  oauthConfig(): OAuthConfig {
    return {
      authUrl:      "https://www.strava.com/oauth/authorize",
      tokenUrl:     "https://www.strava.com/oauth/token",
      clientId:     process.env.STRAVA_CLIENT_ID     ?? "",
      clientSecret: process.env.STRAVA_CLIENT_SECRET  ?? "",
      scopes:       ["activity:read"],
    };
  }

  buildAuthUrl(redirectUri: string, state: string): string {
    const cfg = this.oauthConfig();
    const p = new URLSearchParams({
      client_id:     cfg.clientId,
      redirect_uri:  redirectUri,
      response_type: "code",
      approval_prompt: "auto",
      scope:         cfg.scopes.join(","),   // Strava uses comma-separated
      state,
    });
    return `${cfg.authUrl}?${p.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
    const cfg = this.oauthConfig();
    return this.postTokenEndpoint(
      cfg.tokenUrl,
      { grant_type: "authorization_code", code, redirect_uri: redirectUri },
      { user: cfg.clientId, pass: cfg.clientSecret },
    );
  }

  async refreshAccessToken(refreshToken: string): Promise<TokenSet> {
    const cfg = this.oauthConfig();
    return this.postTokenEndpoint(
      cfg.tokenUrl,
      { grant_type: "refresh_token", refresh_token: refreshToken },
      { user: cfg.clientId, pass: cfg.clientSecret },
    );
  }

  async fetchData(accessToken: string, date: string): Promise<ProviderData> {
    if (!this.isConfigured()) return this.mockData(date);

    const startTs = Math.floor(new Date(date + "T00:00:00Z").getTime() / 1000);
    const endTs   = startTs + 86400;

    const resp = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${startTs}&before=${endTs}&per_page=10`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!resp.ok) return this.mockData(date);
    const activities = await resp.json() as Array<{
      suffer_score?:     number;
      kilojoules?:       number;
      average_heartrate?: number;
    }>;

    // Sum across all activities on this date
    const totalLoad     = activities.reduce((s, a) => s + (a.suffer_score ?? 0), 0);
    const totalKj       = activities.reduce((s, a) => s + (a.kilojoules   ?? 0), 0);

    return {
      date,
      provider:      this.provider,
      trainingLoad:  totalLoad   || null,
      activeCalories: totalKj ? Math.round(totalKj * 0.239) : null,  // kJ → kcal
      rawPayload:    activities,
    };
  }

  private mockData(date: string): ProviderData {
    return {
      date,
      provider:       this.provider,
      trainingLoad:   this.rand(30, 150, 0),
      activeCalories: this.rand(200, 700, 0),
    };
  }
}
