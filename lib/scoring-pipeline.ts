/**
 * Recovery Scoring Pipeline — Authoritative Single Entry Point
 *
 * Consolidates all five scoring stages into one call.  Returns an output
 * shape that is EXACTLY compatible with what the UI expects:
 *
 *   {
 *     recovery_score,
 *     zone,
 *     recommendations,
 *     breakdown: { recovery_state, load_stress, injury_impact }
 *   }
 *
 * ─── Stage map ───────────────────────────────────────────────────────────────
 *
 *  Stage 1 │ Input normalization
 *           │ Raw athlete values → 0–100 per dimension
 *           │ lib/normalization.ts
 *           │
 *  Stage 2 │ Recovery State
 *           │ Multi-day sleep debt, ACWR, autonomic HRV/RHR trend
 *           │ lib/recovery-state.ts
 *           │  → produces:  breakdown.recovery_state  (0–100)
 *           │
 *  Stage 3 │ Load Stress
 *           │ Session AU, Foster monotony / strain
 *           │ lib/load-stress.ts
 *           │  → produces:  breakdown.load_stress  (0–100, 100 = minimal stress)
 *           │
 *  Stage 4 │ Final Score
 *           │ Weighted composite + bloodwork modifier + training-plan context
 *           │ lib/final-scorer.ts → computeFinalRecoveryScore
 *           │  → produces:  recovery_score (0–100),  zone (5-tier)
 *           │
 *  Stage 5 │ Recommendations
 *           │ 3 targeted modalities derived from full context
 *           │ lib/modality-recommendations.ts → unifiedRecoveryEngine
 *           │  → produces:  recommendations: [string, string, string]
 *           │
 *  Stage 6 │ Interpretation
 *           │ Raw dimension subscores → plain-English athlete insights
 *           │ lib/interpretation-engine.ts → interpretFromBreakdown
 *           │  → produces:  interpretation: { interpretations, primary_driver }
 *
 * ─── Field contract ───────────────────────────────────────────────────────────
 *
 *   recovery_score    — 0–100 authoritative final score (ring display)
 *   zone              — "optimal"|"high"|"moderate"|"low"|"critical"
 *   recommendations   — exactly 3 strings, one per modality category
 *   breakdown.recovery_state  — 0–100; 50 = neutral (no history), >50 = trending up
 *   breakdown.load_stress     — 0–100; 100 = no cumulative stress, 0 = overreaching
 *   breakdown.injury_impact   — 0–100; 100 = no injury, <100 = injury suppresses score
 *                               // UI TODO: wire in injury store when injury tracking exists
 *   interpretation.interpretations — string[] per weak dimension (most concerning first)
 *   interpretation.primary_driver  — single biggest negative contributor as noun phrase
 *
 * ─── Usage note ───────────────────────────────────────────────────────────────
 *
 *   // UI TODO: replace the dual computeFinalRecoveryScore + unifiedRecoveryEngine
 *   // calls in app/page.tsx and DailyLogForm.tsx with a single runScoringPipeline()
 *   // call; consume breakdown.recovery_state / load_stress / injury_impact in new
 *   // ScoreCard slots once the UI is ready.
 */

import type { DailyEntry, BloodworkPanel, TrainingDay, IntensityLevel } from "./types";
import type { RecoveryZone } from "./final-scorer";
import { clamp } from "./normalization";
import { computeRecoveryStateAdjustments } from "./recovery-state";
import { computeLoadStressResult }          from "./load-stress";
import { computeFinalRecoveryScore, getFinalZone } from "./final-scorer";
import {
  buildUnifiedInput,
  unifiedRecoveryEngine,
} from "./modality-recommendations";
import {
  interpretFromBreakdown,
  type InterpretationOutput,
} from "./interpretation-engine";

// ─── Output contract ──────────────────────────────────────────────────────────

export interface ScoringPipelineBreakdown {
  /**
   * Multi-day physiological state score (0–100).
   *
   * Derived from the combined signed adjustments produced by the Recovery State
   * stage (sleep debt, ACWR, autonomic HRV/RHR trend).
   *
   *   50  — neutral (no history, all adjustments are zero)
   *   >50 — positive trend (sleeping well, good ACWR, HRV improving)
   *   <50 — accumulated fatigue or autonomic suppression
   *
   * Each adjustment point maps linearly to one score point so the value is
   * directly interpretable by coaches and athletes.
   */
  recovery_state: number;

  /**
   * Cumulative load stress score (0–100).
   *
   * Inverted from the Foster strain stress score so that higher = better:
   *   100 — minimal accumulated load, athlete is well-rested
   *   50  — moderate weekly strain (active training block)
   *   0   — overreaching territory (strain > 8 000 AU)
   */
  load_stress: number;

  /**
   * Injury impact score (0–100).
   *
   *   100 — no active injury; score is unaffected
   *   <100 — injury present; score is suppressed proportionally
   *
   * NOTE: injury tracking is not yet implemented. This field always returns 100
   * until an injury store and assessment flow are added.
   *
   * // UI TODO: add injury toggle / severity input to DailyLogForm and
   * //          thread the resulting impact value through here.
   */
  injury_impact: number;
}

export interface ScoringPipelineOutput {
  /** Authoritative final score (0–100). Maps to the score ring. */
  recovery_score: number;

  /**
   * Five-tier zone classification.
   * Maps to the existing three-tier UI system via zoneToTier():
   *   "optimal" | "high"  → "high"   (green)
   *   "moderate"          → "mid"    (amber)
   *   "low" | "critical"  → "low"    (red)
   *
   * // UI TODO: expose zone-level labels ("Optimal", "Peak", etc.) in the
   * //          score ring subtitle once the design is ready.
   */
  zone: RecoveryZone;

  /**
   * Exactly 3 recommendation strings, one per modality category:
   *   [0] Circulation
   *   [1] Tissue work
   *   [2] Nervous system
   *
   * Format: "<Name> · <duration> — <reason>"
   * Compatible with the existing UI recommendation card rendering.
   */
  recommendations: [string, string, string];

  /** Per-dimension subscores for breakdown display. */
  breakdown: ScoringPipelineBreakdown;

  /**
   * Human-readable interpretation of the day's recovery picture.
   *
   *   interpretations  — one plain-English sentence per weak dimension,
   *                       ordered most-concerning first.  Always non-empty
   *                       (carries an all-clear message when all is well).
   *   primary_driver   — the single biggest negative contributor today,
   *                       as a short noun phrase ("Sleep quality", "HRV and
   *                       nervous system recovery", etc.).  Returns a
   *                       positive phrase when no limiter is present.
   *
   * Produced by Stage 6 of the pipeline (lib/interpretation-engine.ts).
   * No numbers or percentages are ever included in these strings.
   */
  interpretation: InterpretationOutput;
}

// ─── Stage 2 helper — Recovery State → 0–100 subscore ────────────────────────

/**
 * Normalise the signed adjustment vector from the Recovery State stage into a
 * single 0–100 subscore.
 *
 * Adjustment ranges:
 *   sleepAdj:    −25 … +10  (sleep debt penalty / trend bonus)
 *   trainingAdj: −20 … +5   (ACWR / load-stress blend)
 *   hrvAdj:      −10 … +8   (autonomic HRV & RHR trend)
 *   combined:    −55 … +23
 *
 * Mapping: neutral (combined = 0, no history) → 50.
 * Each adjustment point equals one score point so the value is intuitive.
 * Clamped to [0, 100]; maximum negative (−55) clamps to 0 before reaching it.
 */
function recoveryStateToScore(
  sleepAdj:    number,
  trainingAdj: number,
  hrvAdj:      number,
): number {
  const combined = sleepAdj + trainingAdj + hrvAdj;
  // 50 = neutral baseline; combined shifts the score symmetrically
  return clamp(Math.round(50 + combined), 0, 100);
}

// ─── Stage 3 helper — Load Stress → 0–100 subscore ───────────────────────────

/**
 * Convert the Foster strain stress score (0–100, higher = more stress) into a
 * recovery-friendly subscore (0–100, higher = less stress = better).
 */
function loadStressToScore(stressScore: number): number {
  return clamp(100 - Math.round(stressScore), 0, 100);
}

// ─── Stage 6 helper — Session load AU derivation ─────────────────────────────

/**
 * Multipliers that map intensity level to a perceived-effort scalar.
 *
 * Based on Foster's session-RPE method (session load = duration × RPE):
 *   low      → RPE ~3  (easy / recovery)
 *   moderate → RPE ~5  (comfortable working effort)
 *   high     → RPE ~8  (hard / race-pace / game)
 *
 * Reference thresholds in interpretFromBreakdown:
 *   ~300 AU = moderate session | 600+ AU = heavy session (saturates at 100).
 *
 * Examples:
 *   90 min moderate = 450 AU (load_today_score ≈ 75 — elevated)
 *   90 min high     = 720 AU → capped → load_today_score = 100
 *   60 min low      = 180 AU (load_today_score = 30 — acceptable)
 */
const INTENSITY_AU_MULTIPLIER: Record<IntensityLevel, number> = {
  low:      3,
  moderate: 5,
  high:     8,
};

/**
 * Estimate today's session load in Arbitrary Units from available plan + entry data.
 *
 * Priority:
 *   1. Training plan day (todayPlan) — uses structured duration + intensity.
 *   2. DailyEntry training fields    — sums logged strength + cardio durations
 *                                      at a moderate effort assumption.
 *   3. Zero when no training data is present.
 */
function deriveSessionLoadAU(
  todayPlan: TrainingDay | null | undefined,
  entry:     DailyEntry,
): number {
  // Prefer structured plan data when available
  if (todayPlan && todayPlan.training_type !== "off" && todayPlan.duration > 0) {
    return todayPlan.duration * INTENSITY_AU_MULTIPLIER[todayPlan.intensity];
  }

  // Fall back to logged training entry (assume moderate effort)
  const strengthAU = entry.training.strengthTraining
    ? (entry.training.strengthDuration ?? 45) * INTENSITY_AU_MULTIPLIER.moderate
    : 0;
  const cardioAU = entry.training.cardio
    ? (entry.training.cardioDuration ?? 30) * INTENSITY_AU_MULTIPLIER.moderate
    : 0;

  return strengthAU + cardioAU;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * runScoringPipeline
 *
 * Single entry point for the complete 5-stage scoring pipeline.
 * Stages 1–4 produce recovery_score + zone + breakdown subscores.
 * Stage 5 produces the 3-string recommendation tuple.
 *
 * All intermediate data is discarded; only the final ScoringPipelineOutput
 * is returned.
 *
 * @param entry        Today's logged DailyEntry (required)
 * @param history      Prior entries, most-recent first (enables Stages 2 & 3)
 * @param bwPanel      Latest bloodwork panel (Stage 4 modifier, ±12 pts)
 * @param todayPlan    Planned training for today  (Stage 4 & 5 context)
 * @param tomorrowPlan Planned training for tomorrow (Stage 4 & 5 context)
 * @param moodRating   Optional 1–5 mood rating from moodLog (null = unknown → neutral)
 */
export function runScoringPipeline(
  entry:         DailyEntry,
  history:       DailyEntry[]      = [],
  bwPanel?:      BloodworkPanel | null,
  todayPlan?:    TrainingDay | null,
  tomorrowPlan?: TrainingDay | null,
  moodRating?:   number | null,
): ScoringPipelineOutput {

  // ── Stage 2: Recovery State ──────────────────────────────────────────────
  // Computes multi-day adjustments: sleep debt, ACWR, autonomic HRV/RHR trend.
  // Returns zero adjustments when history is empty (safe single-day fallback).
  const { sleepAdj, trainingAdj, hrvAdj } = computeRecoveryStateAdjustments(
    entry,
    history,
  );
  const recovery_state = recoveryStateToScore(sleepAdj, trainingAdj, hrvAdj);

  // ── Stage 3: Load Stress ─────────────────────────────────────────────────
  // Computes Foster session AU, weekly monotony, and strain.
  // Returns score=0 / adjustment=0 when history is empty.
  const loadResult  = computeLoadStressResult(history);
  const load_stress = loadStressToScore(loadResult.stressScore);

  // ── Stage 4: Final Score ─────────────────────────────────────────────────
  // Runs the full 7-stage internal pipeline:
  //   normalization → recovery state → weighted composite →
  //   bloodwork modifier → training-plan context → clamp → zone
  // The bloodwork modifier and training-plan deltas are applied here only
  // (not re-applied in Stage 5) to avoid double-counting.
  const finalScore     = computeFinalRecoveryScore(
    entry,
    history,
    bwPanel,
    todayPlan,
    tomorrowPlan,
  );
  const recovery_score = finalScore.calculatedScore;
  const zone           = getFinalZone(recovery_score);

  // ── Stage 5: Recommendations ─────────────────────────────────────────────
  // Selects exactly 3 modalities (circulation · tissue · nervous system)
  // using the full physiological + training-plan context.
  // bloodwork_modifier is passed as 0 because it is already baked into
  // recovery_score from Stage 4 — passing it again would double-count it.
  const unifiedInput = buildUnifiedInput(
    recovery_score,
    finalScore.breakdown,
    entry,
    todayPlan,
    tomorrowPlan,
    bwPanel,
    0,   // bloodwork already applied in Stage 4
  );
  const unified = unifiedRecoveryEngine(unifiedInput);

  // ── Injury impact ────────────────────────────────────────────────────────
  // No injury tracking exists yet; field reserved for future wiring.
  // // UI TODO: add injury store (active: boolean, severity: 0–3, area: string)
  // //          and thread it through here as:
  // //          injury_impact = clamp(100 - severity * 25, 0, 100)
  const injury_impact = 100;

  // ── Stage 6: Interpretation ───────────────────────────────────────────────
  // Translates raw dimension subscores into human-readable, athlete-friendly
  // language.  No numbers or percentages are included in the output strings.
  //
  // Input mapping:
  //   sleep_score      ← breakdown.sleep
  //   hrv_score        ← breakdown.hrv
  //   rhr_score        ← breakdown.hrv  (proxy; ScoreBreakdown has no separate RHR field)
  //   nutrition_score  ← breakdown.nutrition
  //   psychology_score ← moodRating (1–5, auto-normalised) or neutral fallback (75)
  //   load_today_score ← sessionLoadAU (AU → 0–100 via soft cap at 600 AU)
  const sessionLoadAU = deriveSessionLoadAU(todayPlan, entry);
  const interpretation = interpretFromBreakdown(
    finalScore.breakdown,
    finalScore.breakdown.hrv,   // rhrScore proxy
    moodRating ?? null,
    sessionLoadAU,
  );

  return {
    recovery_score,
    zone,
    recommendations: unified.recommendations,
    breakdown: {
      recovery_state,
      load_stress,
      injury_impact,
    },
    interpretation,
  };
}
