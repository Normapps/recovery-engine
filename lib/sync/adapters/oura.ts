/**
 * Oura Ring Adapter — Phase 3
 *
 * OAuth 2.0
 * Docs: https://cloud.ouraring.com/v2/docs
 *
 * Required env vars:
 *   OURA_CLIENT_ID
 *   OURA_CLIENT_SECRET
 *
 * Data fields available:
 *   HRV, resting HR, sleep duration, readiness score
 */

import { ProviderAdapter } from "./base";
import type { OAuthConfig, TokenSet, ProviderData } from "../types";

export class OuraAdapter extends ProviderAdapter {
  readonly provider     = "oura" as const;
  readonly displayName  = "Oura Ring";

  oauthConfig(): OAuthConfig {
    return {
      authUrl:      "https://cloud.ouraring.com/oauth/authorize",
      tokenUrl:     "https://api.ouraring.com/oauth/token",
      clientId:     process.env.OURA_CLIENT_ID     ?? "",
      clientSecret: process.env.OURA_CLIENT_SECRET  ?? "",
      scopes:       ["daily"],
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

    const [sleepResp, readinessResp] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${date}&end_date=${date}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${date}&end_date=${date}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    ]);

    const sleepBody     = sleepResp.ok     ? await sleepResp.json()     : null;
    const readinessBody = readinessResp.ok ? await readinessResp.json() : null;

    // Use the longest sleep session for the date
    const sleepSessions = sleepBody?.data ?? [];
    const mainSleep     = sleepSessions.reduce(
      (best: Record<string, number> | null, s: Record<string, number>) =>
        !best || s.total_sleep_duration > best.total_sleep_duration ? s : best,
      null,
    );
    const readiness = readinessBody?.data?.[0];

    return {
      date,
      provider:   this.provider,
      sleepHours: mainSleep ? mainSleep.total_sleep_duration / 3600 : null,
      hrv:        mainSleep?.average_hrv                            ?? null,
      restingHr:  mainSleep?.lowest_heart_rate                      ?? null,
      rawPayload: { sleep: sleepBody, readiness: readinessBody },
    };
  }

  private mockData(date: string): ProviderData {
    return {
      date,
      provider:   this.provider,
      sleepHours: this.rand(7.0, 8.5),
      hrv:        this.rand(50, 95, 0),
      restingHr:  this.rand(48, 62, 0),
    };
  }
}
