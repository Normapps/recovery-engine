/**
 * Google Fit Adapter — Phase 1
 *
 * OAuth 2.0 (Google Identity)
 * Docs: https://developers.google.com/fit/rest/v1/get-started
 *
 * Required env vars:
 *   GOOGLE_FIT_CLIENT_ID
 *   GOOGLE_FIT_CLIENT_SECRET
 *
 * Data fields available:
 *   Resting HR, steps, active calories
 *
 * Note: Google Fit is being sunset (March 2025). For new integrations,
 * use Google Health Connect (Android) or Apple Health (iOS) instead.
 * This adapter remains for legacy users.
 */

import { ProviderAdapter } from "./base";
import type { OAuthConfig, TokenSet, ProviderData } from "../types";

const DATA_SOURCES = {
  HEART_RATE:  "derived:com.google.heart_rate.bpm:com.google.android.gms:resting_heart_rate<-merge_heart_rate_bpm",
  CALORIES:    "derived:com.google.calories.expended:com.google.android.gms:merge_calories_expended",
};

export class GoogleFitAdapter extends ProviderAdapter {
  readonly provider     = "google_fit" as const;
  readonly displayName  = "Google Fit";

  oauthConfig(): OAuthConfig {
    return {
      authUrl:      "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl:     "https://oauth2.googleapis.com/token",
      clientId:     process.env.GOOGLE_FIT_CLIENT_ID     ?? "",
      clientSecret: process.env.GOOGLE_FIT_CLIENT_SECRET  ?? "",
      scopes: [
        "https://www.googleapis.com/auth/fitness.activity.read",
        "https://www.googleapis.com/auth/fitness.heart_rate.read",
        "https://www.googleapis.com/auth/fitness.sleep.read",
      ],
    };
  }

  buildAuthUrl(redirectUri: string, state: string): string {
    const cfg = this.oauthConfig();
    const p = new URLSearchParams({
      client_id:     cfg.clientId,
      redirect_uri:  redirectUri,
      response_type: "code",
      scope:         cfg.scopes.join(" "),
      access_type:   "offline",     // request refresh token
      prompt:        "consent",
      state,
    });
    return `${cfg.authUrl}?${p.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
    const cfg = this.oauthConfig();
    const resp = await fetch(cfg.tokenUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri:  redirectUri,
        grant_type:    "authorization_code",
      }).toString(),
    });
    if (!resp.ok) throw new Error(`Google token exchange ${resp.status}`);
    const d = await resp.json() as {
      access_token: string; refresh_token?: string; expires_in: number;
    };
    return {
      accessToken:  d.access_token,
      refreshToken: d.refresh_token,
      expiresAt:    Date.now() + d.expires_in * 1000,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<TokenSet> {
    const cfg = this.oauthConfig();
    const resp = await fetch(cfg.tokenUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: refreshToken,
        grant_type:    "refresh_token",
      }).toString(),
    });
    if (!resp.ok) throw new Error(`Google token refresh ${resp.status}`);
    const d = await resp.json() as { access_token: string; expires_in: number };
    return { accessToken: d.access_token, expiresAt: Date.now() + d.expires_in * 1000 };
  }

  async fetchData(accessToken: string, date: string): Promise<ProviderData> {
    if (!this.isConfigured()) return this.mockData(date);

    const startMs = new Date(date + "T00:00:00Z").getTime();
    const endMs   = startMs + 86_400_000;

    const body = JSON.stringify({
      aggregateBy: [
        { dataTypeName: "com.google.heart_rate.bpm",    dataSourceId: DATA_SOURCES.HEART_RATE },
        { dataTypeName: "com.google.calories.expended", dataSourceId: DATA_SOURCES.CALORIES  },
      ],
      bucketByTime: { durationMillis: 86_400_000 },
      startTimeMillis: startMs,
      endTimeMillis:   endMs,
    });

    const resp = await fetch(
      "https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate",
      { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body },
    );
    if (!resp.ok) return this.mockData(date);

    const data = await resp.json();
    const bucket = data?.bucket?.[0];

    let restingHr:      number | null = null;
    let activeCalories: number | null = null;

    for (const ds of bucket?.dataset ?? []) {
      const point = ds.point?.[0];
      if (!point) continue;
      if (ds.dataSourceId?.includes("heart_rate")) restingHr      = point.value?.[0]?.fpVal ?? null;
      if (ds.dataSourceId?.includes("calories"))   activeCalories = point.value?.[0]?.fpVal ?? null;
    }

    return { date, provider: this.provider, restingHr, activeCalories, rawPayload: data };
  }

  private mockData(date: string): ProviderData {
    return {
      date,
      provider:       this.provider,
      restingHr:      this.rand(54, 68, 0),
      activeCalories: this.rand(300, 800, 0),
    };
  }
}
