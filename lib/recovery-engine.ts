/**
 * Recovery Engine — Scoring Algorithm
 *
 * Weights (must sum to 1.0):
 *   Sleep duration + quality  → 0.30
 *   HRV / resting HR          → 0.25
 *   Training load balance     → 0.20
 *   Nutrition                 → 0.20
 *   Recovery modalities       → 0.05
 *
 * Raw inputs are normalized via lib/normalization.ts before scoring.
 */

import type {
  DailyEntry,
  RecoveryScore,
  ScoreBreakdown,
  ConfidenceLevel,
} from "./types";

import { computeRecoveryStateAdjustments } from "./recovery-state";

import {
  normSleepDuration,
  normSleepQualityMultiplier,
  normHRV,
  normRestingHR,
  normBodyBattery,
  normProtein,
  normHydration,
  normCalories,
  normStrengthLoad,
  normCardioLoad,
  normRecoveryCapacity,
  normModalitiesScore,
  simpleAverage,
  finalize,
  clamp,
} from "./normalization";

// ─── Weights ──────────────────────────────────────────────────────────────────

const WEIGHTS = {
  sleep:      0.30,
  hrv:        0.25,
  training:   0.20,
  nutrition:  0.20,
  modalities: 0.05,
} as const;

// ─── Sleep subscore (0–100) ───────────────────────────────────────────────────

function scoreSleep(
  duration: number | null,
  qualityRating: number | null,
): number {
  // Normalize raw duration → 0–100
  let score = duration !== null ? normSleepDuration(duration) : 50;

  // Apply quality multiplier on top of duration score
  if (qualityRating !== null) {
    score = score * normSleepQualityMultiplier(qualityRating);
  }

  return finalize(score);
}

// ─── HRV / Resting HR subscore (0–100) ───────────────────────────────────────

function scoreHRV(
  hrv: number | null,
  restingHR: number | null,
  bodyBattery: number | null,
): number {
  const components: number[] = [];

  if (hrv         !== null) components.push(normHRV(hrv));
  if (restingHR   !== null) components.push(normRestingHR(restingHR));
  if (bodyBattery !== null) components.push(normBodyBattery(bodyBattery));

  return simpleAverage(components);
}

// ─── Training load balance (0–100) ───────────────────────────────────────────

function scoreTraining(
  strengthTraining: boolean,
  strengthDuration: number | null,
  cardio: boolean,
  cardioDuration: number | null,
  coreWork: boolean,
  mobility: boolean,
  iceBath: boolean,
  sauna: boolean,
  compression: boolean,
  massage: boolean,
): number {
  // Build normalized load units using the normalization layer
  let load = 0;
  if (strengthTraining) load += normStrengthLoad(strengthDuration ?? 45);
  if (cardio)           load += normCardioLoad(cardioDuration ?? 30);
  if (coreWork)         load += 8;
  if (mobility)         load -= 10;   // mobility reduces effective load
  load = Math.max(0, Math.min(100, load));

  // Normalized recovery capacity from modality count
  const modalityCount   = [iceBath, sauna, compression, massage].filter(Boolean).length;
  const recoveryCapacity = normRecoveryCapacity(modalityCount);

  // Score relative to load tier × recovery capacity
  let score: number;
  if      (load === 0)   score = 70 + modalityCount * 5;      // rest day bonus
  else if (load < 30)    score = 75 + recoveryCapacity * 20;  // light
  else if (load < 60)    score = 60 + recoveryCapacity * 35;  // moderate
  else                   score = 40 + recoveryCapacity * 50;  // heavy

  return finalize(score);
}

// ─── Nutrition subscore (0–100) ───────────────────────────────────────────────

function scoreNutrition(
  calories: number | null,
  protein: number | null,
  hydration: number | null,
): number {
  const components: number[] = [];

  if (protein   !== null) components.push(normProtein(protein));
  if (hydration !== null) components.push(normHydration(hydration));
  if (calories  !== null) components.push(normCalories(calories));

  return simpleAverage(components);
}

// ─── Recovery modalities subscore (0–100) ────────────────────────────────────

function scoreModalities(
  iceBath: boolean,
  sauna: boolean,
  compression: boolean,
  massage: boolean,
): number {
  const count = [iceBath, sauna, compression, massage].filter(Boolean).length;
  return normModalitiesScore(count);
}

// ─── Confidence / data completeness ──────────────────────────────────────────

function computeConfidence(entry: DailyEntry): {
  confidence: ConfidenceLevel;
  completeness: number;
} {
  const fields = [
    entry.sleep.duration,
    entry.sleep.qualityRating,
    entry.sleep.hrv,
    entry.sleep.restingHR,
    entry.nutrition.calories,
    entry.nutrition.protein,
    entry.nutrition.hydration,
  ];
  const filled       = fields.filter((f) => f !== null && f !== undefined).length;
  const completeness = filled / fields.length;

  const confidence: ConfidenceLevel =
    completeness >= 0.8 ? "High" :
    completeness >= 0.5 ? "Medium" : "Low";

  return { confidence, completeness };
}

// ─── Main scorer ──────────────────────────────────────────────────────────────

/**
 * Compute a RecoveryScore for one entry.
 *
 * @param entry   - Today's DailyEntry (required)
 * @param history - Prior DailyEntry array, most-recent first, excluding today.
 *                  When provided, multi-day Recovery State adjustments are applied
 *                  to the sleep, HRV, and training subscores.
 *                  Omit (or pass []) for single-day behaviour — all existing
 *                  call-sites continue to work without changes.
 */
export function computeRecoveryScore(
  entry: DailyEntry,
  history: DailyEntry[] = [],
): RecoveryScore {
  const { sleep, nutrition, training, recovery } = entry;

  // ── Base subscores (single-day normalized values) ─────────────────────────
  const baseSleep    = scoreSleep(sleep.duration, sleep.qualityRating);
  const baseHRV      = scoreHRV(sleep.hrv, sleep.restingHR, sleep.bodyBattery);
  const baseTraining = scoreTraining(
    training.strengthTraining, training.strengthDuration,
    training.cardio,           training.cardioDuration,
    training.coreWork,         training.mobility,
    recovery.iceBath,          recovery.sauna,
    recovery.compression,      recovery.massage,
  );
  const nutritionScore  = scoreNutrition(nutrition.calories, nutrition.protein, nutrition.hydration);
  const modalitiesScore = scoreModalities(recovery.iceBath, recovery.sauna, recovery.compression, recovery.massage);

  // ── Recovery State adjustments (multi-day, zero when no history) ──────────
  const { sleepAdj, trainingAdj, hrvAdj } = computeRecoveryStateAdjustments(entry, history);

  // Apply adjustments to the three state-sensitive subscores, clamped to 0–100
  const sleepScore    = clamp(baseSleep    + sleepAdj,    0, 100);
  const hrvScore      = clamp(baseHRV      + hrvAdj,      0, 100);
  const trainingScore = clamp(baseTraining + trainingAdj, 0, 100);

  // ── Breakdown (same field names consumed by UI) ───────────────────────────
  const breakdown: ScoreBreakdown = {
    sleep:      sleepScore,
    hrv:        hrvScore,
    training:   trainingScore,
    nutrition:  nutritionScore,
    modalities: modalitiesScore,
  };

  // ── Weighted final score ──────────────────────────────────────────────────
  const calculatedScore = finalize(
    sleepScore      * WEIGHTS.sleep     +
    hrvScore        * WEIGHTS.hrv       +
    trainingScore   * WEIGHTS.training  +
    nutritionScore  * WEIGHTS.nutrition +
    modalitiesScore * WEIGHTS.modalities,
  );

  const { confidence, completeness } = computeConfidence(entry);

  return {
    id:               crypto.randomUUID(),
    date:             entry.date,
    calculatedScore,
    adjustedScore:    null,
    breakdown,
    confidence,
    dataCompleteness: completeness,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getRecoveryTier(score: number): "low" | "mid" | "high" {
  if (score >= 71) return "high";
  if (score >= 41) return "mid";
  return "low";
}

export function getScoreColor(score: number): string {
  if (score >= 71) return "#22C55E";
  if (score >= 41) return "#F59E0B";
  return "#EF4444";
}

export function getEffectiveScore(score: RecoveryScore): number {
  return score.adjustedScore ?? score.calculatedScore;
}
