/**
 * Load Stress — Session and Cumulative Training Stress Model
 *
 * INTERNAL MODULE. Not imported by any UI component or store selector.
 *
 * Implements a three-layer stress model:
 *
 *   Layer 1 — Session Load (AU)
 *     Raw arbitrary units per session, derived from DailyEntry training fields.
 *     Based on Foster's session-RPE method: load = duration × perceived intensity.
 *     Perceived intensity is inferred from training type + modality usage
 *     (athletes use more recovery tools after harder sessions).
 *
 *   Layer 2 — Load Monotony & Strain (Foster 1998)
 *     Monotony  = weekly mean load ÷ weekly SD of daily loads
 *                 (high monotony = same stress every day = greater fatigue risk)
 *     Strain    = weekly cumulative load × monotony
 *                 (synthesises volume AND variability into one fatigue signal)
 *
 *   Layer 3 — Load Stress Score (0–100, internal)
 *     Normalised strain relative to population reference ranges.
 *     Used exclusively to produce a signed point adjustment to the training
 *     subscore inside recovery-state.ts. Never exposed to UI.
 *
 * Reference ranges (recreational-to-elite continuum):
 *   Weekly load  < 500 AU      → low volume
 *   Weekly load  500–1500 AU   → moderate (team sport baseline)
 *   Weekly load  1500–3000 AU  → high (competitive)
 *   Weekly load  > 3000 AU     → very high (elite / overreaching risk)
 *
 *   Strain       < 2 000       → well-managed
 *   Strain       2 000–5 000   → accumulating fatigue
 *   Strain       > 5 000       → overreaching zone
 */

import type { DailyEntry } from "./types";
import { clamp, lerp, piecewise } from "./normalization";

// ─── Internal types ───────────────────────────────────────────────────────────

/** Per-session raw stress in Arbitrary Units (AU). */
interface SessionLoad {
  strengthAU:  number;
  cardioAU:    number;
  supplementalAU: number;   // core work, mobility offset
  totalAU:     number;
}

/** 7-day rolling load stress state. */
interface WeeklyLoadState {
  dailyLoads:    number[];   // AU per day for the past 7 days (most-recent first)
  cumulativeAU:  number;     // 7-day sum
  meanDailyAU:   number;     // 7-day mean
  stdDevAU:      number;     // 7-day standard deviation
  monotony:      number;     // mean ÷ stdDev (clamped, higher = more fatiguing)
  strain:        number;     // cumulativeAU × monotony
}

/** Normalised stress score and its signed adjustment. */
interface LoadStressResult {
  weeklyLoad:      number;   // raw AU (internal reference only)
  strain:          number;   // Foster strain metric
  monotony:        number;
  stressScore:     number;   // 0–100 normalised strain
  adjustment:      number;   // signed pts to add to training subscore
}

// ─── Layer 1 — Session Load ───────────────────────────────────────────────────

/**
 * Intensity multiplier for strength sessions.
 *
 * We infer intensity from modality usage — athletes tend to deploy more
 * recovery tools after harder sessions.  Modality count shifts the multiplier
 * from 1.4 (light, no tools used) up to 2.8 (very hard, full modality stack).
 */
function strengthIntensityMultiplier(entry: DailyEntry): number {
  const modalityCount = [
    entry.recovery.iceBath,
    entry.recovery.sauna,
    entry.recovery.compression,
    entry.recovery.massage,
  ].filter(Boolean).length;

  // 0 → 1.4 (light),  4 → 2.8 (very heavy)
  return 1.4 + modalityCount * 0.35;
}

/**
 * Intensity multiplier for cardio sessions.
 *
 * Cardio intensity is modelled as a fixed moderate (1.8) when no other signal
 * is available — consistent with a 65–75 % HRmax steady-state effort.
 * Ice bath use after cardio elevates to 2.4 (interval/threshold indicator).
 */
function cardioIntensityMultiplier(entry: DailyEntry): number {
  return entry.recovery.iceBath ? 2.4 : 1.8;
}

/**
 * Compute raw session load (AU) for one DailyEntry.
 *
 *   Strength load = duration (min) × strength_intensity_multiplier
 *   Cardio load   = duration (min) × cardio_intensity_multiplier
 *   Core work     = +25 AU (fixed neuromuscular tax)
 *   Mobility      = −20 AU (active recovery offset)
 *   Total         = max(0, sum)
 */
export function computeSessionLoad(entry: DailyEntry): SessionLoad {
  const { training } = entry;

  const strengthAU = training.strengthTraining
    ? (training.strengthDuration ?? 45) * strengthIntensityMultiplier(entry)
    : 0;

  const cardioAU = training.cardio
    ? (training.cardioDuration ?? 30) * cardioIntensityMultiplier(entry)
    : 0;

  const supplementalAU =
    (training.coreWork  ? 25  : 0) +
    (training.mobility  ? -20 : 0);

  const totalAU = Math.max(0, strengthAU + cardioAU + supplementalAU);

  return { strengthAU, cardioAU, supplementalAU, totalAU };
}

// ─── Layer 2 — Weekly Load State (Monotony & Strain) ─────────────────────────

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Compute 7-day load stress state from a history window.
 *
 * history: DailyEntry[], most-recent first.  Uses up to 7 entries.
 *
 * Monotony floors at 1.0 (cannot be less than neutral) and caps at 10.0
 * to prevent division-by-zero artefacts on very consistent low-load weeks.
 */
function computeWeeklyLoadState(history: DailyEntry[]): WeeklyLoadState {
  const window     = history.slice(0, 7);
  const dailyLoads = window.map((e) => computeSessionLoad(e).totalAU);

  const cumulativeAU = dailyLoads.reduce((a, b) => a + b, 0);
  const meanDailyAU  = dailyLoads.length > 0 ? cumulativeAU / dailyLoads.length : 0;
  const stdDevAU     = stdDev(dailyLoads);

  // Monotony = mean ÷ SD; guard against zero SD (perfectly consistent load)
  const monotony = stdDevAU > 0
    ? clamp(meanDailyAU / stdDevAU, 1.0, 10.0)
    : meanDailyAU > 0 ? 10.0 : 1.0;

  const strain = cumulativeAU * monotony;

  return { dailyLoads, cumulativeAU, meanDailyAU, stdDevAU, monotony, strain };
}

// ─── Layer 3 — Load Stress Score & Adjustment ────────────────────────────────

/**
 * Normalise Foster strain to a 0–100 stress score.
 *
 * Reference thresholds (recreational-to-elite population):
 *   <  2 000  → well-managed          →  0–40
 *   2–5 000   → accumulating fatigue  → 40–75
 *   5–8 000   → overreaching zone     → 75–90
 *   > 8 000   → severe overload       → 90–100
 */
function normaliseStrain(strain: number): number {
  return piecewise(strain, [
    [0,     0 ],
    [500,   15],
    [2000,  40],
    [3500,  60],
    [5000,  75],
    [8000,  90],
    [12000, 100],
  ] as const);
}

/**
 * Convert a 0–100 stress score to a signed training-subscore adjustment.
 *
 * Low stress  → athlete is managing load well → small positive signal
 * Moderate    → neutral zone → no adjustment
 * High stress → cumulative fatigue → negative adjustment
 * Severe      → overreaching → significant negative adjustment
 *
 * Range: −20 … +5 pts
 */
function stressScoreToAdjustment(stressScore: number): number {
  if (stressScore < 20)  return 5;                                          // very low — well-rested
  if (stressScore < 40)  return Math.round(lerp(stressScore, 20, 40, 5, 0)); // tapering
  if (stressScore < 65)  return 0;                                          // neutral training zone
  if (stressScore < 80)  return Math.round(lerp(stressScore, 65, 80, 0, -10)); // accumulating
  if (stressScore < 90)  return Math.round(lerp(stressScore, 80, 90, -10, -17)); // high
  return Math.round(lerp(stressScore, 90, 100, -17, -20));                  // overreaching
}

// ─── Public interface (used only by recovery-state.ts) ───────────────────────

/**
 * computeLoadStressAdjustment
 *
 * Entry point for recovery-state.ts.  Takes the history window and returns
 * a single signed integer (pts) to be merged into the training subscore
 * adjustment.  All intermediate state is discarded — nothing is stored or
 * exposed to the UI layer.
 *
 * Returns 0 when history is empty (preserves single-day fallback behaviour).
 */
export function computeLoadStressAdjustment(history: DailyEntry[]): number {
  if (history.length === 0) return 0;

  const weeklyState = computeWeeklyLoadState(history);
  const stressScore = normaliseStrain(weeklyState.strain);
  return stressScoreToAdjustment(stressScore);
}

/**
 * computeLoadStressResult
 *
 * Extended version for internal debugging or future analytics pipelines.
 * Returns the full intermediate state — useful for unit tests or a future
 * internal diagnostics endpoint.  Still not exported to any UI path.
 */
export function computeLoadStressResult(history: DailyEntry[]): LoadStressResult {
  if (history.length === 0) {
    return { weeklyLoad: 0, strain: 0, monotony: 1, stressScore: 0, adjustment: 0 };
  }

  const weeklyState = computeWeeklyLoadState(history);
  const stressScore = normaliseStrain(weeklyState.strain);
  const adjustment  = stressScoreToAdjustment(stressScore);

  return {
    weeklyLoad:  weeklyState.cumulativeAU,
    strain:      weeklyState.strain,
    monotony:    weeklyState.monotony,
    stressScore,
    adjustment,
  };
}
