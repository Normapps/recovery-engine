/**
 * Apple Health Adapter — Phase 1
 *
 * Apple Health (HealthKit) does not expose a web OAuth API.
 * Data is accessed via:
 *   A) A native iOS companion app that reads HealthKit and POSTs to our API
 *   B) Apple's Health Records API (clinical data only, not fitness)
 *
 * For this app we implement a "push" model:
 *   - A companion iOS shortcut / app calls POST /api/sync/apple_health
 *     with a payload of health metrics
 *   - This adapter parses that payload
 *
 * The "OAuth" flow here redirects users to a setup guide instead.
 * Set APPLE_HEALTH_WEBHOOK_SECRET in env to authenticate incoming pushes.
 *
 * No real API calls are made from this server — data is pushed TO us.
 */

import { ProviderAdapter } from "./base";
import type { OAuthConfig, TokenSet, ProviderData } from "../types";

export class AppleHealthAdapter extends ProviderAdapter {
  readonly provider     = "apple_health" as const;
  readonly displayName  = "Apple Health";

  oauthConfig(): OAuthConfig {
    // Apple Health uses a push model, not a traditional OAuth pull.
    // The authUrl below points to a setup guide page.
    return {
      authUrl:      `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/setup/apple-health`,
      tokenUrl:     "",
      clientId:     process.env.APPLE_HEALTH_WEBHOOK_SECRET ?? "apple_health_push",
      clientSecret: process.env.APPLE_HEALTH_WEBHOOK_SECRET ?? "",
      scopes:       [],
    };
  }

  /** No OAuth exchange — "connect" just marks the provider as active. */
  async exchangeCode(_code: string, _redirectUri: string): Promise<TokenSet> {
    return { accessToken: `apple_health_push_${Date.now()}` };
  }

  async refreshAccessToken(_refreshToken: string): Promise<TokenSet> {
    return { accessToken: `apple_health_push_${Date.now()}` };
  }

  /**
   * Parse an incoming push payload from the iOS companion app.
   * The payload shape mirrors the Apple HealthKit quantity types.
   *
   * Expected body (POSTed by the iOS shortcut):
   * {
   *   heartRateVariabilitySDNN:  65,   // ms
   *   restingHeartRate:          52,   // bpm
   *   sleepAnalysis:             7.5,  // hours
   *   activeEnergyBurned:        450,  // kcal
   * }
   */
  async fetchData(_accessToken: string, date: string): Promise<ProviderData> {
    // fetchData is not called for push-based providers.
    // Incoming data is handled directly in the /api/sync/apple_health route.
    return this.mockData(date);
  }

  /** Parse a push payload into normalized ProviderData. */
  parseWebhookPayload(
    payload: Record<string, number | null>,
    date:    string,
  ): ProviderData {
    return {
      date,
      provider:   this.provider,
      hrv:        payload.heartRateVariabilitySDNN ?? null,
      restingHr:  payload.restingHeartRate         ?? null,
      sleepHours: payload.sleepAnalysis            ?? null,
      activeCalories: payload.activeEnergyBurned   ?? null,
      rawPayload: payload,
    };
  }

  private mockData(date: string): ProviderData {
    return {
      date,
      provider:   this.provider,
      sleepHours: this.rand(6.5, 8.5),
      hrv:        this.rand(35, 75, 0),
      restingHr:  this.rand(52, 68, 0),
    };
  }
}
