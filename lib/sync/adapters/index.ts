/**
 * Provider adapter registry.
 *
 * Import getAdapter(provider) wherever you need to work with a specific
 * provider — avoids scattering switch statements across the codebase.
 */

import type { DeviceProvider } from "@/lib/types";
import type { ProviderAdapter } from "./base";
import { WhoopAdapter       } from "./whoop";
import { OuraAdapter        } from "./oura";
import { GarminAdapter      } from "./garmin";
import { StravaAdapter      } from "./strava";
import { AppleHealthAdapter } from "./appleHealth";
import { GoogleFitAdapter   } from "./googleFit";

// Singleton instances — adapters are stateless so one per provider is enough.
const ADAPTERS: Record<DeviceProvider, ProviderAdapter> = {
  whoop:          new WhoopAdapter(),
  oura:           new OuraAdapter(),
  garmin:         new GarminAdapter(),
  strava:         new StravaAdapter(),
  apple_health:   new AppleHealthAdapter(),
  google_fit:     new GoogleFitAdapter(),
  // Training-app-only providers that don't have adapters yet:
  apple_watch:    new AppleHealthAdapter(),   // Apple Watch syncs via Apple Health
  fitbit:         new GoogleFitAdapter(),     // placeholder — swap in FitbitAdapter
  training_peaks: new StravaAdapter(),        // placeholder — swap in TrainingPeaksAdapter
  nike_run_club:  new StravaAdapter(),        // placeholder — swap in NikeAdapter
  myfitnesspal:   new GoogleFitAdapter(),     // placeholder — nutrition-only
  cronometer:     new GoogleFitAdapter(),     // placeholder — nutrition-only
};

export function getAdapter(provider: DeviceProvider): ProviderAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`No adapter registered for provider: ${provider}`);
  return adapter;
}

export { ProviderAdapter } from "./base";
export type { ProviderData, TokenSet, SyncResult } from "../types";
