/**
 * Recovery State — Multi-Day Physiological State Model
 *
 * All types and functions in this file are INTERNAL to the scoring layer.
 * Nothing here is imported by UI components or exposed through store selectors.
 *
 * Computes three state vectors from historical DailyEntry data:
 *   1. SleepState    — rolling debt and trend
 *   2. TrainingLoad  — acute:chronic workload ratio (ACWR)
 *   3. AutonomicState — HRV and RHR multi-day trajectory
 *
 * Each state vector produces a signed adjustment (points) applied to the
 * corresponding subscore inside computeRecoveryScore.  The output shape of
 * RecoveryScore is UNCHANGED.
 */

import type { DailyEntry } from "./types";
import { clamp, lerp } from "./normalization";
import { computeLoadStressAdjustment } from "./load-stress";

// ─── Internal state types (never exported to UI) ──────────────────────────────

interface SleepState {
  debtHours:    number;   // cumulative deficit vs 8h/night over 7 days
  trendDelta:   number;   // recent-3d avg minus prior-3d avg (hours, signed)
  rollingAvg:   number;   // 7-day sleep average (hours)
}

interface TrainingLoad {
  acuteScore:   number;   // 7-day exponentially weighted avg training score
  chronicScore: number;   // 28-day simple avg training score
  acwr:         number;   // acute ÷ chronic ratio
}

interface AutonomicState {
  hrvBaseline:  number;   // 7-day avg HRV excluding today (ms)
  hrvDeltaPct:  number;   // (today − baseline) / baseline × 100 (signed %)
  rhrBaseline:  number;   // 7-day avg RHR excluding today (bpm)
  rhrDeltaBpm:  number;   // today − baseline (signed bpm, lower today = negative = good)
}

/** Aggregate adjustment vector returned to recovery-engine.ts */
export interface RecoveryStateAdjustments {
  sleepAdj:    number;   // signed points added to sleepScore    (−25 … +10)
  trainingAdj: number;   // signed points added to trainingScore (−20 … +5)
  hrvAdj:      number;   // signed points added to hrvScore      (−10 … +8)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Safely get the sleep duration for a given entry, returning null if absent. */
function sleepHours(entry: DailyEntry): number | null {
  return entry.sleep.duration;
}

/** Approximate training score for a historical entry without re-running full scorer. */
function approxTrainingScore(entry: DailyEntry): number {
  const { training, recovery } = entry;
  let load = 0;
  if (training.strengthTraining) load += Math.min(50, ((training.strengthDuration ?? 45) / 90) * 50);
  if (training.cardio)           load += Math.min(35, ((training.cardioDuration  ?? 30) / 60) * 35);
  if (training.coreWork)         load += 8;
  if (training.mobility)         load -= 10;
  load = Math.max(0, Math.min(100, load));

  const modalities = [recovery.iceBath, recovery.sauna, recovery.compression, recovery.massage]
    .filter(Boolean).length;
  const capacity = 0.40 + modalities * 0.15;

  if      (load === 0)  return Math.min(100, 70 + modalities * 5);
  else if (load < 30)  return 75 + capacity * 20;
  else if (load < 60)  return 60 + capacity * 35;
  else                 return 40 + capacity * 50;
}

/** Simple mean of a non-empty array; returns fallback when empty. */
function mean(values: number[], fallback = 0): number {
  if (values.length === 0) return fallback;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ─── State computers ──────────────────────────────────────────────────────────

/**
 * SleepState — debt + trend from up to 7 prior entries.
 *
 * Sleep debt: cumulative hours below an 8h target.
 * Trend: recent-3-day avg minus prior-3-day avg (positive = improving).
 */
function computeSleepState(history: DailyEntry[]): SleepState {
  const TARGET_HOURS = 8;
  const window = history.slice(0, 7);   // most-recent first

  const sleepValues = window
    .map(sleepHours)
    .filter((v): v is number => v !== null);

  const debtHours = sleepValues
    .slice(0, 7)
    .reduce((sum, h) => sum + Math.max(0, TARGET_HOURS - h), 0);

  const recent3 = mean(sleepValues.slice(0, 3));
  const prior3  = mean(sleepValues.slice(3, 6));
  const trendDelta = prior3 > 0 ? recent3 - prior3 : 0;

  return {
    debtHours,
    trendDelta,
    rollingAvg: mean(sleepValues, TARGET_HOURS),
  };
}

/**
 * TrainingLoad — ACWR from prior 28 days.
 *
 * Acute load: exponentially weighted 7-day average (recent days weighted higher).
 * Chronic load: simple 28-day average.
 * ACWR = acute ÷ chronic (floor chronic at 20 to stabilise new-athlete readings).
 */
function computeTrainingLoad(history: DailyEntry[]): TrainingLoad {
  // Acute: weights [7,6,5,4,3,2,1] over 7 days (normalized)
  const ACUTE_DAYS    = 7;
  const CHRONIC_DAYS  = 28;
  const rawWeights    = Array.from({ length: ACUTE_DAYS }, (_, i) => ACUTE_DAYS - i);
  const weightSum     = rawWeights.reduce((a, b) => a + b, 0);

  const acuteEntries  = history.slice(0, ACUTE_DAYS);
  let   acuteScore    = 0;
  acuteEntries.forEach((e, i) => {
    acuteScore += approxTrainingScore(e) * (rawWeights[i] / weightSum);
  });

  const chronicEntries = history.slice(0, CHRONIC_DAYS);
  const chronicScore   = mean(chronicEntries.map(approxTrainingScore), 50);

  const acwr = acuteScore / Math.max(chronicScore, 20);

  return { acuteScore, chronicScore, acwr };
}

/**
 * AutonomicState — HRV and RHR trajectories vs 7-day baseline.
 *
 * Baseline is computed from days 1-7 in history (excluding day 0 = today's prior entry)
 * so the "today" score stands against a stable reference window.
 */
function computeAutonomicState(today: DailyEntry, history: DailyEntry[]): AutonomicState {
  const window = history.slice(0, 7);

  const hrvValues = window
    .map((e) => e.sleep.hrv)
    .filter((v): v is number => v !== null);
  const rhrValues = window
    .map((e) => e.sleep.restingHR)
    .filter((v): v is number => v !== null);

  const hrvBaseline = mean(hrvValues, 0);
  const rhrBaseline = mean(rhrValues, 0);

  const todayHRV = today.sleep.hrv;
  const todayRHR = today.sleep.restingHR;

  const hrvDeltaPct = (todayHRV !== null && hrvBaseline > 0)
    ? ((todayHRV - hrvBaseline) / hrvBaseline) * 100
    : 0;

  const rhrDeltaBpm = (todayRHR !== null && rhrBaseline > 0)
    ? todayRHR - rhrBaseline
    : 0;

  return { hrvBaseline, hrvDeltaPct, rhrBaseline, rhrDeltaBpm };
}

// ─── Adjustment calculators ───────────────────────────────────────────────────

/**
 * Sleep adjustment (−25 … +10 pts).
 *
 * Penalty for accumulated debt; bonus for a positive trend.
 * Both capped to prevent runaway scores.
 */
function sleepAdjustment(state: SleepState): number {
  // Debt penalty: each deficit-hour across the week costs ~3 pts
  const debtPenalty = clamp(state.debtHours * 3, 0, 25);

  // Trend bonus: improving sleep trend adds pts, declining subtracts
  // ±1h avg change over 3 days → ±5 pts
  const trendBonus  = clamp(state.trendDelta * 5, -10, 10);

  return clamp(-debtPenalty + trendBonus, -25, 10);
}

/**
 * ACWR training adjustment (−20 … +5 pts).
 *
 * Sweet spot 0.8–1.3 earns a small bonus.
 * Spike above 1.3 or detraining below 0.5 incurs penalties.
 */
function trainingAdjustment(load: TrainingLoad): number {
  const { acwr } = load;

  if (acwr >= 0.8 && acwr <= 1.3) return 5;                              // sweet spot
  if (acwr > 1.3  && acwr <= 1.5) return Math.round(lerp(acwr, 1.3, 1.5, 5, -8));  // creeping spike
  if (acwr > 1.5)                  return clamp(Math.round(lerp(acwr, 1.5, 2.5, -8, -20)), -20, -8); // spike
  if (acwr >= 0.5 && acwr < 0.8)  return Math.round(lerp(acwr, 0.5, 0.8, -10, 0)); // detraining
  return -10;                                                             // severe detraining (<0.5)
}

/**
 * Autonomic adjustment (−10 … +8 pts) from HRV and RHR trends.
 *
 * HRV ≥10% above baseline → parasympathetic dominance → positive.
 * RHR ≥3 bpm below baseline → cardiovascular readiness → positive.
 */
function autonomicAdjustment(state: AutonomicState): number {
  // HRV: +1pt per 2% above baseline, −1pt per 2% below (cap ±8)
  const hrvAdj = clamp(state.hrvDeltaPct * 0.4, -8, 8);

  // RHR: lower than baseline is better (negative delta = positive adjustment)
  // −3 bpm → +4 pts, +3 bpm → −4 pts
  const rhrAdj = clamp(-state.rhrDeltaBpm * 1.3, -6, 6);

  // Blend: HRV carries 60% weight, RHR 40%
  return Math.round(clamp(hrvAdj * 0.6 + rhrAdj * 0.4, -10, 8));
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * computeRecoveryStateAdjustments
 *
 * Given today's entry and a history array (most-recent first, excluding today),
 * returns signed point adjustments for sleep, training, and HRV subscores.
 *
 * Returns zero adjustments when history is empty — preserves single-day behaviour.
 */
export function computeRecoveryStateAdjustments(
  todayEntry: DailyEntry,
  history: DailyEntry[],
): RecoveryStateAdjustments {
  if (history.length === 0) {
    return { sleepAdj: 0, trainingAdj: 0, hrvAdj: 0 };
  }

  const sleepState  = computeSleepState(history);
  const trainLoad   = computeTrainingLoad(history);
  const autonomic   = computeAutonomicState(todayEntry, history);

  // ACWR adjustment (ratio-based: detraining ↔ spike risk)
  const acwrAdj = trainingAdjustment(trainLoad);

  // Load Stress adjustment (volume + monotony + strain from raw session AU)
  const loadAdj = computeLoadStressAdjustment(history);

  // Blend: ACWR carries 60% weight (ratio signal), Load Stress 40% (volume signal)
  // Together these capture both the training balance and the raw fatigue accumulation.
  const trainingAdj = clamp(Math.round(acwrAdj * 0.6 + loadAdj * 0.4), -20, 5);

  return {
    sleepAdj:    sleepAdjustment(sleepState),
    trainingAdj,
    hrvAdj:      autonomicAdjustment(autonomic),
  };
}
